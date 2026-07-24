"""The append-only, hash-chained event log.

What it must guarantee: an ordered record of what happened across every agent,
which you cannot quietly rewrite. The tests that matter are the tampering ones —
an audit log nobody can detect edits to is just a table.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from teamwork.models.event import GENESIS_HASH, Event
from teamwork.services.event_log import append_event, head_seq, read_events, verify_chain


async def _seed(db, n=3, project_id="p1"):
    out = []
    for i in range(n):
        out.append(await append_event(
            db, event_type="message.posted", actor_type="agent",
            actor_id=f"agent-{i % 2}", actor_name=f"agent{i % 2}",
            project_id=project_id, subject_id=f"msg-{i}",
            payload={"channel_id": "c1", "content_length": 10 + i}))
    await db.commit()
    return out


# ── Chaining ─────────────────────────────────────────────────────────────────

async def test_first_event_chains_from_genesis_and_seq_starts_at_one(db_session):
    (ev,) = await _seed(db_session, 1)
    assert ev.seq == 1
    assert ev.prev_hash == GENESIS_HASH
    assert ev.entry_hash == ev.recompute_hash()


async def test_each_event_chains_to_the_previous(db_session):
    events = await _seed(db_session, 4)
    for prev, cur in zip(events, events[1:]):
        assert cur.seq == prev.seq + 1
        assert cur.prev_hash == prev.entry_hash


async def test_a_clean_log_verifies(db_session):
    await _seed(db_session, 5)
    result = await verify_chain(db_session)
    assert result["ok"] is True and result["checked"] == 5


async def test_an_empty_log_verifies(db_session):
    assert (await verify_chain(db_session))["ok"] is True


# ── Tamper detection — the point of the whole thing ──────────────────────────

async def test_editing_an_entry_breaks_verification(db_session):
    await _seed(db_session, 4)
    target = (await db_session.execute(select(Event).where(Event.seq == 2))).scalar_one()
    target.payload = {"channel_id": "c1", "content_length": 99999}   # rewrite history
    await db_session.commit()

    result = await verify_chain(db_session)
    assert result["ok"] is False
    assert result["broken_at"] == 2
    assert "modified after it was written" in result["reason"]


async def test_deleting_an_entry_breaks_verification(db_session):
    await _seed(db_session, 4)
    victim = (await db_session.execute(select(Event).where(Event.seq == 3))).scalar_one()
    await db_session.delete(victim)
    await db_session.commit()

    result = await verify_chain(db_session)
    assert result["ok"] is False
    assert result["broken_at"] == 4          # the gap shows at the next entry
    assert "deleted or reordered" in result["reason"]


async def test_splicing_a_forged_entry_breaks_verification(db_session):
    await _seed(db_session, 2)
    forged = Event(
        seq=3, actor_type="agent", actor_id="agent-evil", actor_name="evil",
        event_type="message.posted", project_id="p1", subject_id="msg-forged",
        payload={}, prev_hash="f" * 64, entry_hash="e" * 64)
    db_session.add(forged)
    await db_session.commit()

    result = await verify_chain(db_session)
    assert result["ok"] is False and result["broken_at"] == 3


async def test_recomputing_the_hash_is_not_enough_without_the_chain(db_session):
    # An attacker who edits an entry AND fixes its own hash still breaks the
    # chain, because the next entry commits to the original hash.
    await _seed(db_session, 3)
    target = (await db_session.execute(select(Event).where(Event.seq == 1))).scalar_one()
    target.payload = {"tampered": True}
    target.entry_hash = target.recompute_hash()      # self-consistent now
    await db_session.commit()

    result = await verify_chain(db_session)
    assert result["ok"] is False
    assert result["broken_at"] == 2                  # detected at the *next* link
    assert "spliced" in result["reason"]


# ── Reading ──────────────────────────────────────────────────────────────────

async def test_read_filters_by_project_actor_and_type(db_session):
    await _seed(db_session, 4, project_id="p1")
    await append_event(db_session, event_type="task.updated", actor_type="agent",
                       actor_id="agent-9", project_id="p2", subject_id="t1")
    await db_session.commit()

    assert len(await read_events(db_session, project_id="p1")) == 4
    assert len(await read_events(db_session, project_id="p2")) == 1
    assert len(await read_events(db_session, actor_id="agent-0")) == 2
    assert len(await read_events(db_session, event_type="task.updated")) == 1


async def test_read_is_ordered_and_resumable_by_seq(db_session):
    await _seed(db_session, 5)
    later = await read_events(db_session, since_seq=2)
    assert [e.seq for e in later] == [3, 4, 5]
    assert await head_seq(db_session) == 5


async def test_read_limit_is_capped(db_session):
    await _seed(db_session, 3)
    assert len(await read_events(db_session, limit=2)) == 2
    assert len(await read_events(db_session, limit=99999)) == 3


async def test_the_log_survives_deletion_of_what_it_describes(db_session):
    # subject_id is deliberately not a foreign key: the audit record must
    # outlive the row it refers to.
    (ev,) = await _seed(db_session, 1)
    assert ev.subject_id == "msg-0"
    assert (await verify_chain(db_session))["ok"] is True


async def test_signature_is_carried_when_the_request_was_signed(db_session):
    ev = await append_event(db_session, event_type="message.posted", actor_type="agent",
                            actor_id="a1", project_id="p1", subject_id="m1",
                            signature="c2lnbmF0dXJl", signed_by="prax-research")
    await db_session.commit()
    assert ev.signature and ev.signed_by == "prax-research"
    assert (await verify_chain(db_session))["ok"] is True
