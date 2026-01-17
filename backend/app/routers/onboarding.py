"""Onboarding API router for project setup flow."""

import logging
import time
import traceback
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Project, Agent, Channel, Task, get_db
from app.services.project_analyzer import ProjectAnalyzer
from app.services.personality_generator import PersonalityGenerator
from app.services.image_generator import ImageGenerator

# Set up logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class SystemCapabilities(BaseModel):
    """System capabilities check response."""
    image_generation_available: bool
    claude_code_available: bool
    anthropic_configured: bool
    openai_configured: bool


@router.get("/capabilities", response_model=SystemCapabilities)
async def get_system_capabilities() -> SystemCapabilities:
    """
    Check what system capabilities are available.
    Used by frontend to conditionally show features.
    """
    import shutil
    
    return SystemCapabilities(
        image_generation_available=bool(settings.openai_api_key),
        claude_code_available=shutil.which("claude") is not None,
        anthropic_configured=bool(settings.anthropic_api_key),
        openai_configured=bool(settings.openai_api_key),
    )


class AppDescriptionRequest(BaseModel):
    """Initial app description from user."""

    description: str


class ClarifyingQuestionsResponse(BaseModel):
    """Questions to clarify the app requirements."""

    questions: list[str]
    initial_analysis: dict[str, Any]


class AnswersRequest(BaseModel):
    """User's answers to clarifying questions."""

    project_id: str
    answers: list[str]


class TeamMember(BaseModel):
    """Generated team member preview."""

    name: str
    role: str
    team: str | None
    personality_summary: str
    profile_image_type: str


class ProjectBreakdown(BaseModel):
    """Project breakdown into components."""

    components: list[dict[str, Any]]
    teams: list[str]
    suggested_team_members: list[TeamMember]


class ConfigOptions(BaseModel):
    """User configuration options."""

    runtime_mode: str = "subprocess"  # subprocess or docker
    workspace_type: str = "local_git"  # local, local_git, browser, hybrid
    auto_execute_tasks: bool = True  # auto-execute tasks when created
    workspace_naming: str = "named"  # 'named' (app_name_uuid) or 'uuid_only'


class FinalizeRequest(BaseModel):
    """Request to finalize project setup."""

    project_id: str
    config: ConfigOptions
    generate_images: bool = True


class OnboardingStatus(BaseModel):
    """Current onboarding status."""

    project_id: str
    step: str  # description, questions, breakdown, config, generating, complete
    data: dict[str, Any] | None = None


# In-memory store for onboarding sessions (would use Redis in production)
_onboarding_sessions: dict[str, dict[str, Any]] = {}


@router.post("/start", response_model=ClarifyingQuestionsResponse)
async def start_onboarding(
    request: AppDescriptionRequest,
    db: AsyncSession = Depends(get_db),
) -> ClarifyingQuestionsResponse:
    """
    Start the onboarding process with an app description.
    Returns clarifying questions and initial analysis.
    """
    import asyncio
    import sys
    
    def log(msg: str):
        """Log to both stdout and logger."""
        print(f">>> {msg}", file=sys.stderr, flush=True)
        logger.info(msg)
    
    log(f"ONBOARDING START: {request.description[:80]}...")
    total_start = time.time()
    
    try:
        analyzer = ProjectAnalyzer()
        
        # Step 1: Analyze description with 45 second timeout
        log("Step 1/3: Calling Claude API to analyze description...")
        try:
            analysis = await asyncio.wait_for(
                analyzer.analyze_description(request.description),
                timeout=45.0
            )
            log(f"Step 1/3 DONE: suggested_name={analysis.get('suggested_name')}")
        except asyncio.TimeoutError:
            log("Step 1/3 TIMEOUT after 45s!")
            raise HTTPException(status_code=504, detail="Analysis timed out after 45 seconds")
        
        # Step 2: Generate questions with 45 second timeout
        log("Step 2/3: Calling Claude API to generate questions...")
        try:
            questions = await asyncio.wait_for(
                analyzer.generate_clarifying_questions(request.description, analysis),
                timeout=45.0
            )
            log(f"Step 2/3 DONE: {len(questions)} questions generated")
        except asyncio.TimeoutError:
            log("Step 2/3 TIMEOUT after 45s!")
            raise HTTPException(status_code=504, detail="Question generation timed out after 45 seconds")

        # Step 3: Create project in database
        log("Step 3/3: Creating project in database...")
        project = Project(
            name=analysis.get("suggested_name", "New Project"),
            description=request.description,
            config={"status": "onboarding", "analysis": analysis},
        )
        db.add(project)
        await db.flush()
        await db.refresh(project)
        log(f"Step 3/3 DONE: project_id={project.id}")

        # Store session data
        _onboarding_sessions[project.id] = {
            "description": request.description,
            "analysis": analysis,
            "questions": questions,
            "step": "questions",
        }

        total_elapsed = time.time() - total_start
        log(f"ONBOARDING COMPLETE in {total_elapsed:.1f}s")
        
        return ClarifyingQuestionsResponse(
            questions=questions,
            initial_analysis={
                "project_id": project.id,
                "suggested_name": analysis.get("suggested_name"),
                "app_type": analysis.get("app_type"),
                "complexity": analysis.get("complexity"),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        log(f"ONBOARDING ERROR: {str(e)}")
        log(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start onboarding: {str(e)}"
        )


class AutoAnswerResponse(BaseModel):
    """Auto-generated answers to clarifying questions."""

    answers: list[str]


@router.post("/auto-answer", response_model=AutoAnswerResponse)
async def auto_answer_questions(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> AutoAnswerResponse:
    """
    Use AI to automatically answer the clarifying questions based on the project description.
    """
    logger.info(f"[Onboarding] Auto-answer requested for project {project_id}")
    
    session = _onboarding_sessions.get(project_id)
    if not session:
        logger.error(f"[Onboarding] Session not found for project {project_id}")
        logger.info(f"[Onboarding] Active sessions: {list(_onboarding_sessions.keys())}")
        raise HTTPException(status_code=404, detail="Onboarding session not found")

    logger.info(f"[Onboarding] Session found, has {len(session.get('questions', []))} questions")
    
    analyzer = ProjectAnalyzer()

    # Generate answers using AI
    try:
        answers = await analyzer.auto_answer_questions(
            session["description"],
            session["analysis"],
            session["questions"],
        )
        logger.info(f"[Onboarding] Generated {len(answers)} answers")
    except Exception as e:
        logger.error(f"[Onboarding] Auto-answer failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate answers: {str(e)}")

    return AutoAnswerResponse(answers=answers)


@router.post("/answers", response_model=ProjectBreakdown)
async def submit_answers(
    request: AnswersRequest,
    db: AsyncSession = Depends(get_db),
) -> ProjectBreakdown:
    """
    Submit answers to clarifying questions.
    Returns project breakdown and suggested team.
    """
    session = _onboarding_sessions.get(request.project_id)
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")

    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == request.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    analyzer = ProjectAnalyzer()
    personality_gen = PersonalityGenerator()

    # Generate project breakdown with answers
    breakdown = await analyzer.create_project_breakdown(
        session["description"],
        session["analysis"],
        session["questions"],
        request.answers,
    )

    # Generate team suggestions
    team_suggestions = await personality_gen.suggest_team_composition(breakdown)

    # Update session
    session["answers"] = request.answers
    session["breakdown"] = breakdown
    session["team_suggestions"] = team_suggestions
    session["step"] = "config"

    # Update project config
    project.config = {
        **project.config,
        "breakdown": breakdown,
        "team_suggestions": [t.model_dump() for t in team_suggestions],
    }
    await db.flush()

    return ProjectBreakdown(
        components=breakdown.get("components", []),
        teams=breakdown.get("teams", []),
        suggested_team_members=[t.model_dump() for t in team_suggestions],
    )


class ShuffleMemberRequest(BaseModel):
    """Request to shuffle a team member."""
    project_id: str
    member_index: int


class ShuffleMemberResponse(BaseModel):
    """Response with new team member."""
    name: str
    role: str
    team: str | None
    personality_summary: str
    profile_image_type: str


@router.post("/shuffle-member", response_model=ShuffleMemberResponse)
async def shuffle_team_member(
    request: ShuffleMemberRequest,
    db: AsyncSession = Depends(get_db),
) -> ShuffleMemberResponse:
    """
    Shuffle a single team member to get a new person with same role.
    """
    session = _onboarding_sessions.get(request.project_id)
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")
    
    team_suggestions = session.get("team_suggestions", [])
    if request.member_index < 0 or request.member_index >= len(team_suggestions):
        raise HTTPException(status_code=400, detail="Invalid member index")
    
    # Get the member to replace
    old_member = team_suggestions[request.member_index]
    old_member_dict = old_member.model_dump() if hasattr(old_member, "model_dump") else old_member
    
    personality_gen = PersonalityGenerator()
    
    # Generate a new member with the same role and team
    new_member = personality_gen._generate_random_team([old_member_dict.get("team") or "Full Stack"])[0]
    
    # Override with the correct role and team from the old member
    new_member_dict = new_member.model_dump()
    new_member_dict["role"] = old_member_dict["role"]
    new_member_dict["team"] = old_member_dict["team"]
    
    # Create a new TeamMember with the correct data
    from app.services.personality_generator import TeamMember
    final_member = TeamMember(**new_member_dict)
    
    # Update the session
    team_suggestions[request.member_index] = final_member
    session["team_suggestions"] = team_suggestions
    
    logger.info(f"[Onboarding] Shuffled member {request.member_index}: {old_member_dict['name']} -> {final_member.name}")
    
    return ShuffleMemberResponse(
        name=final_member.name,
        role=final_member.role,
        team=final_member.team,
        personality_summary=final_member.personality_summary,
        profile_image_type=final_member.profile_image_type,
    )


class UpdateMemberRequest(BaseModel):
    """Request to update a team member."""
    project_id: str
    member_index: int
    name: str
    personality_summary: str
    profile_image_type: str


@router.post("/update-member", response_model=ShuffleMemberResponse)
async def update_team_member(
    request: UpdateMemberRequest,
    db: AsyncSession = Depends(get_db),
) -> ShuffleMemberResponse:
    """
    Update a team member's details.
    """
    session = _onboarding_sessions.get(request.project_id)
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")
    
    team_suggestions = session.get("team_suggestions", [])
    if request.member_index < 0 or request.member_index >= len(team_suggestions):
        raise HTTPException(status_code=400, detail="Invalid member index")
    
    # Get the current member
    old_member = team_suggestions[request.member_index]
    old_member_dict = old_member.model_dump() if hasattr(old_member, "model_dump") else old_member
    
    # Create updated member
    from app.services.personality_generator import TeamMember
    updated_member = TeamMember(
        name=request.name,
        role=old_member_dict["role"],
        team=old_member_dict["team"],
        personality_summary=request.personality_summary,
        profile_image_type=request.profile_image_type,
    )
    
    # Update the session
    team_suggestions[request.member_index] = updated_member
    session["team_suggestions"] = team_suggestions
    
    logger.info(f"[Onboarding] Updated member {request.member_index}: {updated_member.name}")
    
    return ShuffleMemberResponse(
        name=updated_member.name,
        role=updated_member.role,
        team=updated_member.team,
        personality_summary=updated_member.personality_summary,
        profile_image_type=updated_member.profile_image_type,
    )


@router.post("/finalize", response_model=OnboardingStatus)
async def finalize_project(
    request: FinalizeRequest,
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatus:
    """
    Finalize project setup and create all agents and channels.
    This starts the team generation process.
    """
    session = _onboarding_sessions.get(request.project_id)
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")

    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == request.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    personality_gen = PersonalityGenerator()
    image_gen = ImageGenerator()

    # Update project config with user preferences
    project.config = {
        **project.config,
        "runtime_mode": request.config.runtime_mode,
        "workspace_type": request.config.workspace_type,
        "auto_execute_tasks": request.config.auto_execute_tasks,
        "workspace_naming": request.config.workspace_naming,
        "status": "generating",
    }
    project.status = "generating"
    
    # Set workspace directory name based on naming preference
    project.workspace_dir = project.get_workspace_dir_name()
    logger.info(f"[Onboarding] Set workspace_dir to: {project.workspace_dir}")
    
    await db.flush()

    # Get team suggestions from session
    team_suggestions = session.get("team_suggestions", [])

    # Create channels first
    default_channels = [
        ("general", "public", None, "General project updates and announcements"),
        ("random", "public", None, "Off-topic discussions and team bonding"),
    ]

    # Add team-specific channels
    breakdown = session.get("breakdown", {})
    teams = breakdown.get("teams", [])
    logger.info(f"[Onboarding] Creating channels for project {project.id}")
    logger.info(f"[Onboarding] Breakdown: {breakdown}")
    logger.info(f"[Onboarding] Teams found: {teams}")
    
    # If no teams, add sensible defaults based on team suggestions
    if not teams:
        team_suggestions = session.get("team_suggestions", [])
        unique_teams = set()
        for suggestion in team_suggestions:
            team = suggestion.get("team") if isinstance(suggestion, dict) else getattr(suggestion, "team", None)
            if team:
                unique_teams.add(team)
        teams = list(unique_teams) if unique_teams else ["Development"]
        logger.info(f"[Onboarding] No teams in breakdown, derived from suggestions: {teams}")
    
    for team in teams:
        default_channels.append(
            (team.lower().replace(" ", "-"), "team", team, f"{team} team discussions")
        )
    
    logger.info(f"[Onboarding] Creating channels: {[c[0] for c in default_channels]}")

    created_channels = []
    for name, channel_type, team, description in default_channels:
        channel = Channel(
            project_id=project.id,
            name=name,
            type=channel_type,
            team=team,
            description=description,
        )
        created_channels.append(channel)
    
    # Add all channels at once
    db.add_all(created_channels)
    logger.info(f"[Onboarding] Added {len(created_channels)} channels to session")
    
    # Commit in a fresh transaction
    try:
        await db.commit()
        logger.info(f"[Onboarding] Commit successful")
    except Exception as e:
        logger.error(f"[Onboarding] Commit failed: {e}")
        await db.rollback()
        raise
    
    # Verify channels were saved with a fresh query
    verify_result = await db.execute(
        select(Channel).where(Channel.project_id == project.id)
    )
    verified_channels = verify_result.scalars().all()
    logger.info(f"[Onboarding] Channels committed to database - verified {len(verified_channels)} channels exist")
    
    if len(verified_channels) == 0:
        # Something is wrong - let's create them again with explicit IDs
        logger.warning(f"[Onboarding] No channels found after commit, trying explicit insert...")
        import uuid
        for name, channel_type, team, description in default_channels:
            from sqlalchemy import text
            channel_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO channels (id, project_id, name, type, team, description, created_at)
                    VALUES (:id, :project_id, :name, :type, :team, :description, datetime('now'))
                """),
                {
                    "id": channel_id,
                    "project_id": project.id,
                    "name": name,
                    "type": channel_type,
                    "team": team,
                    "description": description,
                }
            )
            logger.info(f"[Onboarding] Inserted channel via raw SQL: {name}")
        await db.commit()
        
        # Verify again
        verify_result2 = await db.execute(
            select(Channel).where(Channel.project_id == project.id)
        )
        verified_channels = verify_result2.scalars().all()
        logger.info(f"[Onboarding] After raw SQL insert - verified {len(verified_channels)} channels exist")
    
    for ch in verified_channels:
        logger.info(f"[Onboarding]   Verified channel: {ch.name} (type={ch.type}, id={ch.id})")

    # Limit team size to 5 for faster creation
    if len(team_suggestions) > 5:
        logger.info(f"[Onboarding] Limiting team from {len(team_suggestions)} to 5 members")
        team_suggestions = team_suggestions[:5]

    # Create agents from team suggestions - PARALLELIZED
    import asyncio
    
    async def generate_agent_data(suggestion):
        """Generate persona and optionally image for one agent."""
        suggestion_dict = suggestion if isinstance(suggestion, dict) else suggestion.model_dump()
        persona = await personality_gen.generate_full_persona(suggestion_dict)
        
        profile_image = None
        if request.generate_images:
            try:
                profile_image = await image_gen.generate_profile_image(persona)
            except Exception as e:
                logger.warning(f"[Onboarding] Image generation failed for {persona.get('name')}: {e}")
        
        return persona, profile_image
    
    # Run all persona+image generation in parallel
    logger.info(f"[Onboarding] Generating {len(team_suggestions)} agents in parallel...")
    agent_data_list = await asyncio.gather(
        *[generate_agent_data(s) for s in team_suggestions],
        return_exceptions=True
    )
    
    created_agents = []
    for i, result in enumerate(agent_data_list):
        if isinstance(result, Exception):
            logger.error(f"[Onboarding] Failed to generate agent {i}: {result}")
            continue
        
        persona, profile_image = result
        agent = Agent(
            project_id=project.id,
            name=persona["name"],
            role=persona["role"],
            team=persona.get("team"),
            soul_prompt=personality_gen.generate_soul_prompt(persona),
            skills_prompt=personality_gen.generate_skills_prompt(persona),
            persona=persona,
            profile_image=profile_image,
            profile_image_type=persona.get("profile_image_type", "professional"),
        )
        db.add(agent)
        created_agents.append(agent)

    await db.flush()
    logger.info(f"[Onboarding] Created {len(created_agents)} agents")
    
    # Find the PM and general channel for welcome message
    pm_agent = next((a for a in created_agents if a.role.lower() in ["pm", "product manager", "project manager"]), None)
    general_channel = next((c for c in created_channels if c.name == "general"), None)
    
    # Create welcome message from PM in #general
    if pm_agent and general_channel:
        from app.models import Message
        
        welcome_content = f"""👋 Hey team! I'm {pm_agent.name}, and I'll be your PM for this project.

Let me introduce everyone:
{chr(10).join(f"• **{a.name}** - {a.role.title()}" + (f" ({a.team})" if a.team else "") for a in created_agents)}

I've reviewed our project scope and I'm excited to get started. Let's build something great together! 🚀

Check the task board for our initial backlog. Let me know if you have any questions!"""
        
        welcome_message = Message(
            channel_id=general_channel.id,
            agent_id=pm_agent.id,
            content=welcome_content,
            message_type="chat",
        )
        db.add(welcome_message)
        await db.flush()
        logger.info(f"[Onboarding] Created welcome message from PM in #general")

    # Create initial tasks from breakdown
    breakdown = session.get("breakdown", {})
    for component in breakdown.get("components", []):
        task = Task(
            project_id=project.id,
            title=f"Implement {component.get('name', 'Component')}",
            description=component.get("description"),
            team=component.get("team"),
            priority=component.get("priority", 0),
        )
        db.add(task)

    await db.flush()

    # Update project status to active
    project.status = "active"
    project.config = {
        **project.config,
        "status": "active",
    }
    await db.flush()
    await db.commit()  # Final commit for all data
    logger.info(f"[Onboarding] Project finalized and committed: {project.id}")

    # Clean up session
    del _onboarding_sessions[request.project_id]

    return OnboardingStatus(
        project_id=project.id,
        step="complete",
        data={
            "agents_created": len(created_agents),
            "channels_created": len(created_channels),
            "tasks_created": len(breakdown.get("components", [])),
        },
    )


@router.get("/status/{project_id}", response_model=OnboardingStatus)
async def get_onboarding_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatus:
    """Get the current onboarding status for a project."""
    session = _onboarding_sessions.get(project_id)

    if session:
        return OnboardingStatus(
            project_id=project_id,
            step=session.get("step", "unknown"),
            data={
                "has_questions": bool(session.get("questions")),
                "has_answers": bool(session.get("answers")),
                "has_breakdown": bool(session.get("breakdown")),
            },
        )

    # Check if project is complete
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == "active":
        return OnboardingStatus(
            project_id=project_id,
            step="complete",
            data={"status": "active"},
        )

    return OnboardingStatus(
        project_id=project_id,
        step="unknown",
        data=None,
    )
