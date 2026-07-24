"""The agent-first CLI — JSON in, JSON out, parseable failures.

An agent calling this as a tool parses stdout and branches on the result. So the
contract under test is: stdout is always one JSON object, errors are named
rather than prose, and the exit code is non-zero when something failed.
"""
from __future__ import annotations

import json

import pytest

from teamwork.agent_cli import COMMANDS, _build_path, main, run


def _out(capsys) -> dict:
    return json.loads(capsys.readouterr().out.strip())


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("TEAMWORK_AGENT_KEY", raising=False)
    monkeypatch.setenv("TEAMWORK_API_KEY", "test-key")
    monkeypatch.setenv("TEAMWORK_URL", "http://teamwork.test")


# ── The output contract ──────────────────────────────────────────────────────

def test_help_lists_commands_and_exits_nonzero(capsys):
    assert main(["--help"]) == 2
    payload = _out(capsys)
    assert payload["ok"] is False and "message.post" in payload["commands"]


def test_unknown_command_is_named_not_prose(capsys):
    assert main(["message.yell", "{}"]) == 2
    assert _out(capsys)["error"] == "unknown_command"


def test_malformed_json_is_reported_as_json(capsys):
    assert main(["message.post", "{not json"]) == 2
    assert _out(capsys)["error"] == "bad_json"


def test_non_object_arguments_are_refused(capsys):
    assert main(["message.post", '["a"]']) == 2
    assert _out(capsys)["error"] == "bad_json"


def test_missing_path_argument_is_named(capsys):
    # project_id is part of the path; omitting it must not produce a URL with a
    # literal "{project_id}" in it.
    assert main(["message.post", '{"content":"hi"}']) == 2
    payload = _out(capsys)
    assert payload["error"] == "bad_arguments" and "project_id" in payload["detail"]


def test_missing_credential_is_named(capsys, monkeypatch):
    monkeypatch.delenv("TEAMWORK_API_KEY", raising=False)
    assert main(["projects.list", "{}"]) == 3
    assert _out(capsys)["error"] == "no_credential"


# ── Path building ────────────────────────────────────────────────────────────

def test_path_args_are_consumed_and_the_rest_becomes_the_body():
    path, rest = _build_path("/api/external/projects/{project_id}/messages",
                             {"project_id": "p1", "channel_id": "c1", "content": "hi"})
    assert path == "/api/external/projects/p1/messages"
    assert rest == {"channel_id": "c1", "content": "hi"}


def test_multi_segment_paths_are_filled():
    path, rest = _build_path(
        "/api/external/projects/{project_id}/agents/{agent_id}/status",
        {"project_id": "p1", "agent_id": "a1", "status": "working"})
    assert path == "/api/external/projects/p1/agents/a1/status"
    assert rest == {"status": "working"}


def test_every_command_maps_to_a_real_method():
    assert all(m in ("GET", "POST", "PATCH", "DELETE") for m, _ in COMMANDS.values())


# ── HTTP behaviour ───────────────────────────────────────────────────────────

def test_success_wraps_the_result(monkeypatch):
    import httpx

    def fake(method, url, **kw):
        assert kw["headers"]["X-API-Key"] == "test-key"
        return httpx.Response(201, json={"message_id": "m1"},
                              request=httpx.Request(method, url))
    monkeypatch.setattr(httpx, "request", fake)
    payload, code = run("message.post",
                        {"project_id": "p1", "channel_id": "c1", "content": "hi"})
    assert code == 0 and payload == {"ok": True, "result": {"message_id": "m1"}}


@pytest.mark.parametrize("status,name", [
    (401, "unauthorized"), (403, "not_granted"),
    (404, "not_found"), (503, "not_configured"), (500, "http_error"),
])
def test_http_failures_get_branchable_names(monkeypatch, status, name):
    import httpx

    monkeypatch.setattr(httpx, "request", lambda m, u, **k: httpx.Response(
        status, json={"detail": "nope"}, request=httpx.Request(m, u)))
    payload, code = run("projects.list", {})
    assert code == 1
    assert payload["error"] == name and payload["status"] == status


def test_unreachable_server_is_a_named_failure_not_a_traceback(monkeypatch):
    import httpx

    def boom(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(httpx, "request", boom)
    payload, code = run("projects.list", {})
    assert code == 4 and payload["error"] == "unreachable"
    assert "ConnectError" in payload["detail"]


def test_get_sends_args_as_query_not_body(monkeypatch):
    import httpx
    seen = {}

    def fake(method, url, **kw):
        seen.update(kw)
        return httpx.Response(200, json=[], request=httpx.Request(method, url))
    monkeypatch.setattr(httpx, "request", fake)
    run("events.read", {"project_id": "p1", "limit": 5})
    assert seen["params"] == {"limit": 5}
    assert not seen["content"]


# ── Signing (wired to agent_signing) ─────────────────────────────────────────

def test_requests_are_unsigned_unless_a_key_is_configured(monkeypatch):
    import httpx
    seen = {}
    monkeypatch.setattr(httpx, "request", lambda m, u, **k: (
        seen.update(k), httpx.Response(200, json={}, request=httpx.Request(m, u)))[1])
    run("projects.list", {})
    assert "X-Agent-Signature" not in seen["headers"]


def test_configuring_an_agent_key_signs_every_request(monkeypatch):
    import httpx

    from teamwork.agent_signing import generate_keypair, verify_envelope
    priv, pub = generate_keypair()
    monkeypatch.setenv("TEAMWORK_AGENT_KEY", priv)
    seen = {}

    def fake(method, url, **kw):
        seen.update(kw, method=method)
        return httpx.Response(201, json={}, request=httpx.Request(method, url))
    monkeypatch.setattr(httpx, "request", fake)
    run("message.post", {"project_id": "p1", "channel_id": "c1", "content": "hi"})

    h = seen["headers"]
    # The signature the CLI produced must verify server-side, unchanged.
    verify_envelope(pub, method="POST",
                    path="/api/external/projects/p1/messages",
                    timestamp=h["X-Agent-Timestamp"], nonce=h["X-Agent-Nonce"],
                    body=seen["content"], signature=h["X-Agent-Signature"])
