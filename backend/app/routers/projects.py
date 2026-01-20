"""Projects API router."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Project, Task, Agent, get_db

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    """Schema for creating a project."""

    name: str
    description: str | None = None
    config: dict | None = None


class ProjectResponse(BaseModel):
    """Schema for project response."""

    id: str
    name: str
    description: str | None
    config: dict | None
    status: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    """Schema for list of projects."""

    projects: list[ProjectResponse]
    total: int


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 20,
) -> ProjectListResponse:
    """List all projects."""
    result = await db.execute(
        select(Project).offset(skip).limit(limit).order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    count_result = await db.execute(select(Project))
    total = len(count_result.scalars().all())

    return ProjectListResponse(
        projects=[
            ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                config=p.config,
                status=p.status,
                created_at=p.created_at.isoformat(),
                updated_at=p.updated_at.isoformat(),
            )
            for p in projects
        ],
        total=total,
    )


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    project: ProjectCreate,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Create a new project."""
    db_project = Project(
        name=project.name,
        description=project.description,
        config=project.config,
    )
    db.add(db_project)
    await db.flush()
    await db.refresh(db_project)

    return ProjectResponse(
        id=db_project.id,
        name=db_project.name,
        description=db_project.description,
        config=db_project.config,
        status=db_project.status,
        created_at=db_project.created_at.isoformat(),
        updated_at=db_project.updated_at.isoformat(),
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Get a project by ID."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        config=project.config,
        status=project.status,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


class ProjectUpdate(BaseModel):
    """Schema for updating a project."""
    name: str | None = None
    description: str | None = None
    config: dict | None = None


class ProjectConfigUpdate(BaseModel):
    """Schema for updating specific project config values."""
    auto_execute_tasks: bool | None = None
    runtime_mode: str | None = None
    workspace_type: str | None = None


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    update: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Update a project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if update.name is not None:
        project.name = update.name
    if update.description is not None:
        project.description = update.description
    if update.config is not None:
        # Merge config instead of replace
        existing_config = project.config or {}
        existing_config.update(update.config)
        project.config = existing_config

    await db.flush()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        config=project.config,
        status=project.status,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


@router.patch("/{project_id}/config", response_model=ProjectResponse)
async def update_project_config(
    project_id: str,
    config_update: ProjectConfigUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Update specific project configuration values."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get existing config or create new
    config = project.config or {}
    
    # Update only provided values
    if config_update.auto_execute_tasks is not None:
        config["auto_execute_tasks"] = config_update.auto_execute_tasks
    if config_update.runtime_mode is not None:
        config["runtime_mode"] = config_update.runtime_mode
    if config_update.workspace_type is not None:
        config["workspace_type"] = config_update.workspace_type
    
    project.config = config
    await db.flush()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        config=project.config,
        status=project.status,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


class PauseResumeResponse(BaseModel):
    """Response for pause/resume operations."""
    success: bool
    status: str
    agents_affected: int
    message: str


@router.post("/{project_id}/pause", response_model=PauseResumeResponse)
async def pause_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> PauseResumeResponse:
    """
    Pause a project - stops all running agents immediately.
    Tasks in progress will be saved and can be resumed later.
    """
    from app.models import Agent
    
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all agents for this project
    agents_result = await db.execute(select(Agent).where(Agent.project_id == project_id))
    agents = agents_result.scalars().all()
    
    agents_stopped = 0
    
    # Try to stop running agents if agent manager is available
    try:
        from app.services.agent_manager import get_agent_manager
        agent_manager = get_agent_manager()
        
        for agent in agents:
            if agent.id in agent_manager.get_all_running_agents():
                await agent_manager.stop_agent(agent.id)
                agents_stopped += 1
    except RuntimeError:
        # Agent manager not initialized - that's OK, just update statuses
        pass
    
    # Mark all agents as paused
    for agent in agents:
        agent.status = "paused"
    
    # Update project status and config
    project.status = "paused"
    config = project.config or {}
    config["paused"] = True
    config["paused_at"] = datetime.utcnow().isoformat()
    project.config = config
    
    await db.commit()
    
    return PauseResumeResponse(
        success=True,
        status="paused",
        agents_affected=agents_stopped,
        message=f"Project paused. {agents_stopped} agent(s) stopped. All agents marked as paused.",
    )


@router.post("/{project_id}/resume", response_model=PauseResumeResponse)
async def resume_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> PauseResumeResponse:
    """
    Resume a paused project - agents can start working again.
    Does not automatically restart tasks, but allows new tasks to execute.
    """
    from app.models import Agent, Task
    
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all agents for this project
    agents_result = await db.execute(select(Agent).where(Agent.project_id == project_id))
    agents = agents_result.scalars().all()
    
    # Reset agent status from paused to idle
    agents_resumed = 0
    for agent in agents:
        if agent.status == "paused":
            agent.status = "idle"
            agents_resumed += 1
    
    # Update project status
    project.status = "active"
    config = project.config or {}
    config["paused"] = False
    if "paused_at" in config:
        del config["paused_at"]
    project.config = config
    
    await db.commit()
    
    # Count in-progress tasks that can be resumed
    tasks_result = await db.execute(
        select(Task).where(
            Task.project_id == project_id,
            Task.status == "in_progress"
        )
    )
    pending_tasks = len(tasks_result.scalars().all())
    
    message = f"Project resumed. {agents_resumed} agent(s) ready to work."
    if pending_tasks > 0:
        message += f" {pending_tasks} task(s) in progress can be restarted from the task board."
    
    return PauseResumeResponse(
        success=True,
        status="active",
        agents_affected=agents_resumed,
        message=message,
    )


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Delete a project completely.
    
    This removes:
    - The project from the database
    - All agents, channels, tasks, messages (via cascade)
    - All activity logs for the project's agents
    - All Docker containers for the project's agents
    - The workspace directory and all files
    """
    import subprocess
    import shutil
    from pathlib import Path
    from app.config import settings
    from app.models import Agent
    from app.models.activity import ActivityLog
    
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all agents for this project to clean up their resources
    agents_result = await db.execute(select(Agent).where(Agent.project_id == project_id))
    agents = agents_result.scalars().all()
    agent_ids = [a.id for a in agents]
    
    # 1. Stop and remove Docker containers for each agent
    for agent in agents:
        container_names = [
            f"vteam-agent-{agent.id}",
            f"vteam-terminal-{agent.id[:8]}",
        ]
        for container_name in container_names:
            try:
                subprocess.run(
                    ["docker", "rm", "-f", container_name],
                    capture_output=True,
                    timeout=10
                )
            except Exception:
                pass  # Container might not exist
    
    # 2. Clean up temp config files for agents
    for agent in agents:
        try:
            config_path = Path(f"/tmp/claude_config_{agent.id}.json")
            if config_path.exists():
                config_path.unlink()
        except Exception:
            pass
    
    # 3. Delete activity logs for these agents
    if agent_ids:
        activities_result = await db.execute(
            select(ActivityLog).where(ActivityLog.agent_id.in_(agent_ids))
        )
        activities = activities_result.scalars().all()
        for activity in activities:
            await db.delete(activity)
    
    # 4. Delete workspace directory
    if project.workspace_dir:
        workspace_path = Path(settings.workspace_root) / project.workspace_dir
        if workspace_path.exists() and workspace_path.is_dir():
            try:
                shutil.rmtree(workspace_path)
            except Exception as e:
                print(f"Warning: Could not delete workspace {workspace_path}: {e}")
    
    # 5. Delete the project (cascades to agents, channels, tasks, messages)
    await db.delete(project)
    await db.commit()


class ResetResponse(BaseModel):
    """Response for project reset."""
    success: bool
    message: str
    tasks_reset: int
    activities_cleared: int
    messages_cleared: int


@router.post("/{project_id}/reset", response_model=ResetResponse)
async def reset_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ResetResponse:
    """
    Reset a project to initial state.
    
    This clears:
    - All task progress (moves tasks back to pending)
    - Agent activity logs
    - Chat messages in all channels
    - Docker containers for agents
    - Workspace files (keeps .git for history)
    
    But keeps:
    - The project itself
    - Team members (agents)
    - Task definitions
    - Channels (but empties them)
    """
    from app.models import ActivityLog, Channel, Message
    import subprocess
    import shutil
    from pathlib import Path
    from app.config import settings
    
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all agents for this project first (needed for Docker cleanup)
    agents_result = await db.execute(select(Agent).where(Agent.project_id == project_id))
    agents = agents_result.scalars().all()
    agent_ids = [a.id for a in agents]
    
    # Stop and remove Docker containers for each agent
    containers_stopped = 0
    for agent in agents:
        container_names = [
            f"vteam-agent-{agent.id}",
            f"vteam-terminal-{agent.id[:8]}",
        ]
        for container_name in container_names:
            try:
                result_docker = subprocess.run(
                    ["docker", "rm", "-f", container_name],
                    capture_output=True,
                    timeout=10
                )
                if result_docker.returncode == 0:
                    containers_stopped += 1
            except Exception:
                pass  # Container might not exist
        
        # Clean up temp config files
        try:
            config_path = Path(f"/tmp/claude_config_{agent.id}.json")
            if config_path.exists():
                config_path.unlink()
        except Exception:
            pass
    
    if containers_stopped > 0:
        print(f">>> Reset: Stopped {containers_stopped} Docker containers", flush=True)
    
    # Reset ALL tasks to pending (regardless of current status)
    tasks_result = await db.execute(select(Task).where(Task.project_id == project_id))
    tasks = tasks_result.scalars().all()
    tasks_reset = 0
    for task in tasks:
        old_status = task.status
        task.status = "pending"
        task.assigned_to = None
        task.retry_count = 0
        task.last_error = None
        task.start_commit = None
        task.end_commit = None
        tasks_reset += 1
        print(f">>> Reset task: '{task.title}' {old_status} -> pending", flush=True)
    
    # Clear activity logs for these agents
    activities_cleared = 0
    if agent_ids:
        activities_result = await db.execute(
            select(ActivityLog).where(ActivityLog.agent_id.in_(agent_ids))
        )
        activities = activities_result.scalars().all()
        activities_cleared = len(activities)
        for activity in activities:
            await db.delete(activity)
    
    # Clear all messages in all channels
    channels_result = await db.execute(select(Channel).where(Channel.project_id == project_id))
    channels = channels_result.scalars().all()
    print(f">>> Reset: Found {len(channels)} channels to clear", flush=True)
    messages_cleared = 0
    for channel in channels:
        messages_result = await db.execute(select(Message).where(Message.channel_id == channel.id))
        messages = messages_result.scalars().all()
        print(f">>> Reset: Channel '{channel.name}' has {len(messages)} messages to delete", flush=True)
        messages_cleared += len(messages)
        for message in messages:
            await db.delete(message)
    print(f">>> Reset: Deleted {messages_cleared} messages total", flush=True)
    
    # Reset agent status
    for agent in agents:
        agent.status = "idle"
    
    # Clear workspace directory (use project.workspace_dir, not config)
    workspace_dir_name = project.workspace_dir or project.get_workspace_dir_name()
    if workspace_dir_name:
        workspace_path = settings.workspace_path / workspace_dir_name
        if workspace_path.exists() and workspace_path.is_dir():
            print(f">>> Reset: Clearing workspace {workspace_path}", flush=True)
            # Don't delete, just clear contents (keep .git for history)
            for item in workspace_path.iterdir():
                if item.name not in [".git"]:  # Keep git history
                    try:
                        if item.is_dir():
                            shutil.rmtree(item)
                        else:
                            item.unlink()
                    except Exception as e:
                        print(f">>> Reset: Could not delete {item}: {e}", flush=True)
    
    # Make sure project is not paused so tasks can be picked up
    project.status = "active"
    if project.config:
        project.config = {**project.config, "paused": False}
    print(f">>> Reset: Project status set to active", flush=True)
    
    await db.commit()
    
    print(f">>> Reset complete: {tasks_reset} tasks, {messages_cleared} messages, {activities_cleared} activities cleared", flush=True)
    
    return ResetResponse(
        success=True,
        message=f"Project reset. {tasks_reset} tasks reset, {messages_cleared} messages cleared.",
        tasks_reset=tasks_reset,
        activities_cleared=activities_cleared,
        messages_cleared=messages_cleared,
    )
