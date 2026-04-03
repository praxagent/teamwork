"""Memory API router — proxies memory requests to the Prax backend."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Body, Query

from teamwork.config import settings

router = APIRouter(prefix="/memory", tags=["memory"])
_logger = logging.getLogger(__name__)

_PRAX_BASE = "/teamwork/memory"


async def _proxy_get(path: str, params: dict | None = None) -> Any:
    """Proxy a GET request to the Prax backend, returning a fallback on failure."""
    prax_url = settings.prax_url
    if not prax_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{prax_url.rstrip('/')}{_PRAX_BASE}{path}",
                params=params,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to proxy GET %s to Prax: %s", path, exc)
        return None


async def _proxy_request(method: str, path: str, **kwargs: Any) -> Any:
    """Proxy an arbitrary request to the Prax backend."""
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


# ── Config ───────────────────────────────────────────────────────────────


@router.get("/config")
async def get_memory_config():
    """Return memory subsystem configuration from the Prax backend."""
    result = await _proxy_get("/config")
    return result if result is not None else {"enabled": False, "backends": []}


# ── Short-Term Memory (STM) ─────────────────────────────────────────────


@router.get("/stm/{user_id}")
async def get_stm(user_id: str):
    """Retrieve all short-term memory entries for a user."""
    result = await _proxy_get(f"/stm/{user_id}")
    return result if result is not None else {}


@router.put("/stm/{user_id}")
async def put_stm(user_id: str, payload: dict = Body(...)):
    """Create or replace a short-term memory entry for a user."""
    result = await _proxy_request("PUT", f"/stm/{user_id}", json=payload)
    return result if result is not None else {"ok": False}


@router.delete("/stm/{user_id}/{key}")
async def delete_stm(user_id: str, key: str):
    """Delete a short-term memory entry by key."""
    result = await _proxy_request("DELETE", f"/stm/{user_id}/{key}")
    return result if result is not None else {"ok": False}


# ── Long-Term Memory (LTM) ──────────────────────────────────────────────


@router.get("/ltm/{user_id}")
async def get_ltm(
    user_id: str,
    q: str | None = Query(None),
    top_k: int | None = Query(None),
):
    """Search long-term memory for a user."""
    params: dict[str, Any] = {}
    if q is not None:
        params["q"] = q
    if top_k is not None:
        params["top_k"] = top_k
    result = await _proxy_get(f"/ltm/{user_id}", params=params or None)
    return result if result is not None else []


@router.post("/ltm/{user_id}")
async def post_ltm(user_id: str, payload: dict = Body(...)):
    """Store a new long-term memory entry for a user."""
    result = await _proxy_request("POST", f"/ltm/{user_id}", json=payload)
    return result if result is not None else {"ok": False}


@router.delete("/ltm/{user_id}/{memory_id}")
async def delete_ltm(user_id: str, memory_id: str):
    """Delete a long-term memory entry by id."""
    result = await _proxy_request("DELETE", f"/ltm/{user_id}/{memory_id}")
    return result if result is not None else {"ok": False}


# ── Knowledge Graph ──────────────────────────────────────────────────────


@router.get("/graph/{user_id}")
async def get_graph(user_id: str):
    """Retrieve the full knowledge graph for a user."""
    result = await _proxy_get(f"/graph/{user_id}")
    return result if result is not None else {"nodes": [], "edges": []}


@router.get("/graph/{user_id}/entity/{name}")
async def get_graph_entity(user_id: str, name: str):
    """Retrieve a single entity from the knowledge graph."""
    result = await _proxy_get(f"/graph/{user_id}/entity/{name}")
    return result if result is not None else {}


# ── Stats ────────────────────────────────────────────────────────────────


@router.get("/stats/{user_id}")
async def get_stats(user_id: str):
    """Retrieve memory statistics for a user."""
    result = await _proxy_get(f"/stats/{user_id}")
    return result if result is not None else {
        "stm_count": 0,
        "ltm_count": 0,
        "graph_nodes": 0,
        "graph_edges": 0,
    }
