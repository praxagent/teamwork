"""Two external endpoints that raised NameError on entry (undefined ``api_key`` /
``http_request``), so their capability and approval checks never ran."""
from __future__ import annotations

import pytest

from teamwork.agent_auth import AgentClient
from teamwork.config import settings
from teamwork.routers import external


def _project(client):
    resp = client.post("/api/external/projects", json={
        "name": "P", "webhook_url": "http://agent:9000/webhook"})
    data = resp.json()
    return data["project_id"], data["channels"]["general"]


def _as_client(monkeypatch, **fields):
    fields.setdefault("name", "tester")
    fields.setdefault("token_sha256", "")
    monkeypatch.setattr(external, "_resolve_client", lambda _key: AgentClient(**fields))


# ── POST /projects/{id}/activity ────────────────────────────────────────────

def _agent(client, pid, name="Bot"):
    return client.post(f"/api/external/projects/{pid}/agents",
                       json={"name": name, "role": "dev"}).json()["agent_id"]


def test_activity_log_is_created(client):
    pid, _ = _project(client)
    agent_id = _agent(client, pid)
    resp = client.post(f"/api/external/projects/{pid}/activity", json={
        "agent_id": agent_id, "activity_type": "tool_use", "description": "ran a tool"})
    # Old code: NameError('api_key') → 500.
    assert resp.status_code == 200
    assert resp.json()["log_id"]


def test_activity_log_for_an_unknown_agent_is_a_404_not_a_constraint_error(client):
    pid, _ = _project(client)
    resp = client.post(f"/api/external/projects/{pid}/activity", json={
        "agent_id": "no-such-agent", "activity_type": "tool_use", "description": "x"})
    # activity_log.agent_id is a foreign key; enforcement is on, so a phantom
    # agent must be refused before the database refuses it.
    assert resp.status_code == 404


def test_activity_log_requires_the_capability(client, monkeypatch):
    pid, _ = _project(client)
    _as_client(monkeypatch, allow=frozenset({"message.post"}))
    resp = client.post(f"/api/external/projects/{pid}/activity", json={
        "agent_id": "a1", "activity_type": "tool_use", "description": "x"})
    assert resp.status_code == 403
    assert "activity.write" in resp.json()["detail"]


def test_activity_log_rejects_a_bad_key(client, monkeypatch):
    pid, _ = _project(client)
    monkeypatch.setattr(settings, "external_api_key", "real-key")
    monkeypatch.setattr(settings, "allow_unauthenticated_agents", False)
    resp = client.post(f"/api/external/projects/{pid}/activity",
                       headers={"X-API-Key": "wrong"},
                       json={"agent_id": "a1", "activity_type": "t", "description": "x"})
    assert resp.status_code == 401


# ── DELETE /projects/{id}/channels/{ch}/messages ────────────────────────────

def test_clear_channel_messages_deletes(client):
    pid, ch = _project(client)
    for i in range(3):
        client.post(f"/api/external/projects/{pid}/messages",
                    json={"channel_id": ch, "content": f"m{i}"})
    resp = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages")
    # Old code: NameError('http_request') → 500.
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 3}
    assert client.get(f"/api/external/projects/{pid}/channels/{ch}/message-count").json() == {"count": 0}


def test_clear_channel_messages_honours_the_approval_gate(client, monkeypatch):
    pid, ch = _project(client)
    client.post(f"/api/external/projects/{pid}/messages", json={"channel_id": ch, "content": "keep"})
    _as_client(monkeypatch, gated=frozenset({"message.delete"}))

    first = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages")
    assert first.status_code == 403
    detail = first.json()["detail"]
    assert detail["error"] == "approval_required" and detail["approval_id"]

    # The gate reads X-Approval-Id from the request — a bogus one is refused, not ignored.
    bogus = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages",
                          headers={"X-Approval-Id": "nope"})
    assert bogus.status_code == 403 and bogus.json()["detail"]["error"] == "approval_invalid"
    assert client.get(f"/api/external/projects/{pid}/channels/{ch}/message-count").json() == {"count": 1}

    # Granted by a DIFFERENT credential holding the explicit decider grant (the
    # requester itself, and any wildcard-only credential, are refused — see
    # test_approval_separation.py) → the same action goes through once.
    _as_client(monkeypatch, name="human-console", allow=frozenset({"approval.decide"}))
    approved = client.post(f"/api/external/approvals/{detail['approval_id']}/decide",
                           json={"approve": True, "decided_by": "tj"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["decided_by"] == "human-console"
    _as_client(monkeypatch, gated=frozenset({"message.delete"}))
    ok = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages",
                       headers={"X-Approval-Id": detail["approval_id"]})
    assert ok.status_code == 200 and ok.json() == {"deleted": 1}


def test_clear_channel_messages_requires_the_capability(client, monkeypatch):
    pid, ch = _project(client)
    _as_client(monkeypatch, allow=frozenset({"message.post"}))
    resp = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages")
    assert resp.status_code == 403
