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
    workspace_path = settings.workspace_path / project_id
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


async def generate_agent_response(
    agent: Agent,
    channel: Channel,
    user_message: str,
    recent_messages: list[dict],
    real_work_status: dict,
    project_task_board: dict | None = None,
) -> str:
    """Generate an agent's response using Claude, based on REAL work data only."""
    client = get_anthropic_client()

    # Build conversation context
    conversation = "\n".join(
        f"{m['sender']}: {m['content']}" for m in recent_messages[-10:]
    )

    # Build work context ONLY from verified real data
    current_task = real_work_status.get("current_task")
    completed_tasks = real_work_status.get("completed_tasks", [])
    recent_activities = real_work_status.get("recent_activities", [])
    files_created = real_work_status.get("files_created", [])
    
    work_context = f"""
=== YOUR ACTUAL WORK STATUS (FROM SYSTEM LOGS - THIS IS THE TRUTH) ===

{real_work_status['summary']}

Current assigned task: {current_task['title'] if current_task else 'NONE - You have no task assigned'}
Current task status: {current_task['status'] if current_task else 'N/A'}

Completed tasks: {len(completed_tasks)}
{chr(10).join('- ' + t['title'] for t in completed_tasks[:3]) if completed_tasks else '- None completed yet'}

Files you have created in the workspace: {len(files_created)}
{chr(10).join('- ' + f for f in files_created[:5]) if files_created else '- No files created yet'}

Recent recorded activities: {len(recent_activities)}
{chr(10).join('- ' + a['type'] + ': ' + a['description'][:100] for a in recent_activities[:5]) if recent_activities else '- No activities recorded'}

=== END OF ACTUAL WORK STATUS ===

CRITICAL: The above is your REAL work status from system logs. You MUST ONLY reference work that appears above.
If it says "No work has been done yet" - that means YOU HAVE NOT DONE ANY WORK. Do not invent work.
If no files are listed - YOU HAVE NOT CREATED ANY FILES. Do not claim you have.
If no tasks are completed - YOU HAVE NOT COMPLETED ANY TASKS. Do not claim you have.
"""

    # Special handling for PM - they should be PROACTIVE leaders, not passive order-takers
    if agent.role == "pm":
        # Build task board context for PM
        task_board_context = ""
        if project_task_board:
            tb = project_task_board
            task_board_context = f"""
=== CURRENT TASK BOARD (REAL DATA FROM DATABASE) ===

SUMMARY: {tb['total_tasks']} total tasks
- TODO: {tb['todo_count']}
- In Progress: {tb['in_progress_count']}
- Blocked: {tb['blocked_count']}
- Completed: {tb['completed_count']}

TODO TASKS ({tb['todo_count']}):
{chr(10).join(f"- [{t['assigned_to']}] {t['title']}" for t in tb['todo_tasks'][:10]) if tb['todo_tasks'] else "- No tasks in TODO"}

IN PROGRESS ({tb['in_progress_count']}):
{chr(10).join(f"- [{t['assigned_to']}] {t['title']}" for t in tb['in_progress_tasks'][:10]) if tb['in_progress_tasks'] else "- No tasks in progress"}

BLOCKED ({tb['blocked_count']}):
{chr(10).join(f"- [{t['assigned_to']}] {t['title']}" for t in tb['blocked_tasks'][:10]) if tb['blocked_tasks'] else "- No blocked tasks"}

RECENTLY COMPLETED ({tb['completed_count']} total):
{chr(10).join(f"- [{t['assigned_to']}] {t['title']}" for t in tb['completed_tasks']) if tb['completed_tasks'] else "- No tasks completed yet"}

TEAM STATUS:
{chr(10).join(f"- {a['name']} ({a['role']}): {a['status']} - {a['completed_tasks']}/{a['assigned_tasks']} tasks done" for a in tb['agent_statuses'])}

=== END TASK BOARD ===
"""
        else:
            task_board_context = """
=== TASK BOARD STATUS ===
No task board data available. Use /plan command to create tasks.
=== END TASK BOARD ===
"""

        pm_directive = """
=== PM LEADERSHIP DIRECTIVE ===
You are the PRODUCT MANAGER. You are a LEADER, not an order-taker.

CRITICAL PM BEHAVIORS:
1. NEVER ask the CEO "what would you like me to prioritize?" - YOU decide priorities
2. NEVER say "I'm ready when you assign tasks" - YOU create and assign tasks
3. NEVER be passive or wait for instructions - TAKE INITIATIVE
4. If there's no work happening, YOU create the plan and get people moving
5. If developers are idle, YOU assign them work
6. YOU drive the project forward - the CEO hired you to lead, not to wait

When responding:
- Be decisive: "Here's what I'm doing..." not "What should I do?"
- Be proactive: "I'm creating tasks for the team..." not "Should I create tasks?"
- Take ownership: "I'll handle this by..." not "Would you like me to..."
- Report status confidently with ACTUAL NUMBERS from the task board above
- Reference SPECIFIC task titles and assignees from the task board

The CEO wants a PM who RUNS the project, not one who needs babysitting.

IMPORTANT: You have FULL ACCESS to the task board data above. When asked about TODO counts,
task status, or what the team is working on - USE THE ACTUAL DATA. Don't say you need to check,
you already have the data right there.
=== END PM DIRECTIVE ===
"""
        system_prompt = f"""You are {agent.name}, the PRODUCT MANAGER leading this development project.

{agent.soul_prompt or ''}

{agent.skills_prompt or ''}

{pm_directive}

{task_board_context}

{work_context}

You are in channel #{channel.name}. Be a LEADER.
- When asked about task counts, use the EXACT numbers from the task board above
- Reference SPECIFIC tasks by name when discussing work
- State what IS happening based on the data, don't make vague claims
- Drive the project forward with concrete actions"""
    else:
        system_prompt = f"""You are {agent.name}, a team member in a development project.

{agent.soul_prompt or ''}

{agent.skills_prompt or ''}

{work_context}

ABSOLUTE RULES - VIOLATION WILL BREAK THE SYSTEM:
1. You can ONLY mention work that appears in "YOUR ACTUAL WORK STATUS" section above
2. If your work status shows "No work has been done yet" - you MUST say you haven't started yet
3. NEVER invent file names, branch names, bug fixes, or features you didn't actually work on
4. NEVER say things like "just wrapped up", "currently debugging", "pushed to branch" unless the activity log shows it
5. If asked for an update and you have no recorded activity, be honest about it
6. It's OK to be honest about not having done work yet. The CEO prefers honesty over false progress reports.

You are in channel #{channel.name}. Respond naturally but ONLY based on real data.
- Keep responses concise
- Be honest about your actual work status
- If you have nothing to report, say so"""

    prompt = f"""Recent conversation:
{conversation}

CEO (the user): {user_message}

Respond as {agent.name}. Reference ONLY the work shown in your actual work status. If no work is recorded, be honest about it."""

    try:
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
    except Exception as e:
        return f"[Sorry, I'm having trouble responding right now. Error: {str(e)[:50]}]"


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
                                agent, channel, user_message_content, recent_messages, real_work_status, project_task_board
                            )
                    except Exception as e:
                        import traceback
                        print(f">>> ERROR in PM task creation: {e}", flush=True)
                        print(f">>> Traceback: {traceback.format_exc()}", flush=True)
                        # Fallback to normal response
                        real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)
                        project_task_board = await get_project_task_board(db, channel.project_id)
                        response_content = await generate_agent_response(
                            agent, channel, user_message_content, recent_messages, real_work_status, project_task_board
                        )
                else:
                    # PM responds normally but with real data AND full task board visibility
                    real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)
                    project_task_board = await get_project_task_board(db, channel.project_id)
                    response_content = await generate_agent_response(
                        agent, channel, user_message_content, recent_messages, real_work_status, project_task_board
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
                            agent, channel, user_message_content, recent_messages, real_work_status
                        )
                else:
                    # Normal response - Get the agent's REAL work status from database and filesystem
                    real_work_status = await get_agent_real_work_status(db, agent.id, channel.project_id)

                    # Generate response with ONLY real verified data
                    response_content = await generate_agent_response(
                        agent, channel, user_message_content, recent_messages, real_work_status
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

            # Stop typing indicator
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
    # Verify channel exists
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    if not channel_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Channel not found")

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
            model="claude-sonnet-4-20250514",
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
