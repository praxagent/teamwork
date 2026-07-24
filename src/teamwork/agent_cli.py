"""``teamwork-agent`` — JSON in, JSON out, shaped for an LLM tool call.

The REST API is designed for a program that already knows HTTP: build a client,
set headers, choose a method, handle status codes, sign the envelope. An agent
calling a *tool* wants none of that. It wants one command, one JSON object in,
one JSON object out, and a non-zero exit when something failed.

So this is a thin translation layer, not a second API. Every command maps to
exactly one endpoint; nothing is cached, batched or interpreted. The value is
that adding a **non-Prax** agent to a workspace stops requiring an HTTP
integration — it needs a shell.

    $ teamwork-agent message.post '{"project_id":"p1","channel_id":"c1","content":"hi"}'
    {"ok": true, "result": {"message_id": "..."}}

    $ teamwork-agent events.verify '{}'
    {"ok": true, "result": {"ok": true, "checked": 42, "broken_at": null}}

Errors are JSON on **stdout** too, with a non-zero exit — an agent parsing
stdout should never have to also parse stderr to find out what went wrong::

    {"ok": false, "error": "not_granted", "detail": "…", "status": 403}

Config comes from the environment, so the credential never appears in a command
line (where it would land in shell history and process listings):

    TEAMWORK_URL          default http://localhost:8000
    TEAMWORK_API_KEY      required — sent as X-API-Key
    TEAMWORK_AGENT_KEY    optional Ed25519 private key (base64); when set, every
                          request is signed (see agent_signing)
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any

# command -> (HTTP method, path template, {json body keys})
# The path template consumes its own args; everything else becomes the body (for
# writes) or the query string (for reads).
COMMANDS: dict[str, tuple[str, str]] = {
    "projects.list":    ("GET", "/api/external/projects"),
    "project.create":   ("POST", "/api/external/projects"),
    "channels.ensure":  ("POST", "/api/external/projects/{project_id}/ensure-channels"),
    "agent.register":   ("POST", "/api/external/projects/{project_id}/agents"),
    "agent.status":     ("PATCH", "/api/external/projects/{project_id}/agents/{agent_id}/status"),
    "message.post":     ("POST", "/api/external/projects/{project_id}/messages"),
    "typing":           ("POST", "/api/external/projects/{project_id}/typing"),
    "live_output.push": ("POST", "/api/external/projects/{project_id}/agents/{agent_id}/live-output"),
    "task.create":      ("POST", "/api/external/projects/{project_id}/tasks"),
    "task.update":      ("PATCH", "/api/external/projects/{project_id}/tasks/{task_id}"),
    "events.read":      ("GET", "/api/external/projects/{project_id}/events"),
    "events.verify":    ("GET", "/api/external/events/verify"),
}


def _emit(obj: dict[str, Any], code: int = 0) -> int:
    """One JSON object on stdout. Always. Including for failures."""
    print(json.dumps(obj, default=str))
    return code


def _usage() -> int:
    return _emit({
        "ok": False,
        "error": "usage",
        "detail": "teamwork-agent <command> '<json>'",
        "commands": sorted(COMMANDS),
    }, 2)


def _build_path(template: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Fill the path from *args* and return the leftovers as body/query."""
    rest = dict(args)
    path = template
    for key in list(rest):
        token = "{" + key + "}"
        if token in path:
            path = path.replace(token, str(rest.pop(key)))
    missing = [p.split("}")[0] for p in path.split("{")[1:]]
    if missing:
        raise KeyError(f"missing required argument(s): {', '.join(missing)}")
    return path, rest


def _sign(headers: dict[str, str], method: str, path: str, body: bytes) -> None:
    """Attach a signed envelope when an agent key is configured."""
    key = os.environ.get("TEAMWORK_AGENT_KEY", "").strip()
    if not key:
        return
    from teamwork.agent_signing import sign_envelope

    ts, nonce = str(int(time.time())), uuid.uuid4().hex
    headers["X-Agent-Timestamp"] = ts
    headers["X-Agent-Nonce"] = nonce
    headers["X-Agent-Signature"] = sign_envelope(
        key, method=method, path=path, timestamp=ts, nonce=nonce, body=body)


def run(command: str, args: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Execute one command. Returns ``(payload, exit_code)``."""
    import httpx

    if command not in COMMANDS:
        return {"ok": False, "error": "unknown_command", "detail": command,
                "commands": sorted(COMMANDS)}, 2

    method, template = COMMANDS[command]
    try:
        path, rest = _build_path(template, args)
    except KeyError as exc:
        return {"ok": False, "error": "bad_arguments", "detail": str(exc)}, 2

    base = os.environ.get("TEAMWORK_URL", "http://localhost:8000").rstrip("/")
    api_key = os.environ.get("TEAMWORK_API_KEY", "")
    if not api_key:
        return {"ok": False, "error": "no_credential",
                "detail": "TEAMWORK_API_KEY is not set; TeamWork's external API "
                          "requires a credential."}, 3

    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    params = rest if method == "GET" else None
    body = b"" if method == "GET" else json.dumps(rest).encode("utf-8")
    _sign(headers, method, path, body)

    try:
        resp = httpx.request(method, base + path, headers=headers, params=params,
                             content=body or None, timeout=30.0)
    except Exception as exc:  # noqa: BLE001 - the agent gets a parseable failure
        return {"ok": False, "error": "unreachable",
                "detail": f"{type(exc).__name__}: {exc}", "url": base + path}, 4

    try:
        parsed = resp.json()
    except ValueError:
        parsed = {"raw": resp.text[:2000]}

    if resp.is_success:
        return {"ok": True, "result": parsed}, 0
    # Map the statuses this API actually uses to names an agent can branch on,
    # instead of making it pattern-match prose.
    named = {401: "unauthorized", 403: "not_granted", 404: "not_found",
             503: "not_configured"}.get(resp.status_code, "http_error")
    detail = parsed.get("detail") if isinstance(parsed, dict) else None
    return {"ok": False, "error": named, "status": resp.status_code,
            "detail": detail or parsed}, 1


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        return _usage()

    command, raw = argv[0], (argv[1] if len(argv) > 1 else "{}")
    try:
        args = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        return _emit({"ok": False, "error": "bad_json", "detail": str(exc)}, 2)
    if not isinstance(args, dict):
        return _emit({"ok": False, "error": "bad_json",
                      "detail": "arguments must be a JSON object"}, 2)

    payload, code = run(command, args)
    return _emit(payload, code)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
