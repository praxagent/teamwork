"""Plugins API router — proxies plugin management requests to Prax."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from teamwork.config import settings

router = APIRouter(prefix="/plugins", tags=["plugins"])
logger = logging.getLogger(__name__)

PROXY_TIMEOUT = 120.0  # git clone can be slow


def _prax_url() -> str:
    """Return the Prax backend URL, raising if not configured."""
    url = settings.prax_url
    if not url:
        raise HTTPException(
            status_code=501,
            detail="Plugin management requires PRAX_URL to be configured",
        )
    return url.rstrip("/")


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class PluginImportRequest(BaseModel):
    repo_url: str
    name: str | None = None
    plugin_subfolder: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_plugins():
    """List all imported plugins."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(f"{_prax_url()}/plugins")
        resp.raise_for_status()
        return resp.json()


@router.post("/import")
async def import_plugin(body: PluginImportRequest):
    """Import a plugin from a git repository."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.post(
            f"{_prax_url()}/plugins/import",
            json=body.model_dump(exclude_none=True),
        )
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.get("/check-updates")
async def check_all_updates():
    """Check all imported plugins for upstream updates."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(f"{_prax_url()}/plugins/check-updates")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.post("/update-all")
async def update_all_plugins():
    """Pull latest version for all imported plugins."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.post(f"{_prax_url()}/plugins/update-all")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.delete("/{name}")
async def remove_plugin(name: str):
    """Remove an imported plugin."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.delete(f"{_prax_url()}/plugins/{name}")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.post("/{name}/update")
async def update_plugin(name: str):
    """Pull latest version of a plugin."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.post(f"{_prax_url()}/plugins/{name}/update")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.post("/{name}/acknowledge")
async def acknowledge_warnings(name: str):
    """Acknowledge security warnings for a plugin."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.post(f"{_prax_url()}/plugins/{name}/acknowledge")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.get("/{name}/check-updates")
async def check_updates(name: str):
    """Check if a plugin has upstream updates available."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(f"{_prax_url()}/plugins/{name}/check-updates")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.get("/{name}/security")
async def security_scan(name: str):
    """Get security scan results for a plugin."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(f"{_prax_url()}/plugins/{name}/security")
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


@router.get("/{name}/skills")
async def plugin_skills(name: str, subfolder: str | None = None):
    """Get the Skills.md content for a plugin."""
    params = {}
    if subfolder:
        params["subfolder"] = subfolder
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(
            f"{_prax_url()}/plugins/{name}/skills", params=params,
        )
        if resp.status_code >= 400:
            detail = resp.json().get("error", resp.text)
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()
