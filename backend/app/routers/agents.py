"""Agents API router."""

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Project, ActivityLog, get_db
from app.websocket import manager, WebSocketEvent, EventType

router = APIRouter(prefix="/agents", tags=["agents"])


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


class StartAgentResponse(BaseModel):
    """Response from starting an agent."""
    success: bool
    message: str
    claude_code_available: bool


@router.post("/{agent_id}/start", response_model=StartAgentResponse)
async def start_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> StartAgentResponse:
    """
    Start an agent's Claude Code session.
    
    This initializes the agent to work on tasks using Claude Code CLI.
    """
    from app.services.agent_manager import get_agent_manager, check_claude_code_available
    
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    claude_available = check_claude_code_available()
    
    agent_manager = get_agent_manager()
    success = await agent_manager.start_agent(agent_id, agent.project_id)
    
    if success:
        return StartAgentResponse(
            success=True,
            message=f"{agent.name} is ready to work" + (
                "" if claude_available else " (Claude Code CLI not installed - code generation disabled)"
            ),
            claude_code_available=claude_available,
        )
    else:
        return StartAgentResponse(
            success=False,
            message=f"Failed to start {agent.name}",
            claude_code_available=claude_available,
        )


@router.post("/project/{project_id}/start-all", response_model=list[StartAgentResponse])
async def start_all_agents(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[StartAgentResponse]:
    """Start all agents in a project."""
    from app.services.agent_manager import get_agent_manager, check_claude_code_available
    
    # Get all agents for project
    result = await db.execute(select(Agent).where(Agent.project_id == project_id))
    agents = result.scalars().all()
    
    if not agents:
        raise HTTPException(status_code=404, detail="No agents found for project")
    
    claude_available = check_claude_code_available()
    agent_manager = get_agent_manager()
    responses = []
    
    for agent in agents:
        success = await agent_manager.start_agent(agent.id, project_id)
        responses.append(StartAgentResponse(
            success=success,
            message=f"{agent.name} is ready" if success else f"Failed to start {agent.name}",
            claude_code_available=claude_available,
        ))
    
    return responses


class CodeRequestBody(BaseModel):
    """Request body for executing code from chat."""
    request: str
    channel_id: str


class CodeResponse(BaseModel):
    """Response from code execution."""
    success: bool
    message: str
    response: str | None = None


@router.post("/{agent_id}/code", response_model=CodeResponse)
async def execute_code_request(
    agent_id: str,
    body: CodeRequestBody,
    db: AsyncSession = Depends(get_db),
) -> CodeResponse:
    """
    Execute a coding request for an agent.
    
    This allows triggering code generation from a chat message.
    The agent will have access to the full chat history for context,
    so any corrections or specific instructions from the user will be followed.
    """
    from app.services.agent_manager import get_agent_manager, check_claude_code_available
    
    # Verify agent exists
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Check if Claude Code is available
    if not check_claude_code_available():
        raise HTTPException(
            status_code=503,
            detail="Claude Code CLI is not installed. Please install it from https://claude.ai/code"
        )
    
    agent_manager = get_agent_manager()
    
    # Execute the request
    result = await agent_manager.execute_from_chat(
        agent_id=agent_id,
        request=body.request,
        channel_id=body.channel_id,
    )
    
    if result["success"]:
        return CodeResponse(
            success=True,
            message=f"{agent.name} completed the request",
            response=result.get("response"),
        )
    else:
        return CodeResponse(
            success=False,
            message=result.get("error", "Request failed"),
            response=None,
        )


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
    
    Returns all Claude Code activity logs for this agent,
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


class LiveOutputResponse(BaseModel):
    """Response for live Claude Code output."""
    agent_id: str
    agent_name: str
    status: str  # running, completed, timeout, error, idle
    output: str | None
    last_update: str | None
    started_at: str | None
    error: str | None = None


@router.get("/{agent_id}/live-output", response_model=LiveOutputResponse)
async def get_agent_live_output(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
) -> LiveOutputResponse:
    """
    Get live Claude Code output for an agent that's currently executing a task.
    
    This allows real-time monitoring of what the agent is doing.
    """
    from app.services.agent_manager import get_agent_manager
    
    # Get agent for name
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent_manager = get_agent_manager()
    if not agent_manager:
        return LiveOutputResponse(
            agent_id=agent_id,
            agent_name=agent.name,
            status="idle",
            output=None,
            last_update=None,
            started_at=None,
        )
    
    live_output = agent_manager.get_live_output(agent_id)
    
    if not live_output:
        # Check if agent is marked as "working" in DB but has no live output
        # This can happen if backend was restarted while agent was working
        if agent.status == "working":
            # This is a stale state - reset the agent
            agent.status = "idle"
            await db.commit()
            
            # Also try to reset any "in_progress" tasks for this agent
            from app.models import Task
            tasks_result = await db.execute(
                select(Task).where(
                    Task.assigned_to == agent_id,
                    Task.status == "in_progress"
                )
            )
            stale_tasks = tasks_result.scalars().all()
            for task in stale_tasks:
                task.status = "pending"
            if stale_tasks:
                await db.commit()
            
            return LiveOutputResponse(
                agent_id=agent_id,
                agent_name=agent.name,
                status="stale_reset",
                output=f"Agent was marked as 'working' but no execution was found.\n"
                       f"This can happen after a server restart.\n"
                       f"Agent status has been reset to 'idle'.\n"
                       f"Reset {len(stale_tasks)} stale task(s) to 'pending'.",
                last_update=None,
                started_at=None,
                error="Stale working state detected and reset",
            )
        
        return LiveOutputResponse(
            agent_id=agent_id,
            agent_name=agent.name,
            status="idle",
            output=None,
            last_update=None,
            started_at=None,
        )
    
    return LiveOutputResponse(
        agent_id=agent_id,
        agent_name=agent.name,
        status=live_output.get("status", "unknown"),
        output=live_output.get("output"),
        last_update=live_output.get("last_update"),
        started_at=live_output.get("started_at"),
        error=live_output.get("error"),
    )
