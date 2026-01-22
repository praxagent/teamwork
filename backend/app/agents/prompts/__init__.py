"""Prompt templates and instructions for agent personas.

This module contains:
- Soul and skills templates for generating agent personalities
- Formatting instructions for rich markdown and LaTeX support
- Workspace usage guidelines for development agents
- Complete prompt generators for all agent types

Note: Topic-specific coaching instructions are now generated dynamically
during onboarding by CoachingPersonalityGenerator and embedded in the
agent's skills_prompt. This allows for more personalized instructions
based on the user's actual goals, level, and background.

Usage:
    from app.agents.prompts import get_coach_prompt, get_pm_prompt
    
    prompt = get_coach_prompt(agent_name="Dr. Smith", ...)
"""

# Formatting instructions
from app.agents.prompts.formatting_instructions import (
    MARKDOWN_FORMATTING,
    COACHING_FORMATTING,
    PM_FORMATTING,
    DEV_FORMATTING,
)

# Coaching prompts
from app.agents.prompts.coaching_prompts import (
    get_personal_manager_prompt,
    get_coach_prompt,
)

# Software dev prompts
from app.agents.prompts.software_dev_prompts import (
    PM_DIRECTIVE,
    DEV_HONESTY_RULES,
    get_pm_prompt,
    get_developer_prompt,
    build_work_context,
    build_task_board_context,
)

__all__ = [
    # Formatting
    "MARKDOWN_FORMATTING",
    "COACHING_FORMATTING",
    "PM_FORMATTING",
    "DEV_FORMATTING",
    # Coaching
    "get_personal_manager_prompt",
    "get_coach_prompt",
    # Software dev
    "PM_DIRECTIVE",
    "DEV_HONESTY_RULES",
    "get_pm_prompt",
    "get_developer_prompt",
    "build_work_context",
    "build_task_board_context",
]
