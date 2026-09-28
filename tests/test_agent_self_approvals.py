"""An agent can put its own next action in front of a person — and only a person answers.

The external routes let an agent ask, poll and spend. The decision happens on
the human route (``/api/approvals``), which refuses agent credentials. Window
grants ("allow for an hour") approve later requests on arrival but keep every
one recorded, fingerprint-bound and single-use.
"""
from __future__ import annotations

import pytest

from teamwork.agent_auth import AgentClient
from teamwork.config import settings
from teamwork.routers import external


@pytest.fixture(autouse=True)
def _decisions_allowed_without_ui_auth(monkeypatch):
    # The flow tests below are about approvals, not UI login; the auth rule
    # itself is tested at the bottom of this file.
    monkeypatch.setattr(settings, "approvals_allow_unauthenticated", True)
    monkeypatch.setattr(settings, "internal_api_key", "")

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


def test_another_agent_asking_the_same_action_gets_its_own_request(client, monkeypatch):
    mine = _ask(client, monkeypatch)["approval_id"]
    _as(monkeypatch, name="other-agent")
    theirs = client.post("/api/external/approvals", json=ASK).json()["approval_id"]
    assert theirs != mine


# --- a person, not merely a request without agent headers --------------------

def test_decisions_are_refused_without_ui_authentication(client, monkeypatch):
    aid = _ask(client, monkeypatch)["approval_id"]
    monkeypatch.setattr(settings, "approvals_allow_unauthenticated", False)
    resp = _human_decide(client, aid)
    assert resp.status_code == 403 and "INTERNAL_API_KEY" in resp.json()["detail"]
    assert client.get(f"/api/external/approvals/{aid}").json()["status"] == "pending"


def test_with_a_ui_key_only_a_logged_in_session_decides(client, monkeypatch):
    from teamwork.internal_auth import COOKIE, issue_session_token

    aid = _ask(client, monkeypatch)["approval_id"]
    monkeypatch.setattr(settings, "approvals_allow_unauthenticated", False)
    monkeypatch.setattr(settings, "internal_api_key", "ui-key")
    # The key header is the scripts path — exactly what must not decide.
    assert client.post(f"/api/approvals/{aid}/decide", json={"approve": True},
                       headers={"X-Internal-Key": "ui-key"}).status_code == 403
    token, _ = issue_session_token("ui-key")
    client.cookies.set(COOKIE, token)
    assert _human_decide(client, aid).status_code == 200
