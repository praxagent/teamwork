"""Tasks API router."""

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, Project, Agent, get_db
from app.websocket import manager, WebSocketEvent, EventType

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    """Schema for creating a task."""

    project_id: str
    title: str
    description: str | None = None
    team: str | None = None
    assigned_to: str | None = None
    priority: int = 0
    parent_task_id: str | None = None
    blocked_by: list[str] = []  # List of task IDs this task depends on


class TaskUpdate(BaseModel):
    """Schema for updating a task."""

    title: str | None = None
    description: str | None = None
    team: str | None = None
    assigned_to: str | None = None
    status: str | None = None
    priority: int | None = None
    blocked_by: list[str] | None = None  # List of task IDs this task depends on


class TaskResponse(BaseModel):
    """Schema for task response."""

    id: str
    project_id: str
    title: str
    description: str | None
    team: str | None
    assigned_to: str | None
    assigned_agent_name: str | None
    status: str
    priority: int
    parent_task_id: str | None
    subtask_count: int
    blocked_by: list[str]  # Task IDs this task depends on
    blocked_by_titles: list[str]  # Human-readable titles of blocking tasks
    is_blocked: bool  # True if any blocker is not completed
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    """Schema for list of tasks."""

    tasks: list[TaskResponse]
    total: int


async def task_to_response(task: Task, db: AsyncSession) -> TaskResponse:
    """Convert Task model to response schema."""
    assigned_agent_name = None
    if task.assigned_to:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == task.assigned_to)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            assigned_agent_name = agent.name

    # Count subtasks
    subtask_result = await db.execute(
        select(Task).where(Task.parent_task_id == task.id)
    )
    subtask_count = len(subtask_result.scalars().all())

    # Get blocker information
    blocked_by = task.blocked_by
    blocked_by_titles = []
    is_blocked = False
    
    if blocked_by:
        for blocker_id in blocked_by:
            blocker_result = await db.execute(
                select(Task).where(Task.id == blocker_id)
            )
            blocker = blocker_result.scalar_one_or_none()
            if blocker:
                blocked_by_titles.append(blocker.title)
                if blocker.status != "completed":
                    is_blocked = True

    return TaskResponse(
        id=task.id,
        project_id=task.project_id,
        title=task.title,
        description=task.description,
        team=task.team,
        assigned_to=task.assigned_to,
        assigned_agent_name=assigned_agent_name,
        status=task.status,
        priority=task.priority,
        parent_task_id=task.parent_task_id,
        subtask_count=subtask_count,
        blocked_by=blocked_by,
        blocked_by_titles=blocked_by_titles,
        is_blocked=is_blocked,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    db: AsyncSession = Depends(get_db),
    project_id: str | None = None,
    team: str | None = None,
    status: str | None = None,
    assigned_to: str | None = None,
    parent_only: bool = True,
) -> TaskListResponse:
    """List tasks, optionally filtered."""
    query = select(Task)

    if project_id:
        query = query.where(Task.project_id == project_id)
    if team:
        query = query.where(Task.team == team)
    if status:
        query = query.where(Task.status == status)
    if assigned_to:
        query = query.where(Task.assigned_to == assigned_to)
    if parent_only:
        query = query.where(Task.parent_task_id.is_(None))

    result = await db.execute(query.order_by(Task.priority.desc(), Task.created_at))
    tasks = result.scalars().all()

    return TaskListResponse(
        tasks=[await task_to_response(t, db) for t in tasks],
        total=len(tasks),
    )


async def auto_execute_task(task_id: str, project_id: str, assigned_to: str | None):
    """Background task to auto-execute a task."""
    from app.services.agent_manager import get_agent_manager, check_claude_code_available
    from app.models.base import AsyncSessionLocal
    
    if not check_claude_code_available():
        return
    
    # Small delay to let the transaction commit
    await asyncio.sleep(1)
    
    async with AsyncSessionLocal() as db:
        # Get project and check config
        project_result = await db.execute(select(Project).where(Project.id == project_id))
        project = project_result.scalar_one_or_none()
        
        if not project:
            return
        
        config = project.config or {}
        
        # Check if project is paused
        if config.get("paused", False) or project.status == "paused":
            print(f">>> Project is paused, not auto-executing task {task_id}", flush=True)
            return
        
        # Default to True for auto-execute (autonomous mode)
        if not config.get("auto_execute_tasks", True):
            return
        
        # Get or find an agent
        agent_id = assigned_to
        if not agent_id:
            # Find a developer agent
            agents_result = await db.execute(
                select(Agent).where(Agent.project_id == project_id)
            )
            agents = agents_result.scalars().all()
            
            # Prefer developers
            for agent in agents:
                role = (agent.role or "").lower()
                if "developer" in role or "engineer" in role or "dev" in role:
                    agent_id = agent.id
                    break
            
            # Fall back to any agent
            if not agent_id and agents:
                agent_id = agents[0].id
        
        if not agent_id:
            return
        
        # Start the agent and execute the task
        agent_manager = get_agent_manager()
        await agent_manager.start_agent(agent_id, project_id)
        await agent_manager.execute_task(agent_id, task_id)


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    task: TaskCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    """Create a new task."""
    # Verify project exists and get config
    project_result = await db.execute(
        select(Project).where(Project.id == task.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify agent exists if assigned
    if task.assigned_to:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == task.assigned_to)
        )
        if not agent_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Assigned agent not found")

    # Verify parent task exists if specified
    if task.parent_task_id:
        parent_result = await db.execute(
            select(Task).where(Task.id == task.parent_task_id)
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Parent task not found")

    # Set initial status - if task has blockers that aren't completed, mark as blocked
    initial_status = "pending"
    if task.blocked_by:
        # Check if any blockers are not completed
        for blocker_id in task.blocked_by:
            blocker_result = await db.execute(
                select(Task).where(Task.id == blocker_id)
            )
            blocker = blocker_result.scalar_one_or_none()
            if blocker and blocker.status != "completed":
                initial_status = "blocked"
                break
    
    db_task = Task(
        project_id=task.project_id,
        title=task.title,
        description=task.description,
        team=task.team,
        assigned_to=task.assigned_to,
        priority=task.priority,
        parent_task_id=task.parent_task_id,
        status=initial_status,
    )
    db_task.blocked_by = task.blocked_by
    db.add(db_task)
    await db.flush()
    await db.refresh(db_task)

    response = await task_to_response(db_task, db)

    # Broadcast task creation
    await manager.broadcast_to_project(
        task.project_id,
        WebSocketEvent(
            type=EventType.TASK_NEW,
            data={
                "id": db_task.id,
                "title": db_task.title,
                "team": db_task.team,
                "status": db_task.status,
            },
        ),
    )

    # Check if auto-execute is enabled (defaults to True for autonomous mode)
    config = project.config or {}
    if config.get("auto_execute_tasks", True):
        background_tasks.add_task(
            auto_execute_task,
            db_task.id,
            task.project_id,
            task.assigned_to,
        )

    return response


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    """Get a task by ID."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return await task_to_response(task, db)


@router.get("/{task_id}/subtasks", response_model=TaskListResponse)
async def get_subtasks(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> TaskListResponse:
    """Get subtasks of a task."""
    # Verify parent task exists
    parent_result = await db.execute(select(Task).where(Task.id == task_id))
    if not parent_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(Task)
        .where(Task.parent_task_id == task_id)
        .order_by(Task.priority.desc(), Task.created_at)
    )
    tasks = result.scalars().all()

    return TaskListResponse(
        tasks=[await task_to_response(t, db) for t in tasks],
        total=len(tasks),
    )


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    update: TaskUpdate,
    db: AsyncSession = Depends(get_db),
) -> TaskResponse:
    """Update a task."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Update fields if provided
    if update.title is not None:
        task.title = update.title
    if update.description is not None:
        task.description = update.description
    if update.team is not None:
        task.team = update.team
    if update.assigned_to is not None:
        # Verify agent exists
        agent_result = await db.execute(
            select(Agent).where(Agent.id == update.assigned_to)
        )
        if not agent_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Assigned agent not found")
        task.assigned_to = update.assigned_to
    if update.status is not None:
        old_status = task.status
        task.status = update.status
        
        # If task is moved back from in_progress, update the agent's status to idle
        if old_status == "in_progress" and update.status in ["pending", "blocked"]:
            if task.assigned_to:
                agent_result = await db.execute(
                    select(Agent).where(Agent.id == task.assigned_to)
                )
                agent = agent_result.scalar_one_or_none()
                if agent and agent.status == "working":
                    agent.status = "idle"
                    # Broadcast agent status update
                    await manager.broadcast_to_project(
                        task.project_id,
                        WebSocketEvent(
                            type=EventType.AGENT_STATUS,
                            data={
                                "agent_id": agent.id,
                                "status": "idle",
                            },
                        ),
                    )
    if update.priority is not None:
        task.priority = update.priority
    if update.blocked_by is not None:
        task.blocked_by = update.blocked_by
        # Update status based on blockers
        if update.status is None:  # Only auto-update status if not explicitly set
            is_blocked = False
            for blocker_id in update.blocked_by:
                blocker_result = await db.execute(
                    select(Task).where(Task.id == blocker_id)
                )
                blocker = blocker_result.scalar_one_or_none()
                if blocker and blocker.status != "completed":
                    is_blocked = True
                    break
            if is_blocked and task.status == "pending":
                task.status = "blocked"
            elif not is_blocked and task.status == "blocked":
                task.status = "pending"

    task.updated_at = datetime.utcnow()
    await db.flush()

    # If task was completed, unblock any tasks that were waiting on it
    if update.status == "completed":
        await unblock_dependent_tasks(db, task.id, task.project_id)

    response = await task_to_response(task, db)

    # Broadcast task update
    await manager.broadcast_to_project(
        task.project_id,
        WebSocketEvent(
            type=EventType.TASK_UPDATE,
            data={
                "id": task.id,
                "title": task.title,
                "team": task.team,
                "status": task.status,
                "assigned_to": task.assigned_to,
            },
        ),
    )

    return response


async def unblock_dependent_tasks(db: AsyncSession, completed_task_id: str, project_id: str) -> list[str]:
    """
    Find and unblock tasks that were waiting on the completed task.
    Returns list of task IDs that were unblocked.
    """
    unblocked_ids = []
    
    # Find all tasks in this project that have blockers
    tasks_result = await db.execute(
        select(Task).where(
            Task.project_id == project_id,
            Task.status == "blocked"
        )
    )
    blocked_tasks = tasks_result.scalars().all()
    
    for task in blocked_tasks:
        blocked_by = task.blocked_by
        if completed_task_id not in blocked_by:
            continue
            
        # Check if all blockers are now completed
        all_blockers_done = True
        for blocker_id in blocked_by:
            blocker_result = await db.execute(
                select(Task).where(Task.id == blocker_id)
            )
            blocker = blocker_result.scalar_one_or_none()
            if blocker and blocker.status != "completed":
                all_blockers_done = False
                break
        
        if all_blockers_done:
            task.status = "pending"
            task.updated_at = datetime.utcnow()
            unblocked_ids.append(task.id)
            
            # Broadcast the unblock
            await manager.broadcast_to_project(
                project_id,
                WebSocketEvent(
                    type=EventType.TASK_UPDATE,
                    data={
                        "id": task.id,
                        "title": task.title,
                        "status": "pending",
                        "message": "Task unblocked - dependencies completed",
                    },
                ),
            )
    
    await db.flush()
    return unblocked_ids


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a task."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(task)


class ExecuteTaskRequest(BaseModel):
    """Request to execute a task."""
    agent_id: str


class ExecuteTaskResponse(BaseModel):
    """Response from task execution."""
    success: bool
    message: str
    response: str | None = None


@router.post("/{task_id}/execute", response_model=ExecuteTaskResponse)
async def execute_task(
    task_id: str,
    request: ExecuteTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ExecuteTaskResponse:
    """
    Execute a task using Claude Code.
    
    This will have the specified agent work on the task,
    writing actual code to the workspace.
    """
    from app.services.agent_manager import get_agent_manager, check_claude_code_available
    
    # Verify task exists
    task_result = await db.execute(select(Task).where(Task.id == task_id))
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Verify agent exists
    agent_result = await db.execute(select(Agent).where(Agent.id == request.agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Check if Claude Code is available
    if not check_claude_code_available():
        raise HTTPException(
            status_code=503,
            detail="Claude Code CLI is not installed. Please install it from https://claude.ai/code"
        )
    
    # Get or start the agent
    agent_manager = get_agent_manager()
    
    # Start agent if not running
    await agent_manager.start_agent(agent.id, agent.project_id)
    
    # Execute the task
    result = await agent_manager.execute_task(request.agent_id, task_id)
    
    if result["success"]:
        return ExecuteTaskResponse(
            success=True,
            message=f"{agent.name} completed the task",
            response=result.get("response"),
        )
    else:
        return ExecuteTaskResponse(
            success=False,
            message=result.get("error", "Task execution failed"),
            response=None,
        )


class TaskLogEntry(BaseModel):
    """A single log entry for task execution."""
    id: str
    agent_id: str
    agent_name: str | None
    activity_type: str
    description: str
    extra_data: dict | None
    created_at: str


class TaskLogsResponse(BaseModel):
    """Response containing task execution logs."""
    task_id: str
    task_title: str
    task_status: str
    assigned_to: str | None
    assigned_agent_name: str | None
    logs: list[TaskLogEntry]


@router.get("/{task_id}/logs", response_model=TaskLogsResponse)
async def get_task_logs(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> TaskLogsResponse:
    """
    Get execution logs for a task.
    
    Returns all activity logs related to this task,
    including Claude Code responses and file changes.
    """
    from app.models import ActivityLog
    
    # Get task
    task_result = await db.execute(select(Task).where(Task.id == task_id))
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Get assigned agent name
    assigned_agent_name = None
    if task.assigned_to:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == task.assigned_to)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            assigned_agent_name = agent.name
    
    # Find activity logs related to this task
    # Look for logs where extra_data contains this task_id
    logs_result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.activity_type.in_(["task_started", "task_completed", "code_written", "file_edited"]))
        .order_by(ActivityLog.created_at.desc())
        .limit(100)
    )
    all_logs = logs_result.scalars().all()
    
    # Filter logs for this specific task
    task_logs = []
    agent_names: dict[str, str] = {}
    
    for log in all_logs:
        extra = log.extra_data or {}
        if extra.get("task_id") == task_id:
            # Get agent name if not cached
            if log.agent_id not in agent_names:
                agent_result = await db.execute(
                    select(Agent).where(Agent.id == log.agent_id)
                )
                agent = agent_result.scalar_one_or_none()
                agent_names[log.agent_id] = agent.name if agent else "Unknown"
            
            task_logs.append(TaskLogEntry(
                id=log.id,
                agent_id=log.agent_id,
                agent_name=agent_names.get(log.agent_id),
                activity_type=log.activity_type,
                description=log.description,
                extra_data=log.extra_data,
                created_at=log.created_at.isoformat(),
            ))
    
    # Sort by created_at ascending (oldest first)
    task_logs.sort(key=lambda x: x.created_at)
    
    return TaskLogsResponse(
        task_id=task_id,
        task_title=task.title,
        task_status=task.status,
        assigned_to=task.assigned_to,
        assigned_agent_name=assigned_agent_name,
        logs=task_logs,
    )
