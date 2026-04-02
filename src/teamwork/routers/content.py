"""Content API router — proxies Prax's Space content (notes, courses, news) requests."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request

from teamwork.config import settings

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger(__name__)

PROXY_TIMEOUT = 30.0


def _prax_url() -> str:
    """Return the Prax backend URL, raising if not configured."""
    url = settings.prax_url
    if not url:
        raise HTTPException(
            status_code=501,
            detail="Content browsing requires PRAX_URL to be configured",
        )
    return url.rstrip("/")


@router.get("")
async def list_content():
    """List all notes, courses, and news."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(f"{_prax_url()}/teamwork/content")
        resp.raise_for_status()
        return resp.json()


@router.get("/search")
async def search_content(q: str = ""):
    """Search across notes, courses, and news."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(
            f"{_prax_url()}/teamwork/content/search",
            params={"q": q},
        )
        resp.raise_for_status()
        return resp.json()


@router.get("/notes/{slug}/versions")
async def list_note_versions(slug: str, limit: int = 5):
    """List recent git versions of a note."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(
            f"{_prax_url()}/teamwork/content/notes/{slug}/versions",
            params={"limit": limit},
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Note not found")
        resp.raise_for_status()
        return resp.json()


@router.get("/notes/{slug}/versions/{commit}")
async def get_note_version(slug: str, commit: str):
    """Get note content at a specific git commit."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(
            f"{_prax_url()}/teamwork/content/notes/{slug}/versions/{commit}",
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Version not found")
        resp.raise_for_status()
        return resp.json()


@router.post("/notes/{slug}/versions/{commit}/restore")
async def restore_note_version(slug: str, commit: str):
    """Restore a note to a specific git version."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.post(
            f"{_prax_url()}/teamwork/content/notes/{slug}/versions/{commit}/restore",
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Version not found")
        resp.raise_for_status()
        return resp.json()


@router.delete("/notes/{slug}")
async def delete_note(slug: str):
    """Delete a note."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.delete(f"{_prax_url()}/teamwork/content/notes/{slug}")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Note not found")
        resp.raise_for_status()
        return resp.json()


@router.put("/notes/{slug}")
async def update_note(slug: str, request: Request):
    """Update a note's content and/or title."""
    body = await request.json()
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.put(
            f"{_prax_url()}/teamwork/content/notes/{slug}",
            json=body,
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Note not found")
        resp.raise_for_status()
        return resp.json()


@router.get("/{category}/{slug}")
async def get_content_item(category: str, slug: str):
    """Get a single content item by category and slug."""
    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
        resp = await client.get(f"{_prax_url()}/teamwork/content/{category}/{slug}")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Content not found")
        resp.raise_for_status()
        return resp.json()
