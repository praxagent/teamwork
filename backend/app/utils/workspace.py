"""Workspace path utilities."""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Project


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
        return settings.workspace_path / row.workspace_dir
    
    # Fallback to project ID
    return settings.workspace_path / project_id


def get_workspace_path_sync(project: Project) -> Path:
    """
    Get the workspace path for a project (sync version).
    
    Use when you already have the project loaded.
    """
    if project.workspace_dir:
        return settings.workspace_path / project.workspace_dir
    return settings.workspace_path / project.id
