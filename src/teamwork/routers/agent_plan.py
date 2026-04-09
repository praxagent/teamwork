"""Agent plan router — proxies Prax's private working-memory to-do list.

Thin read-only proxy for the chat view's "Currently working on" widget.
The plan itself is managed by Prax through ``agent_plan`` / ``agent_step_done``
/ ``agent_plan_clear`` — this endpoint just exposes the current state so
the user can see what Prax is working on without mid-execution oversight.

See ``docs/library.md`` in the Prax repo for the wall between this (Prax's
private working memory) and the Library Kanban (the user's project board).
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter

from teamwork.config import settings

router = APIRouter(prefix="/agent-plan", tags=["agent-plan"])
_logger = logging.getLogger(__name__)


async def _proxy(method: str, path: str, **kwargs) -> Any:
    prax_url = settings.prax_url
    if not prax_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.request(
                method,
                f"{prax_url.rstrip('/')}/teamwork/agent-plan{path}",
                **kwargs,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to proxy %s /agent-plan%s to Prax: %s", method, path, exc)
        return None


@router.get("")
async def get_agent_plan():
    """Return Prax's current agent_plan or null if none active."""
    result = await _proxy("GET", "")
    # Distinguish "no plan" (null) from "backend unavailable"
    if result is None:
        return None
    return result
