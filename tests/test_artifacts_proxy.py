"""The artifacts proxy: TeamWork shows the agent's pages, it does not make them.

Failures are HTTP failures (see test_proxy_error_contract), so the viewer can
say "not available" instead of rendering a body with no page in it.
"""
from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from teamwork.routers import artifacts as mod

PAGE = {"id": "plan-1a2b3c", "title": "Plan", "version": 2, "html": "<h1>Plan</h1>"}


class _Client:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None):
        self.calls.append((url, params))
        return self.responder(url, params)


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(mod.settings, "prax_url", "http://prax.test")
    a = FastAPI()
    a.include_router(mod.router, prefix="/api")
    return a


def _use(monkeypatch, responder):
    client = _Client(responder)
    monkeypatch.setattr(mod, "prax_client", lambda timeout: client)
    return client


def test_it_passes_the_page_through(app, monkeypatch):
    calls = _use(monkeypatch, lambda url, params: httpx.Response(200, json=PAGE))
    resp = TestClient(app).get("/api/artifacts/plan-1a2b3c")
    assert resp.status_code == 200 and resp.json()["html"] == "<h1>Plan</h1>"
    assert calls.calls == [("http://prax.test/teamwork/artifacts/plan-1a2b3c", None)]


def test_meta_asks_the_agent_for_the_manifest_only(app, monkeypatch):
    calls = _use(monkeypatch, lambda url, params: httpx.Response(200, json={**PAGE, "html": None}))
    TestClient(app).get("/api/artifacts/plan-1a2b3c?meta=1")
    assert calls.calls[0][1] == {"meta": "1"}


def test_unknown_artifact_is_404(app, monkeypatch):
    _use(monkeypatch, lambda url, params: httpx.Response(404, json={"error": "no such artifact"}))
    assert TestClient(app).get("/api/artifacts/nope-000000").status_code == 404


def test_a_bad_id_never_reaches_the_agent(app, monkeypatch):
    calls = _use(monkeypatch, lambda url, params: httpx.Response(200, json=PAGE))
    assert TestClient(app).get("/api/artifacts/UPPER..x").status_code == 404
    assert calls.calls == []


def test_an_unreachable_agent_is_503(app, monkeypatch):
    def boom(url, params):
        raise httpx.ConnectError("refused")
    _use(monkeypatch, boom)
    assert TestClient(app).get("/api/artifacts").status_code == 503


def test_no_agent_configured_is_503(app, monkeypatch):
    monkeypatch.setattr(mod.settings, "prax_url", "")
    assert TestClient(app).get("/api/artifacts").status_code == 503
