"""Approval gates — an agent proposes, a human decides.

The design claim under test: an approval authorises **one exact action, once**.
Everything else here is bookkeeping; the fingerprint binding and single-use
consumption are what make a gate a gate rather than a speed bump.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from teamwork.agent_auth import AgentClient, _sha256
from teamwork.models.approval import (
    STATUS_APPROVED,
    STATUS_CONSUMED,
    STATUS_PENDING,
    STATUS_REJECTED,
    ApprovalRequest,
    fingerprint_action,
)
from teamwork.services.approvals import consume, decide, list_pending, request_approval

CAP = "message.delete"


async def _pending(db, *, payload=None, project_id="p1"):
    req = await request_approval(db, capability=CAP, client_name="prax-ops",
                                 agent_id="agent-ops", project_id=project_id,
                                 payload=payload or {"channel_id": "c1"})
    await db.commit()
    return req


# ── The fingerprint is the design ────────────────────────────────────────────

def test_fingerprint_is_stable_across_key_ordering():
    a = fingerprint_action(CAP, "p1", {"channel_id": "c1", "why": "resync"})
    b = fingerprint_action(CAP, "p1", {"why": "resync", "channel_id": "c1"})
    assert a == b


def test_fingerprint_changes_with_capability_project_or_payload():
    base = fingerprint_action(CAP, "p1", {"channel_id": "c1"})
    assert base != fingerprint_action("message.bulk", "p1", {"channel_id": "c1"})
    assert base != fingerprint_action(CAP, "p2", {"channel_id": "c1"})
    assert base != fingerprint_action(CAP, "p1", {"channel_id": "c2"})


async def test_an_approval_cannot_be_redirected_at_another_action(db_session):
    # The attack a naive gate allows: get "purge #c1" approved, spend it on #c2.
    req = await _pending(db_session, payload={"channel_id": "c1"})
    await decide(db_session, approval_id=req.id, approve=True, decided_by="tj")
    await db_session.commit()

    ok, why = await consume(db_session, approval_id=req.id, capability=CAP,
                            project_id="p1", payload={"channel_id": "c2"},
                            client_name="prax-ops")
    assert ok is False and "different action" in why


async def test_an_approval_cannot_be_escalated_to_another_capability(db_session):
    req = await _pending(db_session)
    await decide(db_session, approval_id=req.id, approve=True, decided_by="tj")
    await db_session.commit()
    ok, why = await consume(db_session, approval_id=req.id, capability="message.bulk",
                            project_id="p1", payload={"channel_id": "c1"},
                            client_name="prax-ops")
    assert ok is False and "different action" in why


# ── Single use ───────────────────────────────────────────────────────────────

async def test_an_approval_is_spent_after_one_use(db_session):
    req = await _pending(db_session)
    await decide(db_session, approval_id=req.id, approve=True, decided_by="tj")
    await db_session.commit()

    ok, _ = await consume(db_session, approval_id=req.id, capability=CAP,
                          project_id="p1", payload={"channel_id": "c1"},
                          client_name="prax-ops")
    assert ok is True
    await db_session.commit()
    assert req.status == STATUS_CONSUMED

    ok2, why = await consume(db_session, approval_id=req.id, capability=CAP,
                             project_id="p1", payload={"channel_id": "c1"},
                             client_name="prax-ops")
    assert ok2 is False and "already been used" in why


# ── Lifecycle ────────────────────────────────────────────────────────────────

async def test_an_undecided_action_cannot_be_performed(db_session):
    req = await _pending(db_session)
    ok, why = await consume(db_session, approval_id=req.id, capability=CAP,
                            project_id="p1", payload={"channel_id": "c1"},
                            client_name="prax-ops")
    assert ok is False and "not been approved" in why


async def test_a_rejected_action_cannot_be_performed(db_session):
    req = await _pending(db_session)
    await decide(db_session, approval_id=req.id, approve=False, decided_by="tj",
                 note="no")
    await db_session.commit()
    assert req.status == STATUS_REJECTED
    ok, why = await consume(db_session, approval_id=req.id, capability=CAP,
                            project_id="p1", payload={"channel_id": "c1"},
                            client_name="prax-ops")
    assert ok is False and "rejected" in why


async def test_a_decision_is_final(db_session):
    req = await _pending(db_session)
    await decide(db_session, approval_id=req.id, approve=False, decided_by="tj")
    await db_session.commit()
    with pytest.raises(ValueError, match="already"):
        await decide(db_session, approval_id=req.id, approve=True, decided_by="tj")


async def test_an_expired_approval_is_not_usable(db_session):
    req = await _pending(db_session)
    await decide(db_session, approval_id=req.id, approve=True, decided_by="tj")
    req.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
    await db_session.commit()
    ok, why = await consume(db_session, approval_id=req.id, capability=CAP,
                            project_id="p1", payload={"channel_id": "c1"},
                            client_name="prax-ops")
    assert ok is False and "expired" in why


async def test_unknown_approval_is_refused(db_session):
    ok, why = await consume(db_session, approval_id="nope", capability=CAP,
                            project_id="p1", payload={}, client_name="x")
    assert ok is False and "no such approval" in why


# ── Ergonomics ───────────────────────────────────────────────────────────────

async def test_retrying_the_same_action_reuses_the_pending_request(db_session):
    # An agent that retries should not spam the humans with duplicates.
    first = await _pending(db_session)
    second = await request_approval(db_session, capability=CAP, client_name="prax-ops",
                                    agent_id="agent-ops", project_id="p1",
                                    payload={"channel_id": "c1"})
    await db_session.commit()
    assert first.id == second.id


async def test_pending_list_excludes_decided_and_expired(db_session):
    keep = await _pending(db_session, payload={"channel_id": "keep"})
    decided = await _pending(db_session, payload={"channel_id": "decided"})
    expired = await _pending(db_session, payload={"channel_id": "expired"})
    await decide(db_session, approval_id=decided.id, approve=True, decided_by="tj")
    expired.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
    await db_session.commit()

    ids = {r.id for r in await list_pending(db_session, project_id="p1")}
    assert ids == {keep.id}


async def test_the_whole_lifecycle_is_in_the_event_log(db_session):
    from teamwork.services.event_log import read_events, verify_chain

    req = await _pending(db_session)
    await decide(db_session, approval_id=req.id, approve=True, decided_by="tj")
    await consume(db_session, approval_id=req.id, capability=CAP,
                  project_id="p1", payload={"channel_id": "c1"}, client_name="prax-ops")
    await db_session.commit()

    types = [e.event_type for e in await read_events(db_session, project_id="p1")]
    assert types == ["approval.requested", "approval.approved", "approval.consumed"]
    assert (await verify_chain(db_session))["ok"] is True


# ── Which capabilities are gated ─────────────────────────────────────────────

def test_gated_is_a_third_state_distinct_from_allowed_and_denied():
    c = AgentClient(name="ops", token_sha256=_sha256("t"),
                    allow=frozenset({"message.post", "message.delete"}),
                    gated=frozenset({"message.delete"}))
    # Holds it, but may not exercise it unilaterally.
    assert c.can("message.delete") and c.needs_approval("message.delete")
    # Holds it outright.
    assert c.can("message.post") and not c.needs_approval("message.post")
    # Does not hold it at all.
    assert not c.can("task.write")


def test_gated_supports_the_noun_wildcard():
    c = AgentClient(name="ops", token_sha256=_sha256("t"), gated=frozenset({"message.*"}))
    assert c.needs_approval("message.delete") and c.needs_approval("message.bulk")
    assert not c.needs_approval("task.write")


def test_ungated_clients_need_no_approval():
    assert not AgentClient(name="x", token_sha256=_sha256("t")).needs_approval("message.delete")


def test_registry_declares_gated_capabilities():
    from tests.test_agent_auth import load_clients_from
    (c,) = load_clients_from([{"name": "ops", "token": "t", "agent_id": "a",
                               "allow": ["message.*"], "gated": ["message.delete"]}])
    assert c.can("message.delete") and c.needs_approval("message.delete")
    assert c.can("message.post") and not c.needs_approval("message.post")
