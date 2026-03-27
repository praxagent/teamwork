"""Application configuration using pydantic-settings."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def get_project_root() -> Path:
    """Find the project root directory."""
    cwd = Path.cwd()
    if (cwd / "frontend").exists():
        return cwd
    if cwd.name == "backend" and (cwd.parent / "frontend").exists():
        return cwd.parent
    return cwd


def resolve_database_path(db_url: str, project_root: Path) -> str:
    """Resolve the database URL to use an absolute path."""
    if db_url.startswith("sqlite"):
        prefix_end = db_url.find(":///") + 4
        prefix = db_url[:prefix_end]
        path = db_url[prefix_end:]

        if path.startswith("./") or not path.startswith("/"):
            clean_path = path.lstrip("./")
            if "data/" not in clean_path and clean_path == "vteam.db":
                clean_path = f"data/{clean_path}"
            absolute_path = project_root / clean_path
            return f"{prefix}{absolute_path}"

    return db_url


_project_root = get_project_root()

_env_file = _project_root / ".env"
if not _env_file.exists():
    _env_file = Path(".env")


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=str(_env_file),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = f"sqlite+aiosqlite:///{_project_root}/data/vteam.db"

    # Workspace — where generated code / files are stored
    workspace_path: Path = _project_root / "workspace"

    # Host workspace path — the REAL host-filesystem path to the workspace
    # (needed when running inside Docker so agents can map volumes correctly).
    host_workspace_path: str = ""

    # Sandbox container for terminal sessions
    sandbox_container: str = ""

    # Chrome CDP — browser screencast proxy
    chrome_cdp_host: str = "sandbox"
    chrome_cdp_port: int = 9223

    def __init__(self, **data):
        super().__init__(**data)
        resolved_db = resolve_database_path(self.database_url, _project_root)
        object.__setattr__(self, "database_url", resolved_db)

        ws_path = self.workspace_path
        if not ws_path.is_absolute():
            ws_path = _project_root / ws_path
        object.__setattr__(self, "workspace_path", ws_path)

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # External agent API key (empty = no auth in dev)
    external_api_key: str = ""

    # CORS
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:80",
    ]


settings = Settings()
