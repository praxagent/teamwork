"""Approvals, as the human sees them — the decision side of the approval gate.

An agent can ask (``/api/external/approvals``) but never answer. The answer
comes from here: the TeamWork UI's approval dialog, which a person clicks. That
separation is the point — an approval that travels back through the agent's own
conversation is a suggestion the agent can talk itself past, not a decision.

Deciding requires an authenticated person (``_require_person``): a browser
session from the ``INTERNAL_API_KEY`` login, or the authenticating proxy. With
neither configured, decisions are refused — an unauthenticated route cannot
tell a person's browser from any program that can reach the port — unless the
operator opts in with ``APPROVALS_ALLOW_UNAUTHENTICATED``. Requests presenting
an agent credential are refused regardless.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models.base import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/approvals", tags=["approvals"])

# Headers only an agent sends. A browser session never carries them.
_AGENT_HEADERS = ("x-api-key", "x-agent-signature", "authorization")
HUMAN_DECIDER = "human:teamwork-ui"


def _human_only(request: Request) -> None:
    """Refuse anything presenting an agent credential."""
    present = [h for h in _AGENT_HEADERS if request.headers.get(h)]
    if present:
        logger.warning("refused an approval request carrying agent credentials (%s)", present)
        raise HTTPException(
            status_code=403,
            detail="Agent credentials cannot decide approvals; a person decides in the TeamWork UI.")


def _require_person(request: Request) -> None:
    """A decision must come from an authenticated person, not merely a request
    without agent headers — headers can simply be left off.

    * ``INTERNAL_API_KEY`` set: a valid browser **session cookie** (the UI
      login). The ``X-Internal-Key`` header alone is not enough: it is the
      scripts path, and scripts are what this check keeps out.
    * the authenticating proxy enabled: its middleware already verified the
      person's signed assertion on this request.
    * neither: refused, unless ``APPROVALS_ALLOW_UNAUTHENTICATED`` says the
      operator accepts that anything reaching the port could approve.
    """
    from teamwork.config import settings
    from teamwork.internal_auth import COOKIE, verify_session_token

    _human_only(request)
    if settings.internal_api_key:
        if verify_session_token(settings.internal_api_key, request.cookies.get(COOKIE)):
            return
        raise HTTPException(status_code=403, detail=(
            "Approvals need a logged-in TeamWork session. Reload the page and log in."))
    if settings.proxy_auth_enabled:
        return
    if settings.approvals_allow_unauthenticated:
        logger.warning("approval decided without UI authentication "
                       "(APPROVALS_ALLOW_UNAUTHENTICATED=true)")
        return
    raise HTTPException(status_code=403, detail=(
        "Approvals are disabled until TeamWork's UI is authenticated: set "
        "INTERNAL_API_KEY (or the authenticating proxy). Without it, any program "
        "that can reach TeamWork could approve on your behalf."))


class HumanDecision(BaseModel):
    approve: bool
    # "once" = this exact action, one time. "hour" / "day" = this capability,
    # for this requester, for that window (each use still recorded).
    scope: str = "once"
    note: str | None = None


def _row(r) -> dict[str, Any]:
    return {
        "approval_id": r.id,
        "capability": r.capability,
        "requested_by": r.requested_by_client,
        "project_id": r.project_id,
        "payload": r.payload_preview,
        "reason": r.reason,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "expires_at": r.expires_at.isoformat() if r.expires_at else None,
    }


@router.get("/pending")
async def pending(request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Everything waiting on a person, oldest first."""
    _human_only(request)
    from teamwork.services.approvals import list_pending

    return {"pending": [_row(r) for r in await list_pending(db)]}


@router.post("/{approval_id}/decide")
async def decide(
    approval_id: str, body: HumanDecision, request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _require_person(request)
    from teamwork.models.approval import GRANT_WINDOWS
    from teamwork.services.approvals import decide as do_decide

    if body.scope != "once" and body.scope not in GRANT_WINDOWS:
        raise HTTPException(status_code=422, detail=f"unknown scope {body.scope!r}")
    try:
        req = await do_decide(db, approval_id=approval_id, approve=body.approve,
                              decided_by=HUMAN_DECIDER, note=body.note, scope=body.scope)
    except LookupError:
        raise HTTPException(status_code=404, detail="No such approval request.") from None
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    await db.commit()
    return {"approval_id": req.id, "status": req.status, "scope": body.scope}


@router.get("/grants")
async def grants(request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Standing (time-bounded) grants currently in force."""
    _human_only(request)
    from teamwork.services.approvals import list_active_grants

    return {"grants": [
        {"grant_id": g.id, "capability": g.capability, "client": g.client_name,
         "scope": g.scope, "expires_at": g.expires_at.isoformat(),
         "granted_by": g.granted_by}
        for g in await list_active_grants(db)
    ]}


@router.post("/grants/{grant_id}/revoke")
async def revoke(grant_id: str, request: Request,
                 db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_person(request)
    from teamwork.services.approvals import revoke_grant

    try:
        await revoke_grant(db, grant_id=grant_id, revoked_by=HUMAN_DECIDER)
    except LookupError:
        raise HTTPException(status_code=404, detail="No such grant.") from None
    await db.commit()
    return {"grant_id": grant_id, "revoked": True}
