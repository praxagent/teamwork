"""Product Manager service for monitoring and coordinating the development team."""

import asyncio
from datetime import datetime, timedelta
from typing import Any

from anthropic import AsyncAnthropic
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Agent, ActivityLog, Channel, Message, Project, Task
from app.websocket import manager as ws_manager, WebSocketEvent, EventType


class PMManager:
    """
    Manages the Product Manager agent's oversight responsibilities.
    
    The PM:
    - Monitors all developer activity logs
    - Provides periodic updates in #general
    - Responds to /update commands
    - Proactively manages the team toward project goals
    """

    def __init__(self, db_session_factory):
        self._db_session_factory = db_session_factory
        self._anthropic_client: AsyncAnthropic | None = None

    def _get_client(self) -> AsyncAnthropic:
        if self._anthropic_client is None:
            self._anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._anthropic_client

    async def get_pm_for_project(self, db: AsyncSession, project_id: str) -> Agent | None:
        """Get the PM agent for a project."""
        result = await db.execute(
            select(Agent)
            .where(Agent.project_id == project_id)
            .where(Agent.role == "pm")
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def gather_team_status(self, db: AsyncSession, project_id: str) -> dict[str, Any]:
        """
        Gather comprehensive status from all team members.
        This pulls REAL data from activity logs, tasks, and workspace.
        """
        status = {
            "project_id": project_id,
            "timestamp": datetime.utcnow().isoformat(),
            "developers": [],
            "qa_engineers": [],
            "tasks_summary": {
                "total": 0,
                "pending": 0,
                "in_progress": 0,
                "completed": 0,
            },
            "recent_activities": [],
            "blockers": [],
            "files_created": 0,
        }

        # Get all agents
        agents_result = await db.execute(
            select(Agent).where(Agent.project_id == project_id)
        )
        agents = agents_result.scalars().all()

        # Get all tasks
        tasks_result = await db.execute(
            select(Task).where(Task.project_id == project_id)
        )
        tasks = tasks_result.scalars().all()

        # Create lookup for agent names
        agent_lookup = {a.id: a.name for a in agents}
        
        status["tasks_summary"]["total"] = len(tasks)
        status["tasks_summary"]["task_list"] = []
        
        for task in tasks:
            if task.status == "pending":
                status["tasks_summary"]["pending"] += 1
            elif task.status == "in_progress":
                status["tasks_summary"]["in_progress"] += 1
            elif task.status == "completed":
                status["tasks_summary"]["completed"] += 1
            
            # Add task to list for detailed reporting
            assignee_name = agent_lookup.get(task.assigned_to, "Unassigned") if task.assigned_to else "Unassigned"
            status["tasks_summary"]["task_list"].append({
                "title": task.title,
                "status": task.status,
                "assigned_to": assignee_name,
            })

        # Get recent activities (last 24 hours)
        cutoff = datetime.utcnow() - timedelta(hours=24)
        for agent in agents:
            if agent.role == "pm":
                continue  # Skip PM in team status

            activity_result = await db.execute(
                select(ActivityLog)
                .where(ActivityLog.agent_id == agent.id)
                .where(ActivityLog.created_at >= cutoff)
                .order_by(ActivityLog.created_at.desc())
                .limit(10)
            )
            activities = activity_result.scalars().all()

            # Get agent's current task
            task_result = await db.execute(
                select(Task)
                .where(Task.assigned_to == agent.id)
                .where(Task.status.in_(["pending", "in_progress"]))
                .limit(1)
            )
            current_task = task_result.scalar_one_or_none()

            # Get completed tasks count
            completed_result = await db.execute(
                select(func.count(Task.id))
                .where(Task.assigned_to == agent.id)
                .where(Task.status == "completed")
            )
            completed_count = completed_result.scalar() or 0

            agent_status = {
                "name": agent.name,
                "role": agent.role,
                "status": agent.status,
                "current_task": current_task.title if current_task else None,
                "current_task_status": current_task.status if current_task else None,
                "completed_tasks": completed_count,
                "recent_activities": [
                    {
                        "type": a.activity_type,
                        "description": a.description[:100],
                        "when": a.created_at.isoformat(),
                    }
                    for a in activities[:5]
                ],
                "has_activity_today": len(activities) > 0,
            }

            # Check for blockers (agents with "blocked" status or questions)
            if agent.status == "blocked":
                status["blockers"].append({
                    "agent": agent.name,
                    "task": current_task.title if current_task else "Unknown",
                    "reason": "Agent is blocked and needs help",
                })

            if agent.role == "developer":
                status["developers"].append(agent_status)
            elif agent.role == "qa":
                status["qa_engineers"].append(agent_status)

        # Check workspace for files
        from pathlib import Path
        from app.utils.workspace import get_project_workspace_path
        workspace_path = await get_project_workspace_path(project_id, db)
        if workspace_path.exists():
            try:
                file_count = sum(
                    1 for f in workspace_path.rglob("*")
                    if f.is_file() and not any(
                        p in str(f) for p in [".git", "__pycache__", "node_modules", ".venv"]
                    )
                )
                status["files_created"] = file_count
            except Exception:
                pass

        return status

    async def generate_status_update(
        self,
        db: AsyncSession,
        project_id: str,
        pm: Agent,
        context: str = "",
    ) -> str:
        """
        Have the PM generate a status update based on REAL team data.
        """
        client = self._get_client()

        # Gather real team status
        team_status = await self.gather_team_status(db, project_id)

        # Get project info
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()

        # Build status summary for PM
        developers_summary = []
        for dev in team_status["developers"]:
            if dev["has_activity_today"]:
                activity_desc = ", ".join(
                    a["type"] + ": " + a["description"][:50]
                    for a in dev["recent_activities"][:2]
                )
                developers_summary.append(
                    f"- {dev['name']}: Working on '{dev['current_task'] or 'no task'}' "
                    f"(status: {dev['status']}). Recent: {activity_desc or 'no recent activity'}"
                )
            else:
                developers_summary.append(
                    f"- {dev['name']}: {dev['current_task'] or 'No task assigned'} "
                    f"(status: {dev['status']}, NO activity in last 24h)"
                )

        qa_summary = []
        for qa in team_status["qa_engineers"]:
            qa_summary.append(
                f"- {qa['name']}: {qa['current_task'] or 'No task'} (status: {qa['status']})"
            )

        blockers_text = ""
        if team_status["blockers"]:
            blockers_text = "\n\nBLOCKERS:\n" + "\n".join(
                f"- {b['agent']} is blocked on '{b['task']}': {b['reason']}"
                for b in team_status["blockers"]
            )

        # Build detailed task list
        task_list = team_status['tasks_summary'].get('task_list', [])
        pending_tasks = [t for t in task_list if t['status'] == 'pending']
        in_progress_tasks = [t for t in task_list if t['status'] == 'in_progress']
        completed_tasks = [t for t in task_list if t['status'] == 'completed']
        
        task_details = f"""
TODO TASKS ({len(pending_tasks)}):
{chr(10).join(f"  - [{t['assigned_to']}] {t['title']}" for t in pending_tasks[:10]) if pending_tasks else '  - No tasks in TODO'}

IN PROGRESS ({len(in_progress_tasks)}):
{chr(10).join(f"  - [{t['assigned_to']}] {t['title']}" for t in in_progress_tasks[:10]) if in_progress_tasks else '  - No tasks in progress'}

COMPLETED ({len(completed_tasks)}):
{chr(10).join(f"  - [{t['assigned_to']}] {t['title']}" for t in completed_tasks[:5]) if completed_tasks else '  - No tasks completed yet'}
"""

        status_data = f"""
=== REAL TEAM STATUS (from activity logs) ===

Project: {project.name if project else 'Unknown'}

TASKS SUMMARY:
- Total: {team_status['tasks_summary']['total']}
- Pending/TODO: {team_status['tasks_summary']['pending']}
- In Progress: {team_status['tasks_summary']['in_progress']}
- Completed: {team_status['tasks_summary']['completed']}
{task_details}
FILES CREATED: {team_status['files_created']}

DEVELOPERS:
{chr(10).join(developers_summary) if developers_summary else '- No developers assigned'}

QA:
{chr(10).join(qa_summary) if qa_summary else '- No QA assigned'}
{blockers_text}
=== END STATUS ===
"""

        system_prompt = f"""You are {pm.name}, the Product Manager LEADING this development project.

{pm.soul_prompt or ''}

You are providing a status update to the CEO. You MUST ONLY report what is shown in the REAL TEAM STATUS above.
DO NOT make up progress. DO NOT invent work that isn't shown.

CRITICAL - YOU ARE A LEADER, NOT AN ORDER-TAKER:
- If there's no progress, don't just report it - STATE what YOU are doing about it
- If developers are idle, say you're assigning them work NOW
- If there are no tasks, say you're creating them NOW
- NEVER ask the CEO what they want you to do - YOU decide and DO IT
- End with what YOU ARE DOING, not what you COULD do

Example BAD response: "We don't have tasks yet. Would you like me to create some?"
Example GOOD response: "We don't have tasks yet. I'm breaking down the work now and will have assignments out in 5 minutes."

Be professional and direct. Report truth, then STATE YOUR ACTIONS.
"""

        prompt = f"""Based on the real team status data, provide an update to the CEO.
{context}

{status_data}

Generate a professional status update. Be honest about progress (or lack thereof).
If things aren't moving, STATE what YOU ARE DOING to fix it - don't ask permission, take action."""

        try:
            response = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=600,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text
        except Exception as e:
            return f"[Unable to generate status update: {str(e)[:50]}]"

    async def post_update_to_general(
        self,
        db: AsyncSession,
        project_id: str,
        content: str,
        pm: Agent,
        trigger_responses: bool = True,
    ) -> Message | None:
        """Post a message to #general from the PM."""
        import asyncio
        
        # Find #general channel
        channel_result = await db.execute(
            select(Channel)
            .where(Channel.project_id == project_id)
            .where(Channel.name == "general")
            .limit(1)
        )
        general_channel = channel_result.scalar_one_or_none()

        if not general_channel:
            return None

        # Create message
        message = Message(
            channel_id=general_channel.id,
            agent_id=pm.id,
            content=content,
            message_type="chat",
        )
        db.add(message)
        await db.flush()
        await db.refresh(message)
        await db.commit()

        # Log PM activity for meaningful updates
        is_status_update = any(kw in content.lower() for kw in ["status", "update", "progress", "check-in", "completed", "started"])
        is_assignment = "@" in content and "assigning" in content.lower()
        
        if is_status_update or len(content) > 200:
            activity_type = "status_update" if is_status_update else "team_communication"
            activity = ActivityLog(
                agent_id=pm.id,
                activity_type=activity_type,
                description=content[:150] + "..." if len(content) > 150 else content,
                extra_data={
                    "channel": "general",
                    "full_message": content,
                    "message_id": message.id,
                },
            )
            db.add(activity)
            await db.commit()

        # Broadcast
        message_event = WebSocketEvent(
            type=EventType.MESSAGE_NEW,
            data={
                "id": message.id,
                "channel_id": general_channel.id,
                "agent_id": pm.id,
                "agent_name": pm.name,
                "agent_role": pm.role,
                "content": content,
                "message_type": "chat",
                "created_at": message.created_at.isoformat(),
            },
        )
        await ws_manager.broadcast_to_channel(general_channel.id, message_event)
        await ws_manager.broadcast_to_project(project_id, message_event)

        # Trigger responses from mentioned agents
        if trigger_responses:
            asyncio.create_task(
                self._trigger_mentioned_agent_responses(
                    project_id, general_channel.id, content, message.id, pm.id
                )
            )

        return message

    async def _trigger_mentioned_agent_responses(
        self,
        project_id: str,
        channel_id: str,
        message_content: str,
        message_id: str,
        sender_agent_id: str,
    ):
        """Trigger responses from agents mentioned in a message."""
        import asyncio
        import random
        from anthropic import AsyncAnthropic
        from app.config import settings
        from app.models.base import AsyncSessionLocal
        
        # Small delay before agents respond
        await asyncio.sleep(random.uniform(2.0, 4.0))
        
        async with AsyncSessionLocal() as db:
            # Get all agents in this project
            agents_result = await db.execute(
                select(Agent).where(Agent.project_id == project_id)
            )
            all_agents = agents_result.scalars().all()
            
            # Find agents mentioned in the message
            content_lower = message_content.lower()
            mentioned_agents = []
            
            for agent in all_agents:
                # Skip the sender
                if agent.id == sender_agent_id:
                    continue
                
                # Check if agent is mentioned by name
                if agent.name.lower() in content_lower or agent.name.split()[0].lower() in content_lower:
                    mentioned_agents.append(agent)
            
            # If PM asks for status from everyone ("team", "sound off", "status", "everyone")
            team_keywords = ["team", "sound off", "everyone", "all of you", "status update"]
            if any(kw in content_lower for kw in team_keywords) and not mentioned_agents:
                # All non-PM agents should consider responding
                mentioned_agents = [a for a in all_agents if a.id != sender_agent_id and a.role != "pm"]
                # Limit to avoid flooding
                if len(mentioned_agents) > 3:
                    mentioned_agents = random.sample(mentioned_agents, 3)
            
            if not mentioned_agents:
                return
            
            # Get recent messages for context
            messages_result = await db.execute(
                select(Message)
                .where(Message.channel_id == channel_id)
                .order_by(Message.created_at.desc())
                .limit(10)
            )
            recent_msgs = messages_result.scalars().all()
            
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
            
            client = AsyncAnthropic(api_key=settings.anthropic_api_key)
            
            # Have each mentioned agent respond
            for agent in mentioned_agents:
                await asyncio.sleep(random.uniform(1.5, 3.5))
                
                # Get agent's current task
                task_result = await db.execute(
                    select(Task)
                    .where(Task.assigned_to == agent.id)
                    .where(Task.status.in_(["pending", "in_progress"]))
                    .order_by(Task.priority.desc())
                    .limit(1)
                )
                current_task = task_result.scalar_one_or_none()
                
                # Get agent's recent activities
                activity_result = await db.execute(
                    select(ActivityLog)
                    .where(ActivityLog.agent_id == agent.id)
                    .order_by(ActivityLog.created_at.desc())
                    .limit(5)
                )
                activities = activity_result.scalars().all()
                
                # Build context about agent's actual work
                work_context = ""
                if current_task:
                    work_context = f"You have a task assigned: '{current_task.title}' (status: {current_task.status})"
                else:
                    work_context = "You don't have any tasks assigned right now."
                
                if activities:
                    work_context += "\n\nYour recent activities:\n"
                    for a in activities[:3]:
                        work_context += f"- {a.description}\n"
                else:
                    work_context += "\nYou haven't started any work yet."
                
                # Check if this is a task assignment message
                assignment_keywords = ["assign", "get started", "work on", "jump on", "tackle", 
                                       "start on", "pick up", "your task", "new task"]
                is_task_assignment = any(kw in content_lower for kw in assignment_keywords)
                
                # Adjust prompt based on whether this is a task assignment
                if is_task_assignment and current_task:
                    action_instruction = f"""The PM has just assigned you a task or told you to start working.
You should:
1. Acknowledge the task
2. Say you're getting started on it RIGHT NOW
3. Be enthusiastic and action-oriented"""
                else:
                    action_instruction = """The PM has just called you out or asked for an update in #general. You must respond.

CRITICAL RULES:
1. Be HONEST about your status. If you haven't done any work, admit it.
2. If you have a task, explain what's happening with it.
3. If you're stuck, say so and explain why.
4. Be professional but natural in your response.
5. Keep response brief (2-3 sentences)."""
                
                # Generate response
                system_prompt = f"""You are {agent.name}, a {agent.role} on a development team.
{agent.soul_prompt or ''}

Your current work status:
{work_context}

{action_instruction}"""

                try:
                    response = await client.messages.create(
                        model="claude-sonnet-4-20250514",
                        max_tokens=200,
                        system=system_prompt,
                        messages=[
                            {"role": "user", "content": f"The PM just said: {message_content}\n\nRespond appropriately."}
                        ],
                    )
                    response_content = response.content[0].text
                except Exception as e:
                    response_content = f"On it! Getting started right now."
                
                # Create response message
                response_message = Message(
                    channel_id=channel_id,
                    agent_id=agent.id,
                    content=response_content,
                    message_type="chat",
                )
                db.add(response_message)
                await db.flush()
                await db.refresh(response_message)
                await db.commit()
                
                # Broadcast
                message_event = WebSocketEvent(
                    type=EventType.MESSAGE_NEW,
                    data={
                        "id": response_message.id,
                        "channel_id": channel_id,
                        "agent_id": agent.id,
                        "agent_name": agent.name,
                        "agent_role": agent.role,
                        "content": response_content,
                        "message_type": "chat",
                        "created_at": response_message.created_at.isoformat(),
                    },
                )
                await ws_manager.broadcast_to_channel(channel_id, message_event)
                await ws_manager.broadcast_to_project(project_id, message_event)
                
                # If this was a task assignment and they have a pending task, start execution
                if is_task_assignment and current_task and current_task.status == "pending":
                    await self._trigger_task_execution(
                        project_id, current_task.id, agent.id
                    )

    async def check_and_nudge_idle_developers(
        self,
        db: AsyncSession,
        project_id: str,
        pm: Agent,
    ) -> list[str]:
        """
        Check for idle developers and have PM nudge them.
        Returns list of nudge messages sent.
        """
        nudges = []
        cutoff = datetime.utcnow() - timedelta(hours=2)  # 2 hours of no activity

        # Get developers
        devs_result = await db.execute(
            select(Agent)
            .where(Agent.project_id == project_id)
            .where(Agent.role == "developer")
        )
        developers = devs_result.scalars().all()

        for dev in developers:
            # Check recent activity
            activity_result = await db.execute(
                select(ActivityLog)
                .where(ActivityLog.agent_id == dev.id)
                .where(ActivityLog.created_at >= cutoff)
                .limit(1)
            )
            has_recent_activity = activity_result.scalar_one_or_none() is not None

            if not has_recent_activity and dev.status == "idle":
                # Check if they have pending tasks
                task_result = await db.execute(
                    select(Task)
                    .where(Task.assigned_to == dev.id)
                    .where(Task.status.in_(["pending", "in_progress"]))
                    .limit(1)
                )
                pending_task = task_result.scalar_one_or_none()

                if pending_task:
                    nudge = f"Hey {dev.name.split()[0]}, how's it going with '{pending_task.title}'? Need any help getting unblocked?"
                    nudges.append(nudge)

        return nudges

    async def handle_update_command(
        self,
        db: AsyncSession,
        project_id: str,
        channel_id: str,
    ) -> str:
        """Handle the /update command from the CEO."""
        pm = await self.get_pm_for_project(db, project_id)
        if not pm:
            return "No Product Manager found for this project."

        # Generate comprehensive update
        update = await self.generate_status_update(
            db, project_id, pm,
            context="The CEO has requested a status update via /update command."
        )

        return update

    async def dm_developer(
        self,
        db: AsyncSession,
        pm: Agent,
        developer: Agent,
        message_content: str,
    ) -> Message | None:
        """Send a DM from PM to a developer."""
        # Find or create DM channel
        dm_channel_result = await db.execute(
            select(Channel)
            .where(Channel.project_id == pm.project_id)
            .where(Channel.type == "dm")
            .where(Channel.dm_participants == developer.id)
            .limit(1)
        )
        dm_channel = dm_channel_result.scalar_one_or_none()

        if not dm_channel:
            # Create DM channel
            dm_channel = Channel(
                project_id=pm.project_id,
                name=f"dm-{developer.name.lower().replace(' ', '-')}",
                type="dm",
                dm_participants=developer.id,
            )
            db.add(dm_channel)
            await db.flush()
            await db.refresh(dm_channel)

        # Create message
        message = Message(
            channel_id=dm_channel.id,
            agent_id=pm.id,
            content=message_content,
            message_type="chat",
        )
        db.add(message)
        await db.flush()
        await db.refresh(message)
        await db.commit()

        # Broadcast
        message_event = WebSocketEvent(
            type=EventType.MESSAGE_NEW,
            data={
                "id": message.id,
                "channel_id": dm_channel.id,
                "agent_id": pm.id,
                "agent_name": pm.name,
                "agent_role": pm.role,
                "content": message_content,
                "message_type": "chat",
                "created_at": message.created_at.isoformat(),
            },
        )
        await ws_manager.broadcast_to_channel(dm_channel.id, message_event)
        await ws_manager.broadcast_to_project(pm.project_id, message_event)

        # Trigger developer response
        asyncio.create_task(
            self._trigger_dm_response(
                dm_channel.id, message_content, message.id, developer, pm
            )
        )

        return message

    async def _trigger_dm_response(
        self,
        channel_id: str,
        pm_message: str,
        pm_message_id: str,
        developer: Agent,
        pm: Agent,
    ):
        """Trigger the developer to respond to a PM DM."""
        import asyncio
        import random
        from anthropic import AsyncAnthropic
        from app.config import settings
        from app.models.base import AsyncSessionLocal
        
        # Delay before responding
        await asyncio.sleep(random.uniform(2.0, 5.0))
        
        async with AsyncSessionLocal() as db:
            # Get developer's current task
            task_result = await db.execute(
                select(Task)
                .where(Task.assigned_to == developer.id)
                .where(Task.status.in_(["pending", "in_progress"]))
                .order_by(Task.priority.desc())
                .limit(1)
            )
            current_task = task_result.scalar_one_or_none()
            
            # Get recent activities
            activity_result = await db.execute(
                select(ActivityLog)
                .where(ActivityLog.agent_id == developer.id)
                .order_by(ActivityLog.created_at.desc())
                .limit(5)
            )
            activities = activity_result.scalars().all()
            
            # Build work context
            work_context = ""
            if current_task:
                work_context = f"Your current task: '{current_task.title}' (status: {current_task.status})"
            else:
                work_context = "You don't have any tasks assigned currently."
            
            if activities:
                work_context += "\n\nRecent activities:\n"
                for a in activities[:3]:
                    work_context += f"- {a.description}\n"
            else:
                work_context += "\nNo work recorded yet."
            
            client = AsyncAnthropic(api_key=settings.anthropic_api_key)
            
            system_prompt = f"""You are {developer.name}, a {developer.role}.
{developer.soul_prompt or ''}

Current work status:
{work_context}

The PM ({pm.name}) has just DM'd you. You should respond.

RULES:
1. Be honest about your status
2. If you haven't started work, acknowledge it and say you're getting on it
3. If you're stuck, explain why
4. Be professional but natural
5. Keep response brief (2-3 sentences)"""

            try:
                response = await client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=150,
                    system=system_prompt,
                    messages=[
                        {"role": "user", "content": f"PM says: {pm_message}"}
                    ],
                )
                response_content = response.content[0].text
            except Exception as e:
                response_content = f"On it! Getting started now."
            
            # Create response message
            response_message = Message(
                channel_id=channel_id,
                agent_id=developer.id,
                content=response_content,
                message_type="chat",
            )
            db.add(response_message)
            await db.flush()
            await db.refresh(response_message)
            await db.commit()
            
            # Broadcast
            message_event = WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": response_message.id,
                    "channel_id": channel_id,
                    "agent_id": developer.id,
                    "agent_name": developer.name,
                    "agent_role": developer.role,
                    "content": response_content,
                    "message_type": "chat",
                    "created_at": response_message.created_at.isoformat(),
                },
            )
            await ws_manager.broadcast_to_channel(channel_id, message_event)
            await ws_manager.broadcast_to_project(developer.project_id, message_event)
            
            # Check if this is a task assignment DM and start execution
            assignment_keywords = ["assign", "task", "get started", "work on", "new task"]
            if any(kw in pm_message.lower() for kw in assignment_keywords) and current_task:
                if current_task.status == "pending":
                    await self._trigger_task_execution(
                        developer.project_id, current_task.id, developer.id
                    )

    async def assign_unassigned_tasks(
        self,
        db: AsyncSession,
        project_id: str,
    ) -> list[dict]:
        """Find unassigned tasks and assign them to available developers."""
        assignments = []

        # Get unassigned tasks
        unassigned_result = await db.execute(
            select(Task)
            .where(Task.project_id == project_id)
            .where(Task.assigned_to.is_(None))
            .where(Task.status == "pending")
            .order_by(Task.priority.desc())
            .limit(5)
        )
        unassigned_tasks = unassigned_result.scalars().all()

        if not unassigned_tasks:
            return assignments

        # Get available developers (idle status, no current task)
        devs_result = await db.execute(
            select(Agent)
            .where(Agent.project_id == project_id)
            .where(Agent.role == "developer")
            .where(Agent.status == "idle")
        )
        available_devs = devs_result.scalars().all()

        # Filter to those without active tasks
        truly_available = []
        for dev in available_devs:
            active_task_result = await db.execute(
                select(Task)
                .where(Task.assigned_to == dev.id)
                .where(Task.status.in_(["pending", "in_progress"]))
                .limit(1)
            )
            if not active_task_result.scalar_one_or_none():
                truly_available.append(dev)

        # Assign tasks
        for i, task in enumerate(unassigned_tasks):
            if i >= len(truly_available):
                break

            dev = truly_available[i]
            task.assigned_to = dev.id
            assignments.append({
                "task": task.title,
                "developer": dev.name,
            })

        if assignments:
            await db.commit()

        return assignments

    async def check_project_health(
        self,
        db: AsyncSession,
        project_id: str,
    ) -> dict:
        """Assess overall project health and identify issues."""
        health = {
            "status": "healthy",  # healthy, warning, critical
            "issues": [],
            "recommendations": [],
        }

        team_status = await self.gather_team_status(db, project_id)

        # Check for blockers
        if team_status["blockers"]:
            health["status"] = "critical"
            health["issues"].append(f"{len(team_status['blockers'])} team member(s) are blocked")
            health["recommendations"].append("Address blockers immediately")

        # Check task progress
        total_tasks = team_status["tasks_summary"]["total"]
        completed = team_status["tasks_summary"]["completed"]
        in_progress = team_status["tasks_summary"]["in_progress"]

        if total_tasks > 0:
            completion_rate = completed / total_tasks
            if completion_rate < 0.1 and total_tasks > 3:
                if health["status"] == "healthy":
                    health["status"] = "warning"
                health["issues"].append("Low task completion rate")
                health["recommendations"].append("Review if tasks are properly scoped")

        # Check for idle developers
        idle_with_tasks = [
            d for d in team_status["developers"]
            if d["status"] == "idle" and d["current_task"]
        ]
        if idle_with_tasks:
            if health["status"] == "healthy":
                health["status"] = "warning"
            health["issues"].append(f"{len(idle_with_tasks)} developer(s) idle despite having tasks")
            health["recommendations"].append("Check if developers need guidance or are stuck")

        # Check for developers with no activity
        no_activity = [
            d for d in team_status["developers"]
            if not d["has_activity_today"] and d["current_task"]
        ]
        if no_activity:
            if health["status"] == "healthy":
                health["status"] = "warning"
            health["issues"].append(f"{len(no_activity)} developer(s) with no recent activity")

        return health

    async def check_if_work_complete(
        self,
        db: AsyncSession,
        project_id: str,
    ) -> dict:
        """
        Check if all tasks are complete and the project is ready for review.
        Returns status and details.
        """
        result = {
            "all_complete": False,
            "total_tasks": 0,
            "completed_tasks": 0,
            "pending_tasks": 0,
            "in_progress_tasks": 0,
            "files_created": 0,
            "ready_for_review": False,
        }

        # Get all tasks
        tasks_result = await db.execute(
            select(Task).where(Task.project_id == project_id)
        )
        tasks = tasks_result.scalars().all()

        result["total_tasks"] = len(tasks)
        
        if not tasks:
            return result

        for task in tasks:
            if task.status == "completed":
                result["completed_tasks"] += 1
            elif task.status == "in_progress":
                result["in_progress_tasks"] += 1
            else:
                result["pending_tasks"] += 1

        # Check workspace for files
        from pathlib import Path
        from app.utils.workspace import get_project_workspace_path
        workspace_path = await get_project_workspace_path(project_id, db)
        if workspace_path.exists():
            try:
                file_count = sum(
                    1 for f in workspace_path.rglob("*")
                    if f.is_file() and not any(
                        p in str(f) for p in [".git", "__pycache__", "node_modules", ".venv"]
                    )
                )
                result["files_created"] = file_count
            except Exception:
                pass

        # All complete if we have tasks and all are done
        result["all_complete"] = (
            result["total_tasks"] > 0 and 
            result["completed_tasks"] == result["total_tasks"]
        )

        # Ready for review if all complete AND we have files
        result["ready_for_review"] = (
            result["all_complete"] and result["files_created"] > 0
        )

        return result

    async def announce_completion(
        self,
        db: AsyncSession,
        project_id: str,
        pm: Agent,
    ) -> bool:
        """
        Announce that all work is complete and request CEO review.
        Posts a celebratory message in #general.
        """
        client = self._get_client()
        
        # Get completion status
        completion = await self.check_if_work_complete(db, project_id)
        
        if not completion["ready_for_review"]:
            return False

        # Get project info
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()

        # Generate celebratory message
        prompt = f"""You're the PM announcing that all tasks are COMPLETE and the project is ready for CEO review!

Project: {project.name if project else 'the project'}
Tasks completed: {completion['completed_tasks']}
Files created: {completion['files_created']}

Write a SHORT celebratory message (2-3 sentences) that:
1. Celebrates the team's work
2. Tags @CEO asking them to review
3. Mentions they can use /test to verify the app works
4. Is enthusiastic but professional

Start with something like "🎉 @CEO" to get their attention."""

        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            system=f"You are {pm.name}, the PM. Write a brief, celebratory completion announcement.",
            messages=[{"role": "user", "content": prompt}],
        )

        announcement = response.content[0].text

        # Post to #general
        await self.post_update_to_general(db, project_id, announcement, pm)

        # Log this activity
        activity = ActivityLog(
            agent_id=pm.id,
            activity_type="project_complete",
            description=f"Announced project completion - {completion['completed_tasks']} tasks done, {completion['files_created']} files created",
            extra_data=completion,
        )
        db.add(activity)
        await db.commit()

        return True

    async def create_task(
        self,
        db: AsyncSession,
        project_id: str,
        title: str,
        description: str | None = None,
        team: str | None = None,
        priority: int = 0,
        assigned_to: str | None = None,
    ) -> Task:
        """Create a new task."""
        task = Task(
            project_id=project_id,
            title=title,
            description=description,
            team=team,
            priority=priority,
            assigned_to=assigned_to,
            status="pending",
        )
        db.add(task)
        await db.flush()
        await db.refresh(task)
        await db.commit()
        return task

    async def assign_task_to_agent(
        self,
        db: AsyncSession,
        task: Task,
        agent: Agent,
        pm: Agent,
        auto_start: bool = True,
    ) -> bool:
        """
        Assign a task to an agent, notify them, and optionally start execution.
        
        Args:
            db: Database session
            task: The task to assign
            agent: The agent to assign to
            pm: The PM agent doing the assignment
            auto_start: Whether to automatically start task execution
        """
        # Check if this is the first task assignment for this project (kickoff)
        assigned_count_result = await db.execute(
            select(Task).where(
                Task.project_id == task.project_id,
                Task.assigned_to.isnot(None)
            )
        )
        is_first_assignment = len(assigned_count_result.scalars().all()) == 0
        
        task.assigned_to = agent.id
        task.status = "pending"
        await db.commit()

        # Post kickoff message if this is the first assignment
        if is_first_assignment:
            kickoff_msg = f"""🚀 **Alright team, let's get started!**

I've reviewed our backlog and I'm ready to start handing out tasks. We've got some exciting work ahead of us!

I'll be assigning tasks based on your skills and availability. Let's build something great together! 💪"""
            await self.post_update_to_general(db, task.project_id, kickoff_msg, pm, trigger_responses=False)
            
            # Log kickoff activity
            kickoff_activity = ActivityLog(
                agent_id=pm.id,
                activity_type="project_kickoff",
                description="Kicked off the project and started assigning tasks",
                extra_data={"project_id": task.project_id},
            )
            db.add(kickoff_activity)

        # Post assignment in #general with @ mention
        general_msg = f"@{agent.name} - I'm assigning you: **{task.title}**\n\n"
        if task.description:
            general_msg += f"{task.description[:150]}...\n\n"
        general_msg += "Get started on this right away. Let me know if you have blockers!"
        
        await self.post_update_to_general(db, task.project_id, general_msg, pm, trigger_responses=True)

        # Log task assignment activity
        assignment_activity = ActivityLog(
            agent_id=pm.id,
            activity_type="task_assigned",
            description=f"Assigned '{task.title}' to {agent.name}",
            extra_data={
                "task_id": task.id,
                "task_title": task.title,
                "assigned_to_id": agent.id,
                "assigned_to_name": agent.name,
            },
        )
        db.add(assignment_activity)
        await db.commit()

        # DM the agent about their new task
        dm_content = f"Hey {agent.name.split()[0]}! I've assigned you a new task: **{task.title}**"
        if task.description:
            dm_content += f"\n\n{task.description[:200]}..."
        dm_content += "\n\nLet me know if you have any questions or need clarification!"

        await self.dm_developer(db, pm, agent, dm_content)
        
        # Auto-start task execution if enabled
        if auto_start:
            await self._trigger_task_execution(task.project_id, task.id, agent.id)
        
        return True

    async def _trigger_task_execution(
        self,
        project_id: str,
        task_id: str,
        agent_id: str,
    ):
        """Trigger actual task execution via Claude Code."""
        import asyncio
        from app.services.agent_manager import get_agent_manager, check_claude_code_available
        from app.models.base import AsyncSessionLocal
        
        # Check if Claude Code is available
        if not check_claude_code_available():
            print(f"Claude Code not available, skipping auto-execution for task {task_id}")
            return
        
        # Get project config to check if auto-execute is enabled
        async with AsyncSessionLocal() as db:
            project_result = await db.execute(
                select(Project).where(Project.id == project_id)
            )
            project = project_result.scalar_one_or_none()
            
            if not project:
                return
            
            config = project.config or {}
            # Default to True for autonomous mode
            if not config.get("auto_execute_tasks", True):
                print(f"Auto-execute disabled, skipping for task {task_id}")
                return
        
        # Small delay to let the assignment commit
        await asyncio.sleep(1.0)
        
        # Start the agent and execute the task
        try:
            agent_manager = get_agent_manager()
            await agent_manager.start_agent(agent_id, project_id)
            
            # Execute in background
            asyncio.create_task(agent_manager.execute_task(agent_id, task_id))
            print(f"Started task execution: {task_id} by agent {agent_id}")
        except Exception as e:
            print(f"Error starting task execution: {e}")

    async def break_down_and_create_tasks(
        self,
        db: AsyncSession,
        project_id: str,
        pm: Agent,
        goal: str,
        auto_assign: bool = True,
    ) -> list[Task]:
        """
        Use AI to break down a high-level goal into specific tasks,
        create them, and optionally assign to available developers and QA.
        """
        client = self._get_client()

        # Get available developers
        devs_result = await db.execute(
            select(Agent)
            .where(Agent.project_id == project_id)
            .where(Agent.role == "developer")
        )
        developers = devs_result.scalars().all()
        dev_names = [d.name for d in developers]
        
        # Get available QA engineers
        qa_result = await db.execute(
            select(Agent)
            .where(Agent.project_id == project_id)
            .where(Agent.role == "qa")
        )
        qa_engineers = qa_result.scalars().all()
        qa_names = [q.name for q in qa_engineers]

        # Get project info
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()

        prompt = f"""You are a Product Manager breaking down a goal into specific, actionable tasks.

Project: {project.name if project else 'Unknown'}
Goal: {goal}

Available developers: {', '.join(dev_names) if dev_names else 'None assigned yet'}
Available QA engineers: {', '.join(qa_names) if qa_names else 'None assigned yet'}

Break this goal into 3-7 specific, actionable tasks. IMPORTANT:
- Include BOTH development tasks AND testing tasks
- For every major feature, include a corresponding test task
- Test tasks should include: writing unit tests, integration tests, and manual testing
- Assign development tasks to developers
- Assign testing/QA tasks to QA engineers

Each task should be:
- Clear and specific
- Achievable by one person
- Have a descriptive title (max 100 chars)
- Have a brief description of what needs to be done
- Specify the task_type: "development" or "testing"

Return your response as a JSON array of tasks:
[
  {{"title": "Implement user login", "description": "Create login form and authentication logic", "priority": 5, "task_type": "development", "suggested_assignee": "Developer Name"}},
  {{"title": "Write unit tests for authentication", "description": "Create comprehensive unit tests for login, logout, and session management", "priority": 4, "task_type": "testing", "suggested_assignee": "QA Engineer Name"}}
]

Only return the JSON array, no other text."""

        try:
            response = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )

            import json
            response_text = response.content[0].text.strip()
            # Extract JSON from response
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]
            
            tasks_data = json.loads(response_text)
            created_tasks = []

            # Build lookup maps for both developers and QA
            agent_by_name = {}
            for d in developers:
                agent_by_name[d.name.lower()] = d
                agent_by_name[d.name.split()[0].lower()] = d
            for q in qa_engineers:
                agent_by_name[q.name.lower()] = q
                agent_by_name[q.name.split()[0].lower()] = q

            for task_data in tasks_data:
                # Find suggested assignee
                assignee_id = None
                assigned_agent = None
                if auto_assign and task_data.get("suggested_assignee"):
                    suggested = task_data["suggested_assignee"].lower()
                    if suggested in agent_by_name:
                        assigned_agent = agent_by_name[suggested]
                        assignee_id = assigned_agent.id

                task = await self.create_task(
                    db=db,
                    project_id=project_id,
                    title=task_data["title"][:500],
                    description=task_data.get("description"),
                    priority=task_data.get("priority", 0),
                    assigned_to=assignee_id,
                )
                created_tasks.append(task)

                # Notify assigned agent (developer or QA)
                if assigned_agent:
                    await self.assign_task_to_agent(db, task, assigned_agent, pm)

            # Log task breakdown activity
            if created_tasks:
                breakdown_activity = ActivityLog(
                    agent_id=pm.id,
                    activity_type="tasks_created",
                    description=f"Created {len(created_tasks)} tasks from user request",
                    extra_data={
                        "task_count": len(created_tasks),
                        "task_titles": [t.title for t in created_tasks[:10]],
                        "original_request": work_description[:500] if 'work_description' in dir() else None,
                    },
                )
                db.add(breakdown_activity)
                await db.commit()

            return created_tasks

        except Exception as e:
            print(f"Error breaking down tasks: {e}")
            import traceback
            traceback.print_exc()
            return []

    async def pm_creates_work(
        self,
        db: AsyncSession,
        project_id: str,
        pm: Agent,
        channel_id: str,
        work_description: str,
    ) -> list[Task]:
        """
        PM creates work from a description, announces it, and assigns it.
        This is the main entry point for PM-initiated task creation.
        """
        # Break down the work into tasks
        tasks = await self.break_down_and_create_tasks(
            db, project_id, pm, work_description, auto_assign=True
        )

        if not tasks:
            return []

        # Announce in the channel
        task_list = "\n".join(f"• **{t.title}**" for t in tasks)
        announcement = f"Alright team, I've broken this down into {len(tasks)} tasks:\n\n{task_list}\n\nI've assigned these to the relevant developers. Let's get moving!"

        # Post announcement
        message = Message(
            channel_id=channel_id,
            agent_id=pm.id,
            content=announcement,
            message_type="chat",
        )
        db.add(message)
        await db.flush()
        await db.refresh(message)
        await db.commit()

        # Broadcast
        await ws_manager.broadcast_to_channel(
            channel_id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": message.id,
                    "channel_id": channel_id,
                    "agent_id": pm.id,
                    "agent_name": pm.name,
                    "agent_role": pm.role,
                    "content": announcement,
                    "message_type": "chat",
                    "created_at": message.created_at.isoformat(),
                },
            ),
        )

        return tasks


# Global instance
_pm_manager: PMManager | None = None


def get_pm_manager(db_session_factory) -> PMManager:
    global _pm_manager
    if _pm_manager is None:
        _pm_manager = PMManager(db_session_factory)
    return _pm_manager
