"""Approval gates — an agent proposes, a human (or the orchestrator) decides.

Capabilities (``agent_auth``) answer *may this agent ever do X*. That is the
right question for most actions and the wrong one for the few that are
irreversible or wide-blast-radius: you want the agent to be *able* to purge a
channel when a human says so, and unable to do it on its own initiative. A
permanent grant cannot express that; an approval gate can.

**The action fingerprint is the whole design.** A naive gate approves *an
agent*, and the agent then does something else — approval for "post to #general"
gets spent on "purge #ops". So an approval is bound to a
:func:`fingerprint_action` of the exact capability, project and payload it was
granted for, and is **single-use**. Presenting it for any other action fails the
match; presenting it twice fails on consumption.

Flow, deliberately without the server replaying arbitrary actions:

1. Agent attempts a gated action → ``403 approval_required`` plus a pending
   request carrying the fingerprint.
2. A human (or an orchestrator with the authority) approves or rejects it.
3. Agent retries the *same* action with ``X-Approval-Id``. The server checks the
   approval is approved, unexpired, unconsumed, and fingerprint-matched, then
   executes and marks it consumed.

The server never stores "an action to run later", so there is no queue of
half-executed intentions and no replay engine to get wrong.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from teamwork.models.base import Base

# How long an approval stays usable once granted. Short on purpose: an approval
# is a decision about *now*, and a stale one is a standing grant nobody revisited.
DEFAULT_TTL_SECONDS = 3600

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_CONSUMED = "consumed"


def fingerprint_action(capability: str, project_id: str | None,
                       payload: dict[str, Any] | None) -> str:
    """Identify the exact action an approval is for.

    Canonical JSON so key ordering cannot produce two fingerprints for one
    action — and so a caller cannot reshuffle a payload to reuse an approval.
    """
    body = json.dumps(
        {"capability": capability, "project_id": project_id, "payload": payload or {}},
        sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class ApprovalRequest(Base):
    """One proposed action awaiting a decision."""

    __tablename__ = "approval_requests"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # Who asked. The credential name is recorded alongside the agent id because
    # the credential is what was actually authenticated.
    requested_by_agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    requested_by_client: Mapped[str] = mapped_column(String(255), nullable=False)

    capability: Mapped[str] = mapped_column(String(64), nullable=False)
    action_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Kept for the human deciding — they need to see what they are approving.
    payload_preview: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), default=STATUS_PENDING, nullable=False, index=True)
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: (datetime.now(timezone.utc).replace(tzinfo=None)
                         + timedelta(seconds=DEFAULT_TTL_SECONDS)),
        nullable=False)

    def is_expired(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc).replace(tzinfo=None)
        if self.expires_at is None:
            return False
        expires = self.expires_at
        if expires.tzinfo is not None:
            expires = expires.astimezone(timezone.utc).replace(tzinfo=None)
        return now > expires

    def usable_for(self, fingerprint: str, now: datetime | None = None) -> tuple[bool, str]:
        """May this approval authorise *fingerprint* right now? ``(ok, reason)``."""
        if self.status == STATUS_CONSUMED:
            return False, "this approval has already been used"
        if self.status == STATUS_REJECTED:
            return False, "this action was rejected"
        if self.status == STATUS_PENDING:
            return False, "this action has not been approved yet"
        if self.is_expired(now):
            return False, "this approval has expired"
        if self.action_fingerprint != fingerprint:
            return False, ("this approval was granted for a different action "
                           "— approvals are bound to the exact action")
        return True, ""

    def __repr__(self) -> str:
        return f"<ApprovalRequest(id={self.id}, {self.capability}, {self.status})>"
