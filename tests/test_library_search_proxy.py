"""TeamWork's Library search relays to Prax, which does the searching."""
from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from teamwork.routers import library as lib


class _Client:
    def __init__(self):
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def request(self, method, url, **kw):
        self.calls.append((method, url, kw.get("params")))
        return httpx.Response(200, json={"query": "x", "results": [{"slug": "eigenvalues"}]},
                              request=httpx.Request(method, url))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(lib.settings, "prax_url", "http://prax.test")
    c = _Client()
    monkeypatch.setattr(lib, "prax_client", lambda timeout: c)
    app = FastAPI()
    app.include_router(lib.router, prefix="/api")
    return TestClient(app), c


def test_search_passes_the_query_and_caps_the_limit(client):
    tc, prax = client
    resp = tc.get("/api/library/search", params={"q": "eigen vector", "space": "la", "limit": 500})
    assert resp.status_code == 200 and resp.json()["results"][0]["slug"] == "eigenvalues"
    method, url, params = prax.calls[0]
    assert url.endswith("/teamwork/library/search")
    assert params == {"q": "eigen vector", "limit": 50, "space": "la"}
