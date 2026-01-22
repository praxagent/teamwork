"""Messages API router."""

import asyncio
import json
import random
from typing import Any

from anthropic import AsyncAnthropic
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Message, Channel, Agent, Project, Task, get_db, AsyncSessionLocal
from app.websocket import manager, WebSocketEvent, EventType

router = APIRouter(prefix="/messages", tags=["messages"])

# Anthropic client for agent responses
_anthropic_client: AsyncAnthropic | None = None


def get_anthropic_client() -> AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


async def get_agent_real_work_status(db: AsyncSession, agent_id: str, project_id: str) -> dict:
    """
    Fetch the ACTUAL work status of an agent from database activity logs.
    This returns ONLY verified, real data - no hallucination allowed.
    """
    from app.models import ActivityLog, Task
    from pathlib import Path
    from app.config import settings
    
    result = {
        "has_any_activity": False,
        "current_task": None,
        "completed_tasks": [],
        "recent_activities": [],
        "files_created": [],
        "summary": "No work has been done yet."
    }
    
    # Get current assigned task
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
            "description": current_task.description
        }
    
    # Get completed tasks
    completed_result = await db.execute(
        select(Task)
        .where(Task.assigned_to == agent_id)
        .where(Task.status == "completed")
        .order_by(Task.updated_at.desc())
        .limit(5)
    )
    completed_tasks = completed_result.scalars().all()
    result["completed_tasks"] = [{"title": t.title, "status": t.status} for t in completed_tasks]
    
    # Get recent activity logs (ACTUAL recorded activities)
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
                "data": a.extra_data
            }
            for a in activities
        ]
    
    # Check workspace for actual files created
    from app.utils.workspace import get_project_workspace_path
    workspace_path = await get_project_workspace_path(project_id, db)
    if workspace_path.exists():
        try:
            files = []
            for f in workspace_path.rglob("*"):
                if f.is_file() and not any(p in str(f) for p in [".git", "__pycache__", "node_modules", ".venv"]):
                    files.append(str(f.relative_to(workspace_path)))
            result["files_created"] = files[:20]  # Limit to 20 files
        except Exception:
            pass
    
    # Build summary based on REAL data
    if result["has_any_activity"] or result["completed_tasks"] or result["files_created"]:
        summary_parts = []
        if result["completed_tasks"]:
            summary_parts.append(f"Completed {len(result['completed_tasks'])} task(s): " + 
                               ", ".join(t["title"] for t in result["completed_tasks"][:3]))
        if result["files_created"]:
            summary_parts.append(f"Created {len(result['files_created'])} file(s)")
        if result["current_task"]:
            summary_parts.append(f"Currently assigned: {result['current_task']['title']} ({result['current_task']['status']})")
        result["summary"] = ". ".join(summary_parts) if summary_parts else "No significant work recorded."
    else:
        result["summary"] = "No work has been done yet. No tasks completed, no files created, no activities recorded."
    
    return result


async def get_project_task_board(db: AsyncSession, project_id: str) -> dict:
    """
    Get the FULL task board status for a project.
    This is what the PM needs to see - all tasks across all agents.
    """
    from app.models import Task, Agent
    
    # Get all tasks
    tasks_result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .order_by(Task.created_at)
    )
    all_tasks = tasks_result.scalars().all()
    
    # Get all agents for name lookup
    agents_result = await db.execute(
        select(Agent).where(Agent.project_id == project_id)
    )
    agents = {a.id: a for a in agents_result.scalars().all()}
    
    # Categorize tasks
    todo_tasks = []
    in_progress_tasks = []
    blocked_tasks = []
    completed_tasks = []
    
    for task in all_tasks:
        assignee_name = agents[task.assigned_to].name if task.assigned_to and task.assigned_to in agents else "Unassigned"
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
        else:  # pending
            blocked_by = task.blocked_by or []
            if blocked_by:
                # Check if any blockers are incomplete
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
    
    # Get agent statuses
    agent_statuses = []
    for agent in agents.values():
        # Count their tasks
        assigned_tasks = [t for t in all_tasks if t.assigned_to == agent.id]
        agent_statuses.append({
            "name": agent.name,
            "role": agent.role,
            "status": agent.status or "idle",
            "assigned_tasks": len(assigned_tasks),
            "completed_tasks": len([t for t in assigned_tasks if t.status == "completed"]),
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
        "completed_tasks": completed_tasks[-5:],  # Last 5 completed
        "agent_statuses": agent_statuses,
    }


async def _generate_coaching_response(
    client: AsyncAnthropic,
    agent: Agent,
    channel: Channel,
    user_message: str,
    conversation: str,
    project_config: dict,
) -> str:
    """Generate a response for a coaching agent with memory context."""
    print(f"[CoachingResponse] === GENERATING COACHING RESPONSE ===", flush=True)
    print(f"[CoachingResponse] Agent: {agent.name}, Role: {agent.role}", flush=True)
    
    from app.services.progress_tracker import ProgressTracker
    
    # Get user-defined memories/instructions from project config
    user_memories = project_config.get("memories", [])
    memories_block = ""
    if user_memories:
        memories_list = "\n".join(f"- {m.get('instruction', '')}" for m in user_memories)
        memories_block = f"""
=== USER'S STANDING INSTRUCTIONS (ALWAYS FOLLOW THESE) ===

{memories_list}

=== END STANDING INSTRUCTIONS ===
"""
        print(f"[CoachingResponse] Including {len(user_memories)} user memories", flush=True)
    
    # Get memory context for this topic AND check for file-based prompts
    memory_context = ""
    file_soul_prompt = None
    file_skills_prompt = None
    topic = agent.specialization or channel.team
    print(f"[CoachingResponse] Topic: {topic}", flush=True)
    
    try:
        # Get the project for workspace path
        async with AsyncSessionLocal() as db:
            from app.models import Project
            from pathlib import Path
            import re
            project_result = await db.execute(
                select(Project).where(Project.id == channel.project_id)
            )
            project = project_result.scalar_one_or_none()
            
            if project:
                workspace_dir = project.workspace_dir or project.id
                workspace_path = settings.workspace_path / workspace_dir
                
                # Check for prompts in .agents/{agent-name}/ folder (NEW, preferred)
                agent_slug = re.sub(r'[^a-z0-9\s-]', '', agent.name.lower())
                agent_slug = re.sub(r'[\s_]+', '-', agent_slug).strip('-')
                agents_dir = workspace_path / ".agents" / agent_slug
                
                if (agents_dir / "soul.md").exists():
                    file_soul_prompt = (agents_dir / "soul.md").read_text()
                    print(f"[CoachingResponse] Found soul.md in .agents/", flush=True)
                if (agents_dir / "skills.md").exists():
                    file_skills_prompt = (agents_dir / "skills.md").read_text()
                    print(f"[CoachingResponse] Found skills.md in .agents/", flush=True)
                
                # Fall back to .coaching/{coach-name}/ folder (legacy)
                if not file_soul_prompt or not file_skills_prompt:
                    tracker = ProgressTracker(project.id, workspace_dir)
                    coaching_prompts = await tracker.get_coach_prompts(agent.name)
                    if not file_soul_prompt:
                        file_soul_prompt = coaching_prompts.get("soul_prompt")
                    if not file_skills_prompt:
                        file_skills_prompt = coaching_prompts.get("skills_prompt")
                
                # Filter out placeholder content
                if file_soul_prompt and ("not yet available" in file_soul_prompt.lower() or "placeholder" in file_soul_prompt.lower()):
                    file_soul_prompt = None
                if file_skills_prompt and ("not yet available" in file_skills_prompt.lower() or "placeholder" in file_skills_prompt.lower()):
                    file_skills_prompt = None
                
                if file_soul_prompt or file_skills_prompt:
                    print(f"[CoachingResponse] Using file-based prompts for {agent.name}", flush=True)
                
                # Get memory context if topic exists
                if topic:
                    memory_context = await tracker.get_memory_context(topic)
    except Exception as e:
        print(f"[CoachingResponse] Error getting memory/prompts: {e}")
    
    # Prefer file prompts (user edits) over database prompts
    soul_prompt = file_soul_prompt or agent.soul_prompt or ""
    skills_prompt = file_skills_prompt or agent.skills_prompt or ""
    
    # Build context block
    memory_block = ""
    if memory_context:
        memory_block = f"""
=== YOUR MEMORY (What you know from past conversations) ===

{memory_context}

=== END MEMORY ===

IMPORTANT: Use this memory to provide personalized coaching. Reference things you've 
learned about this person. Build on previous conversations. Show that you remember them.
"""

    # Import prompts from centralized location
    from app.agents.prompts import (
        get_personal_manager_prompt,
        get_coach_prompt,
    )

    # Generate system prompt using centralized templates
    # Note: Topic-specific instructions are now embedded in skills_prompt,
    # generated during onboarding based on the actual topic and user context
    if agent.role == "personal_manager":
        system_prompt = get_personal_manager_prompt(
            agent_name=agent.name,
            soul_prompt=soul_prompt,
            skills_prompt=skills_prompt,
            memories_block=memories_block,
            memory_block=memory_block,
            channel_name=channel.name,
        )
    else:
        # Coach - topic-specific instructions are in skills_prompt from onboarding
        system_prompt = get_coach_prompt(
            agent_name=agent.name,
            soul_prompt=soul_prompt,
            skills_prompt=skills_prompt,
            memories_block=memories_block,
            memory_block=memory_block,
            channel_name=channel.name,
            topic=topic,
        )

    prompt = f"""Recent conversation:
{conversation}

Learner: {user_message}

Respond as {agent.name}. Be natural, helpful, and build on any context from your memory."""

    try:
        response = await client.messages.create(
            model=settings.model_pm,  # Use same model for consistency
            max_tokens=600,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
    except Exception as e:
        return f"[Sorry, I'm having trouble responding right now. Error: {str(e)[:50]}]"


# Note: All prompt templates moved to app.agents.prompts/


async def generate_agent_response(
    agent: Agent,
    channel: Channel,
    user_message: str,
    recent_messages: list[dict],
    real_work_status: dict,
    project_task_board: dict | None = None,
    project_config: dict | None = None,
) -> str:
    """Generate an agent's response using Claude, based on REAL work data only."""
    client = get_anthropic_client()

    # Build conversation context
    conversation = "\n".join(
        f"{m['sender']}: {m['content']}" for m in recent_messages[-10:]
    )
    
    # Check if this is a coaching project - use different response logic
    if project_config and project_config.get("project_type") == "coaching":
        return await _generate_coaching_response(
            client, agent, channel, user_message, conversation, project_config
        )

    # Build work context ONLY from verified real data
    current_task = real_work_status.get("current_task")
    completed_tasks = real_work_status.get("completed_tasks", [])
    recent_activities = real_work_status.get("recent_activities", [])
    files_created = real_work_status.get("files_created", [])
    
    # Import prompt generators from centralized location
    from app.agents.prompts import (
        build_work_context,
        build_task_board_context,
        get_pm_prompt,
        get_developer_prompt,
    )
    
    # Check for file-based prompts in .agents/{agent-name}/ folder
    import re
    from app.models import Project
    
    file_soul_prompt = None
    file_skills_prompt = None
    
    try:
        async with AsyncSessionLocal() as db:
            project_result = await db.execute(
                select(Project).where(Project.id == channel.project_id)
            )
            project = project_result.scalar_one_or_none()
            
            if project:
                workspace_dir = project.workspace_dir or project.id
                workspace_path = settings.workspace_path / workspace_dir
                
                # Check .agents/{agent-name}/ folder
                agent_slug = re.sub(r'[^a-z0-9\s-]', '', agent.name.lower())
                agent_slug = re.sub(r'[\s_]+', '-', agent_slug).strip('-')
                agents_dir = workspace_path / ".agents" / agent_slug
                
                if (agents_dir / "soul.md").exists():
                    file_soul_prompt = (agents_dir / "soul.md").read_text()
                if (agents_dir / "skills.md").exists():
                    file_skills_prompt = (agents_dir / "skills.md").read_text()
    except Exception as e:
        print(f"[DevResponse] Error reading agent prompts: {e}")
    
    # Prefer file prompts over database prompts
    soul_prompt = file_soul_prompt or agent.soul_prompt or ''
    skills_prompt = file_skills_prompt or agent.skills_prompt or ''

    # Build work context using centralized function
    work_context = build_work_context(
        current_task=current_task,
        completed_tasks=completed_tasks,
        recent_activities=recent_activities,
        files_created=files_created,
        summary=real_work_status['summary'],
    )

    # Generate system prompt using centralized templates
    if agent.role == "pm":
        task_board_context = build_task_board_context(project_task_board)
        system_prompt = get_pm_prompt(
            agent_name=agent.name,
            soul_prompt=soul_prompt,
            skills_prompt=skills_prompt,
            work_context=work_context,
            task_board_context=task_board_context,
            channel_name=channel.name,
        )
    else:
        # Developer/QA agents
        system_prompt = get_developer_prompt(
            agent_name=agent.name,
            soul_prompt=soul_prompt,
            skills_prompt=skills_prompt,
            work_context=work_context,
            channel_name=channel.name,
        )

    prompt = f"""Recent conversation:
{conversation}

CEO (the user): {user_message}

Respond as {agent.name}. Reference ONLY the work shown in your actual work status. If no work is recorded, be honest about it."""

    try:
        response = await client.messages.create(
            model=settings.model_pm,
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
    except Exception as e:
        return f"[Sorry, I'm having trouble responding right now. Error: {str(e)[:50]}]"


async def _track_coaching_progress_background(
    project_id: str,
    channel_id: str,
    channel_team: str | None,
    agent_id: str,
    agent_name: str,
    agent_role: str | None,
    agent_specialization: str | None,
    user_message: str,
    agent_response: str,
) -> None:
    """
    Track progress for coaching conversations in the background.
    This is fire-and-forget so it doesn't block the chat response.
    """
    print(f"[CoachingProgress] === BACKGROUND TRACKING START ===", flush=True)
    
    try:
        # Track for both coaches and personal_manager
        if agent_role not in ("coach", "personal_manager"):
            print(f"[CoachingProgress] Agent role '{agent_role}' not tracked, skipping", flush=True)
            return
        
        async with AsyncSessionLocal() as db:
            # Get the project to check if it's a coaching project
            project_result = await db.execute(
                select(Project).where(Project.id == project_id)
            )
            project = project_result.scalar_one_or_none()
            
            if not project:
                print(f"[CoachingProgress] No project found, skipping", flush=True)
                return
            
            config = project.config or {}
            project_type = config.get("project_type")
            
            if project_type != "coaching":
                print(f"[CoachingProgress] Not a coaching project, skipping", flush=True)
                return
            
            # Get the topic from the agent's specialization or channel team
            topic = agent_specialization or channel_team
            
            if not topic:
                if agent_role == "personal_manager":
                    topic = "general"
                else:
                    print(f"[CoachingProgress] No topic found, skipping", flush=True)
                    return
            
            print(f"[CoachingProgress] Tracking for topic: {topic}", flush=True)
            
            # Update progress file
            from app.services.progress_tracker import ProgressTracker
            
            workspace_dir = project.workspace_dir or project.id
            tracker = ProgressTracker(project.id, workspace_dir)
            
            # Record the full conversation with memory extraction
            await tracker.record_conversation(
                topic=topic,
                user_message=user_message,
                coach_response=agent_response,
                coach_name=agent_name,
            )
            
            print(f"[CoachingProgress] SUCCESS - Tracked conversation with {agent_name} on {topic}", flush=True)
        
    except Exception as e:
        import traceback
        print(f"[CoachingProgress] BACKGROUND ERROR: {e}", flush=True)
        print(f"[CoachingProgress] Traceback: {traceback.format_exc()}", flush=True)


async def trigger_agent_responses(
    channel_id: str,
    user_message_content: str,
    user_message_id: str,
):
    """Background task to trigger agent responses to a user message."""
    from app.models import Task
    
    # Small delay to let the original request complete and release the database
    await asyncio.sleep(0.5)
    
    # Retry logic for database locks
    max_retries = 3
    for attempt in range(max_retries):
        try:
            await _do_agent_responses(channel_id, user_message_content, user_message_id)
            return
        except Exception as e:
            if "database is locked" in str(e) and attempt < max_retries - 1:
                await asyncio.sleep(1.0 * (attempt + 1))  # Exponential backoff
                continue
            else:
                print(f"Error in agent response: {e}")
                return


async def _do_agent_responses(
    channel_id: str,
    user_message_content: str,
    user_message_id: str,
):
    """Internal function to handle agent responses."""
    from app.models import Task
    
    async with AsyncSessionLocal() as db:
        # Get channel info
        channel_result = await db.execute(
            select(Channel).where(Channel.id == channel_id)
        )
        channel = channel_result.scalar_one_or_none()
        if not channel:
            return
        
        # Get project config (needed for coaching projects)
        project_result = await db.execute(
            select(Project).where(Project.id == channel.project_id)
        )
        project = project_result.scalar_one_or_none()
        project_config = project.config if project else None

        # Get recent messages for context (with agent names)
        messages_result = await db.execute(
            select(Message)
            .where(Message.channel_id == channel_id)
            .order_by(Message.created_at.desc())
            .limit(10)
        )
        recent_msgs = messages_result.scalars().all()
        
        # Build message context with agent names
        recent_messages = []
        for m in reversed(recent_msgs):
            if m.agent_id is None:
                sender = "CEO"
            else:
                agent_result = await db.execute(
                    select(Agent).where(Agent.id == m.agent_id)
                )
                agent = agent_result.scalar_one_or_none()
                sender = agent.name if agent else "Agent"
            recent_messages.append({"sender": sender, "content": m.content})

        # Get all agents with their current tasks
        agents_query = select(Agent).where(Agent.project_id == channel.project_id)
        agents_result = await db.execute(agents_query)
        all_agents = list(agents_result.scalars().all())
        
        # Get current tasks for each agent
        agent_tasks: dict[str, dict | None] = {}
        for agent in all_agents:
            task_result = await db.execute(
                select(Task)
                .where(Task.assigned_to == agent.id)
                .where(Task.status.in_(["in_progress", "pending"]))
                .order_by(Task.priority.desc())
                .limit(1)
            )
            task = task_result.scalar_one_or_none()
            if task:
                agent_tasks[agent.id] = {
                    "id": task.id,
                    "title": task.title,
                    "description": task.description,
                    "status": task.status,
                }
            else:
                agent_tasks[agent.id] = None

        # Determine which agents should respond
        agents_to_respond: list[Agent] = []
        message_lower = user_message_content.lower()

        if channel.type == "dm":
            # In DM, the specific agent should respond
            if channel.dm_participants:
                agent_result = await db.execute(
                    select(Agent).where(Agent.id == channel.dm_participants)
                )
                agent = agent_result.scalar_one_or_none()
                if agent:
                    agents_to_respond.append(agent)
        else:
            # Build a map of agent names to agents for context detection
            agent_by_name: dict[str, Agent] = {}
            for a in all_agents:
                agent_by_name[a.name.lower()] = a
                agent_by_name[a.name.split()[0].lower()] = a  # First name only
            
            # Check if any agent is directly mentioned by name
            mentioned_agents = [
                a for a in all_agents 
                if a.name.lower() in message_lower or a.name.split()[0].lower() in message_lower
            ]
            
            # Check conversational context - who spoke last that the user might be replying to
            contextual_agent: Agent | None = None
            if len(recent_messages) >= 2 and not mentioned_agents:
                # Look at the last message before the user's message
                # recent_messages is oldest-first, so we look at the second-to-last
                for msg in reversed(recent_messages[:-1]):  # Exclude the current user message
                    if msg["sender"] != "CEO":
                        # This was the last agent to speak - user is likely replying to them
                        sender_lower = msg["sender"].lower()
                        if sender_lower in agent_by_name:
                            contextual_agent = agent_by_name[sender_lower]
                        else:
                            # Try first name
                            first_name = msg["sender"].split()[0].lower()
                            if first_name in agent_by_name:
                                contextual_agent = agent_by_name[first_name]
                        break
            
            # Check if user is asking for team-wide response
            team_keywords = [
                "team", "sound off", "everyone", "everybody", "all of you", 
                "status update", "what's everyone", "how's everyone", "what's everybody",
                "how's everybody", "give me an update", "need updates", "all hands",
                "your favorite", "what do you", "who wants", "anyone", "you all",
            ]
            wants_team_response = any(kw in message_lower for kw in team_keywords)
            
            if mentioned_agents:
                # Respond with mentioned agents
                agents_to_respond = mentioned_agents
            elif wants_team_response:
                # Multiple agents should respond
                # PM responds first (as the lead)
                pm_agents = [a for a in all_agents if a.role == "pm"]
                other_agents = [a for a in all_agents if a.role != "pm"]
                
                # Select up to 3 non-PM agents
                if len(other_agents) > 3:
                    other_agents = random.sample(other_agents, 3)
                
                # PM first, then others
                agents_to_respond = pm_agents + other_agents
            elif contextual_agent:
                # User is replying to a specific agent based on conversation flow
                agents_to_respond = [contextual_agent]
            else:
                # No clear context - pick relevant agents
                working_agents = [a for a in all_agents if agent_tasks.get(a.id) is not None]
                
                if channel.team:
                    # Filter to team members if in a team channel
                    team_agents = [a for a in working_agents if a.team == channel.team]
                    if team_agents:
                        working_agents = team_agents
                    else:
                        team_agents = [a for a in all_agents if a.team == channel.team]
                        if team_agents:
                            working_agents = team_agents
                
                if working_agents:
                    # Pick just 1 agent to respond (avoid multiple random agents)
                    agents_to_respond = [random.choice(working_agents)]
                elif all_agents:
                    agents_to_respond = [random.choice(all_agents)]

        # Generate and post responses with slight delays for realism
        print(f">>> Agents that will respond: {[a.name + ' (role: ' + str(a.role) + ')' for a in agents_to_respond]}", flush=True)
        for i, agent in enumerate(agents_to_respond):
            # Broadcast typing indicator BEFORE generating response
            await manager.broadcast_to_channel(
                channel_id,
                WebSocketEvent(
                    type=EventType.AGENT_TYPING,
                    data={
                        "agent_id": agent.id,
                        "agent_name": agent.name,
                        "channel_id": channel_id,
                        "is_typing": True,
                    },
                ),
            )
            
            # Random delay between 1-3 seconds
            base_delay = 1.5 if agent_tasks.get(agent.id) else 1.0
            await asyncio.sleep(random.uniform(base_delay, base_delay + 2.0))

            # SPECIAL HANDLING FOR PM: If PM is responding and user wants work done,
            # PM should ACTUALLY create tasks, not just talk about it
            print(f">>> Agent responding: {agent.name}, role: '{agent.role}', message: {user_message_content[:50]}", flush=True)
            is_pm = agent.role and agent.role.lower() in ["pm", "product manager", "project manager"]
            print(f">>> is_pm check: {is_pm} (role='{agent.role}')", flush=True)
            if is_pm:
                user_lower = user_message_content.lower()
                
                # Check if user is explicitly asking for task/ticket creation
                explicit_task_request = any(phrase in user_lower for phrase in [
                    "create a task", "create a ticket", "add a task", "add a ticket",
                    "make a task", "make a ticket", "new task", "new ticket",
                    "assign", "get them started", "get her started", "get him started",
                    "try again", "do it", "actually do",
                ])
                
                # Check if user is asking for general work/tasks/planning
                work_keywords = ["build", "create", "make", "develop", "implement", "add", 
                                "need", "want", "let's", "can you", "please", "start",
                                "work on", "get going", "ship", "do", "execute", "action",
                                "try again", "actually"]
                
                # Check team status - if no tasks exist or developers are idle, PM should act
                team_status_result = await db.execute(
                    select(Task).where(Task.project_id == channel.project_id)
                )
                existing_tasks = team_status_result.scalars().all()
                pending_tasks = [t for t in existing_tasks if t.status in ["pending", "in_progress"]]
                
                print(f">>> PM check: explicit_task_request={explicit_task_request}, pending_tasks={len(pending_tasks)}", flush=True)
                
                should_create_work = (
                    explicit_task_request or
                    any(kw in user_lower for kw in work_keywords) or
                    len(pending_tasks) == 0
                )
                
                print(f">>> should_create_work={should_create_work}", flush=True)
                
                if should_create_work:
                    print(f">>> PM {agent.name} is creating tasks based on: {user_message_content[:100]}", flush=True)
                    
                    try:
                        # Check if user mentioned a specific person to assign to
                        target_assignee: Agent | None = None
                        for a in all_agents:
                            if a.role != "pm" and (a.name.lower() in user_lower or a.name.split()[0].lower() in user_lower):
                                target_assignee = a
                                break
                        
                        # If no assignee mentioned in current message, look at recent messages for context
                        if not target_assignee:
                            print(f">>> No assignee in current message, checking recent messages...", flush=True)
                            # Check recent CEO messages for mentions of developers
                            for msg in reversed(recent_messages[-15:]):
                                if msg["sender"] == "CEO":
                                    msg_lower = msg["content"].lower()
                                    for a in all_agents:
                                        a_role = (a.role or "").lower()
                                        is_pm = a_role in ["pm", "product manager", "project manager"]
                                        if not is_pm and (a.name.lower() in msg_lower or a.name.split()[0].lower() in msg_lower):
                                            target_assignee = a
                                            print(f">>> Found assignee from CEO message context: {a.name}", flush=True)
                                            break
                                if target_assignee:
                                    break
                        
                        # If still no assignee, pick a random developer
                        if not target_assignee:
                            developers = [a for a in all_agents if a.role and a.role.lower() not in ["pm", "product manager", "project manager"]]
                            if developers:
                                target_assignee = developers[0]
                                print(f">>> Defaulting to first available developer: {target_assignee.name}", flush=True)
                        
                        print(f">>> target_assignee: {target_assignee.name if target_assignee else 'None'}", flush=True)
                        
                        # If explicit task request with a simple description, create a single task
                        if explicit_task_request:
                            print(f">>> Creating explicit task request", flush=True)
                            # Extract the task description from the message
                            task_title = user_message_content
                            # Clean up the title
                            for phrase in ["please create a task", "create a task", "create a ticket", 
                                           "add a task", "and assign it to", "assign to", "get them started",
                                           "get her started", "get him started", f"@{agent.name}",
                                           "try again", "do it", "actually do"]:
                                task_title = task_title.replace(phrase, "").replace(phrase.title(), "")
                            # Also remove agent names
                            for a in all_agents:
                                task_title = task_title.replace(f"@{a.name}", "")
                                task_title = task_title.replace(a.name, "")
                            task_title = task_title.strip(" ,.-:;@")
                            
                            # If title is too short, look for context in recent messages
                            if len(task_title) < 5:
                                print(f">>> Task title too short, searching recent messages for context...", flush=True)
                                print(f">>> Recent messages: {[m['sender'] + ': ' + m['content'][:50] for m in recent_messages[-10:]]}", flush=True)
                                
                                # Look for what was being asked - search CEO messages first
                                action_words = ["create", "build", "make", "write", "implement", "add", "fix", 
                                               "develop", "code", "generate", "setup", "test", "design"]
                                for msg in reversed(recent_messages[-15:]):
                                    msg_content = msg["content"]
                                    msg_sender = msg["sender"]
                                    # Look for CEO messages with action words
                                    if msg_sender == "CEO" and any(word in msg_content.lower() for word in action_words):
                                        # Extract the action from this message
                                        task_title = msg_content
                                        # Remove common prefixes
                                        for phrase in ["please", "can you", "could you", "would you", "i need", "i want", "@"]:
                                            task_title = task_title.lower().replace(phrase, "")
                                        # Remove agent names
                                        for a in all_agents:
                                            task_title = task_title.replace(a.name.lower(), "")
                                            task_title = task_title.replace(a.name.split()[0].lower(), "")
                                        task_title = task_title.strip(" ,.-:;@")
                                        if len(task_title) > 5:
                                            task_title = task_title[:100].strip()
                                            print(f">>> Extracted task title from context: '{task_title}'", flush=True)
                                            break
                            
                            if len(task_title) < 5:
                                # Still nothing, use a generic title
                                task_title = "Complete requested work"
                                print(f">>> Could not extract task from context, using default", flush=True)
                            
                            # Create the single task
                            task = Task(
                                project_id=channel.project_id,
                                title=task_title[:200],
                                description=user_message_content,
                                assigned_to=target_assignee.id if target_assignee else None,
                                status="pending",
                                priority=3,
                            )
                            db.add(task)
                            await db.flush()
                            await db.refresh(task)
                            await db.commit()
                            
                            print(f">>> Created task: {task.title}, id={task.id}, assigned to: {target_assignee.name if target_assignee else 'unassigned'}", flush=True)
                            
                            # Verify task was actually saved
                            verify_result = await db.execute(select(Task).where(Task.id == task.id))
                            verified_task = verify_result.scalar_one_or_none()
                            if verified_task:
                                print(f">>> VERIFIED: Task {task.id} exists in database with status={verified_task.status}", flush=True)
                            else:
                                print(f">>> ERROR: Task {task.id} NOT FOUND in database after commit!", flush=True)
                            
                            # Build response
                            if target_assignee:
                                response_content = f"""Done! I've created the task and assigned it to {target_assignee.name}.

**Task:** {task.title}
**Assigned to:** @{target_assignee.name}
**Status:** Ready to start

@{target_assignee.name} - You've got a new task. Check the task board and get going on this!"""

                                # Start the developer on the task
                                try:
                                    from app.services.agent_manager import get_agent_manager
                                    agent_manager = get_agent_manager()
                                    await agent_manager.start_agent(target_assignee.id, channel.project_id)
                                    asyncio.create_task(agent_manager.execute_task(target_assignee.id, task.id))
                                except Exception as e:
                                    print(f">>> Error starting task execution: {e}", flush=True)
                            else:
                                response_content = f"""Done! I've created the task.

**Task:** {task.title}
**Status:** Pending assignment

I'll assign it to the next available developer."""
                            
                            created_tasks = [task]
                        else:
                            # Use PM manager to break down into multiple tasks
                            from app.services.pm_manager import get_pm_manager
                            pm_manager = get_pm_manager(lambda: db)
                            
                            # Create tasks based on user's message or project context
                            work_description = user_message_content
                            if len(work_description) < 20:
                                # User message too short, use project description
                                project_result = await db.execute(
                                    select(Project).where(Project.id == channel.project_id)
                                )
                                project = project_result.scalar_one_or_none()
                                if project and project.description:
                                    work_description = f"Build the core features for: {project.description[:500]}"
                            
                            # Actually create the tasks
                            created_tasks = await pm_manager.break_down_and_create_tasks(
                                db, channel.project_id, agent, work_description, auto_assign=True
                            )
                            
                            if created_tasks:
                                # Generate response that references the REAL tasks just created
                                task_list = "\n".join(f"• **{t.title}**" for t in created_tasks)
                                
                                # Find who got assigned
                                assignments = []
                                for t in created_tasks:
                                    if t.assigned_to:
                                        assignee_result = await db.execute(
                                            select(Agent).where(Agent.id == t.assigned_to)
                                        )
                                        assignee = assignee_result.scalar_one_or_none()
                                        if assignee:
                                            assignments.append(f"{assignee.name} → {t.title}")
                                
                                response_content = f"""Done. I've created {len(created_tasks)} tasks and assigned them:

{task_list}

**Assignments:**
{chr(10).join('• ' + a for a in assignments) if assignments else '• Tasks created, assigning now...'}

The team has their marching orders. I'll check in on progress shortly."""
                        
                        # Check if the else branch created tasks
                        if not created_tasks:
                            # Fallback to normal response if task creation failed
                            print(f">>> No tasks created by pm_manager, falling back to normal response", flush=True)
                            real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)
                            project_task_board = await get_project_task_board(db, channel.project_id)
                            response_content = await generate_agent_response(
                                agent, channel, user_message_content, recent_messages, real_work_status, project_task_board, project_config
                            )
                    except Exception as e:
                        import traceback
                        print(f">>> ERROR in PM task creation: {e}", flush=True)
                        print(f">>> Traceback: {traceback.format_exc()}", flush=True)
                        # Fallback to normal response
                        real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)
                        project_task_board = await get_project_task_board(db, channel.project_id)
                        response_content = await generate_agent_response(
                            agent, channel, user_message_content, recent_messages, real_work_status, project_task_board, project_config
                        )
                else:
                    # PM responds normally but with real data AND full task board visibility
                    real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)
                    project_task_board = await get_project_task_board(db, channel.project_id)
                    response_content = await generate_agent_response(
                        agent, channel, user_message_content, recent_messages, real_work_status, project_task_board, project_config
                    )
            else:
                # Non-PM agents - check if they should actually DO something
                user_lower = user_message_content.lower()
                agent_role_lower = (agent.role or "").lower()
                
                # Any non-PM agent can do work
                is_worker = agent_role_lower not in ["pm", "product manager", "project manager"]
                
                # Check if user is asking this agent to do actual development work
                # These are coding/development action keywords
                dev_action_keywords = ["create", "build", "make", "write", "implement", "code", "develop", 
                                       "add", "fix", "update", "generate", "setup", "set up", "initialize",
                                       "test", "debug", "refactor", "deploy", "configure", "integrate"]
                
                # These are casual/conversational phrases that should NOT trigger work
                casual_keywords = ["share", "recipe", "food", "favorite", "tell me about", "what do you think",
                                   "how are you", "where are you", "opinion", "recommend", "suggest",
                                   "chat", "talk", "discuss", "explain", "describe", "story", "joke",
                                   "weather", "weekend", "hobby", "fun", "interesting", "cool", "nice"]
                
                is_casual = any(kw in user_lower for kw in casual_keywords)
                is_dev_action = any(kw in user_lower for kw in dev_action_keywords)
                
                # Only treat as action request if it's a dev action AND not casual conversation
                is_action_request = is_dev_action and not is_casual
                agent_mentioned = agent.name.lower() in user_lower or agent.name.split()[0].lower() in user_lower
                
                print(f">>> Non-PM check: is_worker={is_worker}, is_action_request={is_action_request}, is_casual={is_casual}, agent_mentioned={agent_mentioned}", flush=True)
                
                # If an agent is specifically asked to do actual development work, create a task and do it
                if is_worker and is_action_request and agent_mentioned:
                    print(f">>> {agent.name} will create a task and execute it", flush=True)
                    # Create a task for this request and execute it
                    try:
                        from app.services.agent_manager import get_agent_manager
                        
                        # Extract what they want built from the message
                        # Clean up the title
                        task_title = user_message_content
                        for phrase in ["please", "can you", "could you", "would you", "need you to", f"@{agent.name}"]:
                            task_title = task_title.replace(phrase, "").replace(phrase.title(), "")
                        for a in all_agents:
                            task_title = task_title.replace(f"@{a.name}", "")
                            task_title = task_title.replace(a.name, "")
                        task_title = task_title.strip(" ,.-:;@")
                        
                        if len(task_title) < 5:
                            task_title = user_message_content[:100]
                        else:
                            task_title = task_title[:100]
                        
                        task_description = user_message_content
                        
                        # Create the task
                        task = Task(
                            project_id=channel.project_id,
                            title=task_title,
                            description=task_description,
                            assigned_to=agent.id,
                            status="pending",
                            priority=3,
                        )
                        db.add(task)
                        await db.flush()
                        await db.refresh(task)
                        await db.commit()
                        
                        print(f">>> Created task for {agent.name}: {task.title}, id={task.id}", flush=True)
                        
                        # Verify task was saved
                        verify_result = await db.execute(select(Task).where(Task.id == task.id))
                        verified_task = verify_result.scalar_one_or_none()
                        if verified_task:
                            print(f">>> VERIFIED: Task {task.id} exists in database", flush=True)
                        else:
                            print(f">>> ERROR: Task {task.id} NOT FOUND after commit!", flush=True)
                        
                        # Respond that they're starting work
                        response_content = f"""On it! I've created a task and I'm getting started right now.

**Task:** {task_title}
**Status:** In Progress

I'll update you once I've made progress. Give me a few moments to work on this."""

                        # Start the actual execution in the background
                        agent_manager = get_agent_manager()
                        await agent_manager.start_agent(agent.id, channel.project_id)
                        asyncio.create_task(agent_manager.execute_task(agent.id, task.id))
                        
                    except Exception as e:
                        import traceback
                        print(f">>> Error executing task for {agent.name}: {e}", flush=True)
                        print(f">>> Traceback: {traceback.format_exc()}", flush=True)
                        # Fall back to normal response
                        real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)
                        response_content = await generate_agent_response(
                            agent, channel, user_message_content, recent_messages, real_work_status, None, project_config
                        )
                else:
                    # Normal response - Get the agent's REAL work status from database and filesystem
                    real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)

                    # Generate response with ONLY real verified data
                    response_content = await generate_agent_response(
                        agent, channel, user_message_content, recent_messages, real_work_status, None, project_config
                    )

            # Create message
            agent_message = Message(
                channel_id=channel_id,
                agent_id=agent.id,
                content=response_content,
                message_type="chat",
            )
            db.add(agent_message)
            await db.flush()
            await db.refresh(agent_message)
            await db.commit()  # Explicitly commit to persist

            # Stop typing indicator IMMEDIATELY after message is created
            await manager.broadcast_to_channel(
                channel_id,
                WebSocketEvent(
                    type=EventType.AGENT_TYPING,
                    data={
                        "agent_id": agent.id,
                        "agent_name": agent.name,
                        "channel_id": channel_id,
                        "is_typing": False,
                    },
                ),
            )
            
            # Broadcast the message to both channel and project subscribers
            message_event = WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": agent_message.id,
                    "channel_id": channel_id,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "content": response_content,
                    "message_type": "chat",
                    "created_at": agent_message.created_at.isoformat(),
                },
            )
            await manager.broadcast_to_channel(channel_id, message_event)
            await manager.broadcast_to_project(channel.project_id, message_event)
            
            # Track coaching progress in background (don't block the response)
            # This does vocabulary extraction and learning extraction which can take time
            asyncio.create_task(_track_coaching_progress_background(
                channel.project_id, channel.id, channel.team,
                agent.id, agent.name, agent.role, agent.specialization,
                user_message_content, response_content
            ))


class MessageCreate(BaseModel):
    """Schema for creating a message."""

    channel_id: str
    agent_id: str | None = None  # None if from user (CEO)
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


@router.get("/channel/{channel_id}", response_model=MessageListResponse)
async def list_channel_messages(
    channel_id: str,
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 50,
    thread_id: str | None = None,
) -> MessageListResponse:
    """List messages in a channel."""
    print(f">>> Fetching messages for channel {channel_id}, skip={skip}, limit={limit}", flush=True)
    
    # Verify channel exists
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        print(f">>> Channel {channel_id} not found!", flush=True)
        raise HTTPException(status_code=404, detail="Channel not found")
    
    print(f">>> Found channel: {channel.name}", flush=True)

    # Build query
    query = select(Message).where(Message.channel_id == channel_id)

    if thread_id:
        # Get thread replies
        query = query.where(Message.thread_id == thread_id)
    else:
        # Get top-level messages only (no thread replies)
        query = query.where(Message.thread_id.is_(None))

    # Get total count
    count_result = await db.execute(query)
    total = len(count_result.scalars().all())
    print(f">>> Total messages in channel: {total}", flush=True)

    # Get paginated messages
    result = await db.execute(
        query.order_by(Message.created_at.desc()).offset(skip).limit(limit + 1)
    )
    messages = list(result.scalars().all())

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    # Reverse to show oldest first
    messages.reverse()
    
    print(f">>> Returning {len(messages)} messages for channel {channel.name}", flush=True)

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
    """Create a new message."""
    # Verify channel exists
    channel_result = await db.execute(
        select(Channel).where(Channel.id == message.channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # Verify agent exists if specified
    agent_name = "CEO"
    if message.agent_id:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == message.agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent_name = agent.name

    # Verify thread exists if specified
    if message.thread_id:
        thread_result = await db.execute(
            select(Message).where(Message.id == message.thread_id)
        )
        if not thread_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Thread not found")

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
    await db.commit()  # Explicitly commit to persist message immediately

    response = await message_to_response(db_message, db)

    # Broadcast message to channel subscribers
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

    # If this is a user message (not from an agent), handle commands or trigger responses
    if message.agent_id is None:
        content_lower = message.content.strip().lower()
        
        # Handle /update command - PM provides status update
        if content_lower.startswith("/update"):
            background_tasks.add_task(
                handle_update_command,
                message.channel_id,
                channel.project_id,
            )
        # Handle /test command - Test and run the app
        elif content_lower.startswith("/test"):
            background_tasks.add_task(
                handle_test_command,
                message.channel_id,
                channel.project_id,
            )
        # Handle /plan command - PM breaks down work into tasks
        elif content_lower.startswith("/plan "):
            # Extract the work description after /plan
            work_description = message.content.strip()[6:].strip()  # Remove "/plan "
            if work_description:
                background_tasks.add_task(
                    handle_plan_command,
                    message.channel_id,
                    channel.project_id,
                    work_description,
                )
        # Handle /memorize command - Store persistent instruction for agents
        elif content_lower.startswith("/memorize "):
            instruction = message.content.strip()[10:].strip()  # Remove "/memorize "
            if instruction:
                background_tasks.add_task(
                    handle_memorize_command,
                    message.channel_id,
                    channel.project_id,
                    instruction,
                )
        # Handle /memories command - Show current memories
        elif content_lower.startswith("/memories"):
            background_tasks.add_task(
                handle_memories_command,
                message.channel_id,
                channel.project_id,
            )
        else:
            # Normal agent responses
            background_tasks.add_task(
                trigger_agent_responses,
                message.channel_id,
                message.content,
                db_message.id,
            )

    return response


async def handle_update_command(channel_id: str, project_id: str):
    """Handle the /update command by having the PM provide a status report."""
    from app.services.pm_manager import get_pm_manager
    
    print(f"[/update] Starting for channel={channel_id}, project={project_id}")
    
    await asyncio.sleep(1.0)  # Small delay for realism
    
    try:
        async with AsyncSessionLocal() as db:
            pm_manager = get_pm_manager(lambda: db)
            
            # Get the PM
            pm = await pm_manager.get_pm_for_project(db, project_id)
            if not pm:
                print(f"[/update] No PM found for project {project_id}")
                # Post an error message
                error_message = Message(
                    channel_id=channel_id,
                    agent_id=None,
                    content="[System] No Product Manager found for this project. The PM role may not have been created during onboarding.",
                    message_type="system",
                )
                db.add(error_message)
                await db.flush()
                await db.refresh(error_message)
                await db.commit()
                
                await manager.broadcast_to_channel(
                    channel_id,
                    WebSocketEvent(
                        type=EventType.MESSAGE_NEW,
                        data={
                            "id": error_message.id,
                            "channel_id": channel_id,
                            "content": error_message.content,
                            "message_type": "system",
                            "created_at": error_message.created_at.isoformat(),
                        },
                    ),
                )
                return
            
            print(f"[/update] Found PM: {pm.name}")
            
            # Generate status update
            update_content = await pm_manager.generate_status_update(
                db, project_id, pm,
                context="The CEO requested a status update via /update command."
            )
            
            print(f"[/update] Generated update: {update_content[:100]}...")
            
            # Post the update to the channel
            update_message = Message(
                channel_id=channel_id,
                agent_id=pm.id,
                content=update_content,
                message_type="chat",
            )
            db.add(update_message)
            await db.flush()
            await db.refresh(update_message)
            await db.commit()
            
            # Broadcast
            await manager.broadcast_to_channel(
                channel_id,
                WebSocketEvent(
                    type=EventType.MESSAGE_NEW,
                    data={
                        "id": update_message.id,
                        "channel_id": channel_id,
                        "agent_id": pm.id,
                        "agent_name": pm.name,
                        "agent_role": pm.role,
                        "content": update_content,
                        "message_type": "chat",
                        "created_at": update_message.created_at.isoformat(),
                    },
                ),
            )
            
            # Also broadcast to project
            await manager.broadcast_to_project(project_id, WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": update_message.id,
                    "channel_id": channel_id,
                    "agent_id": pm.id,
                    "agent_name": pm.name,
                    "agent_role": pm.role,
                    "content": update_content,
                    "message_type": "chat",
                    "created_at": update_message.created_at.isoformat(),
                },
            ))
            
            print(f"[/update] Successfully posted update from {pm.name}")
            
    except Exception as e:
        print(f"[/update] ERROR: {e}")
        import traceback
        traceback.print_exc()


async def handle_test_command(channel_id: str, project_id: str):
    """Handle the /test command by running and verifying the app."""
    from app.services.pm_manager import get_pm_manager
    from app.services.app_runner import get_app_runner
    from anthropic import AsyncAnthropic
    
    await asyncio.sleep(1.0)  # Small delay for realism
    
    async with AsyncSessionLocal() as db:
        pm_manager = get_pm_manager(lambda: db)
        app_runner = get_app_runner()
        
        # Get the PM
        pm = await pm_manager.get_pm_for_project(db, project_id)
        if not pm:
            return
        
        # First, post a "testing..." message
        testing_message = Message(
            channel_id=channel_id,
            agent_id=pm.id,
            content="On it! Let me test the app and verify it runs... 🔧",
            message_type="chat",
        )
        db.add(testing_message)
        await db.flush()
        await db.refresh(testing_message)
        await db.commit()
        
        await manager.broadcast_to_channel(
            channel_id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": testing_message.id,
                    "channel_id": channel_id,
                    "agent_id": pm.id,
                    "agent_name": pm.name,
                    "agent_role": pm.role,
                    "content": testing_message.content,
                    "message_type": "chat",
                    "created_at": testing_message.created_at.isoformat(),
                },
            ),
        )
        
        # Run the test
        test_results = await app_runner.test_app(project_id)
        
        # Generate a report using Claude
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        
        if test_results["run_success"]:
            report_prompt = f"""You're the PM reporting that the app test was SUCCESSFUL.

Test Results:
- Project Type: {test_results['project_type']}
- Install: {'✓ Success' if test_results['install_success'] else '✗ Failed'}
- Run: ✓ Success
- Port: {test_results['port']}

Run Instructions:
{test_results['instructions']}

Output:
{test_results['run_output'][:500]}

Write a brief, excited but professional message confirming the app works and how to run it.
Include the exact commands to run it. Keep it concise (3-5 sentences + commands)."""
        else:
            report_prompt = f"""You're the PM reporting that the app test FAILED.

Test Results:
- Project Type: {test_results['project_type']}
- Install: {'✓ Success' if test_results['install_success'] else '✗ Failed'}
- Run: ✗ Failed
- Error: {test_results['run_error']}

Output:
{test_results['run_output'][:500] if test_results['run_output'] else 'No output'}

Write a brief, honest message about what went wrong and what needs to be fixed.
Be specific about the error. Keep it concise (2-4 sentences)."""

        response = await client.messages.create(
            model=settings.model_pm,
            max_tokens=400,
            system=f"""You are {pm.name}, the PM. Report test results honestly and helpfully.
{pm.soul_prompt or ''}""",
            messages=[{"role": "user", "content": report_prompt}],
        )
        
        report_content = response.content[0].text
        
        # Post the report
        report_message = Message(
            channel_id=channel_id,
            agent_id=pm.id,
            content=report_content,
            message_type="chat",
        )
        db.add(report_message)
        await db.flush()
        await db.refresh(report_message)
        await db.commit()
        
        await manager.broadcast_to_channel(
            channel_id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": report_message.id,
                    "channel_id": channel_id,
                    "agent_id": pm.id,
                    "agent_name": pm.name,
                    "agent_role": pm.role,
                    "content": report_content,
                    "message_type": "chat",
                    "created_at": report_message.created_at.isoformat(),
                },
            ),
        )
        
        await manager.broadcast_to_project(project_id, WebSocketEvent(
            type=EventType.MESSAGE_NEW,
            data={
                "id": report_message.id,
                "channel_id": channel_id,
                "agent_id": pm.id,
                "agent_name": pm.name,
                "agent_role": pm.role,
                "content": report_content,
                "message_type": "chat",
                "created_at": report_message.created_at.isoformat(),
            },
        ))


async def handle_memorize_command(channel_id: str, project_id: str, instruction: str):
    """Handle the /memorize command by storing a persistent instruction for agents."""
    print(f"[/memorize] Storing instruction for project={project_id}: {instruction[:50]}...")
    
    try:
        async with AsyncSessionLocal() as db:
            # Get the project
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            
            if not project:
                return
            
            # Get or create memories list in config
            config = project.config or {}
            memories = config.get("memories", [])
            
            # Add the new memory with timestamp
            from datetime import datetime
            memories.append({
                "instruction": instruction,
                "added_at": datetime.utcnow().isoformat(),
                "channel_id": channel_id,
            })
            
            # Update config
            config["memories"] = memories
            project.config = config
            await db.commit()
            
            # Send confirmation message
            confirm_message = Message(
                channel_id=channel_id,
                agent_id=None,
                content=f"✓ **Memorized!** I'll remember: \"{instruction}\"\n\n_This instruction will be included in all agent conversations. Use `/memories` to see all stored instructions._",
                message_type="system",
            )
            db.add(confirm_message)
            await db.flush()
            await db.refresh(confirm_message)
            await db.commit()
            
            await manager.broadcast_to_channel(
                channel_id,
                WebSocketEvent(
                    type=EventType.MESSAGE_NEW,
                    data={
                        "id": confirm_message.id,
                        "channel_id": channel_id,
                        "content": confirm_message.content,
                        "message_type": "system",
                        "created_at": confirm_message.created_at.isoformat(),
                    },
                ),
            )
            
            print(f"[/memorize] Stored memory #{len(memories)}", flush=True)
            
    except Exception as e:
        print(f"[/memorize] Error: {e}", flush=True)


async def handle_memories_command(channel_id: str, project_id: str):
    """Handle the /memories command by showing all stored memories."""
    print(f"[/memories] Showing memories for project={project_id}")
    
    try:
        async with AsyncSessionLocal() as db:
            # Get the project
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            
            if not project:
                return
            
            config = project.config or {}
            memories = config.get("memories", [])
            
            if not memories:
                content = "📝 **No memories stored yet.**\n\nUse `/memorize <instruction>` to add persistent instructions that all agents will follow."
            else:
                content = f"📝 **Stored Memories ({len(memories)})**\n\n"
                for i, memory in enumerate(memories, 1):
                    instruction = memory.get("instruction", "")
                    added_at = memory.get("added_at", "")[:10]  # Just the date
                    content += f"{i}. {instruction}\n   _Added: {added_at}_\n\n"
                content += "_Use `/memorize <instruction>` to add more._"
            
            # Send the memories list
            mem_message = Message(
                channel_id=channel_id,
                agent_id=None,
                content=content,
                message_type="system",
            )
            db.add(mem_message)
            await db.flush()
            await db.refresh(mem_message)
            await db.commit()
            
            await manager.broadcast_to_channel(
                channel_id,
                WebSocketEvent(
                    type=EventType.MESSAGE_NEW,
                    data={
                        "id": mem_message.id,
                        "channel_id": channel_id,
                        "content": mem_message.content,
                        "message_type": "system",
                        "created_at": mem_message.created_at.isoformat(),
                    },
                ),
            )
            
    except Exception as e:
        print(f"[/memories] Error: {e}", flush=True)


async def handle_plan_command(channel_id: str, project_id: str, work_description: str):
    """Handle the /plan command by having the PM break down work into tasks."""
    from app.services.pm_manager import get_pm_manager
    
    print(f"[/plan] Starting for project={project_id}, work={work_description[:50]}...")
    
    await asyncio.sleep(1.0)  # Small delay for realism
    
    try:
        async with AsyncSessionLocal() as db:
            pm_manager = get_pm_manager(lambda: db)
            
            # Get the PM
            pm = await pm_manager.get_pm_for_project(db, project_id)
            if not pm:
                print(f"[/plan] No PM found for project {project_id}")
                return
            
            # Post a "working on it" message
            thinking_message = Message(
                channel_id=channel_id,
                agent_id=pm.id,
                content=f"Got it! Let me break this down into actionable tasks... 📋",
                message_type="chat",
            )
            db.add(thinking_message)
            await db.flush()
            await db.refresh(thinking_message)
            await db.commit()
            
            await manager.broadcast_to_channel(
                channel_id,
                WebSocketEvent(
                    type=EventType.MESSAGE_NEW,
                    data={
                        "id": thinking_message.id,
                        "channel_id": channel_id,
                        "agent_id": pm.id,
                        "agent_name": pm.name,
                        "agent_role": pm.role,
                        "content": thinking_message.content,
                        "message_type": "chat",
                        "created_at": thinking_message.created_at.isoformat(),
                    },
                ),
            )
            
            # Have PM create and assign tasks
            tasks = await pm_manager.pm_creates_work(
                db, project_id, pm, channel_id, work_description
            )
            
            print(f"[/plan] Created {len(tasks)} tasks")
            
            if not tasks:
                # Post error message
                error_message = Message(
                    channel_id=channel_id,
                    agent_id=pm.id,
                    content="Hmm, I had trouble breaking that down. Could you give me more details about what you'd like built?",
                    message_type="chat",
                )
                db.add(error_message)
                await db.flush()
                await db.refresh(error_message)
                await db.commit()
                
                await manager.broadcast_to_channel(
                    channel_id,
                    WebSocketEvent(
                        type=EventType.MESSAGE_NEW,
                        data={
                            "id": error_message.id,
                            "channel_id": channel_id,
                            "agent_id": pm.id,
                            "agent_name": pm.name,
                            "agent_role": pm.role,
                            "content": error_message.content,
                            "message_type": "chat",
                            "created_at": error_message.created_at.isoformat(),
                        },
                    ),
                )
            
    except Exception as e:
        print(f"[/plan] ERROR: {e}")
        import traceback
        traceback.print_exc()


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
    # Verify parent message exists
    parent_result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    if not parent_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Message not found")

    query = select(Message).where(Message.thread_id == message_id)

    # Get total count
    count_result = await db.execute(query)
    total = len(count_result.scalars().all())

    # Get paginated replies
    result = await db.execute(
        query.order_by(Message.created_at).offset(skip).limit(limit + 1)
    )
    messages = list(result.scalars().all())

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    return MessageListResponse(
        messages=[await message_to_response(m, db, include_reply_count=False) for m in messages],
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
