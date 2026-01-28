"""Services for the Virtual Dev Team Simulator."""

from app.services.agent_manager import AgentManager
from app.services.app_runner import AppRunner, get_app_runner
from app.services.base import BaseAnalyzer, BasePersonalityGenerator, BaseAgentManager
from app.services.coaching_analyzer import CoachingAnalyzer
from app.services.coaching_manager import CoachingManager
from app.services.onboarding_strategy import (
    OnboardingStrategy,
    SoftwareOnboardingStrategy,
    CoachingOnboardingStrategy,
    get_onboarding_strategy,
)
from app.services.coaching_personality_generator import CoachingPersonalityGenerator
from app.services.image_generator import ImageGenerator
from app.services.memory_store import (
    MemoryStore,
    MemoryTypes,
    MemoryExtractor,
    get_relevant_memories,
)
from app.services.personality_generator import PersonalityGenerator
from app.services.pm_manager import PMManager, get_pm_manager
from app.services.progress_tracker import ProgressTracker
from app.services.project_analyzer import ProjectAnalyzer
from app.services.task_queue import TaskQueue

__all__ = [
    # Base classes
    "BaseAnalyzer",
    "BasePersonalityGenerator",
    "BaseAgentManager",
    # Software team services
    "AgentManager",
    "AppRunner",
    "ImageGenerator",
    "PersonalityGenerator",
    "PMManager",
    "ProjectAnalyzer",
    "TaskQueue",
    # Coaching services
    "CoachingAnalyzer",
    "CoachingManager",
    "CoachingPersonalityGenerator",
    "ProgressTracker",
    # Memory services
    "MemoryStore",
    "MemoryTypes",
    "MemoryExtractor",
    "get_relevant_memories",
    # Onboarding strategies
    "OnboardingStrategy",
    "SoftwareOnboardingStrategy",
    "CoachingOnboardingStrategy",
    "get_onboarding_strategy",
    # Factory functions
    "get_app_runner",
    "get_pm_manager",
]
