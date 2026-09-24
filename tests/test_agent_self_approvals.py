"""An agent can put its own next action in front of a person — and only a person answers.

The external routes let an agent ask, poll and spend. The decision happens on
the human route (``/api/approvals``), which refuses agent credentials. Window
grants ("allow for an hour") approve later requests on arrival but keep every
one recorded, fingerprint-bound and single-use.
"""
from __future__ import annotations

from teamwork.agent_auth import AgentClient
from teamwork.routers import external

ASK = {"capability": "prax.tool.send_email",
       "payload": {"tool": "send_email", "args_sha256": "abc"},
       "reason": "HIGH-risk tool"}


def _as(monkeypatch, name="prax", **fields):
    fields.setdefault("token_sha256", "")
    monkeypatch.setattr(external, "_resolve_client", lambda _k: AgentClient(name=name, **fields))


def _ask(client, monkeypatch, **overrides):
    _as(monkeypatch)
    body = {**ASK, **overrides}
    resp = client.post("/api/external/approvals", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _human_decide(client, approval_id, **body):
    return client.post(f"/api/approvals/{approval_id}/decide", json={"approve": True, **body})


def test_ask_then_person_approves_then_spend_once(client, monkeypatch):
    asked = _ask(client, monkeypatch)
    assert asked["status"] == "pending"
    aid = asked["approval_id"]

    pending = client.get("/api/approvals/pending").json()["pending"]
    assert [p["approval_id"] for p in pending] == [aid]
    assert pending[0]["payload"]["tool"] == "send_email"

    assert _human_decide(client, aid).status_code == 200
    assert client.get(f"/api/external/approvals/{aid}").json()["status"] == "approved"

    spend = {"capability": ASK["capability"], "payload": ASK["payload"]}
    assert client.post(f"/api/external/approvals/{aid}/consume", json=spend).status_code == 200
    # Single use.
    again = client.post(f"/api/external/approvals/{aid}/consume", json=spend)
    assert again.status_code == 409


def test_an_approval_cannot_be_spent_on_a_different_action(client, monkeypatch):
    aid = _ask(client, monkeypatch)["approval_id"]
    _human_decide(client, aid)
    other = {"capability": ASK["capability"], "payload": {"tool": "send_email", "args_sha256": "zzz"}}
    resp = client.post(f"/api/external/approvals/{aid}/consume", json=other)
    assert resp.status_code == 409
    assert "different action" in resp.json()["detail"]["reason"]


def test_the_human_route_refuses_agent_credentials(client, monkeypatch):
    aid = _ask(client, monkeypatch)["approval_id"]
    for header in ({"X-API-Key": "anything"}, {"Authorization": "Bearer x"},
                   {"X-Agent-Signature": "sig"}):
        resp = client.post(f"/api/approvals/{aid}/decide", json={"approve": True}, headers=header)
        assert resp.status_code == 403, header
    assert client.get(f"/api/external/approvals/{aid}").json()["status"] == "pending"


def test_an_agent_cannot_see_or_spend_another_agents_request(client, monkeypatch):
    aid = _ask(client, monkeypatch)["approval_id"]
    _human_decide(client, aid)
    _as(monkeypatch, name="someone-else")
    assert client.get(f"/api/external/approvals/{aid}").status_code == 404
    spend = {"capability": ASK["capability"], "payload": ASK["payload"]}
    assert client.post(f"/api/external/approvals/{aid}/consume", json=spend).status_code == 404


def test_rejection_is_final(client, monkeypatch):
    aid = _ask(client, monkeypatch)["approval_id"]
    assert client.post(f"/api/approvals/{aid}/decide", json={"approve": False}).status_code == 200
    assert client.get(f"/api/external/approvals/{aid}").json()["status"] == "rejected"
    assert _human_decide(client, aid).status_code == 409


def test_an_hour_grant_approves_later_requests_on_arrival_but_records_each(client, monkeypatch):
    first = _ask(client, monkeypatch)["approval_id"]
    assert _human_decide(client, first, scope="hour").status_code == 200
    grants = client.get("/api/approvals/grants").json()["grants"]
    assert len(grants) == 1 and grants[0]["capability"] == ASK["capability"]

    later = _ask(client, monkeypatch, payload={"tool": "send_email", "args_sha256": "second"})
    assert later["status"] == "approved"
    assert later["decided_by"].startswith("grant:")
    assert later["approval_id"] != first

    # The grant covers only this capability for this requester.
    other_cap = _ask(client, monkeypatch, capability="prax.tool.delete_everything")
    assert other_cap["status"] == "pending"
    _as(monkeypatch, name="another-agent")
    other_agent = client.post("/api/external/approvals", json=ASK).json()
    assert other_agent["status"] == "pending"


def test_a_revoked_grant_stops_approving(client, monkeypatch):
    first = _ask(client, monkeypatch)["approval_id"]
    _human_decide(client, first, scope="day")
    gid = client.get("/api/approvals/grants").json()["grants"][0]["grant_id"]
    assert client.post(f"/api/approvals/grants/{gid}/revoke").status_code == 200
    later = _ask(client, monkeypatch, payload={"tool": "send_email", "args_sha256": "after"})
    assert later["status"] == "pending"


def test_unknown_scope_is_refused(client, monkeypatch):
    aid = _ask(client, monkeypatch)["approval_id"]
    assert _human_decide(client, aid, scope="forever").status_code == 422
