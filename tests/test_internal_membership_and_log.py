"""The internal API writes the same tables as the external one — so it must
follow the same membership rule and leave the same audit trail.

Before: ``POST /api/messages`` never consulted channel membership, and
messages, channels and projects created or deleted through the internal
routers left no event, so the hash-chained log was silent about half the
writes it exists to record.
"""
from __future__ import annotations

from teamwork.config import settings


def _workspace(client):
    pid = client.post("/api/projects", json={"name": "Ops"}).json()["id"]
    ch = client.post("/api/channels", json={"project_id": pid, "name": "ops"}).json()["id"]
    a = client.post("/api/agents", json={"project_id": pid, "name": "A", "role": "dev"}).json()["id"]
    b = client.post("/api/agents", json={"project_id": pid, "name": "B", "role": "dev"}).json()["id"]
    return pid, ch, a, b


def _events(client, pid, event_type=None):
    params = {"event_type": event_type} if event_type else {}
    return client.get(f"/api/external/projects/{pid}/events", params=params).json()["events"]


# ── Membership ───────────────────────────────────────────────────────────────

def test_internal_post_honours_channel_membership_when_enforced(client, monkeypatch):
    pid, ch, a, b = _workspace(client)
    monkeypatch.setattr(settings, "enforce_channel_membership", True)
    assert client.post(f"/api/external/projects/{pid}/channels/members", json={
        "channel_id": ch, "member_id": a, "member_name": "A"}).status_code == 201

    # Old code: 201 — the internal door skipped the check the external one made.
    stranger = client.post("/api/messages", json={"channel_id": ch, "agent_id": b, "content": "hi"})
    assert stranger.status_code == 403
    assert "not a member" in stranger.json()["detail"]

    member = client.post("/api/messages", json={"channel_id": ch, "agent_id": a, "content": "hi"})
    assert member.status_code == 201
    human = client.post("/api/messages", json={"channel_id": ch, "content": "hello"})
    assert human.status_code == 201                       # humans are not scoped


def test_internal_post_is_open_when_enforcement_is_off(client, monkeypatch):
    pid, ch, a, b = _workspace(client)
    monkeypatch.setattr(settings, "enforce_channel_membership", False)
    client.post(f"/api/external/projects/{pid}/channels/members", json={"channel_id": ch, "member_id": a})
    assert client.post("/api/messages", json={"channel_id": ch, "agent_id": b, "content": "hi"}).status_code == 201


# ── Event log ────────────────────────────────────────────────────────────────

def test_internal_message_create_and_delete_are_logged_and_verify(client):
    pid, ch, a, _ = _workspace(client)
    mid = client.post("/api/messages", json={"channel_id": ch, "agent_id": a, "content": "hi"}).json()["id"]

    posted = _events(client, pid, "message.posted")
    # Old code: [] — nothing was appended for an internal post.
    assert [e["subject_id"] for e in posted] == [mid]
    assert posted[0]["actor_type"] == "internal"
    assert posted[0]["actor_id"] == a and posted[0]["actor_name"] == "A"
    assert posted[0]["payload"]["channel_id"] == ch

    assert client.delete(f"/api/messages/{mid}").status_code == 204
    deleted = _events(client, pid, "message.deleted")
    assert [e["subject_id"] for e in deleted] == [mid]
    assert deleted[0]["actor_type"] == "internal"

    chain = client.get("/api/external/events/verify").json()
    assert chain["ok"] is True and chain["checked"] >= 3


def test_project_and_blank_workspace_creation_are_logged(client):
    pid = client.post("/api/projects", json={"name": "Logged"}).json()["id"]
    created = _events(client, pid, "project.created")
    assert created and created[0]["actor_type"] == "internal" and created[0]["payload"]["name"] == "Logged"

    blank = client.post("/api/projects/blank").json()
    types = [e["event_type"] for e in _events(client, blank["project_id"])]
    assert types == ["project.created", "channel.created"]
    ch_ev = _events(client, blank["project_id"], "channel.created")[0]
    assert ch_ev["subject_id"] == blank["channels"]["general"]
    assert client.get("/api/external/events/verify").json()["ok"] is True
