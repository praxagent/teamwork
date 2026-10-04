"""Comments on a Library note — TeamWork relays them to Prax, which stores
them in the note and answers @prax."""
from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from teamwork.routers import library as lib


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


def test_comment_routes_reach_prax(app, monkeypatch):
    client = _Client(lambda m, u, b: httpx.Response(200, json={"ok": True}))
    monkeypatch.setattr(lib, "prax_client", lambda timeout: client)
    c = TestClient(app)
    base = "/api/library/notes/s/n/x/comments"
    c.get(base)
    c.post(base, json={"text": "@prax?", "quote": "a passage", "prefix": "p", "suffix": "s"})
    c.post(f"{base}/c-1a2b3c4d/replies", json={"text": "thanks"})
    c.patch(f"{base}/c-1a2b3c4d", json={"resolved": True})
    c.delete(f"{base}/c-1a2b3c4d")
    prax = "http://prax.test/teamwork/library/notes/s/n/x/comments"
    assert client.calls == [
        ("GET", prax, None),
        ("POST", prax, {"text": "@prax?", "quote": "a passage", "prefix": "p", "suffix": "s"}),
        ("POST", f"{prax}/c-1a2b3c4d/replies", {"text": "thanks"}),
        ("PATCH", f"{prax}/c-1a2b3c4d", {"resolved": True}),
        ("DELETE", f"{prax}/c-1a2b3c4d", None),
    ]


def test_prax_refusal_comes_through(app, monkeypatch):
    client = _Client(lambda m, u, b: httpx.Response(404, json={"error": "No comment 'c-00000000'"}))
    monkeypatch.setattr(lib, "prax_client", lambda timeout: client)
    resp = TestClient(app).post("/api/library/notes/s/n/x/comments/c-00000000/replies", json={"text": "hi"})
    assert resp.status_code == 404 and "No comment" in resp.json()["error"]
