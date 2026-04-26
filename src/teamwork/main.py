"""Main FastAPI application for TeamWork."""

import asyncio
import json
import logging
import os
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
# Quiet down third-party INFO chatter that fires on polling loops:
#   - httpx/httpcore: the browser panel's tab_watcher hits
#     http://sandbox:9223/json every 2s — one line per poll is too loud.
for noisy in ("httpx", "httpcore"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
from teamwork.models import init_db, AsyncSessionLocal
from teamwork.routers import (
    agent_plan_router,
    agents_router,
    browser_router,
    claude_code_router,
    channels_router,
    content_router,
    external_router,
    library_router,
    memory_router,
    messages_router,
    observability_router,
    plugins_router,
    prax_router,
    projects_router,
    scheduler_router,
    tasks_router,
    terminal_router,
    uploads_router,
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
app.include_router(agent_plan_router, prefix="/api")
app.include_router(observability_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(claude_code_router, prefix="/api")
app.include_router(scheduler_router, prefix="/api")
app.include_router(plugins_router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(browser_router, prefix="/api")
app.include_router(channels_router, prefix="/api")
app.include_router(messages_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(terminal_router, prefix="/api")
app.include_router(uploads_router, prefix="/api")
app.include_router(workspace_router, prefix="/api")
app.include_router(external_router, prefix="/api")
app.include_router(prax_router, prefix="/api")
# Content router is mounted at root (no /api prefix) so /courses/<id>/
# and /notes/<slug>/ are valid public-looking URLs.  Must be registered
# before the SPA catch-all at the bottom of this file or it'd be shadowed.
app.include_router(content_router)


# Desktop VNC proxy — forwards /api/desktop/* to the sandbox's noVNC server
@app.api_route("/api/desktop/{path:path}", methods=["GET", "POST"])
async def desktop_vnc_proxy(path: str):
    """Reverse-proxy noVNC from the sandbox container."""
    import httpx
    desktop_url = getattr(settings, 'desktop_vnc_url', None) or os.environ.get("DESKTOP_VNC_URL", "")
    if not desktop_url:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "DESKTOP_VNC_URL not configured"}, status_code=503)
    from starlette.requests import Request
    from starlette.responses import Response
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{desktop_url.rstrip('/')}/{path}")
            # Only forward safe headers — transfer-encoding, content-length,
            # and hop-by-hop headers cause issues when re-served by FastAPI.
            skip = {"transfer-encoding", "content-encoding", "content-length", "connection"}
            headers = {k: v for k, v in resp.headers.items() if k.lower() not in skip}
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=headers,
            )
    except Exception:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Desktop not available"}, status_code=502)


# Desktop VNC WebSocket proxy — noVNC needs a WebSocket connection to websockify.
# The HTTP proxy above handles static files (vnc.html, JS, CSS).
# This route forwards the live VNC stream.
@app.websocket("/api/desktop/websockify")
async def desktop_vnc_ws_proxy(websocket: WebSocket):
    """WebSocket reverse-proxy: browser ↔ websockify in the sandbox."""
    desktop_url = getattr(settings, 'desktop_vnc_url', None) or os.environ.get("DESKTOP_VNC_URL", "")
    if not desktop_url:
        await websocket.close(code=1008, reason="DESKTOP_VNC_URL not configured")
        return

    # Convert http://sandbox:6080 → ws://sandbox:6080/websockify
    ws_target = desktop_url.replace("http://", "ws://").replace("https://", "wss://").rstrip("/") + "/websockify"

    # Echo the requested subprotocol back — noVNC sends Sec-WebSocket-Protocol:
    # binary and treats a server response that omits the header as a fatal
    # protocol mismatch (closes with code 1006).  Pick "binary" if present,
    # otherwise fall back to the first offered subprotocol so we at least
    # echo *something*.  This matters more behind a TLS-terminating proxy
    # like Tailscale serve where any deviation from the spec is exposed.
    requested = websocket.headers.get("sec-websocket-protocol", "")
    offered = [p.strip() for p in requested.split(",") if p.strip()]
    chosen = "binary" if "binary" in offered else (offered[0] if offered else None)
    await websocket.accept(subprotocol=chosen)

    import websockets

    try:
        async with websockets.connect(
            ws_target,
            subprotocols=["binary"],
            max_size=10 * 1024 * 1024,
        ) as upstream:
            stop = asyncio.Event()

            async def client_to_upstream():
                try:
                    while not stop.is_set():
                        data = await websocket.receive()
                        if "bytes" in data and data["bytes"]:
                            await upstream.send(data["bytes"])
                        elif "text" in data and data["text"]:
                            await upstream.send(data["text"])
                except (WebSocketDisconnect, Exception):
                    pass
                finally:
                    stop.set()

            async def upstream_to_client():
                try:
                    async for msg in upstream:
                        if isinstance(msg, bytes):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except (websockets.ConnectionClosed, Exception):
                    pass
                finally:
                    stop.set()

            c2u = asyncio.create_task(client_to_upstream())
            u2c = asyncio.create_task(upstream_to_client())

            await asyncio.wait([c2u, u2c], return_when=asyncio.FIRST_COMPLETED)
            stop.set()
            for t in [c2u, u2c]:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
    except Exception as e:
        logger.error("Desktop WS proxy error: %s", e)
        try:
            await websocket.close(code=1011, reason="Upstream connection failed")
        except Exception:
            pass


# Desktop clipboard WebSocket proxy — forwards JSON text messages to the
# clipboard bridge daemon running on port 6090 in the sandbox container.
@app.websocket("/api/desktop/clipboard")
async def desktop_clipboard_ws_proxy(websocket: WebSocket):
    """WebSocket reverse-proxy: browser clipboard ↔ clipboard bridge in sandbox."""
    desktop_url = getattr(settings, 'desktop_vnc_url', None) or os.environ.get("DESKTOP_VNC_URL", "")
    if not desktop_url:
        await websocket.close(code=1008, reason="DESKTOP_VNC_URL not configured")
        return

    # Derive clipboard bridge URL from the VNC URL (same host, port 6090)
    # e.g. http://sandbox:6080 → ws://sandbox:6090
    from urllib.parse import urlparse
    parsed = urlparse(desktop_url)
    ws_target = f"ws://{parsed.hostname}:6090"

    await websocket.accept()

    import websockets

    try:
        async with websockets.connect(ws_target, max_size=1 * 1024 * 1024) as upstream:
            stop = asyncio.Event()

            async def client_to_upstream():
                try:
                    while not stop.is_set():
                        text = await websocket.receive_text()
                        await upstream.send(text)
                except (WebSocketDisconnect, Exception):
                    pass
                finally:
                    stop.set()

            async def upstream_to_client():
                try:
                    async for msg in upstream:
                        await websocket.send_text(msg if isinstance(msg, str) else msg.decode())
                except (websockets.ConnectionClosed, Exception):
                    pass
                finally:
                    stop.set()

            c2u = asyncio.create_task(client_to_upstream())
            u2c = asyncio.create_task(upstream_to_client())

            await asyncio.wait([c2u, u2c], return_when=asyncio.FIRST_COMPLETED)
            stop.set()
            for t in [c2u, u2c]:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
    except Exception as e:
        logger.error("Clipboard WS proxy error: %s", e)
        try:
            await websocket.close(code=1011, reason="Upstream connection failed")
        except Exception:
            pass


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
