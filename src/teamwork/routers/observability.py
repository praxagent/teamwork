"""Observability API router — proxies config from Prax backend."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter

from teamwork.config import settings

router = APIRouter(prefix="/observability", tags=["observability"])
_logger = logging.getLogger(__name__)


@router.get("/config")
async def get_observability_config():
    """Proxy the observability configuration from the Prax backend.

    The Prax backend owns the observability settings (OBSERVABILITY_ENABLED,
    GRAFANA_URL, etc.).  The frontend calls this endpoint to know whether to
    show dashboards and trace links.
    """
    prax_url = settings.prax_url
    if not prax_url:
        return {"enabled": False, "grafana_url": None, "tempo_url": None}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{prax_url.rstrip('/')}/teamwork/observability")
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to fetch observability config from Prax: %s", exc)
        return {"enabled": False, "grafana_url": None, "tempo_url": None}
