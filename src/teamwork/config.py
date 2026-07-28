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
        # In-memory databases need no path resolution.
        if ":memory:" in db_url:
            return db_url
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


def ensure_database_dir(db_url: str) -> None:
    """Create the parent directory for a file-backed sqlite database.

    sqlite refuses to open a database whose parent directory is missing
    ("unable to open database file"), so make sure it exists before the
    engine connects. No-op for in-memory or non-sqlite URLs.
    """
    if not db_url.startswith("sqlite") or ":memory:" in db_url:
        return
    prefix_end = db_url.find(":///") + 4
    db_path = Path(db_url[prefix_end:])
    db_path.parent.mkdir(parents=True, exist_ok=True)


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

    # noVNC desktop, proxied from the sandbox container. Declared here rather
    # than read straight from the environment: main.py used
    # `getattr(settings, "desktop_vnc_url", None) or os.environ[...]`, and since
    # the field did not exist the getattr always returned None. So the only way
    # to learn this variable was required was to read the proxy handler — it was
    # in neither this model nor .env.example. A setting you cannot discover is a
    # setting nobody sets.
    #
    # Empty disables the desktop panel. For the usual shape (TeamWork on the
    # host, sandbox in Docker with ports published to loopback) this is
    # http://127.0.0.1:6080; inside the sandbox compose network, http://sandbox:6080.
    desktop_vnc_url: str = ""

    # Clipboard bridge in the same container. Derived from desktop_vnc_url when
    # left empty, since it is the same host on a fixed port.
    clipboard_port: int = 6090

    def __init__(self, **data):
        super().__init__(**data)
        resolved_db = resolve_database_path(self.database_url, _project_root)
        object.__setattr__(self, "database_url", resolved_db)
        ensure_database_dir(resolved_db)

        ws_path = self.workspace_path
        if not ws_path.is_absolute():
            ws_path = _project_root / ws_path
        object.__setattr__(self, "workspace_path", ws_path)

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    # Echo every SQL statement to stdout — only flip on when actively
    # debugging queries.  Kept off by default so DEBUG mode (Flask reloader,
    # better tracebacks) doesn't drown the logs in BEGIN/SELECT/COMMIT.
    sqlalchemy_echo: bool = False

    # Prax backend URL (for plugin management proxy)
    prax_url: str = ""

    # External agent API key — the legacy *shared* credential. It authenticates a
    # caller but carries no agent identity, so any holder can act as any agent.
    # Prefer agent_clients_path below, which binds one token to one agent.
    external_api_key: str = ""

    # Per-agent credential registry (JSON): [{name, token_sha256|token, agent_id,
    # project_id, allow}, ...]. The token determines the caller's identity, so a
    # body-asserted agent_id can never be taken on trust. See agent_auth.py.
    #
    # Defaults to a real path rather than "" so enabling MCP for a space can just
    # write here. An unset registry meant every grant began with the user hand-
    # authoring JSON and hand-picking a slug — a manual step that defeats the
    # point of having a UI at all. The file is created on first grant; until then
    # nothing exists and nothing is granted, which is the same fail-closed state
    # an empty path gave us.
    agent_clients_path: str = "~/.teamwork/agent-clients.json"

    # Require every external-agent request to carry a valid Ed25519 envelope,
    # even from credentials that did not register a public key. Off by default:
    # per-client `public_key` opts an agent in individually, which is the
    # migration path. See agent_signing.py.
    require_signed_requests: bool = False

    # Restrict agents to posting only in channels they are a member of. Off by
    # default, and even when on it only bites on channels that declare a
    # membership list — so enabling it cannot mute an existing deployment that
    # never configured one. See services/membership.py.
    enforce_channel_membership: bool = False

    # The MCP surface for other agents (Claude Code, Codex, ...). OFF by default
    # and fail-closed: it also refuses to mount unless at least one credential in
    # AGENT_CLIENTS_PATH grants MCP, so switching this on without granting
    # anything changes nothing. Access is per-space — a key names the spaces it
    # may touch and reaches no others. Bind loopback and publish over the tailnet
    # (`tailscale serve`); it must not face the internet.
    mcp_enabled: bool = False

    # Dev escape hatch. With no credential configured the external API refuses
    # requests (503) rather than accepting anyone as anyone — set this only for
    # local development, never for a reachable deployment.
    allow_unauthenticated_agents: bool = False

    # CORS
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:80",
    ]

    # ── Reverse-proxy authentication (defense-in-depth) ──────────────────────
    # For the "bind 0.0.0.0 behind an authenticating proxy" deployment (Google
    # IAP, Cloudflare Access, ...). When ON, every request (except exempt health
    # paths) must carry a VALID SIGNED assertion from the fronting proxy, so a
    # request that bypasses the proxy to the bound port is rejected by the app
    # itself — not only by the firewall. Default OFF: a complete no-op for
    # Tailscale / same-host-proxy / dev. See docs/security/network-exposure.md.
    proxy_auth_enabled: bool = False
    # Preset that fills header/algorithms/jwks/issuer: "iap" | "cloudflare_access"
    # | "" (custom — supply the fields below explicitly).
    proxy_auth_provider: str = ""
    proxy_auth_audience: str = ""      # REQUIRED when enabled (IAP backend aud / CF AUD tag)
    proxy_auth_issuer: str = ""        # CF: your team-domain URL; IAP: preset default
    proxy_auth_jwks_url: str = ""      # override/preset (CF derives from issuer)
    proxy_auth_header: str = ""        # override/preset
    proxy_auth_algorithms: str = ""    # comma-separated; override/preset
    proxy_auth_exempt_paths: str = "/health,/healthz"  # comma-separated path prefixes


settings = Settings()
