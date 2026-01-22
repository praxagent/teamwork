"""Coaching-specific API endpoints for progress tracking and session management."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Project, Agent
from app.models.base import get_db
from app.services.progress_tracker import ProgressTracker

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/coaching", tags=["coaching"])


class ProgressOverviewResponse(BaseModel):
    """Response containing the progress overview content."""

    content: str
    topics: list[str]  # Legacy - topic slugs
    coaches: list[str]  # New - coach folder names


class TopicProgressResponse(BaseModel):
    """Response containing a topic's progress content."""

    topic: str
    content: str


class CoachProgressResponse(BaseModel):
    """Response containing all progress files for a coach."""
    
    coach: str
    soul: str | None = None  # Coach's personality prompt (EDITABLE!)
    skills: str | None = None  # Coach's skills/expertise prompt (EDITABLE!)
    progress: str | None = None
    learnings: str | None = None
    strengths: str | None = None
    improvements: str | None = None
    summary: str | None = None
    resources: str | None = None
    vocabulary: str | None = None
    topics_covered: str | None = None
    ratings: str | None = None


class RecordSessionRequest(BaseModel):
    """Request to record a coaching session."""

    summary: str
    duration_minutes: int | None = None
    key_learnings: list[str] | None = None
    areas_to_review: list[str] | None = None
    mood: str | None = None


class RecordSessionResponse(BaseModel):
    """Response after recording a session."""

    success: bool
    message: str


class UpdateSkillRequest(BaseModel):
    """Request to update skill level for a topic."""

    level: str
    notes: str | None = None


class CoachInfo(BaseModel):
    """Information about a coach."""

    id: str
    name: str
    role: str
    specialization: str | None
    personality_summary: str | None


class CoachingTeamResponse(BaseModel):
    """Response containing the coaching team."""

    personal_manager: CoachInfo | None
    coaches: list[CoachInfo]


@router.get("/progress/{project_id}", response_model=ProgressOverviewResponse)
async def get_progress_overview(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ProgressOverviewResponse:
    """
    Get the progress overview for a coaching project.
    """
    # Verify project exists and is a coaching project
    project = await _get_coaching_project(db, project_id)

    tracker = ProgressTracker(project_id, project.workspace_dir)

    content = await tracker.get_overview()
    if content is None:
        raise HTTPException(status_code=404, detail="Progress files not found")

    topics = await tracker.list_topics()  # Legacy
    coaches = await tracker.list_coaches()  # New structure

    return ProgressOverviewResponse(content=content, topics=topics, coaches=coaches)


@router.get("/progress/{project_id}/{topic}", response_model=TopicProgressResponse)
async def get_topic_progress(
    project_id: str,
    topic: str,
    db: AsyncSession = Depends(get_db),
) -> TopicProgressResponse:
    """
    Get the progress for a specific topic (legacy) or coach (new structure).
    Tries coach folder first, then falls back to topic file.
    """
    project = await _get_coaching_project(db, project_id)

    tracker = ProgressTracker(project_id, project.workspace_dir)

    # Try new structure first - coach folder with progress.md
    coach_files = await tracker.get_coach_progress(topic)
    if coach_files and "progress" in coach_files:
        # Combine all files into one content blob for backward compatibility
        content_parts = []
        if coach_files.get("progress"):
            content_parts.append(coach_files["progress"])
        if coach_files.get("learnings"):
            content_parts.append(coach_files["learnings"])
        if coach_files.get("summary"):
            content_parts.append(coach_files["summary"])
        return TopicProgressResponse(topic=topic, content="\n\n---\n\n".join(content_parts))

    # Fall back to old structure
    content = await tracker.get_topic_progress(topic)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Progress file for {topic} not found")

    return TopicProgressResponse(topic=topic, content=content)


@router.get("/coach/{project_id}/{coach_name}", response_model=CoachProgressResponse)
async def get_coach_progress(
    project_id: str,
    coach_name: str,
    db: AsyncSession = Depends(get_db),
) -> CoachProgressResponse:
    """
    Get all progress files for a specific coach (new structure).
    """
    project = await _get_coaching_project(db, project_id)

    tracker = ProgressTracker(project_id, project.workspace_dir)

    files = await tracker.get_coach_progress(coach_name)
    if not files:
        raise HTTPException(status_code=404, detail=f"No progress files found for coach {coach_name}")

    return CoachProgressResponse(
        coach=coach_name,
        soul=files.get("soul"),
        skills=files.get("skills"),
        progress=files.get("progress"),
        learnings=files.get("learnings"),
        strengths=files.get("strengths"),
        improvements=files.get("improvements"),
        summary=files.get("summary"),
        resources=files.get("resources"),
        vocabulary=files.get("vocabulary"),
        topics_covered=files.get("topics-covered"),
        ratings=files.get("ratings"),
    )


class VocabularyResponse(BaseModel):
    """Response containing vocabulary tracker content."""
    
    topic: str
    content: str | None
    has_vocabulary: bool


@router.get("/vocabulary/{project_id}/{topic}", response_model=VocabularyResponse)
async def get_vocabulary(
    project_id: str,
    topic: str,
    db: AsyncSession = Depends(get_db),
) -> VocabularyResponse:
    """
    Get the vocabulary tracker for a language topic.
    """
    project = await _get_coaching_project(db, project_id)

    tracker = ProgressTracker(project_id, project.workspace_dir)

    content = await tracker.get_vocabulary(topic)
    
    return VocabularyResponse(
        topic=topic,
        content=content,
        has_vocabulary=content is not None
    )


@router.post("/session/{project_id}/{topic}", response_model=RecordSessionResponse)
async def record_coaching_session(
    project_id: str,
    topic: str,
    request: RecordSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> RecordSessionResponse:
    """
    Record a coaching session for a topic.
    """
    project = await _get_coaching_project(db, project_id)

    tracker = ProgressTracker(project_id, project.workspace_dir)

    try:
        await tracker.record_session(
            topic=topic,
            summary=request.summary,
            duration_minutes=request.duration_minutes,
            key_learnings=request.key_learnings,
            areas_to_review=request.areas_to_review,
            mood=request.mood,
        )
        return RecordSessionResponse(
            success=True,
            message=f"Session recorded for {topic}"
        )
    except Exception as e:
        logger.error(f"[Coaching] Failed to record session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to record session: {str(e)}")


@router.patch("/skill/{project_id}/{topic}", response_model=RecordSessionResponse)
async def update_skill_level(
    project_id: str,
    topic: str,
    request: UpdateSkillRequest,
    db: AsyncSession = Depends(get_db),
) -> RecordSessionResponse:
    """
    Update the skill level for a topic.
    """
    project = await _get_coaching_project(db, project_id)

    tracker = ProgressTracker(project_id, project.workspace_dir)

    try:
        await tracker.update_skill_level(
            topic=topic,
            level=request.level,
            notes=request.notes,
        )
        return RecordSessionResponse(
            success=True,
            message=f"Skill level updated to {request.level} for {topic}"
        )
    except Exception as e:
        logger.error(f"[Coaching] Failed to update skill level: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update skill level: {str(e)}")


@router.get("/team/{project_id}", response_model=CoachingTeamResponse)
async def get_coaching_team(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> CoachingTeamResponse:
    """
    Get the coaching team for a project.
    """
    project = await _get_coaching_project(db, project_id)

    # Get all agents for this project
    result = await db.execute(
        select(Agent).where(Agent.project_id == project_id)
    )
    agents = result.scalars().all()

    personal_manager = None
    coaches = []

    for agent in agents:
        info = CoachInfo(
            id=agent.id,
            name=agent.name,
            role=agent.role,
            specialization=agent.specialization,
            personality_summary=agent.persona.get("personality_summary") if agent.persona else None,
        )

        if agent.role == "personal_manager":
            personal_manager = info
        elif agent.role == "coach":
            coaches.append(info)

    return CoachingTeamResponse(
        personal_manager=personal_manager,
        coaches=coaches,
    )


@router.post("/checkin/{project_id}", response_model=RecordSessionResponse)
async def trigger_checkin(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> RecordSessionResponse:
    """
    Manually trigger a check-in from the Personal Manager.
    Useful for testing or when user wants encouragement.
    """
    project = await _get_coaching_project(db, project_id)

    try:
        from app.services.coaching_manager import CoachingManager
        manager = CoachingManager(project_id)
        await manager.send_checkin(db)
        return RecordSessionResponse(
            success=True,
            message="Check-in message sent"
        )
    except Exception as e:
        logger.error(f"[Coaching] Failed to send check-in: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send check-in: {str(e)}")


async def _get_coaching_project(db: AsyncSession, project_id: str) -> Project:
    """
    Get a project and verify it's a coaching project.
    """
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    config = project.config or {}
    if config.get("project_type") != "coaching":
        raise HTTPException(
            status_code=400,
            detail="This endpoint is only available for coaching projects"
        )

    return project
