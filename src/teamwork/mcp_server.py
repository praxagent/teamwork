"""An MCP surface so other agents can work in TeamWork.

Claude Code, Codex and anything else that speaks the Model Context Protocol can
file Kanban items, write notes and notebooks, and leave comments — **without
becoming a chat participant**. They act on the workspace, they do not converse
in it.

**This is an adapter, not a new trust boundary.** Everything an MCP call is
allowed to do is decided by the credential model that already exists: a token
resolves to one :class:`AgentClient`, its capability set bounds what it may do,
its ``gated`` set forces destructive actions through a human, and every action
lands in the hash-chained event log. MCP adds a protocol, not a bypass.

**Keys are scoped to a space.** A credential naming ``spaces`` may only touch
those spaces. That is the difference between "give this coding agent access to
the project it is working on" and "give it my whole workspace" — and a caller
that does not say which space it means is refused rather than allowed, so an
omission can never silently widen a narrow key.

**Writes are git-backed.** Notes, notebooks and space tasks live as files in the
agent's git-tracked workspace, so a bad write is recoverable by reverting a
commit rather than by hoping someone kept a copy. That is why these tools target
the Library rather than TeamWork's own SQLite tables — rollback was a
requirement, and only one of those two can honour it.

Transport is JSON-RPC over a single ``POST /mcp`` endpoint, matching Prax's own
MCP server: no SDK dependency, and one thing to secure.
"""
from __future__ import annotations

import logging
from typing import Any

from teamwork.agent_auth import (
    CAP_ACTIVITY_WRITE,
    CAP_MESSAGE_POST,
    CAP_TASK_WRITE,
    AgentClient,
)

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "teamwork"


class McpError(Exception):
    """A tool call was refused. The message is shown to the calling agent."""

    def __init__(self, message: str, code: int = -32000):
        super().__init__(message)
        self.code = code


# Each tool declares the capability it needs, so authorisation is data rather
# than a rule buried in a handler. A tool with no entry here cannot be called.
TOOL_CAPABILITIES: dict[str, str] = {
    "list_spaces": "",                       # read
    "list_tasks": "",
    "create_task": CAP_TASK_WRITE,
    "update_task": CAP_TASK_WRITE,
    "comment_on_task": CAP_TASK_WRITE,
    "list_notebooks": "",
    "create_notebook": CAP_ACTIVITY_WRITE,
    "create_note": CAP_ACTIVITY_WRITE,
    "update_note": CAP_ACTIVITY_WRITE,
    "read_note": "",
    "post_comment": CAP_MESSAGE_POST,
}

# Tools that change something. A caller watching the UI should see the result
# without reloading, so these announce themselves; reads say nothing.
MUTATING_TOOLS = frozenset({
    "create_task", "update_task", "comment_on_task",
    "create_notebook", "create_note", "update_note",
})

# Tools that take no ``space`` argument, and so cannot be checked against a
# space-scoped key the ordinary way. Each needs its own answer in `authorize`;
# adding a tool here without one is how a scope check gets silently skipped.
SPACELESS_TOOLS = frozenset({"list_spaces", "post_comment"})


def tool_definitions() -> list[dict[str, Any]]:
    """The tool list advertised to a connecting agent.

    Every tool takes ``space`` explicitly rather than inferring a "current"
    one. An agent holding a space-scoped key must name the space it means, and
    an ambient default would make that check meaningless.
    """
    space = {"type": "string", "description": "Library space slug to act in."}
    return [
        {
            "name": "list_spaces",
            "description": "List the Library spaces this key may access.",
            "inputSchema": {"type": "object", "properties": {}},
        },
        {
            "name": "list_tasks",
            "description": "List Kanban tasks in a space.",
            "inputSchema": {
                "type": "object",
                "properties": {"space": space,
                               "status": {"type": "string",
                                          "description": "Optional status filter."}},
                "required": ["space"],
            },
        },
        {
            "name": "create_task",
            "description": "Add a Kanban task to a space.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "space": space,
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "status": {"type": "string", "description": "todo | doing | done"},
                    "assignees": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["space", "title"],
            },
        },
        {
            "name": "update_task",
            "description": "Update a Kanban task's title, description or status.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "space": space,
                    "task_id": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "status": {"type": "string"},
                },
                "required": ["space", "task_id"],
            },
        },
        {
            "name": "comment_on_task",
            "description": "Add a comment to a Kanban task.",
            "inputSchema": {
                "type": "object",
                "properties": {"space": space, "task_id": {"type": "string"},
                               "comment": {"type": "string"}},
                "required": ["space", "task_id", "comment"],
            },
        },
        {
            "name": "list_notebooks",
            "description": "List notebooks in a space.",
            "inputSchema": {"type": "object", "properties": {"space": space},
                            "required": ["space"]},
        },
        {
            "name": "create_notebook",
            "description": "Create a notebook inside a space.",
            "inputSchema": {
                "type": "object",
                "properties": {"space": space, "name": {"type": "string"},
                               "description": {"type": "string"}},
                "required": ["space", "name"],
            },
        },
        {
            "name": "create_note",
            "description": "Write a note into a notebook.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "space": space,
                    "notebook": {"type": "string"},
                    "title": {"type": "string"},
                    "content": {"type": "string", "description": "Markdown body."},
                },
                "required": ["space", "notebook", "title", "content"],
            },
        },
        {
            "name": "read_note",
            "description": "Read a note's content.",
            "inputSchema": {
                "type": "object",
                "properties": {"space": space, "notebook": {"type": "string"},
                               "note": {"type": "string"}},
                "required": ["space", "notebook", "note"],
            },
        },
        {
            "name": "update_note",
            "description": "Replace a note's content.",
            "inputSchema": {
                "type": "object",
                "properties": {"space": space, "notebook": {"type": "string"},
                               "note": {"type": "string"}, "content": {"type": "string"}},
                "required": ["space", "notebook", "note", "content"],
            },
        },
        {
            "name": "post_comment",
            "description": (
                "Post a message into a channel. One-way: this leaves a comment, "
                "it does not join a conversation or read replies."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {"project_id": {"type": "string"},
                               "channel_id": {"type": "string"},
                               "content": {"type": "string"}},
                "required": ["project_id", "channel_id", "content"],
            },
        },
    ]


def mcp_is_available() -> bool:
    """Whether the MCP surface should exist at all.

    Fail-closed twice over: the deployment must enable it, AND at least one
    credential must actually grant MCP. Switching the flag on without granting
    anything changes nothing, so "enabled" alone never opens a door.
    """
    from teamwork.config import settings

    if not getattr(settings, "mcp_enabled", False):
        return False

    from teamwork.agent_auth import load_clients

    clients = load_clients(getattr(settings, "agent_clients_path", "") or None,
                           getattr(settings, "external_api_key", "") or None)
    return any(c.mcp for c in clients)


def require_mcp_client(client: AgentClient) -> None:
    """Refuse a credential that was not granted the MCP surface.

    Being allowed to call the REST API is a different decision from letting an
    arbitrary MCP client connect as you, so it needs its own grant rather than
    riding along on the capability set.
    """
    if not client.mcp:
        raise McpError("this key is not granted MCP access")


def authorize(client: AgentClient, tool: str, arguments: dict[str, Any]) -> None:
    """Refuse a call the credential is not entitled to make.

    Checked in this order on purpose — an unknown tool should not leak whether
    a space exists, and a space refusal should not depend on capability.
    """
    require_mcp_client(client)

    if tool not in TOOL_CAPABILITIES:
        raise McpError(f"unknown tool: {tool}", code=-32601)

    if tool in SPACELESS_TOOLS:
        # `list_spaces` needs no check because it filters its own output to what
        # the key may see. `post_comment` addresses a *channel*, and there is no
        # mapping from a channel to a space — so a space-scoped key cannot be
        # shown to be staying inside its scope, and is refused rather than
        # assumed safe. A narrow key must not become broad by changing subject.
        if tool == "post_comment" and client.spaces:
            raise McpError(
                "this key is scoped to specific spaces, and channels do not "
                "belong to a space — a space-scoped key cannot post comments")
    elif not client.may_touch_space(arguments.get("space")):
        if client.spaces and not arguments.get("space"):
            raise McpError(
                "this key is scoped to specific spaces, so the call must name "
                "one — refusing rather than guessing")
        raise McpError(f"this key may not act on space {arguments.get('space')!r}")

    needed = TOOL_CAPABILITIES[tool]
    if needed and not client.can(needed):
        raise McpError(f"this key is not granted '{needed}'")

    if needed and client.needs_approval(needed):
        raise McpError(
            f"'{tool}' needs approval for this key. Ask a human to approve it, "
            "then retry.")


def accessible_spaces(client: AgentClient, all_slugs: list[str]) -> list[str]:
    """The spaces this key may see — its own, or everything if unscoped."""
    if not client.spaces:
        return list(all_slugs)
    return [s for s in all_slugs if s in client.spaces]


def jsonrpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def jsonrpc_error(request_id: Any, message: str, code: int = -32000) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id,
            "error": {"code": code, "message": message}}


def handle_initialize(request_id: Any) -> dict[str, Any]:
    return jsonrpc_result(request_id, {
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": SERVER_NAME, "version": "1"},
    })


def handle_tools_list(request_id: Any) -> dict[str, Any]:
    return jsonrpc_result(request_id, {"tools": tool_definitions()})


# ---------------------------------------------------------------------------
# Talking to the Library
# ---------------------------------------------------------------------------

async def _prax(method: str, path: str, **kwargs: Any) -> Any:
    """Call Prax's Library API, or raise.

    Deliberately *not* the routers' proxy helper, which returns ``None`` on
    failure so a panel can render an empty state. Handing an agent an empty
    result for a call that never happened is the failure mode that is hardest
    to notice: it reads as "there is nothing there" and it will act on that.
    A refusal it can see beats a silence it cannot.
    """
    import httpx

    from teamwork.config import settings

    base = (getattr(settings, "prax_url", "") or "").rstrip("/")
    if not base:
        raise McpError("TeamWork has no Prax backend configured (PRAX_URL is unset), "
                       "so Library reads and writes cannot be served.")
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.request(method, f"{base}/teamwork/library{path}", **kwargs)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        detail = ""
        try:
            detail = str(exc.response.json().get("error", ""))[:300]
        except Exception:
            detail = exc.response.text[:300]
        raise McpError(
            f"Prax refused {method} {path} ({exc.response.status_code})"
            + (f": {detail}" if detail else "")) from exc
    except Exception as exc:
        logger.warning("MCP call to Prax failed: %s %s: %s", method, path, exc)
        raise McpError(f"Prax backend unreachable: {exc}") from exc


def _require(arguments: dict[str, Any], *names: str) -> list[Any]:
    """Pull required arguments, naming every one that is missing at once.

    An agent that gets told about one missing field at a time burns a round
    trip per field.
    """
    missing = [n for n in names if not arguments.get(n)]
    if missing:
        raise McpError(f"missing required argument(s): {', '.join(missing)}",
                       code=-32602)
    return [arguments[n] for n in names]


async def _list_spaces(client: AgentClient) -> Any:
    tree = await _prax("GET", "")
    slugs = [s.get("slug") for s in (tree.get("spaces") or []) if s.get("slug")]
    visible = set(accessible_spaces(client, slugs))
    return {"spaces": [
        {"slug": s.get("slug"), "name": s.get("name") or s.get("slug"),
         "notebooks": [n.get("name") for n in (s.get("notebooks") or [])]}
        for s in (tree.get("spaces") or []) if s.get("slug") in visible]}


async def _dispatch_library(tool: str, arguments: dict[str, Any],
                            client: AgentClient) -> Any:
    """Run one Library-backed tool. Authorisation has already happened."""
    if tool == "list_spaces":
        return await _list_spaces(client)

    if tool == "list_tasks":
        (space,) = _require(arguments, "space")
        path = f"/spaces/{space}/tasks"
        if arguments.get("status"):
            path += f"?column={arguments['status']}"
        return await _prax("GET", path)

    if tool == "create_task":
        space, title = _require(arguments, "space", "title")
        body = {"title": title,
                "description": arguments.get("description", ""),
                "assignees": arguments.get("assignees") or []}
        if arguments.get("status"):
            body["column"] = arguments["status"]
        return await _prax("POST", f"/spaces/{space}/tasks", json=body)

    if tool == "update_task":
        space, task_id = _require(arguments, "space", "task_id")
        body = {k: arguments[k] for k in ("title", "description")
                if arguments.get(k) is not None}
        result: dict[str, Any] = {}
        if body:
            result = await _prax("PATCH", f"/spaces/{space}/tasks/{task_id}", json=body)
        if arguments.get("status"):
            # Column changes go through /move — the Kanban records a transition,
            # not just a field edit, and the activity log depends on it.
            result = await _prax("PATCH", f"/spaces/{space}/tasks/{task_id}/move",
                                 json={"column": arguments["status"]})
        if not result:
            raise McpError("nothing to update: give at least one of title, "
                           "description or status")
        return result

    if tool == "comment_on_task":
        space, task_id, comment = _require(arguments, "space", "task_id", "comment")
        return await _prax("POST", f"/spaces/{space}/tasks/{task_id}/comment",
                           json={"comment": comment, "author": client.name})

    if tool == "list_notebooks":
        (space,) = _require(arguments, "space")
        tree = await _prax("GET", "")
        for entry in tree.get("spaces") or []:
            if entry.get("slug") == space:
                return {"notebooks": [
                    {"name": n.get("name"),
                     "notes": [x.get("slug") for x in (n.get("notes") or [])]}
                    for n in (entry.get("notebooks") or [])]}
        raise McpError(f"no such space: {space!r}")

    if tool == "create_notebook":
        space, name = _require(arguments, "space", "name")
        return await _prax("POST", f"/spaces/{space}/notebooks",
                           json={"name": name,
                                 "description": arguments.get("description", "")})

    if tool == "create_note":
        space, notebook, title, content = _require(
            arguments, "space", "notebook", "title", "content")
        return await _prax("POST", "/notes", json={
            "project": space, "notebook": notebook, "title": title,
            "content": content, "author": client.name})

    if tool == "read_note":
        space, notebook, note = _require(arguments, "space", "notebook", "note")
        return await _prax("GET", f"/notes/{space}/{notebook}/{note}")

    if tool == "update_note":
        space, notebook, note, content = _require(
            arguments, "space", "notebook", "note", "content")
        return await _prax("PATCH", f"/notes/{space}/{notebook}/{note}",
                           json={"content": content})

    raise McpError(f"unknown tool: {tool}", code=-32601)


async def call_tool(client: AgentClient, tool: str, arguments: dict[str, Any],
                    *, post_comment: Any = None, on_change: Any = None) -> Any:
    """Authorise and run one tool call.

    ``post_comment`` and ``on_change`` are injected by the route because both
    need things only the HTTP layer has — a request-scoped database session, and
    the websocket manager. Everything else goes to the Library over HTTP and
    needs neither, which is why this module stays testable without a running app.

    ``on_change`` fires only after a mutation actually succeeded. Announcing the
    attempt would put the UI a step ahead of the data: it would refetch, see the
    old state, and quietly disagree with what the agent was told.
    """
    authorize(client, tool, arguments)

    if tool == "post_comment":
        project_id, channel_id, content = _require(
            arguments, "project_id", "channel_id", "content")
        if post_comment is None:
            raise McpError("posting comments is not available on this transport")
        return await post_comment(project_id=project_id, channel_id=channel_id,
                                  content=content)

    result = await _dispatch_library(tool, arguments, client)

    if on_change is not None and tool in MUTATING_TOOLS:
        try:
            await on_change(space=arguments.get("space"), tool=tool)
        except Exception:  # noqa: BLE001
            # The write already happened. Failing the call now would tell the
            # agent its change was rejected when it was not — a reload still
            # shows the truth, so a missed notification is the smaller harm.
            logger.warning("could not announce an MCP change to the UI",
                           exc_info=True)

    return result


async def handle_request(client: AgentClient, payload: dict[str, Any],
                         *, post_comment: Any = None,
                         on_change: Any = None) -> dict[str, Any] | None:
    """Handle one JSON-RPC request. Returns ``None`` for a notification."""
    request_id = payload.get("id")
    method = payload.get("method") or ""

    if method == "initialize":
        return handle_initialize(request_id)
    if method == "notifications/initialized":
        return None                       # notification: no id, no response
    if method == "tools/list":
        require_mcp_client(client)
        return handle_tools_list(request_id)
    if method == "ping":
        return jsonrpc_result(request_id, {})
    if method != "tools/call":
        return jsonrpc_error(request_id, f"unknown method: {method}", code=-32601)

    params = payload.get("params") or {}
    tool = params.get("name") or ""
    arguments = params.get("arguments") or {}
    try:
        result = await call_tool(client, tool, arguments,
                                 post_comment=post_comment, on_change=on_change)
    except McpError as exc:
        # A refused or failed tool call is reported as a tool result with
        # isError, not a protocol error: the agent should read it, correct
        # course and retry, which a transport-level failure does not invite.
        if exc.code == -32601:
            return jsonrpc_error(request_id, str(exc), code=exc.code)
        return jsonrpc_result(request_id, {
            "content": [{"type": "text", "text": str(exc)}], "isError": True})

    import json as _json

    return jsonrpc_result(request_id, {
        "content": [{"type": "text", "text": _json.dumps(result, default=str)}],
        "isError": False})
