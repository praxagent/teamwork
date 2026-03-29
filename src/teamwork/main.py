"""Main FastAPI application for TeamWork."""

import json
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from teamwork.config import settings

# Configure logging to output to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)
from teamwork.models import init_db, AsyncSessionLocal
from teamwork.routers import (
    agents_router,
    browser_router,
    channels_router,
    external_router,
    messages_router,
    plugins_router,
    projects_router,
    tasks_router,
    terminal_router,
    workspace_router,
)
from teamwork.websocket import manager, WebSocketEvent, EventType


async def run_migrations():
    """Run database migrations to add new columns to existing tables."""
    async with AsyncSessionLocal() as db:
        # Check and add workspace_dir column to projects table
        try:
            result = await db.execute(text("PRAGMA table_info(projects)"))
            columns = [row[1] for row in result.fetchall()]

            if "workspace_dir" not in columns:
                print("Adding workspace_dir column to projects table...")
                await db.execute(text(
                    "ALTER TABLE projects ADD COLUMN workspace_dir VARCHAR(255)"
                ))
                await db.commit()
                print("Migration complete: added workspace_dir column")
        except Exception as e:
            print(f"Migration check error (may be normal on first run): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Initialize database
    await init_db()

    # Run migrations for existing databases
    await run_migrations()

    # Ensure workspace directory exists
    settings.workspace_path.mkdir(parents=True, exist_ok=True)

    yield

    print(">>> Application shutting down, cleanup complete.", flush=True)


app = FastAPI(
    title="TeamWork",
    description="Agent-agnostic collaboration shell — Slack-like web UI for AI agent teams",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(plugins_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(browser_router, prefix="/api")
app.include_router(channels_router, prefix="/api")
app.include_router(messages_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(terminal_router, prefix="/api")
app.include_router(workspace_router, prefix="/api")
app.include_router(external_router, prefix="/api")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "connections": manager.active_connection_count,
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Clients can subscribe to projects and channels to receive updates.

    Message format:
    {
        "action": "subscribe_project" | "unsubscribe_project" |
                  "subscribe_channel" | "unsubscribe_channel",
        "id": "<project_id or channel_id>"
    }
    """
    await manager.connect(websocket)

    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_text()

            try:
                message = json.loads(data)
                action = message.get("action")
                target_id = message.get("id")

                if not action or not target_id:
                    continue

                if action == "subscribe_project":
                    manager.subscribe_to_project(websocket, target_id)
                elif action == "unsubscribe_project":
                    manager.unsubscribe_from_project(websocket, target_id)
                elif action == "subscribe_channel":
                    manager.subscribe_to_channel(websocket, target_id)
                elif action == "unsubscribe_channel":
                    manager.unsubscribe_from_channel(websocket, target_id)

            except json.JSONDecodeError:
                # Ignore invalid JSON
                pass

    except WebSocketDisconnect:
        manager.disconnect(websocket)


# Static file serving for bundled React frontend — MUST be after all route
# definitions because mounts and catch-all routes shadow later definitions.
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    # Serve hashed JS/CSS/font bundles directly
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """SPA catch-all: serve the file if it exists, otherwise index.html."""
        file_path = STATIC_DIR / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "teamwork.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
