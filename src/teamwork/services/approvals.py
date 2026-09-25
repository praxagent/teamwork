"""Creating, deciding and spending approvals."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models.approval import (
    GRANT_WINDOWS,
    STATUS_APPROVED,
    STATUS_CONSUMED,
    STATUS_PENDING,
    STATUS_REJECTED,
    ApprovalGrant,
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
            # Per requester: another agent asking for the same action must not
            # be handed (or a grant of its own applied to) this one's request.
            ApprovalRequest.requested_by_client == client_name,
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


def can_decide(client) -> tuple[bool, str]:
    """May this credential decide approvals at all? ``(ok, reason)``.

    Two conditions, both structural rather than a matter of trust:

    * ``approval.decide`` must be granted **explicitly** — the ``*`` wildcard
      does not count.  A gated agent's registry entry is typically
      ``allow: ["*"], gated: ["message.delete"]``; if the wildcard conferred
      the right to decide, the gate would be self-approvable by construction.
    * a credential that is itself gated for anything may not decide.  Gating
      says "this caller needs a second party"; the same caller cannot be the
      second party.
    """
    from teamwork.config import CAP_APPROVAL_DECIDE

    if CAP_APPROVAL_DECIDE not in getattr(client, "allow", frozenset()):
        return False, f"this credential is not explicitly granted '{CAP_APPROVAL_DECIDE}'"
    if getattr(client, "gated", frozenset()):
        return False, "a credential whose own actions are gated may not decide approvals"
    return True, ""


async def decide(
    db: AsyncSession, *, approval_id: str, approve: bool, decided_by: str,
    note: str | None = None, decider_client: str | None = None,
    decider_agent_id: str | None = None, scope: str = "once",
) -> ApprovalRequest:
    """Approve or reject. A decision is final — decided requests are not reopened.

    ``decided_by`` is recorded as the decider and must be the name of the
    authenticated credential, not a body field.  ``decider_client`` /
    ``decider_agent_id`` identify the caller for the separation-of-duties check:
    the client (or agent) that requested an action may not decide it — raised
    as ``PermissionError``.  Both default to None for callers that have already
    established the decider is a different party (tests, an admin CLI).
    """
    req = (await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )).scalar_one_or_none()
    if req is None:
        raise LookupError("no such approval request")
    if decider_client is not None and req.requested_by_client == decider_client:
        raise PermissionError("the credential that requested this action may not decide it")
    if decider_agent_id and req.requested_by_agent_id == decider_agent_id:
        raise PermissionError("the agent that requested this action may not decide it")
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
        payload={"capability": req.capability, "note": note, "scope": scope})
    if approve and scope != "once":
        if scope not in GRANT_WINDOWS:
            raise ValueError(f"unknown approval scope {scope!r}")
        grant = ApprovalGrant(
            client_name=req.requested_by_client, capability=req.capability,
            project_id=req.project_id, scope=scope, source_approval_id=req.id,
            granted_by=decided_by,
            expires_at=_now() + timedelta(seconds=GRANT_WINDOWS[scope]),
        )
        db.add(grant)
        await db.flush()
        await append_event(
            db, event_type="approval.grant_created", actor_type="human",
            actor_name=decided_by, project_id=req.project_id, subject_id=grant.id,
            payload={"capability": req.capability, "client": req.requested_by_client,
                     "scope": scope, "expires_at": grant.expires_at.isoformat()})
    return req


async def active_grant(db: AsyncSession, *, client_name: str, capability: str,
                       project_id: str | None) -> ApprovalGrant | None:
    """An unexpired, unrevoked window grant covering this request, if any."""
    rows = (await db.execute(
        select(ApprovalGrant).where(
            ApprovalGrant.client_name == client_name,
            ApprovalGrant.capability == capability,
            ApprovalGrant.project_id == project_id,
            ApprovalGrant.revoked.is_(False),
        ).order_by(ApprovalGrant.expires_at.desc())
    )).scalars().all()
    return next((g for g in rows if g.is_active()), None)


async def request_for_client(
    db: AsyncSession, *, capability: str, client_name: str,
    agent_id: str | None = None, project_id: str | None = None,
    payload: dict[str, Any] | None = None, reason: str | None = None,
) -> ApprovalRequest:
    """An agent asking for approval of its own next action.

    Under an active window grant the request is approved on arrival, but it is
    still a recorded, fingerprint-bound, single-use approval: the grant widens
    who has to be asked, not what gets logged.
    """
    req = await request_approval(
        db, capability=capability, client_name=client_name, agent_id=agent_id,
        project_id=project_id, payload=payload, reason=reason)
    if req.status != STATUS_PENDING:
        return req
    grant = await active_grant(db, client_name=client_name, capability=capability,
                               project_id=project_id)
    if grant is not None:
        req.status = STATUS_APPROVED
        req.decided_by = f"grant:{grant.id}"
        req.decided_at = _now()
        req.decision_note = f"covered by a {grant.scope} grant from {grant.granted_by}"
        await db.flush()
        await append_event(
            db, event_type="approval.auto_granted", actor_type="system",
            actor_name="approval-grant", project_id=project_id, subject_id=req.id,
            payload={"capability": capability, "grant_id": grant.id})
    return req


async def revoke_grant(db: AsyncSession, *, grant_id: str, revoked_by: str) -> ApprovalGrant:
    grant = (await db.execute(
        select(ApprovalGrant).where(ApprovalGrant.id == grant_id)
    )).scalar_one_or_none()
    if grant is None:
        raise LookupError("no such grant")
    grant.revoked = True
    await db.flush()
    await append_event(
        db, event_type="approval.grant_revoked", actor_type="human",
        actor_name=revoked_by, project_id=grant.project_id, subject_id=grant.id,
        payload={"capability": grant.capability, "client": grant.client_name})
    return grant


async def list_active_grants(db: AsyncSession) -> list[ApprovalGrant]:
    rows = (await db.execute(
        select(ApprovalGrant).where(ApprovalGrant.revoked.is_(False))
        .order_by(ApprovalGrant.created_at.desc()).limit(200)
    )).scalars().all()
    return [g for g in rows if g.is_active()]


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

    # Conditional on still being approved: two concurrent spends of one
    # approval must not both succeed.
    spent = await db.execute(
        update(ApprovalRequest)
        .where(ApprovalRequest.id == approval_id, ApprovalRequest.status == STATUS_APPROVED)
        .values(status=STATUS_CONSUMED))
    if spent.rowcount != 1:
        return False, "this approval has already been used"
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
