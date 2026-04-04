"""Scheduler API router — proxies schedule/reminder requests to Prax backend."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Body

from teamwork.config import settings

router = APIRouter(prefix="/scheduler", tags=["scheduler"])
_logger = logging.getLogger(__name__)

_PRAX_BASE = "/teamwork"


async def _proxy(method: str, path: str, **kwargs) -> Any:
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


@router.get("/schedules")
async def list_schedules():
    """List all cron schedules and reminders."""
    result = await _proxy("GET", "/schedules")
    if result is None:
        return {"schedules": [], "reminders": [], "error": "Prax backend unavailable"}
    return result


@router.post("/schedules")
async def create_schedule(data: dict = Body(...)):
    """Create a new cron schedule."""
    result = await _proxy("POST", "/schedules", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, data: dict = Body(...)):
    """Update a schedule."""
    result = await _proxy("PATCH", f"/schedules/{schedule_id}", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str):
    """Delete a schedule."""
    result = await _proxy("DELETE", f"/schedules/{schedule_id}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/reminders")
async def create_reminder(data: dict = Body(...)):
    """Create a one-time reminder."""
    result = await _proxy("POST", "/reminders", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str):
    """Delete a reminder."""
    result = await _proxy("DELETE", f"/reminders/{reminder_id}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.get("/timezone")
async def get_timezone():
    """Get the user's default timezone."""
    result = await _proxy("GET", "/timezone")
    return result or {"timezone": "UTC"}


@router.put("/timezone")
async def set_timezone(data: dict = Body(...)):
    """Set the user's default timezone."""
    result = await _proxy("PUT", "/timezone", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result
