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
