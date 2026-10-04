"""Restart the sandbox container from the UI.

The desktop, the terminal and the agent's browser all live in one sandbox
container. When it gets stuck (a hung desktop, a runaway process), a person
restarts it here instead of reaching for docker on the host.

``docker restart`` keeps the container: files, installed packages and the
browser profile survive, and running programs stop. Each restart goes in the
event log. One at a time.
"""
from __future__ import annotations

import asyncio
import logging
import shutil

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.config import settings
from teamwork.models.base import get_db
from teamwork.services.event_log import append_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sandbox", tags=["sandbox"])

_RESTART_TIMEOUT = 90
_restart_lock = asyncio.Lock()


@router.post("/restart")
async def restart_sandbox(db: AsyncSession = Depends(get_db)) -> dict:
    container = settings.sandbox_container
    if not container:
        raise HTTPException(503, "No sandbox is configured (SANDBOX_CONTAINER is empty).")
    if not shutil.which("docker"):
        raise HTTPException(503, "TeamWork cannot reach docker, so it cannot restart the sandbox.")
    if _restart_lock.locked():
        raise HTTPException(409, "A sandbox restart is already in progress.")

    async with _restart_lock:
        logger.info("Restarting sandbox container %s (requested from the UI)", container)
        proc = await asyncio.create_subprocess_exec(
            "docker", "restart", "-t", "10", container,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=_RESTART_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(504, f"The restart took longer than {_RESTART_TIMEOUT} seconds.") from None
        if proc.returncode != 0:
            detail = (err or b"").decode(errors="replace").strip()[-300:]
            raise HTTPException(500, f"docker restart failed: {detail or 'no detail'}")

    await append_event(db, event_type="sandbox.restarted", actor_type="human",
                       payload={"container": container})
    return {"status": "restarted", "container": container}
