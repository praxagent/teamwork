"""
Onboarding strategy pattern for different team types.

This module provides a clean abstraction for the onboarding flow,
allowing software and coaching teams to share common infrastructure
while having specialized behavior.
"""

import logging
from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Channel, Message, Project, Task
from app.services.image_generator import ImageGenerator

logger = logging.getLogger(__name__)


class OnboardingStrategy(ABC):
    """
    Abstract base class for onboarding strategies.
    
    Each team type (software, coaching) implements this interface
    to provide specialized behavior while sharing common infrastructure.
    """

    @property
    @abstractmethod
    def team_type(self) -> str:
        """Return the team type identifier."""
        pass

    @abstractmethod
    async def analyze(self, description: str) -> dict[str, Any]:
        """Analyze the input description and return initial analysis."""
        pass

    @abstractmethod
    async def generate_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        """Generate clarifying questions based on description and analysis."""
        pass

    @abstractmethod
    async def auto_answer_questions(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
    ) -> list[str]:
        """Auto-generate answers to clarifying questions."""
        pass

    @abstractmethod
    async def create_breakdown(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
        answers: list[str],
    ) -> dict[str, Any]:
        """Create the project/learning breakdown."""
        pass

    @abstractmethod
    async def suggest_team(self, breakdown: dict[str, Any]) -> list[BaseModel]:
        """Suggest team composition based on breakdown."""
        pass

    @abstractmethod
    async def generate_persona(self, suggestion: dict[str, Any]) -> dict[str, Any]:
        """Generate a full persona for a team member."""
        pass

    @abstractmethod
    def generate_soul_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the soul prompt for an agent."""
        pass

    @abstractmethod
    def generate_skills_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the skills prompt for an agent."""
        pass

    @abstractmethod
    def get_default_channels(self, breakdown: dict[str, Any]) -> list[tuple[str, str, str | None, str]]:
        """
        Get default channels to create.
        
        Returns list of tuples: (name, type, team, description)
        """
        pass

    @abstractmethod
    def get_teams_from_breakdown(self, breakdown: dict[str, Any]) -> list[str]:
        """Extract team/topic names from breakdown."""
        pass

    @abstractmethod
    async def create_welcome_message(
        self,
        project: Project,
        agents: list[Agent],
        channel: Channel,
    ) -> str:
        """Create the welcome message content."""
        pass

    @abstractmethod
    async def post_finalize_setup(
        self,
        db: AsyncSession,
        project: Project,
        breakdown: dict[str, Any],
    ) -> None:
        """Perform any post-finalization setup (e.g., create tasks, init files)."""
        pass

    @abstractmethod
    def start_monitoring(self, project_id: str) -> None:
        """Start background monitoring for the project."""
        pass

    def get_role_for_agent(self, persona: dict[str, Any], suggestion: dict[str, Any]) -> str:
        """Get the role for an agent from persona or suggestion."""
        return persona.get("role", suggestion.get("role", "developer"))

    def get_specialization_for_agent(
        self, persona: dict[str, Any], suggestion: dict[str, Any]
    ) -> str | None:
        """Get specialization for an agent (used by coaching)."""
        return None


class SoftwareOnboardingStrategy(OnboardingStrategy):
    """Strategy for software development teams."""

    def __init__(self) -> None:
        from app.services.project_analyzer import ProjectAnalyzer
        from app.services.personality_generator import PersonalityGenerator

        self.analyzer = ProjectAnalyzer()
        self.personality_gen = PersonalityGenerator()

    @property
    def team_type(self) -> str:
        return "software"

    async def analyze(self, description: str) -> dict[str, Any]:
        return await self.analyzer.analyze_description(description)

    async def generate_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        return await self.analyzer.generate_clarifying_questions(description, analysis)

    async def auto_answer_questions(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
    ) -> list[str]:
        return await self.analyzer.auto_answer_questions(description, analysis, questions)

    async def create_breakdown(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
        answers: list[str],
    ) -> dict[str, Any]:
        return await self.analyzer.create_project_breakdown(
            description, analysis, questions, answers
        )

    async def suggest_team(self, breakdown: dict[str, Any]) -> list[BaseModel]:
        return await self.personality_gen.suggest_team_composition(breakdown)

    async def generate_persona(self, suggestion: dict[str, Any]) -> dict[str, Any]:
        return await self.personality_gen.generate_full_persona(suggestion)

    def generate_soul_prompt(self, persona: dict[str, Any]) -> str:
        return self.personality_gen.generate_soul_prompt(persona)

    def generate_skills_prompt(self, persona: dict[str, Any]) -> str:
        return self.personality_gen.generate_skills_prompt(persona)

    def get_default_channels(
        self, breakdown: dict[str, Any]
    ) -> list[tuple[str, str, str | None, str]]:
        channels = [
            ("general", "public", None, "General project updates and announcements"),
            ("random", "public", None, "Off-topic discussions and team bonding"),
        ]

        # Add team-specific channels
        teams = breakdown.get("teams", [])
        for team in teams:
            channels.append(
                (team.lower().replace(" ", "-"), "team", team, f"{team} team discussions")
            )

        return channels

    def get_teams_from_breakdown(self, breakdown: dict[str, Any]) -> list[str]:
        return breakdown.get("teams", [])

    async def create_welcome_message(
        self,
        project: Project,
        agents: list[Agent],
        channel: Channel,
    ) -> str:
        # Find PM
        pm = next((a for a in agents if a.role.lower() in ["pm", "product manager", "project manager"]), None)
        if not pm:
            pm = agents[0] if agents else None

        if not pm:
            return "Welcome to the project!"

        team_intro = "\n".join(
            f"• **{a.name}** - {a.role.title()}" + (f" ({a.team})" if a.team else "")
            for a in agents
        )

        return f"""Hey team! I'm {pm.name}, and I'll be your PM for this project.

Let me introduce everyone:
{team_intro}

I've reviewed our project scope and I'm excited to get started. Let's build something great together!

Check the task board for our initial backlog. Let me know if you have any questions!"""

    async def post_finalize_setup(
        self,
        db: AsyncSession,
        project: Project,
        breakdown: dict[str, Any],
    ) -> None:
        """Create initial tasks from breakdown."""
        from app.websocket import manager as ws_manager, WebSocketEvent, EventType

        created_tasks = []
        for component in breakdown.get("components", []):
            task_name = component.get("name", "Task")
            if not any(task_name.lower().startswith(prefix) for prefix in
                       ["create", "build", "implement", "set up", "design", "write", "test", "add", "configure"]):
                task_name = f"Implement {task_name}"

            task = Task(
                project_id=project.id,
                title=task_name,
                description=component.get("description"),
                team=component.get("team"),
                priority=component.get("priority", 0),
                config={
                    "task_type": component.get("task_type", "development"),
                    "estimated_complexity": component.get("estimated_complexity", "moderate"),
                    "dependencies": component.get("dependencies", []),
                },
            )
            db.add(task)
            created_tasks.append(task)

        logger.info(f"[SoftwareStrategy] Created {len(created_tasks)} initial tasks")
        await db.flush()

        # Broadcast task creation
        for task in created_tasks:
            await ws_manager.broadcast_to_project(
                project.id,
                WebSocketEvent(
                    type=EventType.TASK_NEW,
                    data={
                        "id": str(task.id),
                        "title": task.title,
                        "description": task.description,
                        "status": task.status,
                        "priority": task.priority,
                        "team": task.team,
                        "project_id": str(project.id),
                    },
                ),
            )

    def start_monitoring(self, project_id: str) -> None:
        from app.services.pm_manager import start_pm_monitoring
        start_pm_monitoring(project_id)


class CoachingOnboardingStrategy(OnboardingStrategy):
    """Strategy for coaching/learning teams."""

    def __init__(self) -> None:
        from app.services.coaching_analyzer import CoachingAnalyzer
        from app.services.coaching_personality_generator import CoachingPersonalityGenerator

        self.analyzer = CoachingAnalyzer()
        self.personality_gen = CoachingPersonalityGenerator()

    @property
    def team_type(self) -> str:
        return "coaching"

    async def analyze(self, description: str) -> dict[str, Any]:
        return await self.analyzer.analyze_coaching_goals(description)

    async def generate_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        return await self.analyzer.generate_coaching_questions(description, analysis)

    async def auto_answer_questions(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
    ) -> list[str]:
        return await self.analyzer.auto_answer_questions(description, analysis, questions)

    async def create_breakdown(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
        answers: list[str],
    ) -> dict[str, Any]:
        return await self.analyzer.create_coaching_breakdown(
            description, analysis, questions, answers
        )

    async def suggest_team(self, breakdown: dict[str, Any]) -> list[BaseModel]:
        return await self.personality_gen.suggest_coaching_team(breakdown)

    async def generate_persona(self, suggestion: dict[str, Any]) -> dict[str, Any]:
        return await self.personality_gen.generate_coach_persona(suggestion)

    def generate_soul_prompt(self, persona: dict[str, Any]) -> str:
        role = persona.get("role", "coach")
        if role == "personal_manager":
            return self.personality_gen.generate_personal_manager_soul_prompt(persona)
        return self.personality_gen.generate_coach_soul_prompt(persona)

    def generate_skills_prompt(self, persona: dict[str, Any]) -> str:
        return self.personality_gen.generate_skills_prompt(persona)

    def get_default_channels(
        self, breakdown: dict[str, Any]
    ) -> list[tuple[str, str, str | None, str]]:
        channels = [
            ("general", "public", None, "General discussions and motivation"),
            ("progress", "public", None, "Progress updates and celebrations"),
        ]

        # Add topic-specific channels
        topics = breakdown.get("topics", [])
        for topic_data in topics:
            topic_name = topic_data.get("name", "topic") if isinstance(topic_data, dict) else str(topic_data)
            channel_name = topic_name.lower().replace(" ", "-").replace("/", "-")
            channels.append(
                (channel_name, "team", topic_name, f"Discussions about {topic_name}")
            )

        return channels

    def get_teams_from_breakdown(self, breakdown: dict[str, Any]) -> list[str]:
        """For coaching, 'teams' are topics."""
        topics = breakdown.get("topics", [])
        return [
            t.get("name", "") if isinstance(t, dict) else str(t)
            for t in topics
        ]

    def get_role_for_agent(self, persona: dict[str, Any], suggestion: dict[str, Any]) -> str:
        return persona.get("role", suggestion.get("role", "coach"))

    def get_specialization_for_agent(
        self, persona: dict[str, Any], suggestion: dict[str, Any]
    ) -> str | None:
        return persona.get("specialization") or suggestion.get("specialization")

    async def create_welcome_message(
        self,
        project: Project,
        agents: list[Agent],
        channel: Channel,
    ) -> str:
        # Find Personal Manager
        manager = next((a for a in agents if a.role == "personal_manager"), None)
        if not manager:
            manager = agents[0] if agents else None

        if not manager:
            return "Welcome to your learning journey!"

        # Build coach introductions
        coaches = [a for a in agents if a.role == "coach"]
        coach_intros = "\n".join(
            f"• **{a.name}** - Your {a.specialization} coach"
            for a in coaches
        )

        return f"""Welcome to your learning journey! I'm {manager.name}, your Personal Manager.

I'll be here to support you, celebrate your progress, and help keep you motivated. Think of me as your accountability partner and cheerleader!

Let me introduce your coaches:
{coach_intros}

Each coach is an expert in their subject and excited to help you learn. You can chat with them anytime in their topic channels or here in #general.

Here's how to get started:
1. Check out the topic channels to start learning
2. Visit #progress to see your learning dashboard
3. Don't hesitate to reach out if you need encouragement!

Remember: consistency beats intensity. Even 15 minutes a day adds up!

Let's begin this journey together!"""

    async def post_finalize_setup(
        self,
        db: AsyncSession,
        project: Project,
        breakdown: dict[str, Any],
    ) -> None:
        """Initialize progress tracking files."""
        from app.services.progress_tracker import ProgressTracker

        try:
            tracker = ProgressTracker(project.id, project.workspace_dir)
            topics = breakdown.get("topics", [])
            coaching_style = breakdown.get("coaching_style", {})
            await tracker.initialize_files(topics, coaching_style)
            logger.info(f"[CoachingStrategy] Initialized progress tracking files")
        except Exception as e:
            logger.warning(f"[CoachingStrategy] Failed to initialize progress files: {e}")

    def start_monitoring(self, project_id: str) -> None:
        from app.services.coaching_manager import start_coaching_monitoring
        start_coaching_monitoring(project_id)


def get_onboarding_strategy(team_type: str) -> OnboardingStrategy:
    """
    Factory function to get the appropriate onboarding strategy.
    
    Args:
        team_type: Either 'software' or 'coaching'
        
    Returns:
        The appropriate OnboardingStrategy implementation
        
    Raises:
        ValueError: If team_type is not recognized
    """
    strategies = {
        "software": SoftwareOnboardingStrategy,
        "coaching": CoachingOnboardingStrategy,
    }

    strategy_class = strategies.get(team_type)
    if not strategy_class:
        raise ValueError(f"Unknown team type: {team_type}. Must be one of: {list(strategies.keys())}")

    return strategy_class()
