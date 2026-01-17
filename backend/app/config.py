"""Application configuration using pydantic-settings."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Database
    database_url: str = "sqlite+aiosqlite:///./vteam.db"

    # Workspace
    workspace_path: Path = Path("./workspace")

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Agent Runtime
    default_agent_runtime: Literal["subprocess", "docker"] = "subprocess"

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]


settings = Settings()
