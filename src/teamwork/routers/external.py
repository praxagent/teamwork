"""External agent API — lets an external orchestrator (like Prax) control a TeamWork project."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models import Project, Agent, Channel, Message, Task, get_db, AsyncSessionLocal
from teamwork.routers.agents import get_live_output_store, _LiveOutputEntry
from teamwork.websocket import manager, WebSocketEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/external", tags=["external"])


class ExternalProjectCreate(BaseModel):
    """Create a project in external mode."""
    name: str
    description: str = ""
    webhook_url: str  # URL where user messages get forwarded
    workspace_dir: str | None = None  # Override workspace directory (e.g. user's phone number)


class ExternalProjectUpdate(BaseModel):
    """Update a project."""
    workspace_dir: str | None = None
    webhook_url: str | None = None


class ExternalAgentCreate(BaseModel):
    """Create an agent representation in the UI."""
    name: str
    role: str = "assistant"
    soul_prompt: str = ""
    skills_prompt: str = ""
    avatar_url: str | None = None


class ExternalMessage(BaseModel):
    """Send a message as an agent or system."""
    channel_id: str
    agent_id: str | None = None  # None = system message
    content: str
    message_type: str = "chat"
    extra_data: dict[str, Any] | None = None


class BulkMessageItem(BaseModel):
    """A single message in a bulk import."""
    channel_id: str
    agent_id: str | None = None
    content: str
    message_type: str = "chat"
    created_at: str | None = None  # ISO 8601 — preserves original timestamp


class BulkMessageImport(BaseModel):
    """Bulk import historical messages into a channel."""
    messages: list[BulkMessageItem]


class ExternalAgentStatus(BaseModel):
    """Update an agent's status."""
    status: str  # idle, working, offline


class ExternalLiveOutput(BaseModel):
    """Push live output from agent execution."""
    output: str = ""
    status: str = "running"  # running, completed, error, idle, etc.
    append: bool = True  # True = append to existing output, False = replace
    error: str | None = None


class ExternalTaskCreate(BaseModel):
    """Create a task on the board."""
    title: str
    description: str = ""
    assigned_to: str | None = None  # agent_id
    priority: int = 1
    status: str = "pending"


class ExternalTaskUpdate(BaseModel):
    """Update a task."""
    status: str | None = None
    assigned_to: str | None = None
    title: str | None = None
    description: str | None = None


class ExternalTyping(BaseModel):
    """Typing indicator request."""
    channel_id: str
    agent_id: str
    is_typing: bool = True


def _verify_api_key(x_api_key: str | None = Header(None, alias="X-API-Key")) -> str | None:
    """Verify the external agent API key."""
    from teamwork.config import settings
    expected = getattr(settings, 'external_api_key', None)
    if not expected:
        # No key configured = accept anything (dev mode)
        return x_api_key
    if x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key


@router.get("/projects")
async def list_external_projects(
    db: AsyncSession = Depends(get_db),
    api_key: str | None = Depends(_verify_api_key),
) -> list[dict[str, Any]]:
    """List all external-mode projects."""
    result = await db.execute(select(Project).where(Project.status == "active"))
    projects = []
    for p in result.scalars().all():
        config = p.config or {}
        if config.get("project_type") == "external":
            # Fetch channels for this project
            ch_result = await db.execute(
                select(Channel).where(Channel.project_id == p.id)
            )
            channels = {ch.name: ch.id for ch in ch_result.scalars().all()}
            # Fetch agents for this project
            ag_result = await db.execute(
                select(Agent).where(Agent.project_id == p.id)
            )
            agents = {ag.name: ag.id for ag in ag_result.scalars().all()}
            projects.append({
                "project_id": p.id,
                "name": p.name,
                "channels": channels,
                "agents": agents,
                "webhook_url": config.get("webhook_url", ""),
            })
    return projects


@router.post("/projects", status_code=201)
async def create_external_project(
    request: ExternalProjectCreate,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, Any]:
    """Create a new project in external orchestrator mode.

    No agents are created — the external agent manages its own workers.
    A #general channel is created for user<->agent communication.
    """
    project_id = str(uuid.uuid4())
    project = Project(
        id=project_id,
        name=request.name,
        description=request.description,
        config={
            "project_type": "external",
            "webhook_url": request.webhook_url,
            "runtime_mode": "docker",
            "auto_execute_tasks": False,
        },
        status="active",
    )
    project.workspace_dir = request.workspace_dir or project.get_workspace_dir_name()
    db.add(project)
    await db.flush()
    await db.refresh(project)

    # Create default channels
    channels_to_create = [
        ("general", "public", None, "Main conversation with the external agent"),
        ("engineering", "public", None, "Agent-to-agent work conversations"),
        ("research", "public", None, "Research and investigation"),
        ("discord", "public", None, "Mirrored conversations from Discord"),
        ("sms", "public", None, "Mirrored conversations from SMS/Twilio"),
    ]
    created_channels = {}
    for name, ch_type, team, description in channels_to_create:
        channel = Channel(
            project_id=project.id,
            name=name,
            type=ch_type,
            team=team,
            description=description,
        )
        db.add(channel)
        await db.flush()
        await db.refresh(channel)
        created_channels[name] = channel.id

    await db.commit()

    logger.info("Created external project %s (%s)", project.name, project.id)
    return {
        "project_id": project.id,
        "name": project.name,
        "channels": created_channels,
        "workspace_dir": project.workspace_dir,
    }


@router.patch("/projects/{project_id}")
async def update_external_project(
    project_id: str,
    request: ExternalProjectUpdate,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, str]:
    """Update an external project's settings."""
    project = await _get_external_project(project_id, db)
    if request.workspace_dir is not None:
        project.workspace_dir = request.workspace_dir
    if request.webhook_url is not None:
        config = project.config or {}
        config["webhook_url"] = request.webhook_url
        project.config = config
    await db.commit()
    return {"status": "updated"}


class EnsureChannelsRequest(BaseModel):
    """List of channels to ensure exist."""
    channels: list[dict[str, str]]  # [{"name": "discord", "description": "..."}]


@router.post("/projects/{project_id}/ensure-channels")
async def ensure_channels(
    project_id: str,
    request: EnsureChannelsRequest,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, Any]:
    """Ensure the listed channels exist for this project.

    Creates any that are missing, returns all channel name→id mappings.
    Used by Prax on startup to ensure #discord, #sms, etc. exist even
    for projects created before those channels were added.
    """
    project = await _get_external_project(project_id, db)
    # Get existing channels
    ch_result = await db.execute(
        select(Channel).where(Channel.project_id == project.id)
    )
    existing = {ch.name: ch.id for ch in ch_result.scalars().all()}

    for ch_spec in request.channels:
        name = ch_spec.get("name", "")
        if not name or name in existing:
            continue
        channel = Channel(
            project_id=project.id,
            name=name,
            type="public",
            description=ch_spec.get("description", ""),
        )
        db.add(channel)
        await db.flush()
        await db.refresh(channel)
        existing[name] = channel.id
        logger.info("Created missing channel #%s for project %s", name, project.id)

    await db.commit()
    return {"channels": existing}


@router.post("/projects/{project_id}/agents", status_code=201)
async def create_external_agent(
    project_id: str,
    request: ExternalAgentCreate,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, Any]:
    """Register an agent in the UI. The external orchestrator controls what the agent does."""
    project = await _get_external_project(project_id, db)

    agent = Agent(
        project_id=project.id,
        name=request.name,
        role=request.role,
        soul_prompt=request.soul_prompt,
        skills_prompt=request.skills_prompt,
        status="idle",
    )
    db.add(agent)
    await db.flush()
    await db.refresh(agent)
    await db.commit()

    # Broadcast agent creation
    await manager.broadcast_to_project(
        project_id,
        WebSocketEvent(
            type=EventType.AGENT_STATUS,
            data={"id": agent.id, "name": agent.name, "status": "idle", "role": agent.role},
        ),
    )

    logger.info("Created external agent %s (%s) in project %s", agent.name, agent.id, project_id)
    return {"agent_id": agent.id, "name": agent.name}


@router.patch("/projects/{project_id}/agents/{agent_id}/status")
async def update_agent_status(
    project_id: str,
    agent_id: str,
    request: ExternalAgentStatus,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, str]:
    """Update an agent's status (idle/working/offline)."""
    await _get_external_project(project_id, db)

    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.project_id == project_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.status = request.status
    await db.commit()

    await manager.broadcast_to_project(
        project_id,
        WebSocketEvent(
            type=EventType.AGENT_STATUS,
            data={"id": agent.id, "name": agent.name, "status": request.status},
        ),
    )
    return {"status": "updated"}


@router.post("/projects/{project_id}/messages", status_code=201)
async def send_external_message(
    project_id: str,
    request: ExternalMessage,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, Any]:
    """Send a message to a channel as an agent or system."""
    await _get_external_project(project_id, db)

    # Verify channel belongs to project
    ch_result = await db.execute(
        select(Channel).where(Channel.id == request.channel_id, Channel.project_id == project_id)
    )
    if not ch_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Channel not found in this project")

    agent_name = None
    if request.agent_id:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == request.agent_id, Agent.project_id == project_id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found in this project")
        agent_name = agent.name

    message = Message(
        channel_id=request.channel_id,
        agent_id=request.agent_id,
        content=request.content,
        message_type=request.message_type,
        extra_data=request.extra_data,
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)
    await db.commit()

    msg_event = WebSocketEvent(
        type=EventType.MESSAGE_NEW,
        data={
            "id": message.id,
            "channel_id": message.channel_id,
            "agent_id": message.agent_id,
            "agent_name": agent_name,
            "content": message.content,
            "message_type": message.message_type,
            "created_at": message.created_at.isoformat(),
            **({"extra_data": message.extra_data} if message.extra_data else {}),
        },
    )
    # Broadcast to both channel AND project subscribers (frontend may use either).
    await manager.broadcast_to_channel(request.channel_id, msg_event)
    await manager.broadcast_to_project(project_id, msg_event)

    return {"message_id": message.id}


@router.delete("/projects/{project_id}/channels/{channel_id}/messages")
async def clear_channel_messages(
    project_id: str,
    channel_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, int]:
    """Delete all messages from a channel (used to re-sync history)."""
    await _get_external_project(project_id, db)
    from sqlalchemy import delete
    result = await db.execute(
        delete(Message).where(Message.channel_id == channel_id)
    )
    await db.commit()
    return {"deleted": result.rowcount}


@router.get("/projects/{project_id}/channels/{channel_id}/message-count")
async def get_channel_message_count(
    project_id: str,
    channel_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, int]:
    """Return the number of messages in a channel (used by sync to avoid duplicates)."""
    await _get_external_project(project_id, db)
    from sqlalchemy import func
    result = await db.execute(
        select(func.count(Message.id)).where(Message.channel_id == channel_id)
    )
    count = result.scalar() or 0
    return {"count": count}


@router.post("/projects/{project_id}/messages/bulk", status_code=201)
async def bulk_import_messages(
    project_id: str,
    request: BulkMessageImport,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, Any]:
    """Bulk import historical messages into channels.

    Used to backfill SMS and Discord conversation history into TeamWork.
    Does NOT broadcast via WebSocket (these are historical messages).
    Supports ``created_at`` override to preserve original timestamps.
    """
    await _get_external_project(project_id, db)

    # Validate all channel_ids belong to this project
    ch_result = await db.execute(
        select(Channel).where(Channel.project_id == project_id)
    )
    valid_channels = {ch.id for ch in ch_result.scalars().all()}

    imported = 0
    for item in request.messages:
        if item.channel_id not in valid_channels:
            continue

        msg = Message(
            channel_id=item.channel_id,
            agent_id=item.agent_id,
            content=item.content,
            message_type=item.message_type,
        )
        # Override created_at if provided (for preserving original timestamps)
        if item.created_at:
            msg.created_at = datetime.fromisoformat(item.created_at.replace("Z", "+00:00"))
        db.add(msg)
        imported += 1

    await db.flush()
    await db.commit()

    logger.info("Bulk imported %d messages into project %s", imported, project_id)
    return {"imported": imported}


@router.post("/projects/{project_id}/typing")
async def send_typing_indicator(
    project_id: str,
    request: ExternalTyping,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, str]:
    """Send a typing indicator for an agent."""
    agent_result = await db.execute(
        select(Agent).where(Agent.id == request.agent_id, Agent.project_id == project_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    typing_event = WebSocketEvent(
        type=EventType.AGENT_TYPING,
        data={
            "agent_id": request.agent_id,
            "agent_name": agent.name,
            "channel_id": request.channel_id,
            "is_typing": request.is_typing,
        },
    )
    # Broadcast to both channel AND project subscribers.
    await manager.broadcast_to_channel(request.channel_id, typing_event)
    await manager.broadcast_to_project(project_id, typing_event)
    return {"status": "sent"}


@router.post("/projects/{project_id}/agents/{agent_id}/live-output")
async def push_live_output(
    project_id: str,
    agent_id: str,
    request: ExternalLiveOutput,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, str]:
    """Push live execution output for an agent.

    Called by the external orchestrator (Prax) during agent execution to
    stream tool call logs and output to the TeamWork frontend.
    """
    await _get_external_project(project_id, db)

    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.project_id == project_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in this project")

    store = get_live_output_store()
    now = datetime.now(timezone.utc).isoformat()

    entry = store.get(agent_id)
    if not entry:
        entry = _LiveOutputEntry(agent_id, agent.name)
        store[agent_id] = entry

    entry.agent_name = agent.name
    entry.status = request.status
    entry.last_update = now
    entry.error = request.error

    if request.status in ("running", "invoking", "preparing", "initializing") and not entry.started_at:
        entry.started_at = now

    if request.append and request.output:
        entry.output = (entry.output or "") + request.output
    elif request.output:
        entry.output = request.output

    # Reset started_at on terminal states
    if request.status in ("idle", "completed", "error", "failed", "stopped"):
        entry.started_at = None

    return {"status": "updated"}


@router.post("/projects/{project_id}/tasks", status_code=201)
async def create_external_task(
    project_id: str,
    request: ExternalTaskCreate,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, Any]:
    """Create a task on the board."""
    await _get_external_project(project_id, db)

    task = Task(
        project_id=project_id,
        title=request.title,
        description=request.description,
        assigned_to=request.assigned_to,
        priority=request.priority,
        status=request.status,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    await db.commit()

    await manager.broadcast_to_project(
        project_id,
        WebSocketEvent(
            type=EventType.TASK_NEW,
            data={
                "id": task.id,
                "title": task.title,
                "status": task.status,
                "assigned_to": task.assigned_to,
                "priority": task.priority,
            },
        ),
    )

    return {"task_id": task.id, "title": task.title}


@router.patch("/projects/{project_id}/tasks/{task_id}")
async def update_external_task(
    project_id: str,
    task_id: str,
    request: ExternalTaskUpdate,
    db: AsyncSession = Depends(get_db),
    api_key: str = Depends(_verify_api_key),
) -> dict[str, str]:
    """Update a task on the board."""
    await _get_external_project(project_id, db)

    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.project_id == project_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if request.status is not None:
        task.status = request.status
    if request.assigned_to is not None:
        task.assigned_to = request.assigned_to
    if request.title is not None:
        task.title = request.title
    if request.description is not None:
        task.description = request.description

    await db.commit()

    await manager.broadcast_to_project(
        project_id,
        WebSocketEvent(
            type=EventType.TASK_UPDATE,
            data={
                "id": task.id,
                "title": task.title,
                "status": task.status,
                "assigned_to": task.assigned_to,
            },
        ),
    )
    return {"status": "updated"}


async def _get_external_project(project_id: str, db: AsyncSession) -> Project:
    """Verify the project exists and is in external mode."""
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    config = project.config or {}
    if config.get("project_type") != "external":
        raise HTTPException(
            status_code=403,
            detail="This endpoint is only for external-mode projects",
        )
    return project


# ── Activity Logs ─────────────────────────────────────────────────────


class ActivityLogRequest(BaseModel):
    agent_id: str
    activity_type: str  # tool_use, task_started, task_completed, message, etc.
    description: str
    extra_data: dict[str, Any] | None = None


@router.post("/projects/{project_id}/activity")
async def create_activity_log(
    project_id: str,
    request: ActivityLogRequest,
    db: AsyncSession = Depends(get_db),
    x_api_key: str | None = Header(None),
):
    """Create an activity log entry for an agent."""
    await _get_external_project(project_id, db)

    from teamwork.models import ActivityLog
    log = ActivityLog(
        agent_id=request.agent_id,
        activity_type=request.activity_type,
        description=request.description,
        extra_data=request.extra_data,
    )
    db.add(log)
    await db.commit()
    return {"log_id": log.id}
