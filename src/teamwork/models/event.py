"""The append-only event log — one ordered, tamper-evident record of what happened.

TeamWork keeps its state in purpose-built tables: messages, tasks, agents. Each
answers "what is true now", none answers **"what happened, in what order, and who
did it"** across the whole workspace. With one agent you can reconstruct that by
reading the message table. With several agents governed by an orchestrator, the
interleaving *is* the thing you need to audit — and a row that was quietly
updated or deleted leaves no trace at all.

So: an append-only log that sits *alongside* the existing tables rather than
replacing them. Buzz reaches the same place from the other direction — it makes
the signed event log the substrate and derives everything from it. That is a
much larger bet (and buys federation we don't want); this keeps SQLite and the
existing models, and adds the ordered audit as a second view.

**Tamper-evidence via a hash chain.** Every event stores the hash of the one
before it, so its `entry_hash` commits to the entire prior history. Deleting,
reordering or editing any row breaks verification from that point on — you
cannot quietly rewrite the past, only append to it. Combined with per-request
signatures (``agent_signing``), the log carries both *who attested to this
action* and *that the sequence has not been altered since*.

The chain proves **internal consistency**, not external notarisation: someone
with write access to the database could recompute the whole chain. Detecting
that needs the head hash anchored somewhere outside — deliberately out of scope,
and called out so the guarantee is not overstated.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from teamwork.models.base import Base

# The genesis link — what the first event chains from.
GENESIS_HASH = "0" * 64


def canonical_timestamp(dt: datetime | None) -> str:
    """Normalise a timestamp to one stable string for hashing.

    SQLite's DateTime column does not preserve ``tzinfo``, so a value written as
    aware UTC reads back naive and its ``isoformat()`` no longer matches what was
    hashed — every entry would fail verification on re-read. Normalising to naive
    UTC on both sides makes the hash survive the round trip.
    """
    if dt is None:
        return ""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat()


def compute_entry_hash(*, seq: int, occurred_at: str, actor_type: str,
                       actor_id: str | None, event_type: str,
                       project_id: str | None, subject_id: str | None,
                       payload: dict[str, Any] | None, prev_hash: str) -> str:
    """Hash one entry, committing to the whole chain before it.

    ``sort_keys`` and explicit separators keep the encoding canonical, so the
    same logical event always hashes the same way regardless of dict ordering.
    """
    body = json.dumps(
        {
            "seq": seq,
            "occurred_at": occurred_at,
            "actor_type": actor_type,
            "actor_id": actor_id,
            "event_type": event_type,
            "project_id": project_id,
            "subject_id": subject_id,
            "payload": payload or {},
            "prev_hash": prev_hash,
        },
        sort_keys=True, separators=(",", ":"), default=str,
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class Event(Base):
    """One append-only, hash-chained entry. Never updated, never deleted."""

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # Monotonic position in the log. The chain's order is this, not the clock —
    # timestamps can collide or drift; seq cannot.
    seq: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )

    # Who acted. actor_type distinguishes a human from an agent from the system,
    # so "an agent did this" is never inferred from a name.
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False)  # agent|human|system
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # What happened, e.g. "message.posted", "task.updated", "agent.status_changed".
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    # The thing acted upon (message id, task id, ...) — deliberately not a FK, so
    # the log survives deletion of the row it describes.
    subject_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    # The caller's Ed25519 signature over the originating request, when it sent
    # one — the agent's own attestation, not merely the server's record.
    signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    entry_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    def recompute_hash(self) -> str:
        return compute_entry_hash(
            seq=self.seq,
            occurred_at=canonical_timestamp(self.occurred_at),
            actor_type=self.actor_type,
            actor_id=self.actor_id,
            event_type=self.event_type,
            project_id=self.project_id,
            subject_id=self.subject_id,
            payload=self.payload,
            prev_hash=self.prev_hash,
        )

    def __repr__(self) -> str:
        return f"<Event(seq={self.seq}, type={self.event_type}, actor={self.actor_name})>"
