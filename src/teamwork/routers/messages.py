"""Messages API router — pure CRUD, no AI generation.

All intelligence (agent responses, task planning, status updates) comes from
the external agent (e.g. Prax) via the external API.  This router only handles
message persistence, retrieval, WebSocket broadcasting, and webhook forwarding.
"""

import logging
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.config import settings
from teamwork.models import Message, Channel, Agent, Project, Task, get_db, AsyncSessionLocal
from teamwork.websocket import manager, WebSocketEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/messages", tags=["messages"])


# ─── Schemas ──────────────────────────────────────────────────────────────────


class MessageCreate(BaseModel):
    """Schema for creating a message."""
    channel_id: str
    agent_id: str | None = None
    content: str
    message_type: str = "chat"
    extra_data: dict | None = None
    thread_id: str | None = None


class MessageResponse(BaseModel):
    """Schema for message response."""
    id: str
    channel_id: str
    agent_id: str | None
    agent_name: str | None
    agent_role: str | None
    content: str
    message_type: str
    extra_data: dict | None
    thread_id: str | None
    reply_count: int
    created_at: str
    updated_at: str | None

    class Config:
        from_attributes = True


class MessageListResponse(BaseModel):
    """Schema for list of messages."""
    messages: list[MessageResponse]
    total: int
    has_more: bool


# ─── Helpers ──────────────────────────────────────────────────────────────────


async def message_to_response(
    message: Message, db: AsyncSession, include_reply_count: bool = True
) -> MessageResponse:
    """Convert Message model to response schema."""
    agent_name = None
    agent_role = None

    if message.agent_id:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == message.agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            agent_name = agent.name
            agent_role = agent.role

    reply_count = 0
    if include_reply_count:
        reply_result = await db.execute(
            select(Message).where(Message.thread_id == message.id)
        )
        reply_count = len(reply_result.scalars().all())

    return MessageResponse(
        id=message.id,
        channel_id=message.channel_id,
        agent_id=message.agent_id,
        agent_name=agent_name,
        agent_role=agent_role,
        content=message.content,
        message_type=message.message_type,
        extra_data=message.extra_data,
        thread_id=message.thread_id,
        reply_count=reply_count,
        created_at=message.created_at.isoformat(),
        updated_at=message.updated_at.isoformat() if message.updated_at else None,
    )


async def _forward_to_external_webhook(
    webhook_url: str,
    project_id: str,
    channel_id: str,
    content: str,
    message_id: str,
):
    """Forward a user message to the external orchestrator's webhook."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(webhook_url, json={
                "project_id": project_id,
                "channel_id": channel_id,
                "content": content,
                "message_id": message_id,
                "type": "user_message",
            })
    except Exception as e:
        logger.error("Failed to forward message to webhook %s: %s", webhook_url, e)
        try:
            async with AsyncSessionLocal() as db:
                error_msg = Message(
                    channel_id=channel_id,
                    content=f"[System] Failed to reach external agent: {e}",
                    message_type="system",
                )
                db.add(error_msg)
                await db.flush()
                await db.refresh(error_msg)
                await db.commit()
                await manager.broadcast_to_channel(
                    channel_id,
                    WebSocketEvent(
                        type=EventType.MESSAGE_NEW,
                        data={
                            "id": error_msg.id,
                            "channel_id": channel_id,
                            "content": error_msg.content,
                            "message_type": "system",
                            "created_at": error_msg.created_at.isoformat(),
                        },
                    ),
                )
        except Exception:
            pass


async def _post_system_message(channel_id: str, content: str) -> None:
    """Post a system message to a channel and broadcast via WebSocket."""
    async with AsyncSessionLocal() as db:
        msg = Message(
            channel_id=channel_id,
            content=content,
            message_type="system",
        )
        db.add(msg)
        await db.flush()
        await db.refresh(msg)
        await db.commit()
        await manager.broadcast_to_channel(
            channel_id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": msg.id,
                    "channel_id": channel_id,
                    "content": msg.content,
                    "message_type": "system",
                    "created_at": msg.created_at.isoformat(),
                },
            ),
        )


# ─── Data aggregation (no AI — used by external agents via internal imports) ─


async def get_agent_real_work_status(db: AsyncSession, agent_id: str, project_id: str) -> dict:
    """Fetch the ACTUAL work status of an agent from database activity logs.

    Returns only verified, real data — no hallucination.  External agents can
    import this to gather context before generating responses.
    """
    from teamwork.models import ActivityLog, Task
    from pathlib import Path

    result: dict[str, Any] = {
        "has_any_activity": False,
        "current_task": None,
        "completed_tasks": [],
        "recent_activities": [],
        "files_created": [],
        "summary": "No work has been done yet.",
    }

    # Current assigned task
    task_result = await db.execute(
        select(Task)
        .where(Task.assigned_to == agent_id)
        .where(Task.status.in_(["pending", "in_progress"]))
        .order_by(Task.created_at.desc())
        .limit(1)
    )
    current_task = task_result.scalar_one_or_none()
    if current_task:
        result["current_task"] = {
            "title": current_task.title,
            "status": current_task.status,
            "description": current_task.description,
        }

    # Completed tasks
    completed_result = await db.execute(
        select(Task)
        .where(Task.assigned_to == agent_id)
        .where(Task.status == "completed")
        .order_by(Task.updated_at.desc())
        .limit(5)
    )
    completed_tasks = completed_result.scalars().all()
    result["completed_tasks"] = [{"title": t.title, "status": t.status} for t in completed_tasks]

    # Recent activity logs
    activity_result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.agent_id == agent_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(10)
    )
    activities = activity_result.scalars().all()

    if activities:
        result["has_any_activity"] = True
        result["recent_activities"] = [
            {
                "type": a.activity_type,
                "description": a.description,
                "when": a.created_at.isoformat(),
                "data": a.extra_data,
            }
            for a in activities
        ]

    # Workspace files
    from teamwork.utils.workspace import get_project_workspace_path
    workspace_path = await get_project_workspace_path(project_id, db)
    if workspace_path.exists():
        try:
            files = []
            for f in workspace_path.rglob("*"):
                if f.is_file() and not any(
                    p in str(f) for p in [".git", "__pycache__", "node_modules", ".venv"]
                ):
                    files.append(str(f.relative_to(workspace_path)))
            result["files_created"] = files[:20]
        except Exception:
            pass

    # Build summary from real data
    if result["has_any_activity"] or result["completed_tasks"] or result["files_created"]:
        parts = []
        if result["completed_tasks"]:
            parts.append(
                f"Completed {len(result['completed_tasks'])} task(s): "
                + ", ".join(t["title"] for t in result["completed_tasks"][:3])
            )
        if result["files_created"]:
            parts.append(f"Created {len(result['files_created'])} file(s)")
        if result["current_task"]:
            parts.append(
                f"Currently assigned: {result['current_task']['title']} "
                f"({result['current_task']['status']})"
            )
        result["summary"] = ". ".join(parts) if parts else "No significant work recorded."
    else:
        result["summary"] = (
            "No work has been done yet. No tasks completed, no files created, "
            "no activities recorded."
        )

    return result


async def get_project_task_board(db: AsyncSession, project_id: str) -> dict:
    """Get the full task board status for a project — pure DB read."""
    from teamwork.models import Task, Agent

    tasks_result = await db.execute(
        select(Task).where(Task.project_id == project_id).order_by(Task.created_at)
    )
    all_tasks = tasks_result.scalars().all()

    agents_result = await db.execute(select(Agent).where(Agent.project_id == project_id))
    agents = {a.id: a for a in agents_result.scalars().all()}

    todo_tasks, in_progress_tasks, blocked_tasks, completed_tasks = [], [], [], []

    for task in all_tasks:
        assignee_name = (
            agents[task.assigned_to].name
            if task.assigned_to and task.assigned_to in agents
            else "Unassigned"
        )
        task_info = {
            "id": task.id,
            "title": task.title,
            "description": (task.description or "")[:100],
            "assigned_to": assignee_name,
            "priority": task.priority,
            "team": task.team,
        }
        if task.status == "completed":
            completed_tasks.append(task_info)
        elif task.status == "blocked":
            task_info["blocked_by"] = task.blocked_by
            blocked_tasks.append(task_info)
        elif task.status == "in_progress":
            in_progress_tasks.append(task_info)
        else:
            blocked_by = task.blocked_by or []
            if blocked_by:
                is_blocked = False
                for blocker_id in blocked_by:
                    blocker_result = await db.execute(
                        select(Task).where(Task.id == blocker_id)
                    )
                    blocker = blocker_result.scalar_one_or_none()
                    if blocker and blocker.status != "completed":
                        is_blocked = True
                        break
                if is_blocked:
                    task_info["blocked_by"] = blocked_by
                    blocked_tasks.append(task_info)
                else:
                    todo_tasks.append(task_info)
            else:
                todo_tasks.append(task_info)

    agent_statuses = []
    for agent in agents.values():
        assigned = [t for t in all_tasks if t.assigned_to == agent.id]
        agent_statuses.append({
            "name": agent.name,
            "role": agent.role,
            "status": agent.status or "idle",
            "assigned_tasks": len(assigned),
            "completed_tasks": len([t for t in assigned if t.status == "completed"]),
        })

    return {
        "total_tasks": len(all_tasks),
        "todo_count": len(todo_tasks),
        "in_progress_count": len(in_progress_tasks),
        "blocked_count": len(blocked_tasks),
        "completed_count": len(completed_tasks),
        "todo_tasks": todo_tasks,
        "in_progress_tasks": in_progress_tasks,
        "blocked_tasks": blocked_tasks,
        "completed_tasks": completed_tasks[-5:],
        "agent_statuses": agent_statuses,
    }


# ─── Slash commands (CRUD only — /memorize, /memories) ───────────────────────


async def handle_memorize_command(channel_id: str, project_id: str, instruction: str):
    """Store a persistent instruction in the project config."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            if not project:
                return

            config = project.config or {}
            memories = config.get("memories", [])
            memories.append({
                "instruction": instruction,
                "added_at": datetime.utcnow().isoformat(),
                "channel_id": channel_id,
            })
            config["memories"] = memories
            project.config = config
            await db.commit()

            await _post_system_message(
                channel_id,
                f"\u2713 **Memorized!** I'll remember: \"{instruction}\"\n\n"
                "_This instruction will be included in all agent conversations. "
                "Use `/memories` to see all stored instructions._",
            )
    except Exception as e:
        logger.error("/memorize failed: %s", e)


async def handle_memories_command(channel_id: str, project_id: str):
    """Display all stored memories for a project."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            if not project:
                return

            config = project.config or {}
            memories = config.get("memories", [])

            if not memories:
                content = (
                    "No memories stored yet.\n\n"
                    "Use `/memorize <instruction>` to add persistent instructions "
                    "that all agents will follow."
                )
            else:
                content = f"**Stored Memories ({len(memories)})**\n\n"
                for i, memory in enumerate(memories, 1):
                    instruction = memory.get("instruction", "")
                    added_at = memory.get("added_at", "")[:10]
                    content += f"{i}. {instruction}\n   _Added: {added_at}_\n\n"
                content += "_Use `/memorize <instruction>` to add more._"

            await _post_system_message(channel_id, content)
    except Exception as e:
        logger.error("/memories failed: %s", e)


# ─── Route handlers ──────────────────────────────────────────────────────────


@router.get("/channel/{channel_id}", response_model=MessageListResponse)
async def list_channel_messages(
    channel_id: str,
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
    thread_id: str | None = None,
) -> MessageListResponse:
    """List messages in a channel."""
    channel_result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    query = select(Message).where(Message.channel_id == channel_id)
    if thread_id:
        query = query.where(Message.thread_id == thread_id)
    else:
        query = query.where(Message.thread_id.is_(None))

    count_result = await db.execute(query)
    total = len(count_result.scalars().all())

    result = await db.execute(
        query.order_by(Message.created_at.desc()).offset(skip).limit(limit + 1)
    )
    messages = list(result.scalars().all())

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]
    messages.reverse()

    return MessageListResponse(
        messages=[await message_to_response(m, db) for m in messages],
        total=total,
        has_more=has_more,
    )


@router.post("", response_model=MessageResponse, status_code=201)
async def create_message(
    message: MessageCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Create a new message.

    For external-mode projects, user messages are forwarded to the external
    agent's webhook.  The external agent responds by posting back via the
    external API.  No AI generation happens here.
    """
    # Verify channel
    channel_result = await db.execute(select(Channel).where(Channel.id == message.channel_id))
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # Verify agent
    agent_name = "User"
    if message.agent_id:
        agent_result = await db.execute(select(Agent).where(Agent.id == message.agent_id))
        agent = agent_result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent_name = agent.name

    # Verify thread
    if message.thread_id:
        thread_result = await db.execute(
            select(Message).where(Message.id == message.thread_id)
        )
        if not thread_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Thread not found")

    # Persist
    db_message = Message(
        channel_id=message.channel_id,
        agent_id=message.agent_id,
        content=message.content,
        message_type=message.message_type,
        extra_data=message.extra_data,
        thread_id=message.thread_id,
    )
    db.add(db_message)
    await db.flush()
    await db.refresh(db_message)
    await db.commit()

    response = await message_to_response(db_message, db)

    # Broadcast
    await manager.broadcast_to_channel(
        message.channel_id,
        WebSocketEvent(
            type=EventType.MESSAGE_NEW,
            data={
                "id": db_message.id,
                "channel_id": db_message.channel_id,
                "agent_id": db_message.agent_id,
                "agent_name": agent_name,
                "content": db_message.content,
                "message_type": db_message.message_type,
                "thread_id": db_message.thread_id,
                "created_at": db_message.created_at.isoformat(),
            },
        ),
    )

    # Handle user messages (not from an agent)
    if message.agent_id is None:
        project_result = await db.execute(
            select(Project).where(Project.id == channel.project_id)
        )
        project = project_result.scalar_one_or_none()

        # External mode → forward to webhook
        if project and (project.config or {}).get("project_type") == "external":
            webhook_url = (project.config or {}).get("webhook_url")
            if webhook_url:
                background_tasks.add_task(
                    _forward_to_external_webhook,
                    webhook_url,
                    project.id,
                    message.channel_id,
                    message.content,
                    db_message.id,
                )

        # Handle CRUD-only slash commands
        content_lower = message.content.strip().lower()
        if content_lower.startswith("/memorize "):
            instruction = message.content.strip()[10:].strip()
            if instruction:
                background_tasks.add_task(
                    handle_memorize_command,
                    message.channel_id,
                    channel.project_id,
                    instruction,
                )
        elif content_lower.startswith("/memories"):
            background_tasks.add_task(
                handle_memories_command,
                message.channel_id,
                channel.project_id,
            )

    return response


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Get a message by ID."""
    result = await db.execute(select(Message).where(Message.id == message_id))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return await message_to_response(message, db)


@router.get("/{message_id}/thread", response_model=MessageListResponse)
async def get_thread_replies(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
) -> MessageListResponse:
    """Get replies in a thread."""
    parent_result = await db.execute(select(Message).where(Message.id == message_id))
    if not parent_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Message not found")

    query = select(Message).where(Message.thread_id == message_id)

    count_result = await db.execute(query)
    total = len(count_result.scalars().all())

    result = await db.execute(
        query.order_by(Message.created_at).offset(skip).limit(limit + 1)
    )
    messages = list(result.scalars().all())

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    return MessageListResponse(
        messages=[
            await message_to_response(m, db, include_reply_count=False)
            for m in messages
        ],
        total=total,
        has_more=has_more,
    )


@router.delete("/{message_id}", status_code=204)
async def delete_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a message."""
    result = await db.execute(select(Message).where(Message.id == message_id))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.delete(message)
