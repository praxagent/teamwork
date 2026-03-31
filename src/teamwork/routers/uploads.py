"""File upload API router."""

import logging
import mimetypes
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models import get_db
from teamwork.utils.workspace import get_project_workspace_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/uploads", tags=["uploads"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

ALLOWED_EXTENSIONS = {
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    # Documents
    ".pdf", ".txt", ".md", ".csv",
    # Code
    ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".html", ".css",
    ".go", ".rs", ".java", ".c", ".cpp", ".h", ".rb", ".sh",
    ".yaml", ".yml", ".toml", ".xml", ".sql",
    # Archives
    ".zip",
}


@router.post("/{project_id}")
async def upload_file(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file to the project workspace."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Check extension
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {ext}")

    # Read contents and enforce size limit
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 10 MB limit")

    workspace_path = await get_project_workspace_path(project_id, db)
    upload_dir = workspace_path / "_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_id = uuid4().hex[:12]
    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    stored_name = f"{file_id}_{safe_name}"
    dest = upload_dir / stored_name

    dest.write_bytes(contents)

    content_type = file.content_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"

    return {
        "id": file_id,
        "name": file.filename,
        "url": f"/api/uploads/{project_id}/{stored_name}",
        "content_type": content_type,
        "size": len(contents),
    }


@router.get("/{project_id}/{filename}")
async def serve_upload(
    project_id: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
):
    """Serve a previously uploaded file."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    workspace_path = await get_project_workspace_path(project_id, db)
    file_path = workspace_path / "_uploads" / filename

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)
