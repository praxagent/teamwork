"""Static-file router for Hugo-rendered courses and notes.

Prax builds a Hugo site under ``{workspace}/{user}/courses/_site/public/``
when ``course_publish`` or note publishing runs.  This router serves that
output for local / Tailscale / SSH access — TeamWork is bound to the host
network only (it is NOT exposed via the ngrok tunnel that Twilio uses),
so no authentication is needed: visibility is gated by network reach.

For *public* internet access, Prax registers individual courses/notes in
the user's share registry and the matching Flask route on the Prax app
serves them through the ngrok tunnel.  See
``prax/blueprints/main_routes.py:serve_course_site`` for that path.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, PlainTextResponse

from teamwork.config import settings

router = APIRouter()


def _find_public_dir(rel_path: str) -> Path | None:
    """Scan every workspace's Hugo public/ for one that contains *rel_path*."""
    base = settings.workspace_path
    if not base.is_dir():
        return None
    for user_dir in base.iterdir():
        if not user_dir.is_dir():
            continue
        public = user_dir / "courses" / "_site" / "public"
        if not public.is_dir():
            continue
        candidate = public / rel_path
        if candidate.exists() or (public / rel_path).is_dir():
            return public
    return None


def _serve_under(public: Path, rel_path: str):
    target = public / rel_path
    if target.is_dir():
        target = target / "index.html"
    if not target.is_file():
        return PlainTextResponse("Page not found.", status_code=404)
    # Containment check — defends against `..` escapes in user-supplied paths.
    try:
        target.resolve().relative_to(public.resolve())
    except ValueError:
        return PlainTextResponse("Not found", status_code=404)
    return FileResponse(target)


@router.get("/courses/")
@router.get("/courses/{full_path:path}")
async def serve_course(full_path: str = ""):
    """Serve Hugo course pages — unauthenticated, local-network only."""
    rel = full_path or ""
    public = _find_public_dir(rel)
    if public is None:
        return PlainTextResponse("Page not found.", status_code=404)
    return _serve_under(public, rel)


@router.get("/notes/")
@router.get("/notes/{full_path:path}")
async def serve_note(full_path: str = ""):
    """Serve Hugo note pages — unauthenticated, local-network only."""
    rel = os.path.join("notes", full_path) if full_path else "notes/"
    public = _find_public_dir(rel)
    if public is None:
        return PlainTextResponse("Page not found.", status_code=404)
    return _serve_under(public, rel)


@router.get("/news/")
@router.get("/news/{full_path:path}")
async def serve_news(full_path: str = ""):
    """Serve Hugo news pages — unauthenticated, local-network only."""
    rel = os.path.join("news", full_path) if full_path else "news/"
    public = _find_public_dir(rel)
    if public is None:
        return PlainTextResponse("Page not found.", status_code=404)
    return _serve_under(public, rel)
