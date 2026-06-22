"""CLI entry point for running TeamWork standalone."""
import os

import uvicorn


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def main():
    # Dev mode: uvicorn's reloader restarts the backend on Python edits.
    # Enable with TEAMWORK_RELOAD=true (the harness's `make run-local-all-dev`
    # sets this). Host/port stay overridable via env for flexible deployments.
    reload = _truthy(os.environ.get("TEAMWORK_RELOAD"))
    host = os.environ.get("TEAMWORK_HOST", "0.0.0.0")
    port = int(os.environ.get("TEAMWORK_PORT", "8000"))
    uvicorn.run("teamwork.main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    main()
