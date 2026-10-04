"""TeamWork relays Prax's changeable settings (Prax decides which ones).

Prax's own answer comes through: 404 for a setting that isn't changeable,
400 for a bad value. A malformed key never reaches Prax.
"""
from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from teamwork.routers import prax as mod


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
    monkeypatch.setattr(mod.settings, "prax_url", "http://prax.test")
    a = FastAPI()
    a.include_router(mod.router, prefix="/api")
    return a


def _use(monkeypatch, responder):
    client = _Client(responder)
    monkeypatch.setattr(mod, "prax_client", lambda timeout: client)
    return client


SETTING = {"key": "DESKTOP_SCREENSHOTS_ENABLED", "label": "Prax can look at the desktop",
           "help": "…", "category": "Desktop", "value": False, "source": "teamwork", "env_value": True}


def test_list_set_and_reset_pass_through(app, monkeypatch):
    def respond(method, url, body):
        if method == "GET":
            return httpx.Response(200, json={"settings": [SETTING]})
        return httpx.Response(200, json=SETTING)
    calls = _use(monkeypatch, respond)
    c = TestClient(app)
    assert c.get("/api/prax/runtime-settings").json()["settings"][0]["key"] == SETTING["key"]
    assert c.put("/api/prax/runtime-settings/DESKTOP_SCREENSHOTS_ENABLED", json={"value": False}).json()["value"] is False
    assert c.delete("/api/prax/runtime-settings/DESKTOP_SCREENSHOTS_ENABLED").status_code == 200
    assert calls.calls[1] == ("PUT", "http://prax.test/teamwork/runtime-settings/DESKTOP_SCREENSHOTS_ENABLED",
                              {"value": False})


def test_prax_refusals_come_through(app, monkeypatch):
    _use(monkeypatch, lambda m, u, b: httpx.Response(404, json={"error": "HARD_FLOORS_ENABLED can't be changed from TeamWork"}))
    resp = TestClient(app).put("/api/prax/runtime-settings/HARD_FLOORS_ENABLED", json={"value": False})
    assert resp.status_code == 404 and "can't be changed" in resp.json()["detail"]


def test_a_malformed_key_never_reaches_prax(app, monkeypatch):
    calls = _use(monkeypatch, lambda m, u, b: httpx.Response(200, json={}))
    assert TestClient(app).put("/api/prax/runtime-settings/..%2Fmodel", json={"value": True}).status_code == 404
    assert TestClient(app).put("/api/prax/runtime-settings/lower_case", json={"value": True}).status_code == 404
    assert calls.calls == []


def test_prax_down_is_502_and_unconfigured_is_503(app, monkeypatch):
    def boom(m, u, b):
        raise httpx.ConnectError("refused")
    _use(monkeypatch, boom)
    assert TestClient(app).get("/api/prax/runtime-settings").status_code == 502
    monkeypatch.setattr(mod.settings, "prax_url", "")
    assert TestClient(app).get("/api/prax/runtime-settings").status_code == 503
