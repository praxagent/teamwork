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


# Determine project root for default paths
_project_root = get_project_root()


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API Keys
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Database - stored at project root ./data/
    # Both local and Docker use the same relative structure
    database_url: str = f"sqlite+aiosqlite:///{_project_root}/data/vteam.db"

    # Workspace - where generated code is stored
    # Both local and Docker use ./workspace at project root
    workspace_path: Path = _project_root / "workspace"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Agent Runtime
    default_agent_runtime: Literal["subprocess", "docker"] = "subprocess"

    # CORS - includes Docker default port
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:80"]


settings = Settings()
