"""Library API router — proxies Library (Project → Notebook → Note) requests to Prax.

The Library is an agent-neutral knowledge base with a hierarchical
Project → Notebook → Note layout, inspired by Karpathy's "Second Brain"
three-folder pattern (raw / wiki / outputs) and Obsidian's vault-with-
notebooks UX.  This router is a thin proxy to the Prax backend, which
owns the actual filesystem layout and permission logic.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Body, File, UploadFile

from teamwork.config import settings

router = APIRouter(prefix="/library", tags=["library"])
_logger = logging.getLogger(__name__)

_PRAX_BASE = "/teamwork/library"


async def _proxy(method: str, path: str, **kwargs) -> Any:
    """Proxy a request to the Prax backend."""
    prax_url = settings.prax_url
    if not prax_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
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
# Tree
# ---------------------------------------------------------------------------

@router.get("")
async def library_tree():
    """Return the full library tree: projects → notebooks → notes."""
    result = await _proxy("GET", "")
    if result is None:
        return {"spaces": [], "error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@router.post("/spaces")
async def create_project(data: dict = Body(...)):
    """Create a new project."""
    result = await _proxy("POST", "/spaces", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/spaces/{project}")
async def delete_project(project: str):
    """Delete an empty project."""
    result = await _proxy("DELETE", f"/spaces/{project}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Notebooks
# ---------------------------------------------------------------------------

@router.post("/spaces/{project}/notebooks")
async def create_notebook(project: str, data: dict = Body(...)):
    """Create a new notebook inside a project."""
    result = await _proxy("POST", f"/spaces/{project}/notebooks", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/spaces/{project}/notebooks/{notebook}")
async def delete_notebook(project: str, notebook: str):
    """Delete an empty notebook."""
    result = await _proxy("DELETE", f"/spaces/{project}/notebooks/{notebook}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

@router.post("/notes")
async def create_note(data: dict = Body(...)):
    """Create a note. Defaults to author=human because the UI is the caller."""
    result = await _proxy("POST", "/notes", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.get("/notes/{project}/{notebook}/{slug}")
async def get_note(project: str, notebook: str, slug: str):
    """Return a note with metadata and full content."""
    result = await _proxy("GET", f"/notes/{project}/{notebook}/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/notes/{project}/{notebook}/{slug}")
async def update_note(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Update a note's content, title, or tags."""
    result = await _proxy("PATCH", f"/notes/{project}/{notebook}/{slug}", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/notes/{project}/{notebook}/{slug}")
async def delete_note(project: str, notebook: str, slug: str):
    """Delete a note."""
    result = await _proxy("DELETE", f"/notes/{project}/{notebook}/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/notes/{project}/{notebook}/{slug}/move")
async def move_note(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Move a note to a different notebook (and optionally project)."""
    result = await _proxy("PATCH", f"/notes/{project}/{notebook}/{slug}/move", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/notes/{project}/{notebook}/{slug}/editable")
async def set_note_editable(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Toggle the prax_may_edit flag on a note."""
    result = await _proxy("PATCH", f"/notes/{project}/{notebook}/{slug}/editable", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Phase 2: schema, index, backlinks, refine, raw, outputs, health check
# ---------------------------------------------------------------------------

@router.get("/schema")
async def get_schema():
    """Return LIBRARY.md content."""
    result = await _proxy("GET", "/schema")
    if result is None:
        return {"content": "", "error": "Prax backend unavailable"}
    return result


@router.put("/schema")
async def put_schema(data: dict = Body(...)):
    """Overwrite LIBRARY.md."""
    result = await _proxy("PUT", "/schema", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.get("/index")
async def get_index():
    """Return the auto-maintained INDEX.md."""
    result = await _proxy("GET", "/index")
    if result is None:
        return {"content": "", "error": "Prax backend unavailable"}
    return result


@router.get("/tags")
async def get_tag_tree():
    """Return the nested tag tree."""
    result = await _proxy("GET", "/tags")
    if result is None:
        return {"count": 0, "total": 0, "children": {}, "error": "Prax backend unavailable"}
    return result


@router.get("/notes/by-tag")
async def list_notes_by_tag(prefix: str = ""):
    """Return notes matching a tag prefix."""
    path = f"/notes/by-tag?prefix={prefix}" if prefix else "/notes/by-tag"
    result = await _proxy("GET", path)
    if result is None:
        return {"notes": [], "error": "Prax backend unavailable"}
    return result


@router.get("/notes/{project}/{notebook}/{slug}/backlinks")
async def get_backlinks(project: str, notebook: str, slug: str):
    """Return notes that wikilink to this note."""
    result = await _proxy("GET", f"/notes/{project}/{notebook}/{slug}/backlinks")
    if result is None:
        return {"backlinks": [], "error": "Prax backend unavailable"}
    return result


@router.post("/notes/{project}/{notebook}/{slug}/refine")
async def refine_note(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Generate a refined version (does not apply — preview only)."""
    result = await _proxy("POST", f"/notes/{project}/{notebook}/{slug}/refine", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/notes/{project}/{notebook}/{slug}/apply-refine")
async def apply_refine(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Apply an approved refine result with override_permission."""
    result = await _proxy("POST", f"/notes/{project}/{notebook}/{slug}/apply-refine", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/notes/{project}/{notebook}/{slug}/refine-via-agent")
async def refine_via_agent(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Run a refinement through the full chat agent (with tool access)."""
    result = await _proxy("POST", f"/notes/{project}/{notebook}/{slug}/refine-via-agent", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# --- Raw captures ---

@router.get("/raw")
async def list_raw():
    """List raw captures."""
    result = await _proxy("GET", "/raw")
    if result is None:
        return {"raw": [], "error": "Prax backend unavailable"}
    return result


@router.post("/raw")
async def capture_raw(data: dict = Body(...)):
    """Capture a new raw item."""
    result = await _proxy("POST", "/raw", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.get("/raw/{slug}")
async def get_raw(slug: str):
    """Fetch a single raw capture."""
    result = await _proxy("GET", f"/raw/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/raw/{slug}")
async def delete_raw(slug: str):
    """Delete a raw capture without promoting."""
    result = await _proxy("DELETE", f"/raw/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/raw/{slug}/promote")
async def promote_raw(slug: str, data: dict = Body(...)):
    """Promote a raw capture into a notebook."""
    result = await _proxy("POST", f"/raw/{slug}/promote", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# --- Outputs ---

@router.get("/outputs")
async def list_outputs():
    """List generated outputs."""
    result = await _proxy("GET", "/outputs")
    if result is None:
        return {"outputs": [], "error": "Prax backend unavailable"}
    return result


@router.get("/outputs/{slug}")
async def get_output(slug: str):
    """Fetch a generated output."""
    result = await _proxy("GET", f"/outputs/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# --- Health check ---

@router.post("/health-check")
async def run_health_check():
    """Run the library audit."""
    result = await _proxy("POST", "/health-check")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/health-check/schedule")
async def schedule_health_check(data: dict = Body(...)):
    """Schedule the library audit on a recurring cron."""
    result = await _proxy("POST", "/health-check/schedule", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Phase 3: project metadata, notebook sequencing, Kanban tasks
# ---------------------------------------------------------------------------

@router.get("/spaces/{project}")
async def get_project(project: str):
    """Return project metadata + progress."""
    result = await _proxy("GET", f"/spaces/{project}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/spaces/{project}")
async def update_project(project: str, data: dict = Body(...)):
    """Update project metadata."""
    result = await _proxy("PATCH", f"/spaces/{project}", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/spaces/{project}/notebooks/{notebook}")
async def update_notebook(project: str, notebook: str, data: dict = Body(...)):
    """Update notebook metadata (sequenced, current_slug, rename)."""
    result = await _proxy("PATCH", f"/spaces/{project}/notebooks/{notebook}", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/spaces/{project}/notebooks/{notebook}/reorder")
async def reorder_notebook(project: str, notebook: str, data: dict = Body(...)):
    """Batch-reorder notes in a sequenced notebook."""
    result = await _proxy("POST", f"/spaces/{project}/notebooks/{notebook}/reorder", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/notes/{project}/{notebook}/{slug}/status")
async def set_note_status(project: str, notebook: str, slug: str, data: dict = Body(...)):
    """Mark a note as todo or done."""
    result = await _proxy("PATCH", f"/notes/{project}/{notebook}/{slug}/status", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# --- Tasks ---

@router.get("/spaces/{project}/tasks")
async def list_tasks(project: str, column: str | None = None):
    """List tasks for a project."""
    path = f"/spaces/{project}/tasks"
    if column:
        path += f"?column={column}"
    result = await _proxy("GET", path)
    if result is None:
        return {"tasks": [], "error": "Prax backend unavailable"}
    return result


@router.post("/spaces/{project}/tasks")
async def create_task(project: str, data: dict = Body(...)):
    """Create a new task."""
    result = await _proxy("POST", f"/spaces/{project}/tasks", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.get("/spaces/{project}/tasks/{task_id}")
async def get_task(project: str, task_id: str):
    """Fetch full task details."""
    result = await _proxy("GET", f"/spaces/{project}/tasks/{task_id}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/spaces/{project}/tasks/{task_id}")
async def update_task(project: str, task_id: str, data: dict = Body(...)):
    """Update a task."""
    result = await _proxy("PATCH", f"/spaces/{project}/tasks/{task_id}", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/spaces/{project}/tasks/{task_id}")
async def delete_task(project: str, task_id: str):
    """Delete a task."""
    result = await _proxy("DELETE", f"/spaces/{project}/tasks/{task_id}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/spaces/{project}/tasks/{task_id}/move")
async def move_task(project: str, task_id: str, data: dict = Body(...)):
    """Move a task to a different column."""
    result = await _proxy("PATCH", f"/spaces/{project}/tasks/{task_id}/move", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/spaces/{project}/tasks/{task_id}/comment")
async def comment_task(project: str, task_id: str, data: dict = Body(...)):
    """Add a comment to a task."""
    result = await _proxy("POST", f"/spaces/{project}/tasks/{task_id}/comment", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# --- Columns ---

@router.get("/spaces/{project}/tasks/columns")
async def list_columns(project: str):
    """List columns."""
    result = await _proxy("GET", f"/spaces/{project}/tasks/columns")
    if result is None:
        return {"columns": [], "error": "Prax backend unavailable"}
    return result


@router.post("/spaces/{project}/tasks/columns")
async def add_column(project: str, data: dict = Body(...)):
    """Add a column."""
    result = await _proxy("POST", f"/spaces/{project}/tasks/columns", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.patch("/spaces/{project}/tasks/columns/{column_id}")
async def rename_column(project: str, column_id: str, data: dict = Body(...)):
    """Rename a column."""
    result = await _proxy("PATCH", f"/spaces/{project}/tasks/columns/{column_id}", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/spaces/{project}/tasks/columns/{column_id}")
async def remove_column(project: str, column_id: str):
    """Remove a column."""
    result = await _proxy("DELETE", f"/spaces/{project}/tasks/columns/{column_id}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/spaces/{project}/tasks/columns/reorder")
async def reorder_columns(project: str, data: dict = Body(...)):
    """Reorder columns."""
    result = await _proxy("POST", f"/spaces/{project}/tasks/columns/reorder", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Space cover images
# ---------------------------------------------------------------------------

@router.get("/spaces/{space}/cover")
async def get_space_cover(space: str):
    """Serve a space's cover image."""
    prax_url = settings.prax_url
    if not prax_url:
        return {"error": "Prax backend unavailable"}
    import httpx
    from fastapi.responses import Response
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{prax_url.rstrip('/')}{_PRAX_BASE}/spaces/{space}/cover",
            )
            if resp.status_code == 404:
                return {"error": "No cover image"}
            resp.raise_for_status()
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "image/png"),
            )
    except Exception as exc:
        _logger.debug("Failed to proxy space cover: %s", exc)
        return {"error": "Prax backend unavailable"}


@router.post("/spaces/{space}/cover")
async def upload_space_cover(space: str):
    """Upload a cover image (multipart)."""
    from fastapi import Request
    # Pass through the raw request body to Prax
    from starlette.requests import Request as StarletteRequest
    # For multipart, we need to forward the raw body
    result = await _proxy("POST", f"/spaces/{space}/cover")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/spaces/{space}/cover")
async def delete_space_cover(space: str):
    """Remove a space's cover image."""
    result = await _proxy("DELETE", f"/spaces/{space}/cover")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.post("/spaces/{space}/cover/generate")
async def generate_space_cover(space: str, data: dict = Body(default={})):
    """Ask Prax to generate a cover image."""
    result = await _proxy("POST", f"/spaces/{space}/cover/generate", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# --- Space files (per-space reference-file store) ---

@router.get("/spaces/{space}/files")
async def list_space_files(space: str):
    """List uploaded files in a space."""
    result = await _proxy("GET", f"/spaces/{space}/files")
    return result or {"files": []}


@router.post("/spaces/{space}/files")
async def upload_space_file(space: str, file: UploadFile = File(...)):
    """Upload a file to a space — accepts multipart and re-sends to Prax."""
    from fastapi.responses import JSONResponse

    prax_url = settings.prax_url
    if not prax_url:
        return JSONResponse({"error": "Prax backend unavailable"}, status_code=502)
    try:
        content = await file.read()
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{prax_url.rstrip('/')}{_PRAX_BASE}/spaces/{space}/files",
                files={"file": (file.filename, content, file.content_type or "application/octet-stream")},
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to proxy file upload: %s", exc)
        return JSONResponse({"error": "Prax backend unavailable"}, status_code=502)


@router.get("/spaces/{space}/files/{filename}")
async def get_space_file(space: str, filename: str):
    """Download / serve a file from a space."""
    from fastapi.responses import Response

    prax_url = settings.prax_url
    if not prax_url:
        return {"error": "Prax backend unavailable"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{prax_url.rstrip('/')}{_PRAX_BASE}/spaces/{space}/files/{filename}",
            )
            if resp.status_code == 404:
                return {"error": "File not found"}
            resp.raise_for_status()
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "application/octet-stream"),
                headers={"Content-Disposition": f'inline; filename="{filename}"'},
            )
    except Exception as exc:
        _logger.debug("Failed to proxy space file download: %s", exc)
        return {"error": "Prax backend unavailable"}


@router.delete("/spaces/{space}/files/{filename}")
async def delete_space_file(space: str, filename: str):
    """Delete a file from a space."""
    result = await _proxy("DELETE", f"/spaces/{space}/files/{filename}")
    return result or {"error": "Prax backend unavailable"}


# --- Wiki ---

@router.get("/spaces/{space}/wiki")
async def list_wiki(space: str):
    result = await _proxy("GET", f"/spaces/{space}/wiki")
    return result or {"entries": []}

@router.post("/spaces/{space}/wiki")
async def create_wiki_entry(space: str, data: dict = Body(...)):
    result = await _proxy("POST", f"/spaces/{space}/wiki", json=data)
    return result or {"error": "Prax backend unavailable"}

@router.get("/spaces/{space}/wiki/{slug}")
async def get_wiki_entry(space: str, slug: str):
    result = await _proxy("GET", f"/spaces/{space}/wiki/{slug}")
    return result or {"error": "Prax backend unavailable"}

@router.patch("/spaces/{space}/wiki/{slug}")
async def update_wiki_entry(space: str, slug: str, data: dict = Body(...)):
    result = await _proxy("PATCH", f"/spaces/{space}/wiki/{slug}", json=data)
    return result or {"error": "Prax backend unavailable"}

@router.delete("/spaces/{space}/wiki/{slug}")
async def delete_wiki_entry(space: str, slug: str):
    result = await _proxy("DELETE", f"/spaces/{space}/wiki/{slug}")
    return result or {"error": "Prax backend unavailable"}

# --- Flashcards ---

@router.get("/spaces/{space}/flashcards")
async def list_flashcard_decks(space: str):
    result = await _proxy("GET", f"/spaces/{space}/flashcards")
    return result or {"decks": []}

@router.post("/spaces/{space}/flashcards")
async def create_flashcard_deck(space: str, data: dict = Body(...)):
    result = await _proxy("POST", f"/spaces/{space}/flashcards", json=data)
    return result or {"error": "Prax backend unavailable"}

@router.get("/spaces/{space}/flashcards/{deck_slug}")
async def get_flashcard_deck(space: str, deck_slug: str):
    result = await _proxy("GET", f"/spaces/{space}/flashcards/{deck_slug}")
    return result or {"error": "Prax backend unavailable"}

@router.delete("/spaces/{space}/flashcards/{deck_slug}")
async def delete_flashcard_deck(space: str, deck_slug: str):
    result = await _proxy("DELETE", f"/spaces/{space}/flashcards/{deck_slug}")
    return result or {"error": "Prax backend unavailable"}

@router.post("/spaces/{space}/flashcards/{deck_slug}/cards")
async def add_flashcard(space: str, deck_slug: str, data: dict = Body(...)):
    result = await _proxy("POST", f"/spaces/{space}/flashcards/{deck_slug}/cards", json=data)
    return result or {"error": "Prax backend unavailable"}

@router.patch("/spaces/{space}/flashcards/{deck_slug}/cards/{card_id}")
async def update_flashcard(space: str, deck_slug: str, card_id: str, data: dict = Body(...)):
    result = await _proxy("PATCH", f"/spaces/{space}/flashcards/{deck_slug}/cards/{card_id}", json=data)
    return result or {"error": "Prax backend unavailable"}

@router.delete("/spaces/{space}/flashcards/{deck_slug}/cards/{card_id}")
async def delete_flashcard_card(space: str, deck_slug: str, card_id: str):
    result = await _proxy("DELETE", f"/spaces/{space}/flashcards/{deck_slug}/cards/{card_id}")
    return result or {"error": "Prax backend unavailable"}

@router.get("/spaces/{space}/chat/history")
async def space_chat_history(space: str):
    """Load conversation history for a space's scoped chat."""
    result = await _proxy("GET", f"/spaces/{space}/chat/history")
    if result is None:
        return {"messages": []}
    return result


@router.post("/spaces/{space}/chat")
async def space_chat(space: str, data: dict = Body(...)):
    """Space-scoped chat — separate conversation context per space."""
    prax_url = settings.prax_url
    if not prax_url:
        return {"error": "Prax backend unavailable"}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{prax_url.rstrip('/')}{_PRAX_BASE}/spaces/{space}/chat",
                json=data,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Space chat proxy failed: %s", exc)
        return {"error": "Prax backend unavailable"}


# ---------------------------------------------------------------------------
# Archive
# ---------------------------------------------------------------------------

@router.get("/archive")
async def list_archive():
    """List archived documents."""
    result = await _proxy("GET", "/archive")
    if result is None:
        return {"archive": [], "error": "Prax backend unavailable"}
    return result


@router.post("/archive")
async def capture_archive(data: dict = Body(...)):
    """Archive a document."""
    result = await _proxy("POST", "/archive", json=data)
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.get("/archive/{slug}")
async def get_archive(slug: str):
    """Fetch an archived document."""
    result = await _proxy("GET", f"/archive/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


@router.delete("/archive/{slug}")
async def delete_archive(slug: str):
    """Delete an archive entry."""
    result = await _proxy("DELETE", f"/archive/{slug}")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# ---------------------------------------------------------------------------
# Index rebuild
# ---------------------------------------------------------------------------

@router.post("/index/rebuild")
async def rebuild_index():
    """Force-rebuild the INDEX.md."""
    result = await _proxy("POST", "/index/rebuild")
    if result is None:
        return {"error": "Prax backend unavailable"}
    return result


# Note: POST /spaces and DELETE /spaces/{slug} already exist at lines
# 62 and 71 (renamed from /projects/ during the spaces migration).
# Do not duplicate them here.
