"""Prax proxy router — model picker and context inspector APIs."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Body, HTTPException

from teamwork.config import settings

router = APIRouter(prefix="/prax", tags=["prax"])
_logger = logging.getLogger(__name__)

_PRAX_BASE = "/teamwork"


# ---------------------------------------------------------------------------
# Outbound credential — the one place TeamWork attaches PRAX_API_KEY
# ---------------------------------------------------------------------------

def prax_headers() -> dict[str, str]:
    """Headers every upstream request to Prax carries.

    Empty unless ``PRAX_API_KEY`` is set, so the default sends exactly what it
    always did.
    """
    key = settings.prax_api_key
    return {"X-API-Key": key} if key else {}


def prax_client(timeout: float) -> httpx.AsyncClient:
    """An httpx client for talking to Prax. Every proxy router builds its
    client here so the credential cannot be forgotten at one call site."""
    return httpx.AsyncClient(timeout=timeout, headers=prax_headers())


def _origin(url: str) -> tuple[str, str, int | None] | None:
    try:
        parts = urlsplit(url)
        if not parts.scheme or not parts.hostname:
            return None
        port = parts.port or {"http": 80, "https": 443}.get(parts.scheme.lower())
    except ValueError:  # malformed URL or a non-numeric port
        return None
    return parts.scheme.lower(), parts.hostname.lower(), port


def prax_headers_for_url(url: str) -> dict[str, str]:
    """``prax_headers()`` only if *url* is on ``PRAX_URL``'s origin.

    Webhook URLs are registered per project by whichever external agent created
    it. Attaching Prax's credential to an arbitrary registered URL would hand
    the key to anyone who can register a project, so it goes to Prax and nowhere
    else. A mismatch is logged loudly: if Prax enforces the key, this is the
    symptom you will be chasing.
    """
    headers = prax_headers()
    if not headers:
        return {}
    target, prax = _origin(url), _origin(settings.prax_url)
    if target is not None and target == prax:
        return headers
    _logger.warning(
        "PRAX_API_KEY is set but %s is not on PRAX_URL's origin (%s) — sending no key",
        url, settings.prax_url or "<unset>",
    )
    return {}


async def _proxy(method: str, path: str, **kwargs: Any) -> Any:
    """Proxy a request to the Prax backend."""
    prax_url = settings.prax_url
    if not prax_url:
        return None
    try:
        async with prax_client(timeout=15.0) as client:
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
async def get_model(discover: bool = False):
    """Get the current orchestrator model and available options.

    ``discover=true`` asks each configured provider what it can serve. Opt-in
    because the badge polls this endpoint and only needs the current selection —
    the picker requests discovery when the user opens the dropdown.
    """
    result = await _proxy("GET", f"/model?discover={'1' if discover else '0'}")
    if result is None:
        raise HTTPException(status_code=502, detail="Prax backend unavailable")
    return result


@router.put("/model")
async def set_model(data: dict = Body(...)):
    """Set a runtime model override for the orchestrator."""
    result = await _proxy("PUT", "/model", json=data)
    if result is None:
        raise HTTPException(status_code=502, detail="Prax backend unavailable")
    return result


# ---------------------------------------------------------------------------
# Deployment / reachability
# ---------------------------------------------------------------------------

@router.get("/deployment")
async def get_deployment():
    """Proxy Prax's deployment/reachability info (Tailscale/ngrok/local + the
    base URL links actually use). Shown in the Settings panel."""
    result = await _proxy("GET", "/deployment")
    if result is None:
        return {"available": False, "error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Context Inspector
# ---------------------------------------------------------------------------

@router.get("/context/stats")
async def context_stats():
    """Get context window stats from Prax."""
    result = await _proxy("GET", "/context/stats")
    if result is None:
        raise HTTPException(status_code=502, detail="Prax backend unavailable")
    return result


@router.post("/context/compact")
async def context_compact():
    """Trigger manual context compaction."""
    result = await _proxy("POST", "/context/compact")
    if result is None:
        raise HTTPException(status_code=502, detail="Prax backend unavailable")
    return result
