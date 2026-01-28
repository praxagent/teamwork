"""Agents API router."""

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
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


class LiveSessionsResponse(BaseModel):
    """Response for all live sessions in a project."""
    sessions: list[LiveOutputResponse]
    total_active: int


@router.get("/project/{project_id}/live-sessions", response_model=LiveSessionsResponse)
async def get_project_live_sessions(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> LiveSessionsResponse:
    """
    Get all live Claude Code sessions for agents in a project.
    
    This allows monitoring all running agent sessions in one place,
    like switching between terminal tabs.
    """
    from app.services.agent_manager import get_agent_manager
    
    # Get all agents in this project
    agents_result = await db.execute(
        select(Agent).where(Agent.project_id == project_id)
    )
    agents = agents_result.scalars().all()
    
    agent_manager = get_agent_manager()
    if not agent_manager:
        return LiveSessionsResponse(sessions=[], total_active=0)
    
    sessions = []
    for agent in agents:
        live_output = agent_manager.get_live_output(agent.id)
        
        if live_output:
            status = live_output.get("status", "unknown")
            # Only include sessions that are active or recently completed
            if status not in ["idle"]:
                sessions.append(LiveOutputResponse(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    status=status,
                    output=live_output.get("output"),
                    last_update=live_output.get("last_update"),
                    started_at=live_output.get("started_at"),
                    error=live_output.get("error"),
                ))
        elif agent.status == "working":
            # Agent marked as working but no live output - include with special status
            sessions.append(LiveOutputResponse(
                agent_id=agent.id,
                agent_name=agent.name,
                status="initializing",
                output="Agent is starting up...",
                last_update=None,
                started_at=None,
                error=None,
            ))
    
    # Sort by status (running first, then by last_update)
    def sort_key(s: LiveOutputResponse) -> tuple:
        status_order = {
            "running": 0,
            "invoking": 1,
            "preparing": 2,
            "initializing": 3,
            "completed": 4,
            "stopped": 5,
            "failed": 6,
            "retry_loop": 7,
            "startup_failed": 8,
            "error": 9,
            "timeout": 10,
        }
        return (status_order.get(s.status, 99), s.last_update or "")
    
    sessions.sort(key=sort_key)
    
    return LiveSessionsResponse(
        sessions=sessions,
        total_active=len([s for s in sessions if s.status in ["running", "invoking", "preparing", "initializing"]]),
    )


@router.websocket("/{agent_id}/terminal")
async def agent_terminal_websocket(
    websocket: WebSocket,
    agent_id: str,
):
    """
    WebSocket endpoint to attach to an agent's terminal session.
    
    This allows:
    - Real-time streaming of Claude Code output
    - Sending input to take over the session (optional)
    
    Send text messages to provide input to the terminal.
    """
    from app.services.agent_manager import get_agent_manager
    from starlette.websockets import WebSocketDisconnect
    
    await websocket.accept()
    
    agent_manager = get_agent_manager()
    terminal = agent_manager.get_agent_terminal(agent_id)
    
    try:
        if not terminal:
            # No active terminal - send current output if available
            live_output = agent_manager.get_live_output(agent_id)
            if live_output and live_output.get("output"):
                await websocket.send_text(live_output["output"])
                await websocket.send_text("\n[No active terminal session]\n")
            else:
                await websocket.send_text("[No active terminal session for this agent]\n")
            await websocket.close()
            return
        
        # Send existing parsed output (not raw terminal buffer which is JSON)
        live_output = agent_manager.get_live_output(agent_id)
        if live_output and live_output.get("output"):
            await websocket.send_text(live_output["output"])
        
        # Attach to terminal for live updates
        agent_manager.attach_websocket_to_terminal(agent_id, websocket)
    except WebSocketDisconnect:
        # Client disconnected before we could send - this is normal
        print(f">>> Terminal WebSocket client disconnected early for agent {agent_id}", flush=True)
        return
    except Exception as e:
        # Handle any other send errors gracefully
        print(f">>> Terminal WebSocket send error for agent {agent_id}: {e}", flush=True)
        return
    
    try:
        # Handle incoming messages (user input for takeover)
        print(f">>> Terminal WebSocket ready for input from agent {agent_id}", flush=True)
        while True:
            try:
                data = await websocket.receive()
                
                if "text" in data:
                    text = data["text"]
                    print(f">>> Terminal WS received text: {repr(text[:50]) if len(text) > 50 else repr(text)}", flush=True)
                    # Send to terminal
                    agent_manager.send_to_agent_terminal(agent_id, text.encode('utf-8'))
                elif "bytes" in data:
                    # Binary input - pass through directly
                    bytes_data = data["bytes"]
                    print(f">>> Terminal WS received bytes: {len(bytes_data)} bytes", flush=True)
                    agent_manager.send_to_agent_terminal(agent_id, bytes_data)
                elif "type" in data and data["type"] == "websocket.disconnect":
                    print(f">>> Terminal WebSocket disconnected for agent {agent_id}", flush=True)
                    break
                    
            except Exception as e:
                print(f">>> Terminal WebSocket error for agent {agent_id}: {e}", flush=True)
                break
    finally:
        agent_manager.detach_websocket_from_terminal(agent_id, websocket)
        print(f">>> Terminal WebSocket closed for agent {agent_id}", flush=True)


@router.post("/{agent_id}/terminal/input")
async def send_terminal_input(
    agent_id: str,
    input_data: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Send input to an agent's terminal (for takeover).
    
    This allows interrupting or guiding the agent's Claude Code session.
    """
    from app.services.agent_manager import get_agent_manager
    
    agent_manager = get_agent_manager()
    
    success = agent_manager.send_to_agent_terminal(agent_id, input_data.encode('utf-8'))
    
    if not success:
        raise HTTPException(status_code=404, detail="No active terminal for this agent")
    
    return {"success": True, "message": "Input sent to terminal"}


class TakeoverResponse(BaseModel):
    """Response for takeover endpoint."""
    success: bool
    message: str
    container_name: str | None = None
    workspace_path: str | None = None


@router.post("/{agent_id}/takeover")
async def takeover_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Take over an agent's session.
    
    This:
    1. Pauses the agent's current task (if any)
    2. Returns container info for starting an interactive terminal
    
    The frontend can then open a terminal WebSocket to the container.
    """
    from app.services.agent_manager import get_agent_manager
    from app.config import settings
    
    # Get agent from DB
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent_manager = get_agent_manager()
    
    # Pause the agent (this kills the current Claude process)
    await agent_manager.pause_agent(agent_id, db)
    
    # Get workspace path
    from app.models import Project
    project_result = await db.execute(
        select(Project).where(Project.id == agent.project_id)
    )
    project = project_result.scalar_one_or_none()
    
    workspace_dir = None
    if project:
        workspace_dir = project.workspace_dir or project.get_workspace_dir_name()
        workspace_path = str(settings.workspace_path / workspace_dir) if workspace_dir else None
    else:
        workspace_path = None
    
    # Container name for this project (used by terminal router)
    container_name = f"vteam-terminal-{agent.project_id[:8]}"
    
    return TakeoverResponse(
        success=True,
        message=f"Agent {agent.name} paused. You can now open an interactive terminal.",
        container_name=container_name,
        workspace_path=workspace_path,
    )


@router.post("/{agent_id}/release")
async def release_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Release control back to the agent after takeover.
    
    This resumes the agent so it can pick up pending tasks.
    """
    from app.services.agent_manager import get_agent_manager
    
    # Get agent from DB
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent_manager = get_agent_manager()
    
    # Resume the agent
    await agent_manager.resume_agent(agent_id, db)
    
    return {
        "success": True,
        "message": f"Control released. Agent {agent.name} will resume working.",
    }


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
    from app.config import settings
    
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
    from pathlib import Path
    
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
