"""Application configuration using pydantic-settings."""

import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


def get_project_root() -> Path:
    """
    Find the project root directory.
    Works whether running from backend/ or project root.
    """
    # Check if we're in the backend directory
    cwd = Path.cwd()
    if cwd.name == "backend" and (cwd.parent / "frontend").exists():
        return cwd.parent
    # Check if we're at project root
    if (cwd / "backend").exists() and (cwd / "frontend").exists():
        return cwd
    # Fallback to current directory
    return cwd


def resolve_database_path(db_url: str, project_root: Path) -> str:
    """
    Resolve the database URL to use an absolute path.
    Handles relative paths correctly regardless of working directory.
    """
    if db_url.startswith("sqlite"):
        # Extract the path from SQLite URL
        # Format: sqlite+aiosqlite:///path or sqlite:///path
        prefix_end = db_url.find(":///") + 4
        prefix = db_url[:prefix_end]
        path = db_url[prefix_end:]
        
        # If path is relative, make it absolute based on project root
        if path.startswith("./") or not path.startswith("/"):
            # Clean up the path
            clean_path = path.lstrip("./")
            
            # Check if it's just "vteam.db" or "data/vteam.db"
            if "data/" not in clean_path and clean_path == "vteam.db":
                # Legacy path - put in data/ folder
                clean_path = f"data/{clean_path}"
            
            absolute_path = project_root / clean_path
            return f"{prefix}{absolute_path}"
    
    return db_url


# Determine project root for default paths
_project_root = get_project_root()

# Find the .env file - check project root first, then current directory
_env_file = _project_root / ".env"
if not _env_file.exists():
    _env_file = Path(".env")  # Fallback to current directory


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=str(_env_file),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API Keys
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    
    # Claude Code config (base64 encoded ~/.claude/claude.json)
    # Generate with: cat ~/.claude/claude.json | base64
    # This allows Docker Claude Code to skip setup
    claude_config_base64: str = ""

    # Database - stored at project root ./data/
    # Both local and Docker use the same relative structure
    database_url: str = f"sqlite+aiosqlite:///{_project_root}/data/vteam.db"

    # Workspace - where generated code is stored
    # Both local and Docker use ./workspace at project root
    workspace_path: Path = _project_root / "workspace"
    
    def __init__(self, **data):
        super().__init__(**data)
        # Resolve database URL to absolute path
        resolved_db = resolve_database_path(self.database_url, _project_root)
        object.__setattr__(self, 'database_url', resolved_db)
        
        # Resolve workspace path to absolute path
        ws_path = self.workspace_path
        if not ws_path.is_absolute():
            ws_path = _project_root / ws_path
        object.__setattr__(self, 'workspace_path', ws_path)

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Agent Runtime
    default_agent_runtime: Literal["subprocess", "docker"] = "subprocess"

    # CORS - includes Docker default port
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:80"]


settings = Settings()
