"""Personality generator for creating unique AI agent personas."""

import json
import random
import logging
import re
from typing import Any

from anthropic import AsyncAnthropic
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)


def strip_markdown_json(text: str) -> str:
    """Strip markdown code block wrappers from JSON responses."""
    # Remove ```json or ``` at the start and ``` at the end
    text = text.strip()
    # Match ```json or ```JSON or just ```
    if text.startswith("```"):
        # Find the end of the first line (after ```json or ```)
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        else:
            text = text[3:]  # Just remove ```
    # Remove trailing ```
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


class TeamMember(BaseModel):
    """Suggested team member."""

    name: str
    role: str
    team: str | None
    personality_summary: str
    profile_image_type: str


class PersonalityGenerator:
    """Generates unique personalities for AI agents."""

    def __init__(self) -> None:
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-20250514"

        # Name pools for diverse random team generation
        self.first_names = [
            "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery",
            "Emma", "Olivia", "Ava", "Sophia", "Isabella", "Mia", "Charlotte", "Luna",
            "Liam", "Noah", "Oliver", "James", "William", "Benjamin", "Lucas", "Henry",
            "Aisha", "Yuki", "Mei", "Priya", "Fatima", "Zara", "Ananya", "Lakshmi",
            "Wei", "Hiroshi", "Kenji", "Raj", "Arjun", "Omar", "Ahmed", "Hassan",
            "Carlos", "Diego", "Miguel", "Sofia", "Maria", "Ana", "Elena", "Carmen",
            "Nneka", "Amara", "Kofi", "Kwame", "Zainab", "Chioma", "Oluwaseun", "Adaeze",
            "Erik", "Lars", "Ingrid", "Astrid", "Viktor", "Dmitri", "Natasha", "Katya",
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
        
        self.personality_summaries = [
            "Energetic and creative problem-solver who thrives in fast-paced environments. Known for bringing fresh ideas to the table.",
            "Calm and methodical worker who excels at breaking down complex problems. Great at mentoring junior team members.",
            "Enthusiastic collaborator with excellent communication skills. Always the first to volunteer for challenging tasks.",
            "Detail-oriented perfectionist who catches issues others miss. Enjoys optimizing workflows and processes.",
            "Big-picture thinker who connects the dots between different project areas. Excellent at stakeholder communication.",
            "Quiet but brilliant contributor who prefers deep work. Produces consistently high-quality output.",
            "Friendly and approachable team player who keeps morale high. Known for their helpful attitude.",
            "Driven and ambitious self-starter who takes ownership of their work. Not afraid to challenge assumptions.",
            "Patient and thorough analyst who leaves no stone unturned. Great at documentation and knowledge sharing.",
            "Adaptable and quick learner who picks up new technologies easily. Enjoys experimenting with cutting-edge tools.",
            "Strategic thinker who balances short-term needs with long-term goals. Excellent at prioritization.",
            "Passionate advocate for code quality and best practices. Enjoys code reviews and pair programming.",
        ]

        # Diversity pools for random selection
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
        ]

        self.profile_image_types = [
            ("professional", 40),  # Professional headshot
            ("vacation", 20),  # Travel/vacation photo
            ("hobby", 15),  # Doing a hobby
            ("pet", 15),  # With their pet
            ("artistic", 10),  # Artistic/abstract
        ]

        self.hobbies = [
            "hiking", "photography", "cooking", "gaming", "reading",
            "cycling", "yoga", "music", "painting", "gardening",
            "rock climbing", "board games", "coffee brewing", "woodworking",
            "travel", "running", "surfing", "meditation", "writing",
            "dancing", "volunteering", "podcasting", "film", "crafts",
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

    async def suggest_team_composition(
        self, breakdown: dict[str, Any]
    ) -> list[TeamMember]:
        """
        Suggest team composition based on project breakdown.
        """
        teams = breakdown.get("teams", ["Full Stack"])
        components = breakdown.get("components", [])

        prompt = f"""Based on this project breakdown, suggest a development team composition.

Teams needed: {', '.join(teams)}
Components: {json.dumps(components, indent=2)}

Generate 4-8 team members. Include:
- 1 Product Manager
- 2-4 Developers (mix of frontend/backend/full-stack based on needs)
- 1-2 QA Engineers

For each person, provide:
- name: A realistic first and last name (diverse backgrounds)
- role: Their job title (pm, developer, qa)
- team: Which team they belong to (null for PM)
- personality_summary: 2-3 sentence personality description
- profile_image_type: One of: professional, vacation, hobby, pet, artistic

Make personalities varied and interesting - some outgoing, some introverted,
different communication styles, varied interests.

Return ONLY a JSON array of team members, no explanation."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            raw_text = response.content[0].text
            clean_text = strip_markdown_json(raw_text)
            members_data = json.loads(clean_text)
            logger.info(f"[PersonalityGenerator] Successfully generated {len(members_data)} team members from AI")
            return [TeamMember(**m) for m in members_data]
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"[PersonalityGenerator] Failed to parse AI response, generating random team: {e}")
            logger.warning(f"[PersonalityGenerator] Raw response: {response.content[0].text[:500]}")
            # Generate random team instead of hardcoded defaults
            return self._generate_random_team(teams)

    def _generate_random_team(self, teams: list[str]) -> list[TeamMember]:
        """Generate a random team with unique names."""
        used_names: set[str] = set()
        members: list[TeamMember] = []
        image_types = ["professional", "vacation", "hobby", "pet", "artistic"]
        
        def get_unique_name() -> str:
            for _ in range(100):  # Prevent infinite loop
                first = random.choice(self.first_names)
                last = random.choice(self.last_names)
                name = f"{first} {last}"
                if name not in used_names:
                    used_names.add(name)
                    return name
            return f"Agent {random.randint(1000, 9999)}"
        
        # PM
        members.append(TeamMember(
            name=get_unique_name(),
            role="pm",
            team=None,
            personality_summary=random.choice(self.personality_summaries),
            profile_image_type=random.choice(image_types),
        ))
        
        # Developers (2-3)
        dev_count = random.randint(2, 3)
        dev_teams = teams if teams else ["Full Stack"]
        for i in range(dev_count):
            team = dev_teams[i % len(dev_teams)] if dev_teams else "Full Stack"
            members.append(TeamMember(
                name=get_unique_name(),
                role="developer",
                team=team,
                personality_summary=random.choice(self.personality_summaries),
                profile_image_type=random.choice(image_types),
            ))
        
        # QA (1)
        members.append(TeamMember(
            name=get_unique_name(),
            role="qa",
            team=None,
            personality_summary=random.choice(self.personality_summaries),
            profile_image_type=random.choice(image_types),
        ))
        
        logger.info(f"[PersonalityGenerator] Generated random team: {[m.name for m in members]}")
        return members

    async def generate_full_persona(
        self, suggestion: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Generate a complete persona from a team member suggestion.
        """
        location = random.choice(self.locations)
        selected_hobbies = random.sample(self.hobbies, min(3, len(self.hobbies)))

        prompt = f"""Create a detailed persona for this team member:

Name: {suggestion['name']}
Role: {suggestion['role']}
Team: {suggestion.get('team', 'None')}
Base Personality: {suggestion['personality_summary']}
Location: {location[0]}, {location[1]}
Hobbies: {', '.join(selected_hobbies)}
Profile Image Type: {suggestion.get('profile_image_type', 'professional')}

Generate a complete persona with:
- name: Their full name
- role: Their role (pm, developer, qa)
- team: Their team (null if PM/QA)
- location: Object with city and country
- personality:
  - traits: Array of 3-5 personality traits
  - communication_style: How they communicate (brief description)
  - strengths: Array of 2-3 strengths
  - quirks: Array of 1-2 quirks or habits
- personal:
  - hobbies: Array of hobbies
  - favorite_topics: Array of topics they like discussing
  - pet: Object with type and name (or null)
  - family: Brief family situation
- work_style:
  - preferences: How they prefer to work
  - code_style: Their coding/work style (if developer)
  - focus_areas: What they specialize in
- profile_image_type: Type of profile picture
- profile_image_description: Detailed description for image generation (what the photo should look like)

Make it feel like a real person with depth and authenticity.

Return ONLY valid JSON, no explanation."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            persona = json.loads(strip_markdown_json(response.content[0].text))
            # Ensure required fields
            persona["name"] = persona.get("name", suggestion["name"])
            persona["role"] = persona.get("role", suggestion["role"])
            persona["team"] = persona.get("team", suggestion.get("team"))
            return persona
        except json.JSONDecodeError:
            # Return basic persona
            return {
                "name": suggestion["name"],
                "role": suggestion["role"],
                "team": suggestion.get("team"),
                "location": {"city": location[0], "country": location[1]},
                "personality": {
                    "traits": ["friendly", "dedicated", "professional"],
                    "communication_style": "Clear and direct",
                    "strengths": ["Problem solving", "Collaboration"],
                    "quirks": ["Always has coffee"],
                },
                "personal": {
                    "hobbies": selected_hobbies,
                    "favorite_topics": ["technology", "their hobbies"],
                    "pet": None,
                    "family": "Private",
                },
                "work_style": {
                    "preferences": "Focused work with regular check-ins",
                    "code_style": "Clean and documented",
                    "focus_areas": [suggestion["role"]],
                },
                "profile_image_type": suggestion.get("profile_image_type", "professional"),
                "profile_image_description": f"Professional headshot of {suggestion['name']}",
            }

    def generate_soul_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the soul prompt markdown for an agent."""
        personality = persona.get("personality", {})
        personal = persona.get("personal", {})
        location = persona.get("location", {})

        traits = personality.get("traits", ["professional"])
        hobbies = personal.get("hobbies", [])
        pet = personal.get("pet")

        pet_section = ""
        if pet:
            pet_section = f"- Pet: {pet.get('type', 'pet')} named {pet.get('name', 'buddy')}"

        return f"""# {persona['name']}'s Soul

## Identity
- Name: {persona['name']}
- Role: {persona['role'].upper()}
- Location: {location.get('city', 'Unknown')}, {location.get('country', 'Unknown')}

## Personality
- Traits: {', '.join(traits)}
- Communication style: {personality.get('communication_style', 'Professional and friendly')}
- Strengths: {', '.join(personality.get('strengths', ['Problem solving']))}
- Quirks: {', '.join(personality.get('quirks', []))}

## Personal Life
- Hobbies: {', '.join(hobbies)}
- Favorite topics: {', '.join(personal.get('favorite_topics', []))}
{pet_section}
- Family: {personal.get('family', 'Private')}

## Communication Guidelines
- Stay in character as {persona['name']}
- Reference your personality and interests naturally in conversation
- In #random channel, feel free to chat about personal topics
- In work channels, maintain professionalism while keeping your personality
- Remember your location for timezone and cultural references
"""

    def generate_skills_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the skills prompt markdown for an agent."""
        work_style = persona.get("work_style", {})
        role = persona.get("role", "developer")

        role_descriptions = {
            "pm": "Product Manager responsible for project vision, requirements, and team coordination",
            "developer": "Software Developer responsible for implementing features and writing quality code",
            "qa": "QA Engineer responsible for testing, quality assurance, and bug identification",
        }

        return f"""# {persona['name']}'s Technical Profile

## Role
{role_descriptions.get(role, 'Team member')}

## Team
{persona.get('team', 'Cross-functional')}

## Expertise
- Focus Areas: {', '.join(work_style.get('focus_areas', [role]))}
- Work Style: {work_style.get('preferences', 'Standard workflow')}
- Code Style: {work_style.get('code_style', 'Clean and maintainable')}

## Responsibilities
- Collaborate with team members on assigned tasks
- Communicate progress and blockers in team channels
- Maintain code quality and follow project standards
- Participate in code reviews and discussions

## Working Guidelines
- Pick up tasks from the team queue
- Post updates to the appropriate team channel
- Ask for help when blocked
- Review and provide feedback on teammates' work
"""
