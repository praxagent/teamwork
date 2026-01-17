# TeamWork by praxagent

![TeamWork Header](assets/teamwork-header.png)

A web application where AI agents simulate a software development team. Describe your application idea and the system generates a virtual team with a Product Manager, developers, and QA engineers. Each agent has a distinct persona and collaborates through a Slack-like interface to build your project.

## Features

- Onboarding wizard with AI-driven clarifying questions
- Dynamic team generation with unique agent personalities
- Real-time chat interface with channels and direct messages
- AI-generated profile images for team members
- Kanban task board with drag-and-drop
- Live activity traces showing agent work status
- Code generation to a local workspace
- Execution logs for tasks and agents
- Code diff viewer for completed tasks
- Pause/Resume kill switch for all agents

## Screenshots

### Getting Started

| Step 1: Describe Your Idea | Step 2: Refining Questions |
|---|---|
| ![Step 1](assets/step1_describe_your_idea.png) | ![Step 2](assets/step2_refining_questions.png) |

| Step 3: Meet Your Team | Step 4: Configuration |
|---|---|
| ![Step 3](assets/step3_meant_your_team.png) | ![Step 4](assets/step4_configurations.png) |

### Main Interface

| Chat Interface | Kanban Board |
|---|---|
| ![Chat](assets/example_chat.png) | ![Kanban](assets/kanban_board.png) |

| File Viewer | Work Logs |
|---|---|
| ![Files](assets/example_file_viewer.png) | ![Logs](assets/example_work_log.png) |

### Projects

![My Projects](assets/my_projects_page.png)

## Quick Start with Docker

The easiest way to run TeamWork is with Docker Compose.

### Prerequisites

- Docker and Docker Compose
- Anthropic API key
- OpenAI API key (for profile image generation)

### Steps

1. **Clone and configure:**
   ```bash
   git clone https://github.com/praxagent/teamwork.git
   cd teamwork
   cp .env.example .env
   # Edit .env and add your API keys
   ```

2. **Start the application:**
   ```bash
   docker-compose up -d
   ```

3. **Access the app:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

4. **Stop the application:**
   ```bash
   docker-compose down
   ```

### Docker Volumes

| Path | Description |
|------|-------------|
| `./workspace/` | Generated code from your AI team |
| `./data/` | SQLite database |
| `./.env` | Environment variables (API keys) |

Your generated code persists in the `workspace/` folder even after stopping containers.

---

## Local Development Setup

For development or if you prefer not to use Docker.

### Prerequisites

- Python 3.11+
- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Anthropic API key
- OpenAI API key (optional, for AI profile images)

### Quick Start (Recommended)

Use the dev script to run both backend and frontend with one command:

```bash
# Configure environment
cp .env.example .env
# Edit .env and add your API keys

# Run everything
./dev.sh
```

The script will:
- Check prerequisites and install dependencies
- Create data directories
- Start both backend and frontend servers
- Handle Ctrl+C gracefully to stop both

### Manual Setup

If you prefer to run servers separately:

#### Backend

```bash
cd backend

# Install uv package manager (if not installed)
pip install uv

# Create virtual environment and install dependencies
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv pip install -e .

# Run the server
uvicorn app.main:app --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Access Points (Local)

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Data Locations (Same for Docker and Local)

Both Docker and local development use the same directory structure at the **project root**:

```
teamwork/
├── .env              # API keys (not committed)
├── data/             # SQLite database
│   └── vteam.db
├── workspace/        # Generated code
│   └── {project-dirs}/
├── backend/
└── frontend/
```

The backend auto-detects whether you're running from `backend/` or the project root and uses the correct paths.

---

## Architecture

```
teamwork/
├── frontend/              # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── stores/
│   │   └── pages/
│   ├── Dockerfile
│   └── nginx.conf
├── backend/               # FastAPI + SQLAlchemy
│   ├── app/
│   │   ├── models/
│   │   ├── routers/
│   │   ├── services/
│   │   └── agents/
│   └── Dockerfile
├── workspace/             # Generated code (git-ignored)
├── data/                  # SQLite database (git-ignored)
├── docker-compose.yml
└── .env                   # API keys (git-ignored)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS |
| State | Zustand, React Query |
| Real-time | WebSocket |
| Backend | FastAPI (Python 3.11+) |
| Database | SQLite, SQLAlchemy |
| Agent Runtime | Claude Code CLI |
| Image Generation | OpenAI GPT Image API |
| Containerization | Docker, Docker Compose |

## Environment Variables

Create a `.env` file in the **project root** (copy from `.env.example`):

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude agents |
| `OPENAI_API_KEY` | No* | OpenAI API key for AI-generated profile images |
| `DATABASE_URL` | No | Database URL (default: SQLite) |
| `WORKSPACE_PATH` | No | Code output directory (default: `./workspace`) |
| `DEFAULT_AGENT_RUNTIME` | No | `subprocess` or `docker` |

*If `OPENAI_API_KEY` is not provided, AI profile image generation is automatically disabled. Agents will use colored initials avatars instead, and you can upload custom images manually.

## Usage

1. Navigate to http://localhost:3000 (Docker) or http://localhost:5173 (local)
2. Click "Start Building"
3. Describe your application idea
4. Answer clarifying questions from the PM
5. Review and customize the generated team
6. Configure runtime options
7. Launch your team and watch them build!

## Chat Commands

| Command | Description |
|---------|-------------|
| `/update` | PM provides status report on progress and blockers |
| `/test` | PM runs the application and provides verification |
| `/plan <description>` | PM creates and assigns tasks based on description |

## Agent Status Indicators

- 🔴 **Red**: Actively working on a task
- 🟡 **Yellow**: Blocked, needs input
- 🟢 **Green**: Idle, ready for work
- ⚫ **Gray**: Offline

## Profile Images

**AI-Generated Images** (requires OpenAI API key):
- During onboarding, TeamWork can generate unique profile photos using OpenAI's image API
- Images are based on each agent's persona (professional, vacation, hobby, pet, etc.)

**Manual Upload**:
- Click any agent's profile picture to open their profile
- Hover over the avatar to see upload/remove buttons
- Upload any image (max 2MB) to replace the current avatar
- Works whether or not AI generation is enabled

**No OpenAI Key?**
- If `OPENAI_API_KEY` is not set, AI image generation is automatically disabled
- Agents use colored initials avatars by default
- You can still upload custom images at any time

## Pause/Resume Kill Switch

Located in the Kanban board toolbar:
- **Pause**: Immediately stop all running agents. Work in progress is saved.
- **Resume**: Allow agents to continue. Restart tasks from the task board.

## Model Selection

Control which Claude model your agents use. Configure in Project Settings:

| Mode | Description |
|------|-------------|
| **Auto** (Recommended) | PM selects model based on task complexity. Complex tasks use Sonnet, simple tasks use Haiku |
| **Sonnet** | Use Claude Sonnet for all tasks - best balance of speed and capability |
| **Haiku** | Use Claude Haiku for all tasks - fastest and most cost-effective |
| **Hybrid** | Auto-select by default, but allows per-task overrides |

**Complexity Detection:**
- Complex tasks (architecture, security, database design) → Sonnet
- Simple tasks (typos, docs, minor fixes) → Haiku
- Moderate tasks → Sonnet

## Generated Code Location

All code generated by your AI team is saved to the `workspace/` directory:

```
workspace/
└── {project-id}/          # UUID of your project
    ├── src/               # Source code
    ├── package.json       # Dependencies (if applicable)
    └── ...                # Other generated files
```

View code in-app using the **Files** tab, or browse the folder directly.

## Execution Logs

- **Task Logs**: Click any task in the Task Board to view Claude Code prompt and response
- **Agent Logs**: Click an agent's profile → "Inspect Work Logs" to see all executions
- **Code Diffs**: Click "View Changes" on completed tasks to see file modifications

## PM Behaviors

The Product Manager automatically:
- Creates tasks when none exist
- Assigns work to idle developers
- Checks on blocked team members
- Announces project completion
- Provides periodic status updates

## Development

### Backend

```bash
cd backend
uv run uvicorn app.main:app --reload
uv run pytest
uv run black app/
uv run ruff check app/
```

### Frontend

```bash
cd frontend
npm run dev
npm run build
npm run lint
```

### Docker Build

```bash
# Build images
docker-compose build

# Run with logs visible
docker-compose up

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Rebuild after code changes
docker-compose up --build
```

## Data Persistence & Backup

### What Gets Stored

| Data | Location | Contains |
|------|----------|----------|
| Database | `data/vteam.db` | Projects, agents, tasks, messages, activity logs |
| Generated Code | `workspace/{project-id}/` | All code produced by agents |

### Docker Volume Mounts

Both directories are mounted outside the container to persist data:

```yaml
volumes:
  - ./workspace:/workspace    # Agent-generated code
  - ./data:/app/data          # SQLite database
```

**Important**: Your data lives on the host machine, not inside Docker. Stopping or removing containers won't delete your projects.

### Backing Up Your Data

**Quick backup** (database only):
```bash
cp data/vteam.db data/vteam.db.backup
```

**Full backup** (database + all generated code):
```bash
# Create timestamped backup
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r data/ "$BACKUP_DIR/"
cp -r workspace/ "$BACKUP_DIR/"
echo "Backup created at $BACKUP_DIR"
```

**Automated daily backup** (add to crontab):
```bash
# Run 'crontab -e' and add:
0 2 * * * cd /path/to/teamwork && cp data/vteam.db "backups/vteam_$(date +\%Y\%m\%d).db"
```

### Restoring from Backup

```bash
# Stop the application first
docker-compose down  # or stop the backend

# Restore database
cp backups/vteam.db.backup data/vteam.db

# Restore workspace (if backed up)
cp -r backups/workspace/* workspace/

# Restart
docker-compose up -d  # or start the backend
```

### SQLite Notes

- SQLite uses WAL (Write-Ahead Logging) mode for better concurrency
- You may see `vteam.db-wal` and `vteam.db-shm` files - these are normal
- For a clean backup, either stop the server or copy all three files together

## Troubleshooting

### "Claude Code CLI not available"
Install the Claude Code CLI:
```bash
npm install -g @anthropic-ai/claude-code
```

### Agents stuck in "working" state
This can happen after a server restart. Open the agent's Work Logs - stale states are automatically detected and reset.

### Database issues
Reset the database (warning: deletes all data):
```bash
rm -rf data/vteam.db*
```

### Docker container won't start
Check logs:
```bash
docker-compose logs backend
docker-compose logs frontend
```

## References

- [Claude Code Programmatic Usage](https://code.claude.com/docs/en/headless) - Documentation for running Claude Code via CLI
- [Anthropic API](https://docs.anthropic.com/) - Claude API documentation
- [OpenAI Image Generation](https://platform.openai.com/docs/guides/images) - For AI-generated profile images

## License

MIT - See [LICENSE](LICENSE) for details.
