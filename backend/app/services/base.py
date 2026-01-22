"""Base classes for services with shared functionality."""

import asyncio
import json
import logging
import random
from abc import ABC, abstractmethod
from typing import Any, TypeVar

from anthropic import AsyncAnthropic
from pydantic import BaseModel

from app.config import settings
from app.utils.text import strip_markdown_json, parse_json_or_default

logger = logging.getLogger(__name__)

T = TypeVar("T")


class BaseAnalyzer(ABC):
    """
    Base class for Claude-powered analyzers.
    
    Provides common functionality for:
    - Claude client initialization
    - API call handling with error recovery
    - JSON parsing with fallbacks
    """

    def __init__(self) -> None:
        api_key = settings.anthropic_api_key
        if not api_key:
            logger.error(f"[{self.__class__.__name__}] No ANTHROPIC_API_KEY found!")
            raise ValueError("ANTHROPIC_API_KEY is not set in environment variables")
        
        # Strip quotes if present (common .env issue)
        api_key = api_key.strip('"').strip("'")
        
        self.client = AsyncAnthropic(api_key=api_key, timeout=60.0)
        self.model = settings.model_onboarding
        logger.info(f"[{self.__class__.__name__}] Using model: {self.model}")

    async def _call_claude(
        self,
        prompt: str,
        max_tokens: int = 1000,
        system: str | None = None,
    ) -> str:
        """
        Call Claude API and return the response text.
        
        Args:
            prompt: The user prompt
            max_tokens: Maximum tokens to generate
            system: Optional system prompt
            
        Returns:
            The stripped response text
        """
        messages = [{"role": "user", "content": prompt}]
        
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system:
            kwargs["system"] = system
            
        response = await self.client.messages.create(**kwargs)
        return strip_markdown_json(response.content[0].text)

    async def _call_claude_json(
        self,
        prompt: str,
        default: T,
        max_tokens: int = 1000,
        context: str = "",
    ) -> T | Any:
        """
        Call Claude API and parse the response as JSON.
        
        Args:
            prompt: The user prompt
            default: Default value if parsing fails
            max_tokens: Maximum tokens to generate
            context: Context string for logging
            
        Returns:
            Parsed JSON or the default value
        """
        try:
            response_text = await self._call_claude(prompt, max_tokens)
            return parse_json_or_default(response_text, default, context)
        except Exception as e:
            logger.error(f"[{self.__class__.__name__}] Error calling Claude: {e}")
            raise

    @abstractmethod
    async def analyze(self, description: str) -> dict[str, Any]:
        """Analyze an input description. Subclasses must implement."""
        pass

    @abstractmethod
    async def generate_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        """Generate clarifying questions. Subclasses must implement."""
        pass

    @abstractmethod
    async def auto_answer_questions(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
    ) -> list[str]:
        """Auto-answer questions. Subclasses must implement."""
        pass


class BasePersonalityGenerator(ABC):
    """
    Base class for personality generators.
    
    Provides shared:
    - Name pools for diverse generation
    - Profile image type selection
    - Common generation patterns
    """

    def __init__(self) -> None:
        api_key = settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set")
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = settings.model_onboarding

        # Shared name pools for diverse random team generation
        self.first_names = [
            "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery",
            "Emma", "Olivia", "Ava", "Sophia", "Isabella", "Mia", "Charlotte", "Luna",
            "Liam", "Noah", "Oliver", "James", "William", "Benjamin", "Lucas", "Henry",
            "Aisha", "Yuki", "Mei", "Priya", "Fatima", "Zara", "Ananya", "Lakshmi",
            "Wei", "Hiroshi", "Kenji", "Raj", "Arjun", "Omar", "Ahmed", "Hassan",
            "Carlos", "Diego", "Miguel", "Sofia", "Maria", "Ana", "Elena", "Carmen",
            "Nneka", "Amara", "Kofi", "Kwame", "Zainab", "Chioma", "Oluwaseun", "Adaeze",
            "Erik", "Lars", "Ingrid", "Astrid", "Viktor", "Dmitri", "Natasha", "Katya",
            "Dr. Sarah", "Prof. James", "Dr. Chen", "Dr. Patel", "Dr. Williams",
            "Dr. Kim", "Dr. Okafor", "Dr. Tanaka",
        ]
        
        self.last_names = [
            "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
            "Chen", "Wang", "Li", "Zhang", "Liu", "Yang", "Huang", "Wu",
            "Kim", "Park", "Lee", "Choi", "Tanaka", "Yamamoto", "Sato", "Suzuki",
            "Patel", "Singh", "Kumar", "Sharma", "Gupta", "Mehta", "Rao", "Reddy",
            "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Santos", "Silva", "Costa",
            "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
            "Okafor", "Adeyemi", "Mensah", "Diallo", "Traore", "Nkosi", "Mwangi", "Osei",
            "Anderson", "Taylor", "Thomas", "Jackson", "White", "Harris", "Thompson", "Clark",
            "Johansson", "Nielsen", "Petrov", "Ivanov", "Kowalski", "Novak", "Dubois", "Martin",
        ]

        # Shared profile image types with weights
        self.profile_image_types = [
            ("professional", 40),
            ("friendly", 20),
            ("vacation", 15),
            ("hobby", 15),
            ("casual", 10),
        ]

        # Shared locations for personas
        self.locations = [
            ("San Francisco", "USA"),
            ("London", "UK"),
            ("Toronto", "Canada"),
            ("Berlin", "Germany"),
            ("Tokyo", "Japan"),
            ("Sydney", "Australia"),
            ("Amsterdam", "Netherlands"),
            ("Stockholm", "Sweden"),
            ("Singapore", "Singapore"),
            ("Dublin", "Ireland"),
            ("Austin", "USA"),
            ("Barcelona", "Spain"),
            ("Bangalore", "India"),
            ("São Paulo", "Brazil"),
            ("Tel Aviv", "Israel"),
            ("Boston", "USA"),
        ]

    def _select_image_type(self) -> str:
        """Select a profile image type based on weighted probabilities."""
        total = sum(w for _, w in self.profile_image_types)
        r = random.randint(1, total)
        current = 0
        for img_type, weight in self.profile_image_types:
            current += weight
            if r <= current:
                return img_type
        return "professional"

    def _get_unique_name(self, used_names: set[str]) -> str:
        """Generate a unique name not already in use."""
        for _ in range(100):  # Prevent infinite loop
            first = random.choice(self.first_names)
            last = random.choice(self.last_names)
            name = f"{first} {last}"
            if name not in used_names:
                used_names.add(name)
                return name
        return f"Agent {random.randint(1000, 9999)}"

    def _random_location(self) -> tuple[str, str]:
        """Get a random location tuple (city, country)."""
        return random.choice(self.locations)

    @abstractmethod
    async def suggest_team(self, breakdown: dict[str, Any]) -> list[BaseModel]:
        """Suggest team composition. Subclasses must implement."""
        pass

    @abstractmethod
    async def generate_persona(self, suggestion: dict[str, Any]) -> dict[str, Any]:
        """Generate a full persona. Subclasses must implement."""
        pass

    @abstractmethod
    def generate_soul_prompt(self, persona: dict[str, Any]) -> str:
        """Generate soul prompt. Subclasses must implement."""
        pass

    @abstractmethod
    def generate_skills_prompt(self, persona: dict[str, Any]) -> str:
        """Generate skills prompt. Subclasses must implement."""
        pass


class BaseAgentManager(ABC):
    """
    Base class for agent monitoring services (PM, Coaching Manager, etc).
    
    Provides shared infrastructure for:
    - Background monitoring loops
    - Start/stop monitoring
    - Message posting to channels
    - WebSocket broadcasting
    """

    # Class-level storage for active monitoring tasks
    _active_monitors: dict[str, asyncio.Task] = {}

    @classmethod
    def start_monitoring(cls, project_id: str, monitor_fn) -> None:
        """
        Start a monitoring background task for a project.
        
        Args:
            project_id: The project to monitor
            monitor_fn: Async function that runs the monitoring loop
        """
        if project_id in cls._active_monitors:
            logger.info(f"[{cls.__name__}] Monitoring already active for project {project_id}")
            return

        task = asyncio.create_task(monitor_fn(project_id))
        cls._active_monitors[project_id] = task
        logger.info(f"[{cls.__name__}] Started monitoring for project {project_id}")

    @classmethod
    def stop_monitoring(cls, project_id: str) -> None:
        """Stop monitoring for a project."""
        if project_id in cls._active_monitors:
            cls._active_monitors[project_id].cancel()
            del cls._active_monitors[project_id]
            logger.info(f"[{cls.__name__}] Stopped monitoring for project {project_id}")

    @classmethod
    def is_monitoring(cls, project_id: str) -> bool:
        """Check if monitoring is active for a project."""
        return project_id in cls._active_monitors

    @staticmethod
    async def post_message_to_channel(
        db,
        channel,
        agent,
        content: str,
        message_type: str = "chat",
    ):
        """
        Post a message to a channel from an agent.
        
        Args:
            db: Database session
            channel: Channel to post to
            agent: Agent sending the message
            content: Message content
            message_type: Type of message
            
        Returns:
            The created Message object
        """
        from app.models import Message
        from app.websocket import manager as ws_manager, WebSocketEvent, EventType

        message = Message(
            channel_id=channel.id,
            agent_id=agent.id,
            content=content,
            message_type=message_type,
        )
        db.add(message)
        await db.flush()
        await db.commit()

        # Broadcast via WebSocket
        event = WebSocketEvent(
            type=EventType.MESSAGE_NEW,
            data={
                "id": str(message.id),
                "channel_id": str(channel.id),
                "agent_id": str(agent.id),
                "agent_name": agent.name,
                "agent_role": agent.role,
                "content": content,
                "message_type": message_type,
                "created_at": message.created_at.isoformat(),
            },
        )
        await ws_manager.broadcast_to_channel(str(channel.id), event)
        await ws_manager.broadcast_to_project(str(channel.project_id), event)

        return message
