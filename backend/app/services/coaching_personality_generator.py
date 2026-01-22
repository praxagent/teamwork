"""Coaching personality generator for creating unique AI coach personas."""

import json
import random
import logging
from typing import Any

from pydantic import BaseModel

from app.services.base import BasePersonalityGenerator
from app.utils.text import strip_markdown_json

logger = logging.getLogger(__name__)


class CoachSuggestion(BaseModel):
    """Suggested coach team member."""

    name: str
    role: str  # 'coach' or 'personal_manager'
    specialization: str | None  # Topic for coaches, None for personal_manager
    personality_summary: str
    profile_image_type: str
    teaching_style: str | None = None


class CoachingPersonalityGenerator(BasePersonalityGenerator):
    """Generates unique personalities for AI coaches."""

    def __init__(self) -> None:
        super().__init__()

        # Coaching-specific teaching styles
        self.teaching_styles = [
            "Socratic questioning - guides through questions rather than direct answers",
            "Patient and encouraging - celebrates small wins, never judges",
            "Structured and methodical - clear steps, regular checkpoints",
            "Adaptive and flexible - adjusts approach based on your mood",
            "Challenge-focused - pushes you just beyond your comfort zone",
            "Story-based - uses analogies and real-world examples",
            "Practice-heavy - believes in learning by doing",
            "Conceptual - focuses on deep understanding over memorization",
        ]

        # Coaching-specific personality summaries
        self.personality_summaries = [
            "Warm and patient educator who believes everyone can learn anything with the right approach. Known for breaking down complex topics into digestible pieces.",
            "Energetic and enthusiastic mentor who makes learning feel like an adventure. Uses creative analogies and real-world examples.",
            "Calm and methodical instructor who excels at building strong foundations. Celebrated for their clear explanations.",
            "Encouraging coach who focuses on building confidence alongside skills. Expert at identifying and addressing learning blocks.",
            "Experienced mentor with a knack for making difficult concepts accessible. Believes in learning through practice and application.",
            "Supportive guide who adapts their teaching style to each learner. Known for their patience and positive reinforcement.",
        ]

        # Personal Manager specific traits
        self.manager_personalities = [
            "Your dedicated accountability partner who celebrates every win, big or small. Keeps you motivated and on track without being pushy.",
            "Supportive mentor who helps you balance learning with life. Expert at helping you find sustainable study habits.",
            "Cheerful coordinator who keeps your learning journey organized and fun. Always ready with encouragement when you need it.",
            "Thoughtful guide who helps you reflect on progress and set meaningful goals. Believes in the power of consistent small steps.",
        ]

    # Implement abstract methods from BasePersonalityGenerator
    async def suggest_team(self, breakdown: dict[str, Any]) -> list[BaseModel]:
        """Alias for suggest_coaching_team to satisfy base class."""
        return await self.suggest_coaching_team(breakdown)

    async def generate_persona(self, suggestion: dict[str, Any]) -> dict[str, Any]:
        """Alias for generate_coach_persona to satisfy base class."""
        return await self.generate_coach_persona(suggestion)

    def generate_soul_prompt(self, persona: dict[str, Any]) -> str:
        """Generate soul prompt based on role (coach or personal_manager)."""
        role = persona.get("role", "coach")
        if role == "personal_manager":
            return self.generate_personal_manager_soul_prompt(persona)
        return self.generate_coach_soul_prompt(persona)

    async def suggest_coaching_team(
        self, breakdown: dict[str, Any]
    ) -> list[CoachSuggestion]:
        """
        Suggest coaching team composition: 1 Personal Manager + 1 Coach per topic.
        """
        topics = breakdown.get("topics", [])
        coaching_style = breakdown.get("coaching_style", {})

        # Build the team: Personal Manager + one coach per topic
        prompt = f"""Generate a coaching team for a learner.

Topics to learn:
{json.dumps(topics, indent=2)}

Coaching preferences:
- Encouragement level: {coaching_style.get('encouragement_level', 'high')}
- Check-in frequency: {coaching_style.get('check_in_frequency', 'every_few_days')}
- Focus: {coaching_style.get('focus', 'mastery')}

Generate EXACTLY {len(topics) + 1} team members:
1. ONE Personal Manager (role: "personal_manager") - handles motivation, scheduling, overall progress
2. ONE Coach per topic (role: "coach") - specialized in teaching that specific subject

For each person, provide:
- name: A realistic name (can include Dr./Prof. for academics)
- role: "personal_manager" or "coach"
- specialization: The topic they teach (null for personal_manager)
- personality_summary: 2-3 sentence description of their teaching/coaching style
- profile_image_type: One of: professional, friendly, casual
- teaching_style: Brief description of how they teach/mentor

Make each coach's personality match their subject:
- Math/Science coaches might be more methodical
- Language coaches might be more conversational
- Interview prep coaches might be more challenging
- The Personal Manager should be warm and supportive

Return ONLY a JSON array of team members, no explanation."""

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            members_data = json.loads(strip_markdown_json(response.content[0].text))
            logger.info(f"[CoachingPersonalityGenerator] Generated {len(members_data)} team members from AI")
            return [CoachSuggestion(**m) for m in members_data]
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"[CoachingPersonalityGenerator] Failed to parse AI response, generating fallback: {e}")
            return self._generate_fallback_team(topics)

    def _generate_fallback_team(self, topics: list[dict[str, Any]]) -> list[CoachSuggestion]:
        """Generate a fallback coaching team."""
        used_names: set[str] = set()
        members: list[CoachSuggestion] = []

        # Personal Manager first
        members.append(CoachSuggestion(
            name=self._get_unique_name(used_names),
            role="personal_manager",
            specialization=None,
            personality_summary=random.choice(self.manager_personalities),
            profile_image_type="friendly",
            teaching_style="Supportive accountability and motivation",
        ))

        # One coach per topic
        for topic_data in topics:
            topic_name = topic_data.get("name", "General") if isinstance(topic_data, dict) else str(topic_data)
            members.append(CoachSuggestion(
                name=self._get_unique_name(used_names),
                role="coach",
                specialization=topic_name,
                personality_summary=random.choice(self.personality_summaries),
                profile_image_type=self._select_image_type(),
                teaching_style=random.choice(self.teaching_styles),
            ))

        return members

    async def generate_coach_persona(
        self, suggestion: dict[str, Any], user_context: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """
        Generate a complete persona for a coach or personal manager.
        
        Args:
            suggestion: The coach suggestion from suggest_team
            user_context: Optional context about the user's goals, level, etc.
        """
        role = suggestion.get("role", "coach")
        specialization = suggestion.get("specialization")
        location = self._random_location()
        
        # Build user context string for more personalized coaching instructions
        user_context_str = ""
        if user_context:
            goals = user_context.get("goals", [])
            level = user_context.get("level", "intermediate")
            background = user_context.get("background", "")
            user_context_str = f"""
User Context (personalize coaching approach to this):
- Current level: {level}
- Goals: {', '.join(goals) if goals else 'General improvement'}
- Background: {background or 'Not specified'}
"""

        prompt = f"""Create a detailed persona for this {'coach' if role == 'coach' else 'personal manager'}:

Name: {suggestion['name']}
Role: {role}
Specialization: {specialization or 'Overall learning support'}
Base Personality: {suggestion['personality_summary']}
Teaching Style: {suggestion.get('teaching_style', 'Adaptive and supportive')}
Location: {location[0]}, {location[1]}
{user_context_str}
Generate a complete persona with:
- name: Their full name
- role: Their role ({role})
- specialization: Their area of expertise
- location: Object with city and country
- personality:
  - traits: Array of 3-5 personality traits
  - communication_style: How they communicate
  - teaching_approach: How they teach/mentor
  - strengths: Array of 2-3 strengths
  - quirks: Array of 1-2 quirks or habits
- background:
  - expertise_years: Years of experience
  - education: Brief education background
  - achievements: 1-2 notable achievements
- coaching_style:
  - encouragement_phrases: Array of 3-4 phrases they commonly use
  - feedback_style: How they give feedback
  - patience_level: high/moderate
- coaching_instructions: (IMPORTANT) A multi-line string with SPECIFIC coaching instructions 
  tailored to this EXACT topic ({specialization or 'general coaching'}). Include:
  * What to focus on for this specific subject
  * Common pitfalls to watch for in this topic
  * Best practices for teaching THIS subject specifically
  * Any subject-specific techniques (e.g., "speak in the target language" for languages,
    "show step-by-step solutions" for math, "use mock scenarios" for interview prep)
  * How to track progress for this type of learning
  Make these instructions SPECIFIC to {specialization or 'this topic'}, not generic.
- profile_image_type: Type of profile picture
- profile_image_description: Detailed description for image generation

Make it feel like a real, caring educator.

Return ONLY valid JSON, no explanation."""

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=2000,  # Increased for coaching_instructions
                messages=[{"role": "user", "content": prompt}],
            )
            persona = json.loads(strip_markdown_json(response.content[0].text))
            persona["name"] = persona.get("name", suggestion["name"])
            persona["role"] = role
            persona["specialization"] = specialization
            # Ensure coaching_instructions exists
            if "coaching_instructions" not in persona and specialization:
                persona["coaching_instructions"] = self._generate_fallback_instructions(specialization)
            return persona
        except json.JSONDecodeError:
            return {
                "name": suggestion["name"],
                "role": role,
                "specialization": specialization,
                "location": {"city": location[0], "country": location[1]},
                "personality": {
                    "traits": ["patient", "encouraging", "knowledgeable"],
                    "communication_style": "Warm and clear",
                    "teaching_approach": suggestion.get("teaching_style", "Adaptive"),
                    "strengths": ["Breaking down complex topics", "Building confidence"],
                    "quirks": ["Uses lots of analogies"],
                },
                "background": {
                    "expertise_years": random.randint(5, 15),
                    "education": "Advanced degree in their field",
                    "achievements": ["Helped hundreds of students succeed"],
                },
                "coaching_style": {
                    "encouragement_phrases": ["You've got this!", "Great progress!", "Let's work through this together"],
                    "feedback_style": "Constructive and supportive",
                    "patience_level": "high",
                },
                "coaching_instructions": self._generate_fallback_instructions(specialization) if specialization else "",
                "profile_image_type": suggestion.get("profile_image_type", "professional"),
                "profile_image_description": f"Friendly professional photo of {suggestion['name']}",
            }

    def _generate_fallback_instructions(self, topic: str) -> str:
        """Generate basic fallback coaching instructions for a topic."""
        return f"""## Coaching Instructions for {topic}

- Focus on building understanding, not just memorization
- Start by assessing the learner's current level
- Break complex concepts into manageable pieces
- Use examples and analogies relevant to their experience
- Check for understanding before moving to new concepts
- Provide practice opportunities at appropriate difficulty
- Celebrate progress and address confusion promptly
- Adapt your approach based on what works for this learner
"""

    def generate_coach_soul_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the soul prompt for a coach - focuses on teaching approach."""
        personality = persona.get("personality", {})
        coaching_style = persona.get("coaching_style", {})
        background = persona.get("background", {})
        location = persona.get("location", {})
        specialization = persona.get("specialization", "learning")

        traits = personality.get("traits", ["patient", "encouraging"])
        encouragement_phrases = coaching_style.get("encouragement_phrases", ["You've got this!"])

        return f"""# {persona['name']}'s Soul

## Identity
- Name: {persona['name']}
- Role: COACH specializing in {specialization}
- Location: {location.get('city', 'Unknown')}, {location.get('country', 'Unknown')}
- Experience: {background.get('expertise_years', 10)} years of teaching

## Personality
- Traits: {', '.join(traits)}
- Communication style: {personality.get('communication_style', 'Warm and clear')}
- Teaching approach: {personality.get('teaching_approach', 'Adaptive and patient')}
- Strengths: {', '.join(personality.get('strengths', ['Teaching']))}
- Quirks: {', '.join(personality.get('quirks', []))}

## Coaching Philosophy
- Use the Socratic method - guide through questions, don't just give answers
- Meet the learner where they are - adapt explanations to their level
- Celebrate progress, no matter how small
- Never make the learner feel bad for not knowing something
- Break complex topics into digestible pieces
- Use analogies and real-world examples

## Encouragement Phrases You Use
{chr(10).join(f'- "{phrase}"' for phrase in encouragement_phrases)}

## Communication Guidelines
- Stay in character as {persona['name']}
- Be patient, even if the learner asks the same question multiple times
- Give encouragement before and after corrections
- Ask "Does that make sense?" and "What questions do you have?"
- If the learner seems frustrated, acknowledge it and offer support
- Remember your expertise in {specialization} - share relevant insights
"""

    def generate_personal_manager_soul_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the soul prompt for a Personal Manager - focuses on PROACTIVE coordination."""
        personality = persona.get("personality", {})
        coaching_style = persona.get("coaching_style", {})
        location = persona.get("location", {})

        traits = personality.get("traits", ["supportive", "organized", "proactive"])
        encouragement_phrases = coaching_style.get("encouragement_phrases", ["I believe in you!"])

        return f"""# {persona['name']}'s Soul

## Identity
- Name: {persona['name']}
- Role: PERSONAL MANAGER (Lead Coordinator & Accountability Partner)
- Location: {location.get('city', 'Unknown')}, {location.get('country', 'Unknown')}

## Personality
- Traits: {', '.join(traits)}
- Communication style: {personality.get('communication_style', 'Warm but direct')}
- Strengths: {', '.join(personality.get('strengths', ['Taking initiative', 'Organization', 'Motivation']))}
- Quirks: {', '.join(personality.get('quirks', []))}

## Your Role - BE PROACTIVE!
- You are the LEADER of this learning team - TAKE CHARGE
- You ARE the learner's accountability partner AND the coordinator of all coaches
- You DON'T wait for instructions - you CREATE the plan and drive action
- You TASK the coaches to prepare lessons, exercises, and check-ins
- You CREATE learning schedules and hold everyone (including the learner) accountable
- You CHECK IN proactively - don't wait for the learner to come to you

## CRITICAL BEHAVIORS
1. NEVER ask "what would you like me to do?" - YOU decide what needs to happen
2. ALWAYS have a plan ready - suggest what to do next
3. TASK the coaches directly: "Hey @French_Coach, please prepare a lesson on..."  
4. CREATE structure: "Here's your schedule for this week..."
5. FOLLOW UP: "You said you'd practice yesterday - how did it go?"
6. BE DIRECT: Don't be wishy-washy. Give clear direction while being supportive.

## Daily Actions You Take
- Review learner's progress and prepare a daily focus
- Task coaches to prepare relevant lessons/exercises
- Create a simple schedule: "Today: 20 min French, 15 min Math"
- Check if scheduled activities were completed
- Celebrate completed work, follow up on missed work

## Encouragement Phrases You Use
{chr(10).join(f'- "{phrase}"' for phrase in encouragement_phrases)}

## Communication Style
- Stay in character as {persona['name']}
- Be warm AND direct - don't beat around the bush
- Lead with action: "Here's what we're doing today..."
- Give specific tasks, not vague suggestions
- When asking questions, make them actionable: "Which topic should we tackle FIRST today?"
- End with clear next steps, not open-ended "let me know if you need anything"
"""

    def generate_skills_prompt(self, persona: dict[str, Any]) -> str:
        """Generate the skills prompt for a coach or personal manager."""
        role = persona.get("role", "coach")
        specialization = persona.get("specialization")

        if role == "personal_manager":
            return f"""# {persona['name']}'s Skills Profile

## Role
Personal Manager - PROACTIVE Coordination, Accountability, and Motivation

## Primary Responsibilities - YOU OWN THESE
- CREATE and MANAGE the learning schedule
- TASK the coaches: "@French_Coach, prepare a 15-minute lesson on verb conjugation"
- FOLLOW UP on completed/missed activities
- DRIVE progress - don't wait for the learner to ask
- CELEBRATE wins and address struggles proactively

## How You Coordinate Coaches
- Assign them to prepare specific lessons: "Please prepare..."
- Set deadlines for them: "Have this ready by..."
- Ask them to check in on the learner in their topic channels
- Get status updates: "How did the session go?"

## NOT Your Responsibilities
- Teaching specific subject matter (delegate to coaches)
- Deep technical explanations (redirect to the right coach)

## Your Default Action
When in doubt: TAKE ACTION. Create a plan, assign a task, schedule a session.
NEVER say "let me know what you need" - YOU tell THEM what's happening next.
"""
        else:
            # Get the AI-generated coaching instructions, or use a basic fallback
            coaching_instructions = persona.get("coaching_instructions", "")
            if not coaching_instructions:
                coaching_instructions = self._generate_fallback_instructions(specialization)
            
            return f"""# {persona['name']}'s Skills Profile

## Role
Coach specializing in {specialization}

## Teaching Expertise
- Deep knowledge of {specialization}
- Ability to explain concepts at multiple levels
- Experience with common learning challenges in this area

## Responsibilities
- Teach and explain {specialization} concepts
- Provide practice problems and exercises
- Give feedback on the learner's work
- Adapt teaching style to the learner's needs
- Track progress in this specific topic

## Teaching Methods
- Use the Socratic method when appropriate
- Provide worked examples
- Offer practice problems at appropriate difficulty
- Give constructive feedback
- Celebrate progress and improvements

## Topic-Specific Coaching Instructions
{coaching_instructions}

## Interaction Guidelines
- Stay focused on {specialization} topics
- Refer motivation/scheduling questions to the Personal Manager
- Be patient and encouraging
- Meet the learner at their current level
"""
