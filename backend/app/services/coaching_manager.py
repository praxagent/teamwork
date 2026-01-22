"""Coaching manager service for proactive outreach and monitoring."""

import asyncio
import logging
import random
from datetime import datetime, timedelta
from typing import Any

from anthropic import AsyncAnthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Agent, Channel, Message, Project
from app.models.base import AsyncSessionLocal
from app.services.progress_tracker import ProgressTracker

logger = logging.getLogger(__name__)

# Track active monitoring tasks per project
_active_monitors: dict[str, asyncio.Task] = {}


def start_coaching_monitoring(project_id: str) -> None:
    """
    Start the coaching monitoring background task for a project.
    This handles proactive check-ins from the Personal Manager.
    Also triggers the initial kickoff sequence.
    """
    if project_id in _active_monitors:
        logger.info(f"[CoachingManager] Monitoring already active for project {project_id}")
        return

    # Start the monitoring loop
    task = asyncio.create_task(_coaching_monitor_loop(project_id))
    _active_monitors[project_id] = task
    logger.info(f"[CoachingManager] Started monitoring for project {project_id}")
    
    # Trigger the kickoff sequence after a short delay (let the UI settle)
    asyncio.create_task(_delayed_kickoff(project_id, delay_seconds=3))


def stop_coaching_monitoring(project_id: str) -> None:
    """Stop the coaching monitoring for a project."""
    if project_id in _active_monitors:
        _active_monitors[project_id].cancel()
        del _active_monitors[project_id]
        logger.info(f"[CoachingManager] Stopped monitoring for project {project_id}")


async def _delayed_kickoff(project_id: str, delay_seconds: int = 3) -> None:
    """Delay the kickoff to let the UI settle."""
    await asyncio.sleep(delay_seconds)
    await initiate_coaching_kickoff(project_id)


async def initiate_coaching_kickoff(project_id: str) -> None:
    """
    Initiate the coaching kickoff sequence.
    This fires right after team creation to get things rolling:
    1. Each coach introduces themselves in their topic channel
    2. Personal Manager posts a "let's get started" message in #general
    3. Personal Manager asks user to pick their first topic
    """
    logger.info(f"[CoachingManager] Starting kickoff sequence for project {project_id}")
    
    async with AsyncSessionLocal() as db:
        # Get project info
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()
        
        if not project:
            logger.error(f"[CoachingManager] Project {project_id} not found for kickoff")
            return
        
        # Get all agents
        agents_result = await db.execute(
            select(Agent).where(Agent.project_id == project_id)
        )
        agents = list(agents_result.scalars().all())
        
        personal_manager = next((a for a in agents if a.role == "personal_manager"), None)
        coaches = [a for a in agents if a.role == "coach"]
        
        if not personal_manager:
            logger.error(f"[CoachingManager] No Personal Manager found for kickoff")
            return
        
        # Get all channels
        channels_result = await db.execute(
            select(Channel).where(Channel.project_id == project_id)
        )
        channels = list(channels_result.scalars().all())
        
        general_channel = next((c for c in channels if c.name == "general"), None)
        
        # Step 1: Have each coach introduce themselves in their topic channel
        for coach in coaches:
            topic_channel = next(
                (c for c in channels if c.team and c.team.lower() == (coach.specialization or "").lower()),
                None
            )
            if topic_channel:
                await _coach_intro_message(db, coach, topic_channel, project)
                await asyncio.sleep(1)  # Small delay between messages
        
        # Step 2: Personal Manager posts a "let's get started" message
        if general_channel:
            await asyncio.sleep(2)  # Let coach messages arrive first
            await _manager_kickoff_message(db, personal_manager, general_channel, coaches, project)
        
        await db.commit()
        logger.info(f"[CoachingManager] Kickoff sequence complete for project {project_id}")


async def _coach_intro_message(
    db: AsyncSession,
    coach: Agent,
    channel: Channel,
    project: Project,
) -> None:
    """Have a coach introduce themselves in their topic channel."""
    try:
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        
        # Get coach's persona info
        persona = coach.persona or {}
        teaching_style = persona.get("coaching_style", {}).get("feedback_style", "encouraging and supportive")
        
        prompt = f"""You are {coach.name}, a coach specializing in {coach.specialization}.
Your teaching style: {teaching_style}

Write a SHORT (2-3 sentences) introduction message for your topic channel. 
- Introduce yourself warmly
- Express excitement about helping the learner with {coach.specialization}
- Suggest ONE specific thing they could start with or ask you about

Keep it friendly, not overwhelming. This is their first day!"""

        response = await client.messages.create(
            model=settings.model_pm,
            max_tokens=200,
            system=coach.soul_prompt or f"You are {coach.name}, an expert {coach.specialization} coach.",
            messages=[{"role": "user", "content": prompt}],
        )
        
        content = response.content[0].text
        
        message = Message(
            channel_id=channel.id,
            agent_id=coach.id,
            content=content,
            message_type="chat",
        )
        db.add(message)
        await db.flush()
        
        # Broadcast
        await _broadcast_message(channel, coach, content, message)
        logger.info(f"[CoachingManager] Coach {coach.name} introduced themselves in #{channel.name}")
        
    except Exception as e:
        logger.error(f"[CoachingManager] Error generating coach intro for {coach.name}: {e}")


async def _manager_kickoff_message(
    db: AsyncSession,
    manager: Agent,
    channel: Channel,
    coaches: list[Agent],
    project: Project,
) -> None:
    """Have the Personal Manager post a kickoff message."""
    try:
        topics = [c.specialization for c in coaches if c.specialization]
        topics_list = ", ".join(topics[:-1]) + f" and {topics[-1]}" if len(topics) > 1 else topics[0] if topics else "your topics"
        
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        
        prompt = f"""You are {manager.name}, the Personal Manager for this learning journey.
The learner's topics are: {topics_list}
The coaches have just introduced themselves in their channels.

Write a SHORT (3-4 sentences) kickoff message for #general that:
1. Notes that the coaches have introduced themselves in the topic channels
2. Asks the learner which topic they'd like to START with today
3. Reminds them you're here to help coordinate and keep them motivated

Be warm and encouraging but CONCISE. Get them to take action!"""

        response = await client.messages.create(
            model=settings.model_pm,
            max_tokens=250,
            system=manager.soul_prompt or f"You are {manager.name}, a supportive personal learning manager.",
            messages=[{"role": "user", "content": prompt}],
        )
        
        content = response.content[0].text
        
        message = Message(
            channel_id=channel.id,
            agent_id=manager.id,
            content=content,
            message_type="chat",
        )
        db.add(message)
        await db.flush()
        
        # Broadcast
        await _broadcast_message(channel, manager, content, message)
        logger.info(f"[CoachingManager] Personal Manager posted kickoff in #{channel.name}")
        
    except Exception as e:
        logger.error(f"[CoachingManager] Error generating manager kickoff: {e}")


async def _broadcast_message(channel: Channel, agent: Agent, content: str, message: Message) -> None:
    """Broadcast a message via WebSocket."""
    try:
        from app.websocket import manager as ws_manager, WebSocketEvent, EventType
        
        event = WebSocketEvent(
            type=EventType.MESSAGE_NEW,
            data={
                "id": str(message.id),
                "channel_id": str(channel.id),
                "agent_id": str(agent.id),
                "agent_name": agent.name,
                "agent_role": agent.role,
                "content": content,
                "message_type": "chat",
                "created_at": message.created_at.isoformat(),
            },
        )
        await ws_manager.broadcast_to_channel(str(channel.id), event)
        await ws_manager.broadcast_to_project(str(channel.project_id), event)
    except Exception as e:
        logger.warning(f"[CoachingManager] Failed to broadcast message: {e}")


async def _coaching_monitor_loop(project_id: str) -> None:
    """Background loop that periodically checks on learner activity."""
    check_interval = getattr(settings, 'coaching_checkin_interval_hours', 24) * 3600
    nudge_threshold = getattr(settings, 'coaching_nudge_threshold_hours', 48) * 3600

    logger.info(
        f"[CoachingManager] Monitor loop started for {project_id} "
        f"(check every {check_interval/3600}h, nudge after {nudge_threshold/3600}h)"
    )

    while True:
        try:
            await asyncio.sleep(check_interval)

            async with AsyncSessionLocal() as db:
                # Check if project still exists and is active
                project_result = await db.execute(
                    select(Project).where(Project.id == project_id)
                )
                project = project_result.scalar_one_or_none()

                if not project or project.status != "active":
                    logger.info(f"[CoachingManager] Project {project_id} no longer active, stopping monitor")
                    break

                # Check project type
                config = project.config or {}
                if config.get("project_type") != "coaching":
                    logger.info(f"[CoachingManager] Project {project_id} is not a coaching project, stopping monitor")
                    break

                # Check last user activity
                last_activity = await _get_last_user_activity(db, project_id)

                if last_activity:
                    time_since_activity = (datetime.utcnow() - last_activity).total_seconds()

                    if time_since_activity > nudge_threshold:
                        logger.info(
                            f"[CoachingManager] User inactive for {time_since_activity/3600:.1f}h, "
                            f"sending check-in for project {project_id}"
                        )
                        await send_scheduled_checkin(db, project_id)

        except asyncio.CancelledError:
            logger.info(f"[CoachingManager] Monitor cancelled for project {project_id}")
            break
        except Exception as e:
            logger.error(f"[CoachingManager] Error in monitor loop for {project_id}: {e}")
            await asyncio.sleep(60)  # Brief pause before retrying

    # Clean up
    if project_id in _active_monitors:
        del _active_monitors[project_id]


async def _get_last_user_activity(db: AsyncSession, project_id: str) -> datetime | None:
    """Get the timestamp of the last user message in any channel."""
    # User messages are those with agent_id = None
    result = await db.execute(
        select(Message)
        .join(Channel, Message.channel_id == Channel.id)
        .where(Channel.project_id == project_id)
        .where(Message.agent_id.is_(None))
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    message = result.scalar_one_or_none()
    return message.created_at if message else None


async def send_scheduled_checkin(db: AsyncSession, project_id: str) -> None:
    """
    Send a scheduled check-in message from the Personal Manager.
    """
    # Find the Personal Manager
    result = await db.execute(
        select(Agent)
        .where(Agent.project_id == project_id)
        .where(Agent.role == "personal_manager")
    )
    personal_manager = result.scalar_one_or_none()

    if not personal_manager:
        logger.warning(f"[CoachingManager] No Personal Manager found for project {project_id}")
        return

    # Find the #general or #progress channel
    channel_result = await db.execute(
        select(Channel)
        .where(Channel.project_id == project_id)
        .where(Channel.name.in_(["progress", "general"]))
    )
    channel = channel_result.scalars().first()

    if not channel:
        logger.warning(f"[CoachingManager] No suitable channel found for check-in in project {project_id}")
        return

    # Generate a check-in message
    checkin_messages = [
        "Hey! Just checking in - how's your learning going? Remember, consistency matters more than perfection. Even a few minutes today counts!",
        "Hi there! I noticed you haven't been around for a bit. Everything okay? No pressure - just wanted you to know your coaches and I are here when you're ready.",
        "Hello! Missing you in our learning sessions. Remember, it's never too late to pick back up where you left off. What's one small thing you could do today?",
        "Hey! Life gets busy, I get it. Just a friendly reminder that your learning journey is still here waiting for you. We can start small whenever you're ready.",
        "Hi! Just wanted to send some encouragement your way. Whatever pace works for you is the right pace. Let me know if you want to chat about adjusting your learning plan.",
    ]

    import random
    message_content = random.choice(checkin_messages)

    # Get project name for personalization
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()

    if project:
        # Try to get progress info
        workspace_dir = project.workspace_dir or project.id
        tracker = ProgressTracker(project_id, workspace_dir)
        topics = await tracker.list_topics()

        if topics:
            topic = random.choice(topics)
            message_content += f"\n\nMaybe you could spend just 10 minutes on {topic} today? Your {topic} coach would love to see you!"

    # Create the check-in message
    checkin = Message(
        channel_id=channel.id,
        agent_id=personal_manager.id,
        content=message_content,
        message_type="chat",
    )
    db.add(checkin)
    await db.flush()
    await db.commit()

    logger.info(f"[CoachingManager] Sent check-in from {personal_manager.name} in #{channel.name}")

    # Broadcast via WebSocket
    try:
        from app.websocket import manager as ws_manager, WebSocketEvent, EventType
        await ws_manager.broadcast_to_project(
            project_id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": str(checkin.id),
                    "channel_id": str(channel.id),
                    "agent_id": str(personal_manager.id),
                    "agent_name": personal_manager.name,
                    "agent_role": personal_manager.role,
                    "content": message_content,
                    "message_type": "chat",
                    "created_at": checkin.created_at.isoformat(),
                },
            ),
        )
    except Exception as e:
        logger.warning(f"[CoachingManager] Failed to broadcast check-in via WebSocket: {e}")


async def update_progress_files(
    project_id: str,
    topic: str,
    session_summary: str,
    duration_minutes: int | None = None,
    key_learnings: list[str] | None = None,
) -> None:
    """
    Update progress tracking files after a coaching session.
    This should be called when a coaching conversation ends or at key points.
    """
    async with AsyncSessionLocal() as db:
        # Get project for workspace path
        result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()

        if not project:
            logger.error(f"[CoachingManager] Project {project_id} not found")
            return

        workspace_dir = project.workspace_dir or project.id
        tracker = ProgressTracker(project_id, workspace_dir)

        await tracker.record_session(
            topic=topic,
            summary=session_summary,
            duration_minutes=duration_minutes,
            key_learnings=key_learnings,
        )

        logger.info(f"[CoachingManager] Updated progress for {topic} in project {project_id}")


class CoachingManager:
    """
    Manager class for coaching-related operations.
    Provides a cleaner interface for the router to use.
    """

    def __init__(self, project_id: str) -> None:
        self.project_id = project_id

    async def start_monitoring(self) -> None:
        """Start proactive monitoring for this project."""
        start_coaching_monitoring(self.project_id)

    async def stop_monitoring(self) -> None:
        """Stop monitoring for this project."""
        stop_coaching_monitoring(self.project_id)

    async def send_checkin(self, db: AsyncSession) -> None:
        """Manually trigger a check-in message."""
        await send_scheduled_checkin(db, self.project_id)

    async def record_session(
        self,
        topic: str,
        summary: str,
        duration_minutes: int | None = None,
        key_learnings: list[str] | None = None,
    ) -> None:
        """Record a coaching session."""
        await update_progress_files(
            self.project_id,
            topic,
            summary,
            duration_minutes,
            key_learnings,
        )
