"""Agents API router."""

import base64
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.config import settings
from teamwork.models import Agent, Project, ActivityLog, get_db
from teamwork.websocket import manager, WebSocketEvent, EventType

router = APIRouter(prefix="/agents", tags=["agents"])
_logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory live output buffer
# ---------------------------------------------------------------------------
# Stores the most recent execution output for each agent.  Keyed by agent_id.
# This is intentionally in-memory — live output is ephemeral and doesn't need
# persistence.  It survives as long as the TeamWork process is running.

class _LiveOutputEntry:
    __slots__ = ("agent_id", "agent_name", "status", "output", "last_update", "started_at", "error")

    def __init__(self, agent_id: str, agent_name: str) -> None:
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.status = "idle"
        self.output: str = ""
        self.last_update: str | None = None
        self.started_at: str | None = None
        self.error: str | None = None

_live_output: dict[str, _LiveOutputEntry] = {}


def get_live_output_store() -> dict[str, _LiveOutputEntry]:
    """Return the module-level live output store (used by external router too)."""
    return _live_output


class AgentCreate(BaseModel):
    """Schema for creating an agent."""

    project_id: str
    name: str
    role: str
    team: str | None = None
    soul_prompt: str | None = None
    skills_prompt: str | None = None
    persona: dict | None = None


class AgentResponse(BaseModel):
    """Schema for agent response."""

    id: str
    project_id: str
    name: str
    role: str
    team: str | None
    status: str
    persona: dict | None
    profile_image_type: str | None
    profile_image_url: str | None  # Base64 data URL
    created_at: str

    class Config:
        from_attributes = True


class AgentListResponse(BaseModel):
    """Schema for list of agents."""

    agents: list[AgentResponse]
    total: int


class ActivityLogResponse(BaseModel):
    """Schema for activity log response."""

    id: str
    agent_id: str
    activity_type: str
    description: str
    extra_data: dict | None
    created_at: str


def agent_to_response(agent: Agent) -> AgentResponse:
    """Convert Agent model to response schema."""
    profile_image_url = None
    if agent.profile_image:
        # Convert bytes to base64 data URL
        b64 = base64.b64encode(agent.profile_image).decode("utf-8")
        profile_image_url = f"data:image/png;base64,{b64}"

    return AgentResponse(
        id=agent.id,
        project_id=agent.project_id,
        name=agent.name,
        role=agent.role,
        team=agent.team,
        status=agent.status,
        persona=agent.persona,
        profile_image_type=agent.profile_image_type,
        profile_image_url=profile_image_url,
        created_at=agent.created_at.isoformat(),
    )


@router.get("", response_model=AgentListResponse)
async def list_agents(
    db: AsyncSession = Depends(get_db),
    project_id: str | None = None,
    role: str | None = None,
    team: str | None = None,
) -> AgentListResponse:
    """List agents, optionally filtered by project, role, or team."""
    query = select(Agent)

    if project_id:
        query = query.where(Agent.project_id == project_id)
    if role:
        query = query.where(Agent.role == role)
    if team:
        query = query.where(Agent.team == team)

    result = await db.execute(query.order_by(Agent.created_at))
    agents = result.scalars().all()

    return AgentListResponse(
        agents=[agent_to_response(a) for a in agents],
        total=len(agents),
    )


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(
    agent: AgentCreate,
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Create a new agent."""
    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == agent.project_id)
    )
    if not project_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    db_agent = Agent(
        project_id=agent.project_id,
        name=agent.name,
        role=agent.role,
        team=agent.team,
        soul_prompt=agent.soul_prompt,
        skills_prompt=agent.skills_prompt,
        persona=agent.persona,
    )
    db.add(db_agent)
    await db.flush()
    await db.refresh(db_agent)

    # Broadcast agent creation
    await manager.broadcast_to_project(
        agent.project_id,
        WebSocketEvent(
            type=EventType.AGENT_STATUS,
            data={"agent_id": db_agent.id, "status": "created", "name": db_agent.name},
        ),
    )

    return agent_to_response(db_agent)


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Get an agent by ID."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    return agent_to_response(agent)


@router.patch("/{agent_id}/status")
async def update_agent_status(
    agent_id: str,
    status: str,
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Update an agent's status."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.status = status
    await db.flush()

    # Broadcast status update
    await manager.broadcast_to_project(
        agent.project_id,
        WebSocketEvent(
            type=EventType.AGENT_STATUS,
            data={"agent_id": agent_id, "status": status, "name": agent.name},
        ),
    )

    return agent_to_response(agent)


class UpdateProfileImageRequest(BaseModel):
    """Request to update agent profile image."""
    image_data: str  # Base64 encoded image data (with or without data URL prefix)
    image_type: str | None = None  # Optional: professional, vacation, hobby, pet, artistic


@router.patch("/{agent_id}/profile-image", response_model=AgentResponse)
async def update_agent_profile_image(
    agent_id: str,
    request: UpdateProfileImageRequest,
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Update an agent's profile image manually."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Parse the image data
    image_data = request.image_data

    # Remove data URL prefix if present
    if image_data.startswith("data:"):
        # Format: data:image/png;base64,XXXX
        try:
            image_data = image_data.split(",", 1)[1]
        except IndexError:
            raise HTTPException(status_code=400, detail="Invalid image data format")

    # Decode base64
    try:
        image_bytes = base64.b64decode(image_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    # Update agent
    agent.profile_image = image_bytes
    if request.image_type:
        agent.profile_image_type = request.image_type

    await db.commit()
    await db.refresh(agent)

    # Broadcast update
    await manager.broadcast_to_project(
        agent.project_id,
        WebSocketEvent(
            type=EventType.AGENT_STATUS,
            data={"agent_id": agent_id, "status": agent.status, "name": agent.name, "profile_updated": True},
        ),
    )

    return agent_to_response(agent)


@router.delete("/{agent_id}/profile-image", response_model=AgentResponse)
async def remove_agent_profile_image(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Remove an agent's profile image (revert to initials avatar)."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.profile_image = None

    await db.commit()
    await db.refresh(agent)

    return agent_to_response(agent)


@router.get("/{agent_id}/activity", response_model=list[ActivityLogResponse])
async def get_agent_activity(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
) -> list[ActivityLogResponse]:
    """Get recent activity for an agent."""
    result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.agent_id == agent_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    activities = result.scalars().all()

    return [
        ActivityLogResponse(
            id=a.id,
            agent_id=a.agent_id,
            activity_type=a.activity_type,
            description=a.description,
            extra_data=a.extra_data,
            created_at=a.created_at.isoformat(),
        )
        for a in activities
    ]


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    await db.delete(agent)


class AgentLogEntry(BaseModel):
    """A single activity log entry for an agent."""
    id: str
    activity_type: str
    description: str
    extra_data: dict | None
    created_at: str


class AgentLogsResponse(BaseModel):
    """Response containing agent activity logs."""
    agent_id: str
    agent_name: str
    agent_role: str
    logs: list[AgentLogEntry]


@router.get("/{agent_id}/logs", response_model=AgentLogsResponse)
async def get_agent_logs(
    agent_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> AgentLogsResponse:
    """
    Get activity logs for an agent.

    Returns all activity logs for this agent,
    including task executions and code changes.
    """
    # Get agent
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get activity logs for this agent
    logs_result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.agent_id == agent_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    logs = logs_result.scalars().all()

    # Convert to response format
    log_entries = [
        AgentLogEntry(
            id=log.id,
            activity_type=log.activity_type,
            description=log.description,
            extra_data=log.extra_data,
            created_at=log.created_at.isoformat(),
        )
        for log in logs
    ]

    # Sort by created_at ascending (oldest first)
    log_entries.sort(key=lambda x: x.created_at)

    return AgentLogsResponse(
        agent_id=agent_id,
        agent_name=agent.name,
        agent_role=agent.role,
        logs=log_entries,
    )


# ============================================================================
# Agent Prompts - Stored in workspace for easy editing
# ============================================================================

class AgentPromptsResponse(BaseModel):
    """Agent prompts response."""
    soul_prompt: str | None = None
    skills_prompt: str | None = None
    source: str = "database"  # "database" or "file"


class UpdateAgentPromptsRequest(BaseModel):
    """Request to update agent prompts."""
    soul_prompt: str | None = None
    skills_prompt: str | None = None


def _slugify_agent_name(name: str) -> str:
    """Convert agent name to a safe directory name."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')


def _get_agent_prompts_dir(project: Project, agent: Agent) -> "Path":
    """Get the directory for an agent's prompts in the workspace."""
    from pathlib import Path
    from teamwork.config import settings

    workspace_dir = project.workspace_dir or project.get_workspace_dir_name()
    workspace_path = settings.workspace_path / workspace_dir

    agent_slug = _slugify_agent_name(agent.name)
    return workspace_path / ".agents" / agent_slug


@router.get("/{agent_id}/prompts")
async def get_agent_prompts(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> AgentPromptsResponse:
    """
    Get an agent's prompts.

    Returns prompts from files if they exist in .agents/{agent-name}/,
    otherwise returns prompts from the database.
    """
    # Get agent
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get project
    project_result = await db.execute(
        select(Project).where(Project.id == agent.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check for file-based prompts
    prompts_dir = _get_agent_prompts_dir(project, agent)
    soul_file = prompts_dir / "soul.md"
    skills_file = prompts_dir / "skills.md"

    soul_prompt = None
    skills_prompt = None
    source = "database"

    if soul_file.exists():
        soul_prompt = soul_file.read_text()
        source = "file"
    else:
        soul_prompt = agent.soul_prompt

    if skills_file.exists():
        skills_prompt = skills_file.read_text()
        source = "file" if source == "file" else "mixed"
    else:
        skills_prompt = agent.skills_prompt

    return AgentPromptsResponse(
        soul_prompt=soul_prompt,
        skills_prompt=skills_prompt,
        source=source,
    )


@router.put("/{agent_id}/prompts")
async def update_agent_prompts(
    agent_id: str,
    request: UpdateAgentPromptsRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Update an agent's prompts.

    Saves prompts to files in .agents/{agent-name}/ for easy editing.
    Also updates the database for consistency.
    """
    # Get agent
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get project
    project_result = await db.execute(
        select(Project).where(Project.id == agent.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Create directory if needed
    prompts_dir = _get_agent_prompts_dir(project, agent)
    prompts_dir.mkdir(parents=True, exist_ok=True)

    # Write files
    if request.soul_prompt is not None:
        (prompts_dir / "soul.md").write_text(request.soul_prompt)
        agent.soul_prompt = request.soul_prompt

    if request.skills_prompt is not None:
        (prompts_dir / "skills.md").write_text(request.skills_prompt)
        agent.skills_prompt = request.skills_prompt

    await db.commit()

    return {
        "success": True,
        "message": f"Prompts updated for {agent.name}",
        "path": str(prompts_dir),
    }


@router.post("/{agent_id}/prompts/init")
async def initialize_agent_prompts(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Initialize prompt files for an agent.

    Creates .agents/{agent-name}/soul.md and skills.md from the database.
    """
    # Get agent
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get project
    project_result = await db.execute(
        select(Project).where(Project.id == agent.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Create directory
    prompts_dir = _get_agent_prompts_dir(project, agent)
    prompts_dir.mkdir(parents=True, exist_ok=True)

    # Write files from database
    soul_file = prompts_dir / "soul.md"
    skills_file = prompts_dir / "skills.md"

    if not soul_file.exists() and agent.soul_prompt:
        soul_file.write_text(agent.soul_prompt)

    if not skills_file.exists() and agent.skills_prompt:
        skills_file.write_text(agent.skills_prompt)

    return {
        "success": True,
        "message": f"Prompts initialized for {agent.name}",
        "path": str(prompts_dir),
    }


# ============================================================================
# Agent Live Output — real-time execution output
# ============================================================================

class LiveOutputResponse(BaseModel):
    """Response schema for agent live output."""
    agent_id: str
    agent_name: str
    status: str  # idle, running, completed, error, etc.
    output: str | None
    last_update: str | None
    started_at: str | None
    error: str | None


@router.get("/{agent_id}/live-output", response_model=LiveOutputResponse)
async def get_agent_live_output(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> LiveOutputResponse:
    """Get the live execution output for an agent.

    Returns the most recent execution output buffer.  The frontend polls
    this endpoint every ~1 second to display real-time agent activity.
    """
    entry = _live_output.get(agent_id)
    if entry:
        return LiveOutputResponse(
            agent_id=entry.agent_id,
            agent_name=entry.agent_name,
            status=entry.status,
            output=entry.output or None,
            last_update=entry.last_update,
            started_at=entry.started_at,
            error=entry.error,
        )

    # No live output yet — look up agent name from DB and return idle state
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    return LiveOutputResponse(
        agent_id=agent_id,
        agent_name=agent.name,
        status="idle",
        output=None,
        last_update=None,
        started_at=None,
        error=None,
    )


# ---------------------------------------------------------------------------
# Execution graphs — proxied from Prax backend
# ---------------------------------------------------------------------------


@router.get("/graphs/active")
async def get_active_graphs():
    """Proxy execution graph data from the Prax backend.

    Returns the list of currently running and recently completed execution
    graphs, each with its tree of span nodes.  Used by the Graph panel in
    the frontend.
    """
    prax_url = settings.prax_url
    if not prax_url:
        return {"graphs": []}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{prax_url.rstrip('/')}/execution/graphs")
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        _logger.debug("Failed to fetch execution graphs from Prax: %s", exc)
        return {"graphs": []}
