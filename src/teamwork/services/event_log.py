"""Appending to and verifying the event log.

The only supported write is :func:`append_event`. There is deliberately no
update or delete: an audit log you can edit is not an audit log, and the hash
chain would detect the edit anyway. Reads are ordinary queries.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models.event import (
    GENESIS_HASH,
    Event,
    canonical_timestamp,
    compute_entry_hash,
)

logger = logging.getLogger(__name__)


async def append_event(
    db: AsyncSession,
    *,
    event_type: str,
    actor_type: str = "system",
    actor_id: str | None = None,
    actor_name: str | None = None,
    project_id: str | None = None,
    subject_id: str | None = None,
    payload: dict[str, Any] | None = None,
    signature: str | None = None,
    signed_by: str | None = None,
) -> Event:
    """Append one entry, chained to the current head.

    Reads the head inside the caller's transaction so ``seq`` and ``prev_hash``
    are taken under the same lock that commits the row — SQLite serialises
    writers, which is what makes the naive read-then-append safe here. A
    multi-writer backend would need the head read to be explicitly locking.
    """
    head = (await db.execute(select(Event).order_by(Event.seq.desc()).limit(1))).scalar_one_or_none()
    seq = (head.seq + 1) if head else 1
    prev_hash = head.entry_hash if head else GENESIS_HASH
    # Stored naive-UTC so the value that round-trips through SQLite is exactly
    # the value that was hashed (see canonical_timestamp).
    occurred_at = datetime.now(timezone.utc).replace(tzinfo=None)

    entry_hash = compute_entry_hash(
        seq=seq, occurred_at=canonical_timestamp(occurred_at), actor_type=actor_type,
        actor_id=actor_id, event_type=event_type, project_id=project_id,
        subject_id=subject_id, payload=payload, prev_hash=prev_hash,
    )
    event = Event(
        seq=seq, occurred_at=occurred_at, actor_type=actor_type, actor_id=actor_id,
        actor_name=actor_name, event_type=event_type, project_id=project_id,
        subject_id=subject_id, payload=payload, signature=signature,
        signed_by=signed_by, prev_hash=prev_hash, entry_hash=entry_hash,
    )
    db.add(event)
    await db.flush()
    return event


async def verify_chain(db: AsyncSession, *, limit: int | None = None) -> dict[str, Any]:
    """Walk the log and report the first break, if any.

    Returns ``{"ok", "checked", "broken_at", "reason"}``. A break means the log
    was altered after the fact — a row edited, deleted, or reordered.
    """
    q = select(Event).order_by(Event.seq.asc())
    if limit:
        q = q.limit(limit)
    events = list((await db.execute(q)).scalars().all())

    expected_prev, expected_seq = GENESIS_HASH, 1
    for ev in events:
        if ev.seq != expected_seq:
            return {"ok": False, "checked": expected_seq - 1, "broken_at": ev.seq,
                    "reason": f"sequence gap: expected {expected_seq}, found {ev.seq} "
                              "— an entry was deleted or reordered"}
        if ev.prev_hash != expected_prev:
            return {"ok": False, "checked": expected_seq - 1, "broken_at": ev.seq,
                    "reason": "prev_hash does not match the previous entry's hash "
                              "— the chain was spliced"}
        if ev.recompute_hash() != ev.entry_hash:
            return {"ok": False, "checked": expected_seq - 1, "broken_at": ev.seq,
                    "reason": "entry_hash does not match its contents "
                              "— this entry was modified after it was written"}
        expected_prev, expected_seq = ev.entry_hash, ev.seq + 1

    return {"ok": True, "checked": len(events), "broken_at": None, "reason": None}


async def read_events(
    db: AsyncSession, *, project_id: str | None = None, actor_id: str | None = None,
    event_type: str | None = None, since_seq: int | None = None, limit: int = 100,
) -> list[Event]:
    """Read the log in order. The single place to answer 'what happened here'."""
    q = select(Event)
    if project_id:
        q = q.where(Event.project_id == project_id)
    if actor_id:
        q = q.where(Event.actor_id == actor_id)
    if event_type:
        q = q.where(Event.event_type == event_type)
    if since_seq is not None:
        q = q.where(Event.seq > since_seq)
    q = q.order_by(Event.seq.asc()).limit(min(limit, 1000))
    return list((await db.execute(q)).scalars().all())


async def head_seq(db: AsyncSession) -> int:
    return (await db.execute(select(func.max(Event.seq)))).scalar() or 0
