"""Workspace API router for file browsing."""

import os
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import get_db
from app.utils.workspace import get_project_workspace_path

router = APIRouter(prefix="/workspace", tags=["workspace"])


class FileNode(BaseModel):
    """File or directory node."""
    name: str
    path: str
    type: str  # 'file' or 'directory'
    size: int | None = None
    modified: str | None = None
    children: list["FileNode"] | None = None


class FilesResponse(BaseModel):
    """Response containing file tree."""
    files: list[FileNode]
    workspace_path: str


class FileContentResponse(BaseModel):
    """Response containing file content."""
    content: str
    language: str
    path: str


# Language detection by extension
LANGUAGE_MAP = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".sql": "sql",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".toml": "toml",
    ".ini": "ini",
    ".xml": "xml",
    ".txt": "plaintext",
    ".env": "plaintext",
    ".gitignore": "plaintext",
    ".dockerignore": "plaintext",
    "Dockerfile": "dockerfile",
    "Makefile": "makefile",
}

# Files/directories to ignore
IGNORE_PATTERNS = {
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    ".env",
    ".DS_Store",
    "*.pyc",
    "*.pyo",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
    "*.egg-info",
}


def should_ignore(name: str) -> bool:
    """Check if file/directory should be ignored."""
    if name in IGNORE_PATTERNS:
        return True
    for pattern in IGNORE_PATTERNS:
        if pattern.startswith("*.") and name.endswith(pattern[1:]):
            return True
    return False


def get_language(file_path: Path) -> str:
    """Get language identifier for a file."""
    # Check for special files
    if file_path.name in LANGUAGE_MAP:
        return LANGUAGE_MAP[file_path.name]
    # Check extension
    ext = file_path.suffix.lower()
    return LANGUAGE_MAP.get(ext, "plaintext")


def build_file_tree(path: Path, relative_base: Path, max_depth: int = 5, current_depth: int = 0) -> list[FileNode]:
    """Build file tree recursively."""
    if current_depth >= max_depth:
        return []
    
    nodes = []
    
    try:
        items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    except PermissionError:
        return []
    
    for item in items:
        if should_ignore(item.name):
            continue
        
        relative_path = str(item.relative_to(relative_base))
        
        if item.is_dir():
            children = build_file_tree(item, relative_base, max_depth, current_depth + 1)
            nodes.append(FileNode(
                name=item.name,
                path=relative_path,
                type="directory",
                children=children if children else None,
            ))
        else:
            try:
                stat = item.stat()
                nodes.append(FileNode(
                    name=item.name,
                    path=relative_path,
                    type="file",
                    size=stat.st_size,
                    modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                ))
            except OSError:
                continue
    
    return nodes


@router.get("/{project_id}/files", response_model=FilesResponse)
async def list_workspace_files(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> FilesResponse:
    """List all files in the project workspace."""
    workspace_path = await get_project_workspace_path(project_id, db)
    
    if not workspace_path.exists():
        # Create workspace if it doesn't exist
        workspace_path.mkdir(parents=True, exist_ok=True)
        return FilesResponse(files=[], workspace_path=str(workspace_path))
    
    files = build_file_tree(workspace_path, workspace_path)
    
    return FilesResponse(
        files=files,
        workspace_path=str(workspace_path),
    )


@router.get("/{project_id}/file", response_model=FileContentResponse)
async def get_file_content(
    project_id: str,
    path: str = Query(..., description="Relative path to file"),
    db: AsyncSession = Depends(get_db),
) -> FileContentResponse:
    """Get content of a specific file."""
    workspace_path = await get_project_workspace_path(project_id, db)
    file_path = workspace_path / path
    
    # Security: ensure path is within workspace
    try:
        file_path = file_path.resolve()
        workspace_resolved = workspace_path.resolve()
        if not str(file_path).startswith(str(workspace_resolved)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid path")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    
    # Check file size (limit to 1MB)
    if file_path.stat().st_size > 1_000_000:
        raise HTTPException(status_code=400, detail="File too large")
    
    try:
        content = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Binary file cannot be displayed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")
    
    return FileContentResponse(
        content=content,
        language=get_language(file_path),
        path=path,
    )


class SaveFileRequest(BaseModel):
    """Request to save file content."""
    path: str
    content: str


class SaveFileResponse(BaseModel):
    """Response after saving file."""
    success: bool
    path: str
    message: str


@router.put("/{project_id}/file", response_model=SaveFileResponse)
async def save_file_content(
    project_id: str,
    request: SaveFileRequest,
    db: AsyncSession = Depends(get_db),
) -> SaveFileResponse:
    """Save/update content of a file."""
    workspace_path = await get_project_workspace_path(project_id, db)
    file_path = workspace_path / request.path
    
    # Security: ensure path is within workspace
    try:
        file_path = file_path.resolve()
        workspace_resolved = workspace_path.resolve()
        if not str(file_path).startswith(str(workspace_resolved)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid path")
    
    # Ensure parent directory exists
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        file_path.write_text(request.content, encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    
    return SaveFileResponse(
        success=True,
        path=request.path,
        message=f"File saved successfully",
    )


@router.get("/{project_id}/git-log")
async def get_git_log(
    project_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get git commit history for the workspace."""
    import subprocess
    
    workspace_path = await get_project_workspace_path(project_id, db)
    
    if not workspace_path.exists():
        return {"commits": [], "error": "Workspace not found"}
    
    git_dir = workspace_path / ".git"
    if not git_dir.exists():
        return {"commits": [], "error": "Not a git repository"}
    
    try:
        result = subprocess.run(
            ["git", "log", f"--max-count={limit}", "--pretty=format:%H|%an|%ae|%at|%s"],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=10,
        )
        
        if result.returncode != 0:
            return {"commits": [], "error": result.stderr}
        
        commits = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("|", 4)
            if len(parts) >= 5:
                commits.append({
                    "hash": parts[0],
                    "author_name": parts[1],
                    "author_email": parts[2],
                    "timestamp": int(parts[3]),
                    "message": parts[4],
                })
        
        return {"commits": commits}
    
    except subprocess.TimeoutExpired:
        return {"commits": [], "error": "Git command timed out"}
    except Exception as e:
        return {"commits": [], "error": str(e)}


class FileDiff(BaseModel):
    """A single file's diff information."""
    path: str
    old_path: str | None = None  # For renamed files
    status: str  # 'added', 'modified', 'deleted', 'renamed'
    additions: int
    deletions: int
    diff: str  # The actual diff content


class TaskDiffResponse(BaseModel):
    """Response containing task code changes."""
    task_id: str
    task_title: str
    start_commit: str | None
    end_commit: str | None
    files_changed: int
    total_additions: int
    total_deletions: int
    files: list[FileDiff]
    commits: list[dict]
    error: str | None = None


@router.get("/{project_id}/task/{task_id}/diff", response_model=TaskDiffResponse)
async def get_task_diff(
    project_id: str,
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> TaskDiffResponse:
    """
    Get the code changes (diff) for a completed task.
    Shows all file changes between when the task started and completed.
    """
    import subprocess
    from sqlalchemy import select
    from app.models import Task
    
    workspace_path = await get_project_workspace_path(project_id, db)
    
    # Get task from database
    task_result = await db.execute(
        select(Task).where(Task.id == task_id)
    )
    task = task_result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Get latest commit if task doesn't have end_commit
    start_commit = task.start_commit
    end_commit = task.end_commit
    
    if not workspace_path.exists():
        return TaskDiffResponse(
            task_id=task_id,
            task_title=task.title,
            start_commit=start_commit,
            end_commit=end_commit,
            files_changed=0,
            total_additions=0,
            total_deletions=0,
            files=[],
            commits=[],
            error="Workspace not found"
        )
    
    git_dir = workspace_path / ".git"
    if not git_dir.exists():
        return TaskDiffResponse(
            task_id=task_id,
            task_title=task.title,
            start_commit=start_commit,
            end_commit=end_commit,
            files_changed=0,
            total_additions=0,
            total_deletions=0,
            files=[],
            commits=[],
            error="Not a git repository"
        )
    
    # If no commits recorded, try to show all changes
    if not start_commit and not end_commit:
        # Show diff from initial commit to HEAD
        try:
            result = subprocess.run(
                ["git", "rev-list", "--max-parents=0", "HEAD"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0 and result.stdout.strip():
                start_commit = result.stdout.strip().split('\n')[0]
                end_commit = "HEAD"
        except Exception:
            pass
    
    if not start_commit:
        return TaskDiffResponse(
            task_id=task_id,
            task_title=task.title,
            start_commit=None,
            end_commit=None,
            files_changed=0,
            total_additions=0,
            total_deletions=0,
            files=[],
            commits=[],
            error="No commits recorded for this task"
        )
    
    try:
        # Get list of commits between start and end
        commit_range = f"{start_commit}..{end_commit or 'HEAD'}"
        
        # Get commits in range
        commits_result = subprocess.run(
            ["git", "log", commit_range, "--pretty=format:%H|%an|%at|%s"],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=10,
        )
        
        commits = []
        if commits_result.returncode == 0:
            for line in commits_result.stdout.strip().split('\n'):
                if not line:
                    continue
                parts = line.split('|', 3)
                if len(parts) >= 4:
                    commits.append({
                        "hash": parts[0][:8],
                        "author": parts[1],
                        "timestamp": int(parts[2]),
                        "message": parts[3],
                    })
        
        # Get file stats
        stat_result = subprocess.run(
            ["git", "diff", "--stat", "--numstat", commit_range],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        
        # Parse numstat for accurate counts
        file_stats = {}
        if stat_result.returncode == 0:
            for line in stat_result.stdout.strip().split('\n'):
                parts = line.split('\t')
                if len(parts) >= 3:
                    try:
                        additions = int(parts[0]) if parts[0] != '-' else 0
                        deletions = int(parts[1]) if parts[1] != '-' else 0
                        file_path = parts[2]
                        file_stats[file_path] = {
                            "additions": additions,
                            "deletions": deletions,
                        }
                    except ValueError:
                        continue
        
        # Get actual diffs
        diff_result = subprocess.run(
            ["git", "diff", commit_range, "--no-color"],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        
        # Parse diff output into per-file diffs
        files = []
        current_file = None
        current_diff_lines = []
        total_additions = 0
        total_deletions = 0
        
        if diff_result.returncode == 0:
            for line in diff_result.stdout.split('\n'):
                if line.startswith('diff --git'):
                    # Save previous file
                    if current_file:
                        stats = file_stats.get(current_file, {"additions": 0, "deletions": 0})
                        files.append(FileDiff(
                            path=current_file,
                            status="modified",
                            additions=stats["additions"],
                            deletions=stats["deletions"],
                            diff='\n'.join(current_diff_lines),
                        ))
                        total_additions += stats["additions"]
                        total_deletions += stats["deletions"]
                    
                    # Start new file
                    parts = line.split(' b/')
                    if len(parts) >= 2:
                        current_file = parts[1]
                    current_diff_lines = [line]
                else:
                    current_diff_lines.append(line)
            
            # Don't forget the last file
            if current_file:
                stats = file_stats.get(current_file, {"additions": 0, "deletions": 0})
                files.append(FileDiff(
                    path=current_file,
                    status="modified",
                    additions=stats["additions"],
                    deletions=stats["deletions"],
                    diff='\n'.join(current_diff_lines),
                ))
                total_additions += stats["additions"]
                total_deletions += stats["deletions"]
        
        return TaskDiffResponse(
            task_id=task_id,
            task_title=task.title,
            start_commit=start_commit[:8] if start_commit else None,
            end_commit=(end_commit[:8] if end_commit and end_commit != "HEAD" else end_commit) if end_commit else None,
            files_changed=len(files),
            total_additions=total_additions,
            total_deletions=total_deletions,
            files=files,
            commits=commits,
        )
        
    except subprocess.TimeoutExpired:
        return TaskDiffResponse(
            task_id=task_id,
            task_title=task.title,
            start_commit=start_commit,
            end_commit=end_commit,
            files_changed=0,
            total_additions=0,
            total_deletions=0,
            files=[],
            commits=[],
            error="Git command timed out"
        )
    except Exception as e:
        return TaskDiffResponse(
            task_id=task_id,
            task_title=task.title,
            start_commit=start_commit,
            end_commit=end_commit,
            files_changed=0,
            total_additions=0,
            total_deletions=0,
            files=[],
            commits=[],
            error=str(e)
        )


class TestAppResponse(BaseModel):
    """Response from testing the app."""
    project_id: str
    timestamp: str
    project_type: str | None
    install_success: bool
    install_output: str
    run_success: bool
    run_output: str
    run_error: str | None
    run_command: str
    install_command: str | None
    port: int | None
    instructions: str


@router.post("/{project_id}/test", response_model=TestAppResponse)
async def test_project_app(project_id: str) -> TestAppResponse:
    """
    Test the app built in this project workspace.
    
    This will:
    1. Install dependencies
    2. Attempt to run the app
    3. Verify it starts successfully
    4. Return run instructions
    """
    from app.services.app_runner import get_app_runner
    
    runner = get_app_runner()
    results = await runner.test_app(project_id)
    
    return TestAppResponse(**results)
