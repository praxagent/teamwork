"""Workspace path utilities."""

import re
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.config import settings
from teamwork.models import Project

# One directory name directly under WORKSPACE_PATH: no separators, no leading
# dot (so neither "." nor ".." nor a hidden dir), no NUL/whitespace/control
# characters. "+" is allowed because phone-number workspace dirs ("+1555...")
# are an existing, tested contract of the external API.
_WORKSPACE_DIR_RE = re.compile(r"[A-Za-z0-9+][A-Za-z0-9._+-]{0,254}")


def validate_workspace_dir(value: str) -> str:
    """Return *value* if it is a safe single directory name, else raise ValueError.

    ``workspace_dir`` is joined under ``WORKSPACE_PATH`` by every file endpoint,
    the uploads router and the project delete/reset paths (``rmtree``). An
    absolute value replaces the root outright (``Path(root) / "/etc"`` is
    ``/etc``) and ``..`` climbs out of it, so the value is validated both when
    it is written (external API) and here, where every reader resolves it.
    """
    if not isinstance(value, str) or not _WORKSPACE_DIR_RE.fullmatch(value):
        raise ValueError(
            "workspace_dir must be a single directory name: letters, digits, "
            "'.', '_', '+', '-'; no path separators, no leading '.'"
        )
    return value


def require_valid_workspace_dir(value: str) -> str:
    """``validate_workspace_dir`` as a 400 for request handlers."""
    try:
        return validate_workspace_dir(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _workspace_subdir(name: str) -> Path:
    return settings.workspace_path / require_valid_workspace_dir(name)


async def get_project_workspace_path(project_id: str, db: AsyncSession) -> Path:
    """
    Get the workspace path for a project.

    Looks up the project to check for a stored workspace_dir,
    falls back to just using the project ID.
    """
    result = await db.execute(
        select(Project.workspace_dir, Project.name, Project.config)
        .where(Project.id == project_id)
    )
    row = result.first()

    if row and row.workspace_dir:
        return _workspace_subdir(row.workspace_dir)

    # Fallback to project ID. Validated too: it comes straight from the URL, and
    # an unknown project id of ".." would otherwise name the workspace root's parent.
    return _workspace_subdir(project_id)


def get_workspace_path_sync(project: Project) -> Path:
    """
    Get the workspace path for a project (sync version).

    Use when you already have the project loaded.
    """
    if project.workspace_dir:
        return _workspace_subdir(project.workspace_dir)
    return _workspace_subdir(project.id)
