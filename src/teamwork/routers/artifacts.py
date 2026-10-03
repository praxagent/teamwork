"""Artifacts: pages the agent makes and keeps updating (Prax: ARTIFACTS_ENABLED).

TeamWork only displays them. The page comes from the agent
(``GET {PRAX_URL}/teamwork/artifacts/<id>``) and the frontend renders it in a
sandboxed frame — scripts run, but in an opaque origin with no network — never
on TeamWork's own origin, which holds the session. See
``docs/comparisons/television.md`` and backlog #1.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from teamwork.config import settings
from teamwork.routers.prax import prax_client

router = APIRouter(prefix="/artifacts", tags=["artifacts"])
_logger = logging.getLogger(__name__)

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


async def _get(path: str, params: dict | None = None) -> Any:
    prax_url = settings.prax_url
    if not prax_url:
        raise HTTPException(status_code=503, detail="No agent is connected (PRAX_URL)")
    try:
        async with prax_client(timeout=10.0) as client:
            resp = await client.get(f"{prax_url.rstrip('/')}/teamwork/artifacts{path}",
                                    params=params)
    except Exception as exc:  # noqa: BLE001 - agent unreachable
        _logger.debug("artifacts proxy %s failed: %s", path, exc)
        raise HTTPException(status_code=503, detail="The agent is not reachable") from exc
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="No such artifact, or artifacts are off")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"The agent answered {resp.status_code}")
    return resp.json()


@router.get("")
async def list_artifacts():
    """Every artifact's manifest, newest first."""
    return await _get("")


@router.get("/{artifact_id}")
async def get_artifact(artifact_id: str, meta: bool = Query(False)):
    """One artifact (manifest + ``html``); ``?meta=1`` omits the page."""
    if not _ID.match(artifact_id):
        raise HTTPException(status_code=404, detail="No such artifact")
    return await _get(f"/{artifact_id}", params={"meta": "1"} if meta else None)
