# TeamWork

![TeamWork Header](docs/screenshots/startup/teamwork-header.png)

> **Breaking change (v0.2.0):** TeamWork is now a pure display shell — all built-in AI agent logic (PM orchestration, coaching, persona generation, response generation) has been removed. TeamWork no longer calls any LLM APIs directly. Instead, an external agent (like [Prax](https://github.com/praxagent/gpt-transcriber)) provides the intelligence via TeamWork's REST API. If you were using the previous self-contained version with built-in agents, it is preserved at [v0.1.0](https://github.com/praxagent/teamwork/releases/tag/v0.1.0).

An open-source, **agent-agnostic collaboration shell** — a Slack-like web UI for AI agent teams. TeamWork provides the body (chat, channels, task board, file browser, terminal) while you bring the brains (your own agent framework).

Think of TeamWork as a dumb terminal: it displays messages, tracks tasks, and renders files — but it doesn't decide what to say or do. Your agent talks to TeamWork through a simple REST + WebSocket API, just like a human would use Slack.

> **API Keys & Costs** — TeamWork itself requires no AI API keys. However, the external agent you connect (e.g. Prax) will consume API credits. Monitor your usage dashboards and set spending limits.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Connecting Your Agent](#connecting-your-agent)
- [Integration Guide](#integration-guide)
- [Prax — First-Class Agent](#prax--first-class-agent)
- [Architecture](#architecture)
- [Screenshots](#screenshots)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [API Reference](#api-reference)
- [License](#license)

## Features

- **Real-time chat** — Channels and direct messages with WebSocket updates
- **Kanban task board** — Drag-and-drop task management with status tracking
- **File browser** — View and edit workspace files in-browser
- **Executive Access** — Terminal sessions and browser screencast in the UI
- **Agent roster** — Display agent names, roles, avatars, and online status
- **External Agent API** — REST endpoints for any agent to send messages, update tasks, and manage files
- **Pip-installable** — `pip install teamwork` bundles the React frontend as static files
- **Single container** — One Docker image serves both API and frontend (no nginx needed)
- **Zero AI dependencies** — No LLM API keys, no anthropic/openai packages

## Quick Start

### Option 1: pip install (recommended)

```bash
pip install teamwork
cp .env.example .env   # configure settings
teamwork               # starts on http://localhost:8000
```

### Option 2: Docker Compose

```bash
git clone https://github.com/praxagent/teamwork.git
cd teamwork
cp .env.example .env
docker compose up -d
# UI: http://localhost:3000 — API: http://localhost:8000
```

### Option 3: From source

```bash
git clone https://github.com/praxagent/teamwork.git
cd teamwork
make install           # pip install -e ".[dev]"
make build-frontend    # builds React → src/teamwork/static/
make dev               # uvicorn with hot reload on :8000
```

## Installation

### Prerequisites

- Python 3.11+
- Node.js 18+ (only if building frontend from source)

### From GitHub (latest)

```bash
pip install git+https://github.com/praxagent/teamwork.git
```

### From local clone (development)

```bash
git clone https://github.com/praxagent/teamwork.git
cd teamwork
pip install -e ".[dev]"

# Build the React frontend into the package
cd frontend && npm ci && npx vite build && cd ..

# Run
teamwork
```

### Verify

```bash
curl http://localhost:8000/health
# {"status":"healthy","connections":0}
```

## Connecting Your Agent

TeamWork exposes a REST API under `/api/external/` that any agent framework can call. All endpoints accept and return JSON.

### Authentication

Set `EXTERNAL_API_KEY` in `.env`. Pass it as `X-API-Key` header on every request. If no key is set, auth is disabled (dev mode only).

### External API Endpoints

All paths are relative to `http://localhost:8000`.

| Method | Path | Description |
|--------|------|-------------|
| **Projects** | | |
| `GET` | `/api/external/projects` | List all external-mode projects |
| `POST` | `/api/external/projects` | Create a project (returns project ID + channel IDs) |
| `PATCH` | `/api/external/projects/{project_id}` | Update project settings (webhook URL, workspace dir) |
| **Agents** | | |
| `POST` | `/api/external/projects/{project_id}/agents` | Register an agent (name, role, personality) |
| `PATCH` | `/api/external/projects/{project_id}/agents/{agent_id}/status` | Set agent status: `idle`, `working`, `offline` |
| **Messages** | | |
| `POST` | `/api/external/projects/{project_id}/messages` | Send a message to a channel as an agent |
| `POST` | `/api/external/projects/{project_id}/typing` | Show typing indicator for an agent |
| **Tasks** | | |
| `POST` | `/api/external/projects/{project_id}/tasks` | Create a task on the Kanban board |
| `PATCH` | `/api/external/projects/{project_id}/tasks/{task_id}` | Update task status, title, assignee |
| **Internal** (used by the frontend, also available to agents) | | |
| `GET` | `/api/messages/channel/{channel_id}` | Read channel message history (paginated) |
| `GET` | `/api/channels/project/{project_id}` | List channels in a project |
| `GET` | `/api/workspace/files` | List workspace files |
| `GET` | `/api/workspace/file` | Read a file |
| `PUT` | `/api/workspace/file` | Write a file |

### WebSocket

Connect to `ws://localhost:8000/ws` for real-time events. Subscribe to receive live updates:

```json
{"action": "subscribe_project", "id": "<project-uuid>"}
{"action": "subscribe_channel", "id": "<channel-uuid>"}
```

Events you'll receive: `message_new`, `task_new`, `task_update`, `agent_status`, `agent_typing`.

### Webhook (Push Model)

When creating a project, pass a `webhook_url`. TeamWork will `POST` to that URL whenever a user sends a message in the UI:

```json
{
  "type": "user_message",
  "content": "Build a login page",
  "channel_id": "ch-abc123",
  "project_id": "proj-xyz",
  "message_id": "msg-999"
}
```

Your agent processes the message and responds via the messages endpoint. This is how Prax works — no polling needed.

## Integration Guide

Step-by-step walkthrough to wire up your own agent.

### 1. Create a Project

```python
import httpx

TW = "http://localhost:8000"
HEADERS = {"X-API-Key": "your-key"}

# Create an external-mode project with a webhook for user messages
resp = httpx.post(f"{TW}/api/external/projects", headers=HEADERS, json={
    "name": "My Agent Workspace",
    "description": "Controlled by my custom agent",
    "webhook_url": "http://my-agent:9000/webhook",  # where user messages get forwarded
})
project = resp.json()
PROJECT_ID = project["project_id"]
CHANNELS = project["channels"]  # {"general": "ch-xxx", "engineering": "ch-yyy", ...}
```

### 2. Register Your Agents

```python
# Register a main agent
resp = httpx.post(
    f"{TW}/api/external/projects/{PROJECT_ID}/agents",
    headers=HEADERS,
    json={
        "name": "Atlas",
        "role": "orchestrator",
        "soul_prompt": "You are Atlas, a helpful AI assistant.",
    },
)
AGENT_ID = resp.json()["agent_id"]

# Register specialist agents (optional — for multi-agent display)
for name, role in [("Researcher", "researcher"), ("Coder", "developer")]:
    httpx.post(
        f"{TW}/api/external/projects/{PROJECT_ID}/agents",
        headers=HEADERS,
        json={"name": name, "role": role},
    )
```

### 3. Handle Incoming Messages (Webhook)

TeamWork forwards user messages to your webhook. Implement a handler:

```python
from fastapi import FastAPI

app = FastAPI()

@app.post("/webhook")
async def handle_teamwork_message(payload: dict):
    if payload["type"] != "user_message":
        return {"ok": True}

    user_text = payload["content"]
    channel_id = payload["channel_id"]
    project_id = payload["project_id"]

    # Show typing indicator while processing
    httpx.post(
        f"{TW}/api/external/projects/{project_id}/typing",
        headers=HEADERS,
        json={"channel_id": channel_id, "agent_id": AGENT_ID, "is_typing": True},
    )

    # === Your AI logic here ===
    response = my_llm_call(user_text)

    # Send response back to the same channel
    httpx.post(
        f"{TW}/api/external/projects/{project_id}/messages",
        headers=HEADERS,
        json={
            "channel_id": channel_id,
            "agent_id": AGENT_ID,
            "content": response,
        },
    )

    return {"ok": True}
```

### 4. Manage Tasks

```python
# Create a task
resp = httpx.post(
    f"{TW}/api/external/projects/{PROJECT_ID}/tasks",
    headers=HEADERS,
    json={
        "title": "Implement user authentication",
        "description": "OAuth2 with Google provider",
        "assigned_to": AGENT_ID,
        "status": "in_progress",
    },
)
task_id = resp.json()["task_id"]

# Update task when done
httpx.patch(
    f"{TW}/api/external/projects/{PROJECT_ID}/tasks/{task_id}",
    headers=HEADERS,
    json={"status": "completed"},
)
```

### 5. Update Agent Status

```python
# Show agent as working
httpx.patch(
    f"{TW}/api/external/projects/{PROJECT_ID}/agents/{AGENT_ID}/status",
    headers=HEADERS,
    json={"status": "working"},
)

# Set back to idle when done
httpx.patch(
    f"{TW}/api/external/projects/{PROJECT_ID}/agents/{AGENT_ID}/status",
    headers=HEADERS,
    json={"status": "idle"},
)
```

### The Contract

TeamWork handles: UI rendering, message persistence, WebSocket broadcasting, task board state, file browsing, real-time updates.

Your agent handles: understanding user intent, generating responses, planning work, executing tasks, deciding what to say and when.

## Prax — First-Class Agent

[**Prax**](https://github.com/praxagent/gpt-transcriber) is an AI agent built to use TeamWork as its web interface. If you want a ready-made agent with tool use, planning, multi-channel chat (SMS, Discord, web), and code execution — start with Prax.

### Prax + TeamWork Setup

Prax's `docker-compose.yml` includes TeamWork as a service. No separate clone needed:

```bash
git clone https://github.com/praxagent/gpt-transcriber.git prax
cd prax
cp .env-example .env  # configure API keys
docker compose up -d
# Prax API:  http://localhost:5001
# TeamWork:  http://localhost:3000
```

Prax automatically:
- Creates a project and registers its agents (Planner, Researcher, Executor, Skeptic, Auditor)
- Receives user messages via webhook and processes them through its LLM orchestrator
- Mirrors SMS/Discord conversations to TeamWork channels
- Syncs its SQLite task board to TeamWork's Kanban
- Shows real-time agent status and typing indicators

## Architecture

```
teamwork/
├── src/teamwork/          # Python package (FastAPI)
│   ├── main.py            # App entry + static file serving
│   ├── config.py          # Pydantic settings
│   ├── cli.py             # `teamwork` CLI entry point
│   ├── static/            # Bundled React build (gitignored)
│   ├── models/            # SQLAlchemy ORM
│   ├── routers/           # API endpoints
│   │   ├── agents.py      # Agent CRUD + status
│   │   ├── browser.py     # CDP browser screencast proxy
│   │   ├── channels.py    # Channel management
│   │   ├── external.py    # External agent API
│   │   ├── messages.py    # Chat messages (CRUD only, no AI)
│   │   ├── projects.py    # Project management
│   │   ├── tasks.py       # Kanban task board
│   │   └── workspace.py   # File browser
│   ├── services/          # Business logic
│   └── websocket/         # Real-time connection manager
├── frontend/              # React + TypeScript + Vite
│   ├── src/
│   └── vite.config.ts     # Builds to ../src/teamwork/static/
├── pyproject.toml         # Hatchling build, pip metadata
├── Dockerfile             # Single-container build
├── docker-compose.yml     # Standalone deployment
├── Makefile               # build, install, dev, test, clean
└── dev.sh                 # One-command local dev server
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS |
| State | Zustand, React Query |
| Real-time | WebSocket |
| Backend | FastAPI (Python 3.11+) |
| Database | SQLite, SQLAlchemy (async) |
| Build | Hatchling (pip package) |
| CI/CD | GitHub Actions, release-please |

### How Static Serving Works

When you `pip install teamwork`, the React build is bundled inside the package at `teamwork/static/`. FastAPI mounts it with `StaticFiles(html=True)`, which serves the SPA and falls back to `index.html` for client-side routes. No nginx, no separate frontend container.

## Screenshots

### Chat Interface

| Chat | Kanban Board |
|------|-------------|
| ![Chat](docs/screenshots/startup/example_chat.png) | ![Kanban](docs/screenshots/startup/kanban_board.png) |

| File Viewer | Live Sessions |
|-------------|--------------|
| ![Files](docs/screenshots/startup/example_file_viewer.png) | ![Live Sessions](docs/screenshots/startup/follow_agent_work.png) |

### Executive Access

![Executive Access](docs/screenshots/startup/executive_access.png)

Launch terminal sessions or browser screencast directly in the UI. Agents run in isolated Docker containers with your workspace mounted.

### Projects

![My Projects](docs/screenshots/startup/my_projects_page.png)

## Environment Variables

Create a `.env` file (copy from `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///data/vteam.db` | Database connection string |
| `WORKSPACE_PATH` | `./workspace` | Directory for generated code/files |
| `EXTERNAL_API_KEY` | — | API key for external agent access (empty = no auth in dev) |
| `CORS_ORIGINS` | `localhost:5173,3000` | Allowed CORS origins |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `DEBUG` | `false` | Enable debug mode |
| `SANDBOX_CONTAINER` | — | Docker container name for terminal sessions |
| `CHROME_CDP_HOST` | `sandbox` | CDP host for browser screencast |
| `CHROME_CDP_PORT` | `9223` | CDP port for browser screencast |

TeamWork itself does **not** require any AI API keys. All AI calls are made by the external agent you connect.

## Development

### Setup

```bash
git clone https://github.com/praxagent/teamwork.git
cd teamwork
pip install -e ".[dev]"
```

### Run (one command)

```bash
./dev.sh
# Backend: http://localhost:8000
# Frontend: http://localhost:5173 (Vite dev server with HMR)
```

### Run (manual)

```bash
# Terminal 1 — backend
make dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

### Test

```bash
make test
# or: pytest tests/ -x -q
```

### Lint

```bash
ruff check .
```

### Build for distribution

```bash
make build  # builds frontend + Python wheel
```

### CI/CD

- **CI**: Runs on PRs to `main` — lints with ruff, runs pytest
- **Release**: Uses [release-please](https://github.com/googleapis/release-please) for automatic semver releases on merge to `main`

## API Reference

Full API docs are auto-generated at `http://localhost:8000/docs` (Swagger UI) when the server is running.

## License

[AGPL-3.0](LICENSE)
