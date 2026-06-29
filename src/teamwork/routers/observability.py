"""Observability API router — proxies config from Prax backend."""

from __future__ import annotations

import asyncio
import logging
import os

import httpx
from fastapi import APIRouter

from teamwork.config import settings

router = APIRouter(prefix="/observability", tags=["observability"])
_logger = logging.getLogger(__name__)

# Health endpoints for the LGTM stack. Used by /services to tell the UI which
# dashboards are actually reachable so it can gray out dead links instead of
# linking blindly. Defaults are the host-published ports (the stack runs in
# Docker, TeamWork on the host); override via env for other topologies.
_SERVICE_HEALTH_URLS = {
    "grafana": os.environ.get("GRAFANA_HEALTH_URL", "http://localhost:3002/api/health"),
    "tempo": os.environ.get("TEMPO_HEALTH_URL", "http://localhost:3200/ready"),
    "loki": os.environ.get("LOKI_HEALTH_URL", "http://localhost:3100/ready"),
    "prometheus": os.environ.get("PROMETHEUS_HEALTH_URL", "http://localhost:9090/-/healthy"),
}


async def _probe(client: httpx.AsyncClient, url: str) -> bool:
    """A service is 'up' if its health URL answers at all (any HTTP status).

    We care whether the process is reachable — not whether it's fully warmed
    up — because that's what determines if a dashboard link will resolve. A
    connection refusal / timeout means down → the UI grays the link out.
    """
    try:
        await client.get(url)
        return True
    except Exception:
        return False


@router.get("/services")
async def get_service_availability():
    """Report reachability of each observability service (Grafana/Loki/Tempo/
    Prometheus) so the UI can disable links to services that aren't running."""
    async with httpx.AsyncClient(timeout=2.0) as client:
        names = list(_SERVICE_HEALTH_URLS)
        results = await asyncio.gather(
            *(_probe(client, _SERVICE_HEALTH_URLS[n]) for n in names)
        )
    return dict(zip(names, results))


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


@router.get("/health")
async def get_health_status():
    """Proxy health monitoring data from the Prax backend."""
    prax_url = settings.prax_url
    if not prax_url:
        return {"error": "Prax not configured"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{prax_url.rstrip('/')}/teamwork/health")
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to fetch health status from Prax: %s", exc)
        return {"error": str(exc)}


@router.get("/health/events")
async def get_health_events(
    minutes: int = 60,
    category: str | None = None,
    severity: str | None = None,
    limit: int = 100,
):
    """Proxy health events from the Prax backend."""
    prax_url = settings.prax_url
    if not prax_url:
        return {"events": []}
    try:
        params = {"minutes": minutes, "limit": limit}
        if category:
            params["category"] = category
        if severity:
            params["severity"] = severity
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{prax_url.rstrip('/')}/teamwork/health/events",
                params=params,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to fetch health events from Prax: %s", exc)
        return {"events": []}
