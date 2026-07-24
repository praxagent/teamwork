"""Creating, deciding and spending approvals."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models.approval import (
    STATUS_APPROVED,
    STATUS_CONSUMED,
    STATUS_PENDING,
    STATUS_REJECTED,
    ApprovalRequest,
    fingerprint_action,
)
from teamwork.services.event_log import append_event

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def request_approval(
    db: AsyncSession, *, capability: str, client_name: str,
    agent_id: str | None = None, project_id: str | None = None,
    payload: dict[str, Any] | None = None, reason: str | None = None,
) -> ApprovalRequest:
    """Record a proposed action awaiting a decision.

    Re-attempting the same action returns the existing pending request rather
    than stacking duplicates — an agent that retries should not spam the humans.
    """
    fingerprint = fingerprint_action(capability, project_id, payload)
    existing = (await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.action_fingerprint == fingerprint,
            ApprovalRequest.status == STATUS_PENDING,
        ).order_by(ApprovalRequest.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if existing is not None and not existing.is_expired():
        return existing

    req = ApprovalRequest(
        project_id=project_id, requested_by_agent_id=agent_id,
        requested_by_client=client_name, capability=capability,
        action_fingerprint=fingerprint, payload_preview=payload, reason=reason,
    )
    db.add(req)
    await db.flush()
    await append_event(
        db, event_type="approval.requested", actor_type="agent",
        actor_id=agent_id, actor_name=client_name, project_id=project_id,
        subject_id=req.id,
        payload={"capability": capability, "fingerprint": fingerprint})
    return req


async def decide(
    db: AsyncSession, *, approval_id: str, approve: bool, decided_by: str,
    note: str | None = None,
) -> ApprovalRequest:
    """Approve or reject. A decision is final — decided requests are not reopened."""
    req = (await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )).scalar_one_or_none()
    if req is None:
        raise LookupError("no such approval request")
    if req.status != STATUS_PENDING:
        raise ValueError(f"this request is already {req.status}")
    if req.is_expired():
        raise ValueError("this request has expired")

    req.status = STATUS_APPROVED if approve else STATUS_REJECTED
    req.decided_by = decided_by
    req.decided_at = _now()
    req.decision_note = note
    await db.flush()
    await append_event(
        db, event_type="approval.approved" if approve else "approval.rejected",
        actor_type="human", actor_name=decided_by, project_id=req.project_id,
        subject_id=req.id,
        payload={"capability": req.capability, "note": note})
    return req


async def consume(
    db: AsyncSession, *, approval_id: str, capability: str,
    project_id: str | None, payload: dict[str, Any] | None, client_name: str,
) -> tuple[bool, str]:
    """Spend an approval for exactly this action. ``(ok, reason)``.

    Marks it consumed on success, so a granted approval authorises **one**
    action — not a window during which the agent may repeat it.
    """
    req = (await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )).scalar_one_or_none()
    if req is None:
        return False, "no such approval"

    ok, why = req.usable_for(fingerprint_action(capability, project_id, payload))
    if not ok:
        logger.warning("approval %s refused for client %r: %s",
                       approval_id, client_name, why)
        return False, why

    req.status = STATUS_CONSUMED
    await db.flush()
    await append_event(
        db, event_type="approval.consumed", actor_type="agent",
        actor_name=client_name, project_id=req.project_id, subject_id=req.id,
        payload={"capability": capability})
    return True, ""


async def list_pending(db: AsyncSession, *, project_id: str | None = None,
                       limit: int = 100) -> list[ApprovalRequest]:
    q = select(ApprovalRequest).where(ApprovalRequest.status == STATUS_PENDING)
    if project_id:
        q = q.where(ApprovalRequest.project_id == project_id)
    rows = list((await db.execute(
        q.order_by(ApprovalRequest.created_at.asc()).limit(min(limit, 500))
    )).scalars().all())
    # Expired requests are not decisions anyone should still be asked to make.
    return [r for r in rows if not r.is_expired()]
