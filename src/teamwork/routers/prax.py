"""Prax proxy router — model picker and context inspector APIs."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Body

from teamwork.config import settings

router = APIRouter(prefix="/prax", tags=["prax"])
_logger = logging.getLogger(__name__)

_PRAX_BASE = "/teamwork"


async def _proxy(method: str, path: str, **kwargs: Any) -> Any:
    """Proxy a request to the Prax backend."""
    prax_url = settings.prax_url
    if not prax_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
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


# ---------------------------------------------------------------------------
# Model Picker
# ---------------------------------------------------------------------------

@router.get("/model")
async def get_model():
    """Get the current orchestrator model and available options."""
    result = await _proxy("GET", "/model")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.put("/model")
async def set_model(data: dict = Body(...)):
    """Set a runtime model override for the orchestrator."""
    result = await _proxy("PUT", "/model", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Context Inspector
# ---------------------------------------------------------------------------

@router.get("/context/stats")
async def context_stats():
    """Get context window stats from Prax."""
    result = await _proxy("GET", "/context/stats")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/context/compact")
async def context_compact():
    """Trigger manual context compaction."""
    result = await _proxy("POST", "/context/compact")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result
