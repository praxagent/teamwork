"""Main FastAPI application for the Virtual Dev Team Simulator."""

import asyncio
import json
import logging
import random
import sys
from contextlib import asynccontextmanager

from anthropic import AsyncAnthropic
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.config import settings

# Configure logging to output to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)
from app.models import init_db, AsyncSessionLocal, Agent, Channel, Message, Project
from app.routers import (
    agents_router,
    channels_router,
    messages_router,
    onboarding_router,
    projects_router,
    tasks_router,
    terminal_router,
    workspace_router,
)
from app.services import agent_manager as am_module
from app.services import task_queue as tq_module
from app.websocket import manager, WebSocketEvent, EventType

# Global flags for background tasks
_random_chat_task: asyncio.Task | None = None
_pm_checkin_task: asyncio.Task | None = None
_shutdown_event = asyncio.Event()


async def random_chat_background_task():
    """Background task that has agents occasionally post in #random."""
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    
    while not _shutdown_event.is_set():
        try:
            # Wait a random interval (2-5 minutes)
            wait_time = random.uniform(120, 300)
            await asyncio.sleep(wait_time)
            
            if _shutdown_event.is_set():
                break
            
            # 10% chance to post
            if random.random() > 0.10:
                continue
            
            async with AsyncSessionLocal() as db:
                # Get all active projects
                projects_result = await db.execute(
                    select(Project).where(Project.status == "active")
                )
                projects = list(projects_result.scalars().all())
                
                if not projects:
                    continue
                
                # Pick a random project
                project = random.choice(projects)
                
                # Find #random channel
                random_channel_result = await db.execute(
                    select(Channel).where(
                        Channel.project_id == project.id,
                        Channel.name == "random"
                    )
                )
                random_channel = random_channel_result.scalar_one_or_none()
                
                if not random_channel:
                    continue
                
                # Get agents for this project
                agents_result = await db.execute(
                    select(Agent).where(Agent.project_id == project.id)
                )
                agents = list(agents_result.scalars().all())
                
                if not agents:
                    continue
                
                # Pick a random agent
                agent = random.choice(agents)
                
                # Get recent messages in #random for context
                recent_result = await db.execute(
                    select(Message)
                    .where(Message.channel_id == random_channel.id)
                    .order_by(Message.created_at.desc())
                    .limit(5)
                )
                recent_msgs = list(recent_result.scalars().all())
                
                # Build context
                context = ""
                if recent_msgs:
                    context_parts = []
                    for m in reversed(recent_msgs):
                        if m.agent_id:
                            agent_result = await db.execute(
                                select(Agent).where(Agent.id == m.agent_id)
                            )
                            sender_agent = agent_result.scalar_one_or_none()
                            sender = sender_agent.name if sender_agent else "Someone"
                        else:
                            sender = "CEO"
                        context_parts.append(f"{sender}: {m.content}")
                    context = "\nRecent conversation:\n" + "\n".join(context_parts)
                
                # Generate spontaneous message
                system_prompt = f"""You are {agent.name}, a team member casually chatting in the #random channel.

{agent.soul_prompt or ''}

This is the casual/off-topic channel. Post something natural like:
- Share something interesting you just read/learned
- Make a casual observation about work or life
- React to recent conversation if there is one
- Share a thought, joke, or random musing
- Ask a casual question to the team

Keep it SHORT (1-2 sentences max). Be natural and human-like. Don't be overly enthusiastic."""

                prompt = f"""You're casually posting in #random.{context}

Generate a single casual message as {agent.name}. Be natural, like a real coworker would post."""

                response = await client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=150,
                    system=system_prompt,
                    messages=[{"role": "user", "content": prompt}],
                )
                
                content = response.content[0].text
                
                # Create the message
                new_message = Message(
                    channel_id=random_channel.id,
                    agent_id=agent.id,
                    content=content,
                    message_type="chat",
                )
                db.add(new_message)
                await db.flush()
                await db.refresh(new_message)
                
                # Broadcast to channel and project
                message_event = WebSocketEvent(
                    type=EventType.MESSAGE_NEW,
                    data={
                        "id": new_message.id,
                        "channel_id": random_channel.id,
                        "agent_id": agent.id,
                        "agent_name": agent.name,
                        "content": content,
                        "message_type": "chat",
                        "created_at": new_message.created_at.isoformat(),
                    },
                )
                await manager.broadcast_to_channel(random_channel.id, message_event)
                await manager.broadcast_to_project(project.id, message_event)
                
                await db.commit()
                
        except Exception as e:
            print(f"Error in random chat task: {e}")
            # Wait a bit before retrying
            await asyncio.sleep(30)


async def pm_checkin_background_task():
    """Background task that has PMs periodically check in with status updates."""
    from app.services.pm_manager import get_pm_manager
    
    while not _shutdown_event.is_set():
        try:
            # Wait 10-15 minutes between check-ins
            wait_time = random.uniform(600, 900)
            await asyncio.sleep(wait_time)
            
            if _shutdown_event.is_set():
                break
            
            # 30% chance to do a check-in (so roughly every 30-45 min on average)
            if random.random() > 0.30:
                continue
            
            async with AsyncSessionLocal() as db:
                # Get all active projects
                projects_result = await db.execute(select(Project))
                projects = projects_result.scalars().all()
                
                for project in projects:
                    pm_manager = get_pm_manager(lambda: db)
                    pm = await pm_manager.get_pm_for_project(db, project.id)
                    
                    if not pm:
                        continue
                    
                    # FIRST: Check if all work is complete - announce and celebrate!
                    completion_status = await pm_manager.check_if_work_complete(db, project.id)
                    if completion_status["ready_for_review"]:
                        # Check if we already announced (don't spam)
                        from app.models import ActivityLog
                        recent_announcement = await db.execute(
                            select(ActivityLog)
                            .where(ActivityLog.agent_id == pm.id)
                            .where(ActivityLog.activity_type == "project_complete")
                            .order_by(ActivityLog.created_at.desc())
                            .limit(1)
                        )
                        if not recent_announcement.scalar_one_or_none():
                            # Haven't announced yet - do it now!
                            await pm_manager.announce_completion(db, project.id, pm)
                            print(f"PM {pm.name} announced project completion!")
                            continue  # Skip other updates, completion is the big news
                    
                    # Gather status
                    team_status = await pm_manager.gather_team_status(db, project.id)
                    
                    # Decide what kind of update to give
                    update_type = None
                    context = ""
                    
                    # Check for blockers - high priority
                    if team_status["blockers"]:
                        update_type = "blocker_alert"
                        context = "There are team members who are blocked and need assistance."
                    
                    # Check for idle developers with pending tasks
                    idle_devs = [d for d in team_status["developers"] 
                                 if d["status"] == "idle" and d["current_task"]]
                    if idle_devs:
                        update_type = "idle_check"
                        context = f"Noticed some developers are idle: {', '.join(d['name'] for d in idle_devs)}"
                    
                    # Check for significant progress
                    if team_status["tasks_summary"]["completed"] > 0:
                        update_type = "progress_update"
                        context = "Sharing progress update on completed work."
                    
                    # Random general check-in
                    if not update_type and random.random() < 0.3:
                        update_type = "general_checkin"
                        context = "Periodic status check-in with the team."
                    
                    # PM proactive management actions
                    # 1. Check project health
                    health = await pm_manager.check_project_health(db, project.id)
                    
                    # 2. Auto-assign unassigned tasks
                    assignments = await pm_manager.assign_unassigned_tasks(db, project.id)
                    if assignments:
                        assign_msg = f"Just assigned some tasks: " + ", ".join(
                            f"{a['task']} to {a['developer']}" for a in assignments[:3]
                        )
                        await pm_manager.post_update_to_general(db, project.id, assign_msg, pm)
                        print(f"PM assigned {len(assignments)} tasks")

                    if update_type:
                        # Generate and post update
                        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
                        
                        # Include health status in context
                        health_context = ""
                        if health["status"] != "healthy":
                            health_context = f"\nProject health: {health['status'].upper()}\nIssues: {', '.join(health['issues'])}"
                        
                        # Build appropriate message based on type
                        if update_type == "blocker_alert":
                            prompt_context = f"""You're the PM noticing blockers in the team. Alert the CEO about this.
Blockers: {team_status['blockers']}
{health_context}
Be concise and actionable. Suggest next steps."""
                        elif update_type == "idle_check":
                            prompt_context = f"""You're the PM noticing some developers are idle despite having tasks.
Idle devs: {idle_devs}
{health_context}
Mention this and say you'll check in with them. Be proactive."""
                        elif update_type == "progress_update":
                            prompt_context = f"""You're the PM giving a brief progress update.
Completed tasks: {team_status['tasks_summary']['completed']}
In progress: {team_status['tasks_summary']['in_progress']}
Files created: {team_status['files_created']}
{health_context}
Keep it brief (2-3 sentences). Be honest about progress."""
                        else:
                            prompt_context = f"""You're the PM doing a quick check-in.
{health_context}
Just a brief status note (1-2 sentences). Be real about where things stand."""
                        
                        system_prompt = f"""You are {pm.name}, the Product Manager.
{pm.soul_prompt or ''}
You're posting an update in #general. Keep it natural and professional.
Only mention REAL data from the team status. Don't make things up.
Be honest - if there are problems, mention them. The CEO wants truth."""

                        response = await client.messages.create(
                            model="claude-sonnet-4-20250514",
                            max_tokens=250,
                            system=system_prompt,
                            messages=[{"role": "user", "content": prompt_context}],
                        )
                        
                        content = response.content[0].text
                        
                        # Post to #general
                        await pm_manager.post_update_to_general(db, project.id, content, pm)
                        
                        print(f"PM {pm.name} posted {update_type} update (health: {health['status']})")
                    
                    # 3. DM idle developers to check on them
                    if idle_devs and random.random() < 0.5:  # 50% chance to DM
                        dev_to_check = random.choice(idle_devs)
                        # Find the actual agent object
                        dev_result = await db.execute(
                            select(Agent).where(Agent.name == dev_to_check["name"])
                        )
                        dev_agent = dev_result.scalar_one_or_none()
                        if dev_agent:
                            client = AsyncAnthropic(api_key=settings.anthropic_api_key)
                            dm_prompt = f"""You're the PM checking in on {dev_agent.name} who seems idle.
Their current task: {dev_to_check['current_task']}
Write a friendly but focused DM asking how things are going and if they need help.
Keep it short (1-2 sentences). Be supportive, not accusatory."""
                            
                            dm_response = await client.messages.create(
                                model="claude-sonnet-4-20250514",
                                max_tokens=100,
                                system=f"You are {pm.name}, the PM. Write a brief, friendly check-in DM.",
                                messages=[{"role": "user", "content": dm_prompt}],
                            )
                            
                            await pm_manager.dm_developer(db, pm, dev_agent, dm_response.content[0].text)
                            print(f"PM DMed {dev_agent.name} to check on progress")
                        
        except Exception as e:
            print(f"Error in PM check-in task: {e}")
            await asyncio.sleep(60)


# Global for task manager background task
_task_manager_task: asyncio.Task | None = None


async def task_manager_background_task():
    """
    Background task that continuously manages task execution:
    - Syncs agent status with task status (fixes mismatches)
    - Starts unblocked tasks that are pending
    - Assigns unassigned tasks to available developers
    - Monitors task progress
    
    Runs every 30 seconds for responsive task management.
    """
    from app.services.agent_manager import get_agent_manager, check_claude_code_available
    from app.models import Task
    
    while not _shutdown_event.is_set():
        try:
            # Short interval for responsive task management
            await asyncio.sleep(30)
            
            if _shutdown_event.is_set():
                break
            
            async with AsyncSessionLocal() as db:
                # FIRST: Sync agent status with task status to fix any mismatches
                # Find agents with in_progress tasks but not showing as "working"
                in_progress_tasks = await db.execute(
                    select(Task).where(Task.status == "in_progress")
                )
                for task in in_progress_tasks.scalars().all():
                    if task.assigned_to:
                        agent_result = await db.execute(
                            select(Agent).where(Agent.id == task.assigned_to)
                        )
                        agent = agent_result.scalar_one_or_none()
                        if agent and agent.status != "working":
                            print(f"[Status Sync] Fixing {agent.name}: was '{agent.status}', should be 'working' (task: {task.title})")
                            agent.status = "working"
                            await db.commit()
                            
                            # Broadcast the status fix
                            await manager.broadcast_to_project(
                                agent.project_id,
                                WebSocketEvent(
                                    type=EventType.AGENT_STATUS,
                                    data={"agent_id": agent.id, "status": "working", "name": agent.name},
                                ),
                            )
            
            # Check if Claude Code is available for auto-execution
            if not check_claude_code_available():
                continue
            
            async with AsyncSessionLocal() as db:
                # Get all active projects with auto-execute enabled
                projects_result = await db.execute(
                    select(Project).where(Project.status == "active")
                )
                projects = projects_result.scalars().all()
                
                for project in projects:
                    config = project.config or {}
                    
                    # Skip paused projects
                    if config.get("paused", False) or project.status == "paused":
                        continue
                    
                    # Default to True for auto-execute (autonomous mode)
                    if not config.get("auto_execute_tasks", True):
                        continue
                    
                    # Find pending (unblocked) tasks that aren't being worked on
                    pending_tasks_result = await db.execute(
                        select(Task).where(
                            Task.project_id == project.id,
                            Task.status == "pending",
                            Task.assigned_to.isnot(None)  # Must have an assignee
                        ).order_by(Task.priority.desc(), Task.created_at)
                    )
                    pending_tasks = pending_tasks_result.scalars().all()
                    
                    # Get available agents (those not currently working)
                    agents_result = await db.execute(
                        select(Agent).where(
                            Agent.project_id == project.id,
                            Agent.status.in_(["idle", None])
                        )
                    )
                    available_agents = {a.id: a for a in agents_result.scalars().all()}
                    
                    agent_manager = get_agent_manager()
                    
                    for task in pending_tasks[:3]:  # Process up to 3 tasks per cycle
                        # Check if the assigned agent is available
                        if task.assigned_to not in available_agents:
                            continue
                        
                        agent = available_agents[task.assigned_to]
                        
                        # Verify task is truly unblocked
                        blocked_by = task.blocked_by
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
                            # Update status to blocked if not already
                            if task.status != "blocked":
                                task.status = "blocked"
                                await db.commit()
                            continue
                        
                        # Start the agent and execute the task
                        try:
                            print(f"Auto-starting task '{task.title}' for {agent.name}")
                            
                            # Update agent status
                            agent.status = "working"
                            await db.commit()
                            
                            # Start agent if needed
                            await agent_manager.start_agent(agent.id, project.id)
                            
                            # Execute task (this runs async)
                            asyncio.create_task(
                                agent_manager.execute_task(agent.id, task.id)
                            )
                            
                            # Remove from available agents for this cycle
                            del available_agents[agent.id]
                            
                        except Exception as e:
                            print(f"Error auto-starting task: {e}")
                            agent.status = "idle"
                            await db.commit()
                    
                    # Also check for unassigned pending tasks and assign them
                    unassigned_result = await db.execute(
                        select(Task).where(
                            Task.project_id == project.id,
                            Task.status.in_(["pending", "blocked"]),
                            Task.assigned_to.is_(None)
                        ).order_by(Task.priority.desc()).limit(5)
                    )
                    unassigned_tasks = unassigned_result.scalars().all()
                    
                    if unassigned_tasks and available_agents:
                        from app.services.pm_manager import get_pm_manager
                        pm_manager = get_pm_manager(lambda: db)
                        pm = await pm_manager.get_pm_for_project(db, project.id)
                        
                        for task in unassigned_tasks:
                            if not available_agents:
                                break
                            
                            # Find a suitable developer
                            for agent_id, agent in list(available_agents.items()):
                                role = (agent.role or "").lower()
                                if "developer" in role or "engineer" in role:
                                    print(f"Auto-assigning task '{task.title}' to {agent.name}")
                                    
                                    # Use PM manager's assign method which posts to #general
                                    if pm:
                                        await pm_manager.assign_task_to_agent(
                                            db, task, agent, pm, auto_start=True
                                        )
                                    else:
                                        # Fallback if no PM found
                                        task.assigned_to = agent_id
                                        await db.commit()
                                    
                                    del available_agents[agent_id]
                                    break
                        
        except Exception as e:
            print(f"Error in task manager: {e}")
            import traceback
            traceback.print_exc()
            await asyncio.sleep(10)


def check_api_keys():
    """Check that required API keys are configured."""
    print(f"[Config] Project root: {settings.workspace_path.parent}")
    print(f"[Config] Workspace path: {settings.workspace_path}")
    print(f"[Config] Database URL: {settings.database_url}")
    
    if settings.anthropic_api_key:
        # Mask the key for security
        masked = settings.anthropic_api_key[:8] + "..." + settings.anthropic_api_key[-4:]
        print(f"[Config] Anthropic API key: {masked}")
    else:
        print("[WARNING] ANTHROPIC_API_KEY is not set! Agents will not work.")
        print("[WARNING] Add ANTHROPIC_API_KEY to your .env file at the project root.")
    
    if settings.openai_api_key:
        masked = settings.openai_api_key[:8] + "..." + settings.openai_api_key[-4:]
        print(f"[Config] OpenAI API key: {masked}")
    else:
        print("[Config] OpenAI API key: Not configured (profile images disabled)")


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
    global _random_chat_task, _pm_checkin_task, _task_manager_task
    
    # Initialize database
    await init_db()
    
    # Check API keys are configured
    check_api_keys()
    
    # Run migrations for existing databases
    await run_migrations()

    # Initialize services with database session factory
    am_module.agent_manager = am_module.AgentManager(
        db_session_factory=AsyncSessionLocal
    )
    tq_module.task_queue = tq_module.TaskQueue(
        db_session_factory=AsyncSessionLocal
    )

    # Ensure workspace directory exists
    settings.workspace_path.mkdir(parents=True, exist_ok=True)
    
    # Start background tasks
    _shutdown_event.clear()
    _random_chat_task = asyncio.create_task(random_chat_background_task())
    _pm_checkin_task = asyncio.create_task(pm_checkin_background_task())
    _task_manager_task = asyncio.create_task(task_manager_background_task())

    yield

    # Signal shutdown and cleanup
    _shutdown_event.set()
    for task in [_random_chat_task, _pm_checkin_task, _task_manager_task]:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    
    # Stop all running agents
    if am_module.agent_manager:
        for agent_id in am_module.agent_manager.get_all_running_agents():
            await am_module.agent_manager.stop_agent(agent_id)


app = FastAPI(
    title="Virtual Dev Team Simulator",
    description="A Slack-like application where AI agents simulate a development team",
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
app.include_router(projects_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(channels_router, prefix="/api")
app.include_router(messages_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(onboarding_router, prefix="/api")
app.include_router(workspace_router, prefix="/api")
app.include_router(terminal_router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint returning API info."""
    return {
        "name": "Virtual Dev Team Simulator API",
        "version": "0.1.0",
        "docs": "/docs",
    }


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
