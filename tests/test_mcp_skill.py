"""The skill a user pastes into their coding agent.

Its job is not to list the tools — the protocol already does that. It is to
teach the one judgement a harness cannot infer from a schema: what belongs on a
human's board and what is the agent's own working memory.

These tests are about the properties that make it safe to paste, plus the
guidance that stops a connected agent from ruining the board.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from teamwork import mcp_skill


def test_the_skill_names_the_space_it_was_generated_for():
    # A template with a blank to fill in is a step someone skips, and a skill
    # naming the wrong space writes into the wrong space without complaining.
    md = mcp_skill.skill_markdown(space="project-a", space_name="Project A")
    assert "project-a" in md
    assert "Project A" in md


def test_it_never_carries_a_live_token():
    """It gets pasted into repos and chat windows. It must be safe there."""
    md = mcp_skill.skill_markdown(space="project-a", server_url="https://x/mcp")
    assert "<your-key>" in md
    md2 = mcp_skill.skill_markdown(space="a", token_hint="<your-key>")
    assert "sk-" not in md2


def test_it_teaches_the_wall_between_a_board_and_working_memory():
    """The failure this exists to prevent: fifty rows of 'run the tests'.

    An agent with write access and no guidance either does nothing or dumps its
    scratch list onto the board, burying the human's view of the work.
    """
    flat = " ".join(mcp_skill.skill_markdown(space="a").split())
    assert "working memory" in flat
    assert "does not go on someone else's wall" in flat


def test_it_asks_for_a_read_before_a_write():
    # A duplicate board is a board people stop reading.
    md = mcp_skill.skill_markdown(space="a")
    assert "list_tasks" in md


def test_it_carries_the_honesty_rule():
    # A board is only worth having if it can be trusted without checking.
    flat = " ".join(mcp_skill.skill_markdown(space="a").split())
    assert "If tests fail, the card is not done." in flat


@pytest.mark.asyncio
async def test_the_url_comes_from_where_the_user_is_browsing():
    """A backend that knows itself as localhost hands a tailnet user a dead URL.

    Same lesson as the Grafana deep-link: the failure looks like a broken
    feature rather than a wrong address.
    """
    from teamwork.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport,
                           base_url="https://teamwork.example.ts.net") as c:
        r = await c.get("/api/mcp/skill", params={"space": "project-a"})
    assert r.status_code == 200
    body = r.json()
    assert "teamwork.example.ts.net/mcp" in body["skill"]
    assert body["token_included"] is False


@pytest.mark.asyncio
async def test_status_separates_not_enabled_from_nothing_granted(monkeypatch):
    """Two different fixes. Calling both "off" sends the user to the wrong one."""
    from teamwork.config import settings
    from teamwork.main import app

    monkeypatch.setattr(settings, "mcp_enabled", False, raising=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        off = (await c.get("/api/mcp/status")).json()
    assert off["available"] is False
    assert "MCP_ENABLED" in off["reason"]

    monkeypatch.setattr(settings, "mcp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", "", raising=False)
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        ungranted = (await c.get("/api/mcp/status")).json()
    assert ungranted["available"] is False
    assert "no credential" in ungranted["reason"]


@pytest.mark.asyncio
async def test_status_lists_only_the_keys_that_reach_this_space(monkeypatch, tmp_path):
    import json

    from teamwork.config import settings
    from teamwork.main import app

    reg = tmp_path / "clients.json"
    reg.write_text(json.dumps([
        {"name": "for-a", "token": "t1", "mcp": True, "spaces": ["project-a"]},
        {"name": "for-b", "token": "t2", "mcp": True, "spaces": ["project-b"]},
        {"name": "no-mcp", "token": "t3"},
    ]))
    monkeypatch.setattr(settings, "mcp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", str(reg), raising=False)
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        body = (await c.get("/api/mcp/status", params={"space": "project-a"})).json()

    assert [k["name"] for k in body["keys_for_space"]] == ["for-a"]
    assert body["granted_keys"] == 2, "the count is of MCP keys, not of matches"


# ── Enabling a space from the UI ─────────────────────────────────────────────

@pytest.fixture
def registry(monkeypatch, tmp_path):
    path = tmp_path / "agent-clients.json"
    monkeypatch.setattr("teamwork.config.settings.agent_clients_path",
                        str(path), raising=False)
    return path


@pytest.mark.asyncio
async def test_enabling_a_space_returns_a_working_connect_command(registry):
    """The one moment the user has the token is the moment they need it."""
    from teamwork.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport,
                           base_url="https://tw.example.ts.net") as c:
        body = (await c.post("/api/mcp/spaces/project-a/enable")).json()

    assert body["token"] in body["connect"]
    assert "tw.example.ts.net/mcp" in body["connect"]
    assert "shown once" in body["warning"]


@pytest.mark.asyncio
async def test_the_skill_still_ships_a_placeholder_after_enabling(registry):
    """The connect command carries the token; the skill must not.

    The skill gets committed and pasted into chat threads. The connect command
    is read once and typed into a config.
    """
    from teamwork.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        enabled = (await c.post("/api/mcp/spaces/project-a/enable")).json()
        skill = (await c.get("/api/mcp/skill",
                             params={"space": "project-a"})).json()

    assert enabled["token"] not in skill["skill"]
    assert "<your-key>" in skill["skill"]


@pytest.mark.asyncio
async def test_status_shows_a_space_as_granted_after_enabling(registry, monkeypatch):
    from teamwork.config import settings
    from teamwork.main import app

    monkeypatch.setattr(settings, "mcp_enabled", True, raising=False)
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        before = (await c.get("/api/mcp/status",
                              params={"space": "project-a"})).json()
        assert before["granted"] is False

        await c.post("/api/mcp/spaces/project-a/enable")
        after = (await c.get("/api/mcp/status",
                             params={"space": "project-a"})).json()

    assert after["granted"] is True
    assert after["available"] is True, "a grant should take effect without a restart"


@pytest.mark.asyncio
async def test_disabling_removes_the_grant(registry):
    from teamwork.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        await c.post("/api/mcp/spaces/project-a/enable")
        body = (await c.delete("/api/mcp/spaces/project-a/enable")).json()
        status = (await c.get("/api/mcp/status",
                              params={"space": "project-a"})).json()

    assert body["revoked"] is True
    assert status["granted"] is False


@pytest.mark.asyncio
async def test_a_broken_registry_is_a_400_not_a_500(registry):
    """The user can fix a bad file; they cannot fix a stack trace."""
    from teamwork.main import app

    registry.write_text("{ not json")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.post("/api/mcp/spaces/project-a/enable")

    assert r.status_code == 400
    assert "not readable JSON" in r.json()["detail"]
