"""An approval gate is only a gate if the gated party cannot open it.

Before: ``POST /external/approvals/{id}/decide`` accepted any valid credential
and recorded whatever ``decided_by`` the body said.  A gated agent could
request, approve and consume its own approval, and the log would credit "tj".

Now deciding needs an EXPLICIT ``approval.decide`` grant (``*`` does not count),
the decider must not itself be gated, must not be the client or agent that
asked, and the recorded decider is the credential's name.
"""
from __future__ import annotations

from teamwork.agent_auth import AgentClient
from teamwork.routers import external


def _project(client):
    resp = client.post("/api/external/projects", json={
        "name": "P", "webhook_url": "http://agent:9000/webhook"})
    data = resp.json()
    return data["project_id"], data["channels"]["general"]


def _as_client(monkeypatch, **fields):
    fields.setdefault("name", "agent-ops")
    fields.setdefault("token_sha256", "")
    monkeypatch.setattr(external, "_resolve_client", lambda _key: AgentClient(**fields))


def _pending_request(client, monkeypatch):
    """A gated agent (wildcard allow, as registries typically grant) asks to purge a channel."""
    pid, ch = _project(client)
    client.post(f"/api/external/projects/{pid}/messages", json={"channel_id": ch, "content": "keep"})
    _as_client(monkeypatch, name="agent-ops", agent_id="a-ops",
               gated=frozenset({"message.delete"}))
    first = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages")
    assert first.status_code == 403
    detail = first.json()["detail"]
    assert detail["error"] == "approval_required"
    return pid, ch, detail["approval_id"]


def _decide(client, approval_id, **body):
    return client.post(f"/api/external/approvals/{approval_id}/decide",
                       json={"approve": True, "decided_by": "tj", **body})


# ── Refusals ─────────────────────────────────────────────────────────────────

def test_the_requester_cannot_approve_itself_even_with_a_wildcard(client, monkeypatch):
    _, _, approval_id = _pending_request(client, monkeypatch)
    # Same credential as the request: allow={"*"} (the default) and gated.
    resp = _decide(client, approval_id)
    # Old code: 200, status approved, decided_by "tj".
    assert resp.status_code == 403
    assert "approval.decide" in resp.json()["detail"]


def test_a_wildcard_only_credential_cannot_decide(client, monkeypatch):
    _, _, approval_id = _pending_request(client, monkeypatch)
    _as_client(monkeypatch, name="other-agent")            # allow={"*"}, not gated
    resp = _decide(client, approval_id)
    assert resp.status_code == 403
    assert "not explicitly granted" in resp.json()["detail"]


def test_the_requesting_client_cannot_decide_even_when_granted(client, monkeypatch):
    _, _, approval_id = _pending_request(client, monkeypatch)
    _as_client(monkeypatch, name="agent-ops", allow=frozenset({"approval.decide"}))
    resp = _decide(client, approval_id)
    assert resp.status_code == 403
    assert "requested this action may not decide" in resp.json()["detail"]


def test_the_requesting_agent_cannot_decide_under_another_credential(client, monkeypatch):
    _, _, approval_id = _pending_request(client, monkeypatch)
    _as_client(monkeypatch, name="agent-ops-second-key", agent_id="a-ops",
               allow=frozenset({"approval.decide"}))
    resp = _decide(client, approval_id)
    assert resp.status_code == 403
    assert "agent that requested" in resp.json()["detail"]


def test_a_gated_credential_cannot_decide_even_when_granted(client, monkeypatch):
    _, _, approval_id = _pending_request(client, monkeypatch)
    _as_client(monkeypatch, name="gated-console", allow=frozenset({"approval.decide"}),
               gated=frozenset({"task.write"}))
    resp = _decide(client, approval_id)
    assert resp.status_code == 403
    assert "gated" in resp.json()["detail"]


# ── The happy path ───────────────────────────────────────────────────────────

def test_a_distinct_granted_credential_decides_and_is_recorded(client, monkeypatch):
    pid, ch, approval_id = _pending_request(client, monkeypatch)

    _as_client(monkeypatch, name="human-console", allow=frozenset({"approval.decide"}))
    resp = _decide(client, approval_id, note="looks fine")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "approved"
    # Recorded from the token, not the body ("tj").
    assert resp.json()["decided_by"] == "human-console"

    # The log agrees, and the body's name survives only as a note.
    events = client.get(f"/api/external/projects/{pid}/events").json()["events"]
    approved = [e for e in events if e["event_type"] == "approval.approved"]
    assert approved and approved[0]["actor_name"] == "human-console"
    assert "[entered as: tj]" in approved[0]["payload"]["note"]

    # The requester can now spend it — once.
    _as_client(monkeypatch, name="agent-ops", agent_id="a-ops",
               gated=frozenset({"message.delete"}))
    ok = client.delete(f"/api/external/projects/{pid}/channels/{ch}/messages",
                       headers={"X-Approval-Id": approval_id})
    assert ok.status_code == 200 and ok.json() == {"deleted": 1}
    assert client.get("/api/external/events/verify").json()["ok"] is True


def test_can_decide_is_an_explicit_grant():
    from teamwork.services.approvals import can_decide
    assert can_decide(AgentClient(name="x", token_sha256=""))[0] is False              # "*"
    assert can_decide(AgentClient(name="x", token_sha256="",
                                  allow=frozenset({"approval.*"})))[0] is False        # noun wildcard
    assert can_decide(AgentClient(name="x", token_sha256="",
                                  allow=frozenset({"approval.decide"})))[0] is True
    assert can_decide(AgentClient(name="x", token_sha256="",
                                  allow=frozenset({"approval.decide"}),
                                  gated=frozenset({"message.post"})))[0] is False
