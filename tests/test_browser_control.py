"""The agent can tell when a person is driving the shared browser."""
from __future__ import annotations

import pytest

from teamwork.agent_auth import AgentClient
from teamwork.routers import external
from teamwork.services import browser_control


@pytest.fixture(autouse=True)
def _clean():
    browser_control.reset()
    yield
    browser_control.reset()


def _as_agent(monkeypatch):
    monkeypatch.setattr(external, "_resolve_client",
                        lambda _k: AgentClient(name="prax", token_sha256=""))


def test_idle_browser_belongs_to_the_agent(client, monkeypatch):
    _as_agent(monkeypatch)
    assert client.get("/api/external/browser/control").json()["user_in_control"] is False


def test_take_control_and_hand_back(client, monkeypatch):
    _as_agent(monkeypatch)
    assert client.post("/api/browser/control", json={"held": True}).status_code == 200
    assert client.get("/api/external/browser/control").json()["user_in_control"] is True
    client.post("/api/browser/control", json={"held": False})
    assert client.get("/api/external/browser/control").json()["user_in_control"] is False


def test_recent_input_counts_as_control(client, monkeypatch):
    _as_agent(monkeypatch)
    browser_control.mark_input()
    state = client.get("/api/external/browser/control").json()
    assert state["user_in_control"] is True and state["held"] is False


def test_recent_input_expires(monkeypatch):
    browser_control.mark_input()
    monkeypatch.setattr(browser_control, "ACTIVE_SECONDS", 0.0)
    assert browser_control.status()["user_in_control"] is False


def test_an_agent_credential_cannot_take_or_release_control(client):
    resp = client.post("/api/browser/control", json={"held": False},
                       headers={"X-API-Key": "agent"})
    assert resp.status_code == 403
