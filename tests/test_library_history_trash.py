"""Library history, trash and safe saves — TeamWork's side.

TeamWork relays Prax's answers with their status (a stale save's 409 carries
the current note), broadcasts Prax's "library changed" nudges (names only),
and passes an MCP agent's own name as the editor of its note edits.
"""
from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from teamwork import mcp_server
from teamwork.agent_auth import AgentClient
from teamwork.routers import external
from teamwork.routers import library as lib


# --- relaying Prax, with Prax's status ----------------------------------------------

class _Client:
    def __init__(self, responder):
        self.responder, self.calls = responder, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def request(self, method, url, **kw):
        self.calls.append((method, url, kw.get("json")))
        return self.responder(method, url, kw.get("json"))


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(lib.settings, "prax_url", "http://prax.test")
    a = FastAPI()
    a.include_router(lib.router, prefix="/api")
    return a


def _use(monkeypatch, responder):
    client = _Client(responder)
    monkeypatch.setattr(lib, "prax_client", lambda timeout: client)
    return client


def test_a_stale_save_comes_back_as_409_with_the_current_note(app, monkeypatch):
    current = {"meta": {"updated_at": "2026-10-04T12:00:00", "last_edited_by": "prax"}, "content": "Prax's"}
    _use(monkeypatch, lambda m, u, b: httpx.Response(
        409, json={"error": "changed since it was opened", "conflict": True, "current": current}))
    resp = TestClient(app).patch("/api/library/notes/s/n/x",
                                 json={"content": "mine", "expected_updated_at": "old"})
    assert resp.status_code == 409 and resp.json()["current"] == current


def test_history_and_trash_routes_reach_prax(app, monkeypatch):
    calls = _use(monkeypatch, lambda m, u, b: httpx.Response(200, json={"ok": True}))
    c = TestClient(app)
    c.get("/api/library/notes/s/n/x/history")
    c.get("/api/library/notes/s/n/x/history/abc1234")
    c.post("/api/library/notes/s/n/x/history/abc1234/restore")
    c.get("/api/library/trash")
    c.post("/api/library/trash/20261004T120000-a1b2c3/restore")
    c.delete("/api/library/trash/20261004T120000-a1b2c3")
    assert [(m, u.replace("http://prax.test/teamwork/library", "")) for m, u, _ in calls.calls] == [
        ("GET", "/notes/s/n/x/history"), ("GET", "/notes/s/n/x/history/abc1234"),
        ("POST", "/notes/s/n/x/history/abc1234/restore"), ("GET", "/trash"),
        ("POST", "/trash/20261004T120000-a1b2c3/restore"), ("DELETE", "/trash/20261004T120000-a1b2c3")]


def test_a_refused_restore_says_why(app, monkeypatch):
    _use(monkeypatch, lambda m, u, b: httpx.Response(409, json={"error": "Its notebook is gone"}))
    resp = TestClient(app).post("/api/library/trash/20261004T120000-a1b2c3/restore")
    assert resp.status_code == 409 and "notebook is gone" in resp.json()["error"]


# --- Prax's "library changed" nudge -------------------------------------------------

def _project(client):
    return client.post("/api/external/projects", json={
        "name": "P", "webhook_url": "http://agent:9000/webhook"}).json()["project_id"]


def test_library_changed_is_broadcast_names_only(client, monkeypatch):
    sent = []

    async def capture(event):
        sent.append(event)
    monkeypatch.setattr(external.manager, "broadcast_all", capture)
    pid = _project(client)
    resp = client.post(f"/api/external/projects/{pid}/library-changed", json={
        "space": "linear-algebra", "notebook": "lectures", "slug": "eigenvalues",
        "action": "edited", "actor": "prax", "content": "should never be relayed"})
    assert resp.status_code == 200
    data = sent[0].data
    assert data["slug"] == "eigenvalues" and data["source"] == "agent"
    assert "content" not in data


def test_library_changed_needs_the_presence_capability(client, monkeypatch):
    pid = _project(client)
    monkeypatch.setattr(external, "_resolve_client",
                        lambda _key: AgentClient(name="t", token_sha256="", allow=frozenset({"message.post"})))
    resp = client.post(f"/api/external/projects/{pid}/library-changed", json={"space": "s"})
    assert resp.status_code == 403


# --- an MCP agent's note edits carry its own name ------------------------------------

def test_mcp_note_edits_name_their_editor(monkeypatch):
    seen = {}

    async def fake_prax(method, path, **kw):
        seen.update(method=method, path=path, json=kw.get("json"))
        return {"status": "updated"}
    monkeypatch.setattr(mcp_server, "_prax", fake_prax)
    agent = AgentClient(name="research-bot", token_sha256="", allow=frozenset({"*"}))
    asyncio.get_event_loop().run_until_complete(mcp_server._dispatch_library(
        "update_note", {"space": "s", "notebook": "n", "note": "x", "content": "new"}, agent))
    assert seen["json"] == {"content": "new", "editor": agent.display_name}
