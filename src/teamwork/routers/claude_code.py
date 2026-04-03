"""Claude Code session API — proxies session status/control to Prax backend."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter

from teamwork.config import settings

router = APIRouter(prefix="/claude-code", tags=["claude-code"])
_logger = logging.getLogger(__name__)

_PRAX_BASE = "/teamwork/claude-code"


async def _proxy(method: str, path: str, **kwargs) -> dict | None:
    """Proxy a request to the Prax backend."""
    prax_url = settings.prax_url
    if not prax_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.request(
                method,
                f"{prax_url.rstrip('/')}{_PRAX_BASE}{path}",
                **kwargs,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to proxy %s %s to Prax: %s", method, path, exc)
        return None


@router.get("/sessions")
async def list_sessions():
    """List active Claude Code sessions."""
    result = await _proxy("GET", "/sessions")
    if result is None:
        return {"sessions": [], "bridge_available": False}
    return result


@router.delete("/sessions/{session_id}")
async def kill_session(session_id: str):
    """Terminate a Claude Code session."""
    result = await _proxy("DELETE", f"/sessions/{session_id}")
    if result is None:
        return {"error": "Failed to reach Prax backend"}
    return result
