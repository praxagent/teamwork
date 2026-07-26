"""The MCP surface other agents use to work in TeamWork.

The tests that matter are the authorization ones. MCP is meant to be an adapter
over the credential model, not a way around it — so a key that cannot do
something through the REST API must not be able to do it through MCP either.

The per-space scoping is the headline: a key handed to a coding agent for one
project must not reach the rest of the workspace.
"""
from __future__ import annotations

import pytest

from teamwork.agent_auth import (
    CAP_ACTIVITY_WRITE,
    CAP_TASK_WRITE,
    AgentClient,
    _sha256,
)
from teamwork.mcp_server import (
    TOOL_CAPABILITIES,
    McpError,
    accessible_spaces,
    authorize,
    handle_initialize,
    handle_tools_list,
    tool_definitions,
)


def client(**kw) -> AgentClient:
    kw.setdefault("name", "codex")
    kw.setdefault("token_sha256", _sha256("t"))
    kw.setdefault("mcp", True)      # the grant itself is covered separately below
    return AgentClient(**kw)


# ── Per-space scoping — the point of the feature ─────────────────────────────

def test_a_scoped_key_reaches_only_its_space():
    c = client(spaces=frozenset({"project-a"}))
    assert c.may_touch_space("project-a") is True
    assert c.may_touch_space("project-b") is False


def test_an_unscoped_key_reaches_every_space():
    # Existing behaviour must not change for keys that never opted in.
    c = client()
    assert c.may_touch_space("anything") is True
    assert c.may_touch_space(None) is True


def test_a_scoped_key_is_refused_when_the_space_is_unspecified():
    # An omission must not silently widen a deliberately narrow key.
    c = client(spaces=frozenset({"project-a"}))
    assert c.may_touch_space(None) is False
    assert c.may_touch_space("") is False


def test_authorize_blocks_a_call_into_another_space():
    c = client(spaces=frozenset({"project-a"}), allow=frozenset({CAP_TASK_WRITE}))
    with pytest.raises(McpError, match="may not act on space"):
        authorize(c, "create_task", {"space": "project-b", "title": "x"})


def test_authorize_explains_a_missing_space_rather_than_guessing(): 
    c = client(spaces=frozenset({"project-a"}), allow=frozenset({CAP_TASK_WRITE}))
    with pytest.raises(McpError, match="must name one"):
        authorize(c, "create_task", {"title": "x"})


def test_a_key_can_be_scoped_to_several_spaces():
    c = client(spaces=frozenset({"a", "b"}))
    assert c.may_touch_space("a") and c.may_touch_space("b")
    assert not c.may_touch_space("c")


def test_listing_only_shows_spaces_the_key_may_see():
    scoped = client(spaces=frozenset({"a"}))
    assert accessible_spaces(scoped, ["a", "b", "c"]) == ["a"]
    assert accessible_spaces(client(), ["a", "b"]) == ["a", "b"]


def test_registry_accepts_spaces_as_a_list_or_csv():
    from tests.test_agent_auth import load_clients_from
    a, b = load_clients_from([
        {"name": "list", "token": "t1", "spaces": ["x", "y"]},
        {"name": "csv", "token": "t2", "spaces": "x, y"},
    ])
    assert a.spaces == frozenset({"x", "y"})
    assert b.spaces == frozenset({"x", "y"})


# ── MCP does not bypass the existing model ───────────────────────────────────

def test_a_capability_the_key_lacks_is_refused():
    c = client(allow=frozenset({"message.post"}))
    with pytest.raises(McpError, match="not granted"):
        authorize(c, "create_task", {"space": "a", "title": "x"})


def test_reads_need_no_capability():
    authorize(client(allow=frozenset()), "list_tasks", {"space": "a"})


def test_a_gated_capability_still_needs_a_human():
    # The approval gate must apply through MCP too, or it would be a way around.
    c = client(allow=frozenset({CAP_TASK_WRITE}), gated=frozenset({CAP_TASK_WRITE}))
    with pytest.raises(McpError, match="needs approval"):
        authorize(c, "create_task", {"space": "a", "title": "x"})


def test_an_unknown_tool_is_refused_before_anything_else_is_checked():
    # Ordering matters: an unknown tool must not leak whether a space exists.
    c = client(spaces=frozenset({"a"}))
    with pytest.raises(McpError, match="unknown tool"):
        authorize(c, "delete_everything", {"space": "b"})


def test_a_permitted_call_passes_cleanly():
    c = client(spaces=frozenset({"a"}), allow=frozenset({CAP_TASK_WRITE}))
    authorize(c, "create_task", {"space": "a", "title": "x"})


# ── The advertised surface ───────────────────────────────────────────────────

def test_every_advertised_tool_has_a_declared_capability():
    # A tool missing from the map cannot be called at all — so a new tool that
    # forgets its entry fails closed rather than open.
    for tool in tool_definitions():
        assert tool["name"] in TOOL_CAPABILITIES, tool["name"]


def test_every_space_tool_takes_the_space_explicitly():
    # An ambient "current space" would make the scoping check meaningless.
    for tool in tool_definitions():
        if tool["name"] in ("list_spaces", "post_comment"):
            continue
        assert "space" in tool["inputSchema"]["properties"], tool["name"]
        assert "space" in tool["inputSchema"].get("required", []), tool["name"]


def test_write_tools_require_a_write_capability():
    for name in ("create_task", "update_task", "create_note", "update_note",
                 "create_notebook", "comment_on_task"):
        assert TOOL_CAPABILITIES[name], f"{name} would be callable with no capability"


def test_read_tools_are_not_gated_behind_a_write_capability():
    for name in ("list_spaces", "list_tasks", "list_notebooks", "read_note"):
        assert TOOL_CAPABILITIES[name] == ""


def test_initialize_and_tools_list_shape():
    init = handle_initialize(1)["result"]
    assert init["serverInfo"]["name"] == "teamwork"
    assert "tools" in init["capabilities"]
    listing = handle_tools_list(2)["result"]["tools"]
    assert {t["name"] for t in listing} == set(TOOL_CAPABILITIES)


def test_the_comment_tool_says_it_is_one_way():
    # TJ was explicit: leave comments, do not join the conversation.
    comment = next(t for t in tool_definitions() if t["name"] == "post_comment")
    assert "one-way" in comment["description"].lower()


# ── Off by default, and fail-closed ──────────────────────────────────────────

def test_a_key_without_the_mcp_grant_is_refused():
    # REST access and MCP access are different decisions; one must not imply
    # the other.
    c = client(mcp=False, allow=frozenset({CAP_TASK_WRITE}))
    with pytest.raises(McpError, match="not granted MCP"):
        authorize(c, "create_task", {"space": "a", "title": "x"})


def test_the_mcp_grant_defaults_to_off():
    from teamwork.agent_auth import AgentClient as AC
    assert AC(name="x", token_sha256="y").mcp is False


def test_registry_grants_mcp_only_when_asked():
    from tests.test_agent_auth import load_clients_from
    off, on = load_clients_from([
        {"name": "plain", "token": "t1"},
        {"name": "mcp", "token": "t2", "mcp": True, "spaces": ["a"]},
    ])
    assert off.mcp is False
    assert on.mcp is True and on.spaces == frozenset({"a"})


def test_the_surface_does_not_exist_unless_enabled(monkeypatch):
    from teamwork.config import settings
    from teamwork.mcp_server import mcp_is_available
    monkeypatch.setattr(settings, "mcp_enabled", False, raising=False)
    assert mcp_is_available() is False


def test_enabling_without_granting_anything_changes_nothing(monkeypatch, tmp_path):
    # "Enabled" alone must never open a door.
    import json

    from teamwork.config import settings
    from teamwork.mcp_server import mcp_is_available

    reg = tmp_path / "clients.json"
    reg.write_text(json.dumps([{"name": "plain", "token": "t"}]))
    monkeypatch.setattr(settings, "mcp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", str(reg), raising=False)
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)
    assert mcp_is_available() is False


def test_enabled_plus_a_granted_key_makes_it_available(monkeypatch, tmp_path):
    import json

    from teamwork.config import settings
    from teamwork.mcp_server import mcp_is_available

    reg = tmp_path / "clients.json"
    reg.write_text(json.dumps([{"name": "codex", "token": "t", "mcp": True,
                                "spaces": ["project-a"]}]))
    monkeypatch.setattr(settings, "mcp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", str(reg), raising=False)
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)
    assert mcp_is_available() is True


# ── Handlers: what actually reaches Prax ─────────────────────────────────────

class FakePrax:
    """Records the Library calls a tool makes, and replies with canned data."""

    def __init__(self, replies=None):
        self.calls: list[tuple[str, str, dict]] = []
        self.replies = replies or {}

    async def __call__(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs.get("json") or {}))
        return self.replies.get((method, path), {"ok": True})


@pytest.fixture
def prax(monkeypatch):
    import teamwork.mcp_server as mod

    fake = FakePrax()
    monkeypatch.setattr(mod, "_prax", fake)
    return fake


async def _call(client_, tool, args, **kw):
    from teamwork.mcp_server import call_tool

    return await call_tool(client_, tool, args, **kw)


@pytest.mark.asyncio
async def test_create_task_posts_to_the_named_space(prax):
    await _call(client(allow=frozenset({CAP_TASK_WRITE})), "create_task",
                {"space": "proj-a", "title": "Ship it", "status": "doing"})
    method, path, body = prax.calls[0]
    assert (method, path) == ("POST", "/spaces/proj-a/tasks")
    assert body["title"] == "Ship it"
    assert body["column"] == "doing"


@pytest.mark.asyncio
async def test_status_change_goes_through_move_not_a_field_edit(prax):
    # The Kanban records a transition; a plain PATCH would lose it.
    await _call(client(allow=frozenset({CAP_TASK_WRITE})), "update_task",
                {"space": "proj-a", "task_id": "t1", "status": "done"})
    assert prax.calls == [("PATCH", "/spaces/proj-a/tasks/t1/move", {"column": "done"})]


@pytest.mark.asyncio
async def test_update_task_with_nothing_to_change_is_refused(prax):
    with pytest.raises(McpError, match="nothing to update"):
        await _call(client(allow=frozenset({CAP_TASK_WRITE})), "update_task",
                    {"space": "proj-a", "task_id": "t1"})


@pytest.mark.asyncio
async def test_a_comment_is_attributed_to_the_calling_key(prax):
    # Not to a generic "agent" — the board should say which one wrote it.
    await _call(client(name="codex", allow=frozenset({CAP_TASK_WRITE})),
                "comment_on_task",
                {"space": "proj-a", "task_id": "t1", "comment": "picked this up"})
    _, _, body = prax.calls[0]
    assert body == {"comment": "picked this up", "author": "codex"}


@pytest.mark.asyncio
async def test_missing_arguments_are_all_reported_at_once(prax):
    # One round trip per missing field is a waste of the agent's turn.
    with pytest.raises(McpError) as exc:
        await _call(client(allow=frozenset({CAP_ACTIVITY_WRITE})), "create_note",
                    {"space": "proj-a"})
    assert "notebook" in str(exc.value) and "title" in str(exc.value)
    assert not prax.calls


@pytest.mark.asyncio
async def test_list_spaces_hides_spaces_outside_the_key(monkeypatch):
    import teamwork.mcp_server as mod

    async def fake_prax(method, path, **kw):
        return {"spaces": [{"slug": "proj-a", "name": "A", "notebooks": []},
                           {"slug": "secret", "name": "S", "notebooks": []}]}

    monkeypatch.setattr(mod, "_prax", fake_prax)
    result = await _call(client(spaces=frozenset({"proj-a"})), "list_spaces", {})
    assert [s["slug"] for s in result["spaces"]] == ["proj-a"]


@pytest.mark.asyncio
async def test_a_refused_call_never_reaches_prax(prax):
    with pytest.raises(McpError):
        await _call(client(spaces=frozenset({"proj-a"}), allow=frozenset({CAP_TASK_WRITE})),
                    "create_task", {"space": "other", "title": "x"})
    assert prax.calls == []


@pytest.mark.asyncio
async def test_an_unconfigured_backend_says_so_rather_than_returning_nothing(monkeypatch):
    # The dangerous failure is an empty result for a call that never happened:
    # it reads as "there is nothing there" and the agent acts on that.
    from teamwork.config import settings
    from teamwork.mcp_server import _prax

    monkeypatch.setattr(settings, "prax_url", "", raising=False)
    with pytest.raises(McpError, match="PRAX_URL"):
        await _prax("GET", "")


# ── JSON-RPC envelope ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_refused_tool_is_a_tool_error_not_a_protocol_error(prax):
    # The agent should be able to read it, correct course and retry.
    from teamwork.mcp_server import handle_request

    resp = await handle_request(client(allow=frozenset()), {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "create_task", "arguments": {"space": "a", "title": "x"}}})
    assert "error" not in resp
    assert resp["result"]["isError"] is True
    assert "task.write" in resp["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_an_unknown_tool_is_a_protocol_error(prax):
    from teamwork.mcp_server import handle_request

    resp = await handle_request(client(), {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "rm_rf", "arguments": {}}})
    assert resp["error"]["code"] == -32601


@pytest.mark.asyncio
async def test_a_notification_gets_no_response():
    from teamwork.mcp_server import handle_request

    assert await handle_request(client(), {
        "jsonrpc": "2.0", "method": "notifications/initialized"}) is None


@pytest.mark.asyncio
async def test_tools_list_requires_the_mcp_grant():
    # Enumerating the surface is itself information; an ungranted key gets none.
    from teamwork.mcp_server import handle_request

    with pytest.raises(McpError, match="not granted MCP"):
        await handle_request(client(mcp=False), {
            "jsonrpc": "2.0", "id": 1, "method": "tools/list"})


@pytest.mark.asyncio
async def test_post_comment_is_refused_when_the_transport_cannot_do_it(prax):
    with pytest.raises(McpError, match="not available on this transport"):
        await _call(client(allow=frozenset({"message.post"})), "post_comment",
                    {"project_id": "p", "channel_id": "c", "content": "hi"})


@pytest.mark.asyncio
async def test_a_space_scoped_key_cannot_post_to_channels(prax):
    # Channels do not belong to a space, so a space-scoped key cannot be shown
    # to be staying inside its scope. Refuse rather than assume.
    with pytest.raises(McpError, match="channels do not belong to a space"):
        await _call(client(spaces=frozenset({"proj-a"}),
                           allow=frozenset({"message.post"})),
                    "post_comment",
                    {"project_id": "p", "channel_id": "c", "content": "hi"})


@pytest.mark.asyncio
async def test_an_unscoped_key_may_still_post(prax):
    # The restriction is a consequence of scoping, not a blanket ban.
    async def post(**kw):
        return {"posted": True}

    result = await _call(client(allow=frozenset({"message.post"})), "post_comment",
                         {"project_id": "p", "channel_id": "c", "content": "hi"},
                         post_comment=post)
    assert result == {"posted": True}


def test_every_spaceless_tool_is_answered_in_authorize():
    # A tool added to SPACELESS_TOOLS without a rule would skip scope checking
    # entirely. This fails the day someone adds one and forgets.
    from teamwork.mcp_server import SPACELESS_TOOLS

    assert SPACELESS_TOOLS == {"list_spaces", "post_comment"}, (
        "a new spaceless tool needs an explicit scope decision in authorize()")


# ── Telling the UI something changed ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_write_announces_itself(prax):
    """A card filed by an agent should appear without a reload.

    The Kanban query does not poll, so a write that did not come from the UI was
    invisible until someone refreshed — which is the one thing you will not
    think to do while a background agent is working.
    """
    seen = []

    async def on_change(**kw):
        seen.append(kw)

    await _call(client(allow=frozenset({CAP_TASK_WRITE})), "create_task",
                {"space": "proj-a", "title": "Ship it"}, on_change=on_change)
    assert seen == [{"space": "proj-a", "tool": "create_task"}]


@pytest.mark.asyncio
async def test_a_read_announces_nothing(prax):
    # Nothing changed, so there is nothing for anyone to refetch.
    seen = []

    async def on_change(**kw):
        seen.append(kw)

    await _call(client(), "list_tasks", {"space": "proj-a"}, on_change=on_change)
    assert seen == []


@pytest.mark.asyncio
async def test_a_refused_call_announces_nothing(prax):
    """The UI must not be told about a change that did not happen."""
    seen = []

    async def on_change(**kw):
        seen.append(kw)

    with pytest.raises(McpError):
        await _call(client(spaces=frozenset({"proj-a"}),
                           allow=frozenset({CAP_TASK_WRITE})),
                    "create_task", {"space": "other", "title": "x"},
                    on_change=on_change)
    assert seen == []


@pytest.mark.asyncio
async def test_a_failed_announcement_does_not_fail_the_write(prax):
    """The write already happened.

    Failing the call now would tell the agent its change was rejected when it
    was not. A reload still shows the truth, so a missed notification is the
    smaller harm.
    """
    async def on_change(**kw):
        raise RuntimeError("websocket is down")

    result = await _call(client(allow=frozenset({CAP_TASK_WRITE})), "create_task",
                         {"space": "proj-a", "title": "Ship it"},
                         on_change=on_change)
    assert result == {"ok": True}
    assert prax.calls, "the write still went through"
