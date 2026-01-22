"""Progress tracker service for managing coaching progress files.

File Structure:
.coaching/
├── overview.md                    # Overall progress across all coaches
├── dr-sarah-mitchell/             # Coach folder (slugified name)
│   ├── soul.md                    # Coach's personality/soul prompt (EDITABLE!)
│   ├── skills.md                  # Coach's skills/expertise prompt (EDITABLE!)
│   ├── progress.md                # Status, level, goals, session count
│   ├── learnings.md               # What the coach knows about the learner
│   ├── strengths.md               # Areas where learner is doing well
│   ├── improvements.md            # Areas that need work
│   ├── summary.md                 # Compactified conversation summaries
│   ├── resources.md               # Suggested resources
│   ├── topics-covered.md          # Topics/concepts reviewed
│   ├── ratings.md                 # Skill ratings over time
│   └── vocabulary.md              # (for language coaches only)
└── ...
"""

import re
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from anthropic import AsyncAnthropic

from app.config import settings

logger = logging.getLogger(__name__)

# How often to summarize conversations (every N turns)
SUMMARIZE_EVERY_N_TURNS = 5


class ProgressTracker:
    """Manages progress tracking files for coaching projects."""

    def __init__(self, project_id: str, workspace_dir: str | None = None) -> None:
        self.project_id = project_id
        if workspace_dir:
            self.workspace_path = settings.workspace_path / workspace_dir
        else:
            self.workspace_path = settings.workspace_path / project_id
        self.coaching_dir = self.workspace_path / ".coaching"
        self._client: AsyncAnthropic | None = None

    def _get_client(self) -> AsyncAnthropic:
        if self._client is None:
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    def _ensure_dirs(self) -> None:
        """Ensure the coaching directory exists."""
        self.coaching_dir.mkdir(parents=True, exist_ok=True)

    def _slugify(self, text: str) -> str:
        """Convert text to a safe filename/folder name."""
        return text.lower().replace(" ", "-").replace("/", "-").replace("&", "and").replace(".", "").replace(",", "")

    def _get_coach_dir(self, coach_name: str) -> Path:
        """Get the directory for a specific coach."""
        return self.coaching_dir / self._slugify(coach_name)

    def _ensure_coach_dir(self, coach_name: str) -> Path:
        """Ensure the coach directory exists and return it."""
        coach_dir = self._get_coach_dir(coach_name)
        coach_dir.mkdir(parents=True, exist_ok=True)
        return coach_dir

    async def initialize_files(
        self,
        topics: list[dict[str, Any]],
        coaching_style: dict[str, Any] | None = None,
        agent_prompts: dict[str, dict[str, str]] | None = None,
    ) -> None:
        """
        Initialize progress tracking files for a new coaching project.

        Creates:
        - .coaching/overview.md - Central progress summary
        - .coaching/{coach-name}/ - Per-coach folder with individual files
        
        Args:
            topics: List of topic configurations
            coaching_style: Overall coaching style preferences
            agent_prompts: Optional dict mapping coach names to {"soul_prompt": ..., "skills_prompt": ...}
        """
        self._ensure_dirs()
        agent_prompts = agent_prompts or {}

        # Create overview.md
        overview_content = self._generate_overview(topics, coaching_style)
        overview_path = self.coaching_dir / "overview.md"
        overview_path.write_text(overview_content)
        logger.info(f"[ProgressTracker] Created {overview_path}")

        # Create per-coach folders with files
        coaches_initialized = set()
        for topic_data in topics:
            topic_name = topic_data.get("name", "General")
            coach_name = topic_data.get("coach_name", topic_name)  # Fall back to topic name
            
            # Get prompts for this coach
            prompts = agent_prompts.get(coach_name, {})
            soul_prompt = prompts.get("soul_prompt")
            skills_prompt = prompts.get("skills_prompt")
            
            await self._initialize_coach_files(coach_name, topic_data, soul_prompt, skills_prompt)
            coaches_initialized.add(coach_name)
        
        # Also create folders for any agents in agent_prompts that weren't tied to topics
        # (e.g., personal manager)
        for agent_name, prompts in agent_prompts.items():
            if agent_name not in coaches_initialized:
                await self._initialize_agent_prompt_files(
                    agent_name,
                    prompts.get("soul_prompt"),
                    prompts.get("skills_prompt"),
                )

    async def _initialize_agent_prompt_files(
        self,
        agent_name: str,
        soul_prompt: str | None = None,
        skills_prompt: str | None = None,
    ) -> None:
        """Initialize just the soul and skills files for an agent (no progress tracking).
        
        This is used for agents like the Personal Manager who don't have topic-specific
        progress tracking but still need editable prompt files.
        """
        agent_dir = self._ensure_coach_dir(agent_name)
        now = datetime.utcnow().strftime("%Y-%m-%d")

        # Soul file
        if soul_prompt:
            soul_content = f"""# {agent_name}'s Soul

*This file defines {agent_name}'s personality and character.*
*You can edit this file to customize how they behave!*
*Changes take effect on the next conversation.*

---

{soul_prompt}
"""
        else:
            soul_content = f"""# {agent_name}'s Soul

*This file defines {agent_name}'s personality and character.*
*You can edit this file to customize how they behave!*
*Changes take effect on the next conversation.*

---

*Soul prompt not yet available.*
"""
        (agent_dir / "soul.md").write_text(soul_content)

        # Skills file
        if skills_prompt:
            skills_content = f"""# {agent_name}'s Skills & Expertise

*This file defines what {agent_name} knows and how they work.*
*You can edit this file to customize their approach!*
*Changes take effect on the next conversation.*

---

{skills_prompt}
"""
        else:
            skills_content = f"""# {agent_name}'s Skills & Expertise

*This file defines what {agent_name} knows and how they work.*
*You can edit this file to customize their approach!*
*Changes take effect on the next conversation.*

---

*Skills prompt not yet available.*
"""
        (agent_dir / "skills.md").write_text(skills_content)
        
        logger.info(f"[ProgressTracker] Created prompt files for {agent_name}")

    async def _initialize_coach_files(
        self,
        coach_name: str,
        topic_data: dict[str, Any],
        soul_prompt: str | None = None,
        skills_prompt: str | None = None,
    ) -> None:
        """Initialize all files for a specific coach.
        
        Args:
            coach_name: The coach's display name
            topic_data: Topic configuration (level, goals, resources, etc.)
            soul_prompt: The coach's personality prompt (optional, will create placeholder if not provided)
            skills_prompt: The coach's skills/expertise prompt (optional, will create placeholder if not provided)
        """
        coach_dir = self._ensure_coach_dir(coach_name)
        now = datetime.utcnow().strftime("%Y-%m-%d")
        
        topic_name = topic_data.get("name", "General")
        current_level = topic_data.get("current_level", "beginner")
        target_level = topic_data.get("target_level", "intermediate")
        initial_goals = topic_data.get("initial_goals", [])
        resources = topic_data.get("suggested_resources", [])

        # 0a. Soul file - coach's personality (EDITABLE!)
        if soul_prompt:
            soul_content = f"""# {coach_name}'s Soul

*This file defines the coach's personality and character.*
*You can edit this file to customize how the coach behaves!*
*Changes take effect on the next conversation.*

---

{soul_prompt}
"""
        else:
            soul_content = f"""# {coach_name}'s Soul

*This file defines the coach's personality and character.*
*You can edit this file to customize how the coach behaves!*
*Changes take effect on the next conversation.*

---

*Soul prompt will be added when the coach sends their first message.*

## Placeholder Personality

{coach_name} is a friendly and knowledgeable coach specializing in {topic_name}.
They are patient, encouraging, and adapt their teaching style to the learner's needs.
"""
        (coach_dir / "soul.md").write_text(soul_content)
        logger.info(f"[ProgressTracker] Created soul.md for {coach_name}")

        # 0b. Skills file - coach's expertise (EDITABLE!)
        if skills_prompt:
            skills_content = f"""# {coach_name}'s Skills & Expertise

*This file defines what the coach knows and how they teach.*
*You can edit this file to customize the coach's knowledge and approach!*
*Changes take effect on the next conversation.*

---

{skills_prompt}
"""
        else:
            skills_content = f"""# {coach_name}'s Skills & Expertise

*This file defines what the coach knows and how they teach.*
*You can edit this file to customize the coach's knowledge and approach!*
*Changes take effect on the next conversation.*

---

*Skills prompt will be added when the coach sends their first message.*

## Placeholder Skills

{coach_name} is an expert in {topic_name} with extensive experience teaching learners
at all levels from beginner to advanced.

### Teaching Approach
- Starts with fundamentals and builds up
- Uses practical examples and exercises
- Provides clear explanations
- Offers constructive feedback

### Areas of Expertise
- {topic_name} fundamentals
- Advanced {topic_name} concepts
- Practical applications
"""
        (coach_dir / "skills.md").write_text(skills_content)
        logger.info(f"[ProgressTracker] Created skills.md for {coach_name}")

        # 1. Progress file - status, level, goals
        goals_list = "\n".join(f"- [ ] {goal}" for goal in initial_goals) if initial_goals else "- [ ] Master the fundamentals"
        progress_content = f"""# {topic_name} Progress

*Coach: {coach_name}*
*Started: {now}*
*Last Updated: {now}*

## Current Status

- **Level**: {current_level}
- **Target**: {target_level}
- **Conversation Turns**: 0

## Learning Goals

{goals_list}
"""
        (coach_dir / "progress.md").write_text(progress_content)

        # 2. Learnings file - what the coach knows about the learner
        learnings_content = f"""# What I Know About You

*Coach: {coach_name}*
*Last Updated: {now}*

As we talk, I'll remember important things about your learning style, preferences, and background.

## Learnings

*Nothing learned yet - let's start chatting!*
"""
        (coach_dir / "learnings.md").write_text(learnings_content)

        # 3. Strengths file
        strengths_content = f"""# Your Strengths

*Coach: {coach_name}*
*Last Updated: {now}*

Areas where you're doing well will be noted here.

## Strengths

*We'll discover your strengths as we work together!*
"""
        (coach_dir / "strengths.md").write_text(strengths_content)

        # 4. Improvements file
        improvements_content = f"""# Areas to Improve

*Coach: {coach_name}*
*Last Updated: {now}*

Things we need to work on will be tracked here.

## Focus Areas

*We'll identify focus areas as we progress!*
"""
        (coach_dir / "improvements.md").write_text(improvements_content)

        # 5. Summary file - compactified conversation summaries
        summary_content = f"""# Conversation Summary

*Coach: {coach_name}*
*Last Updated: {now}*

Key points from our conversations are summarized here for context.

## Session Summaries

*No sessions yet - let's start learning!*
"""
        (coach_dir / "summary.md").write_text(summary_content)

        # 6. Resources file
        resources_list = "\n".join(f"- {r}" for r in resources) if resources else "- Practice materials\n- Reference guides"
        resources_content = f"""# Suggested Resources

*Coach: {coach_name}*
*Last Updated: {now}*

## Recommended Resources

{resources_list}

## Resources You've Found Helpful

*Add resources that work well for you here.*
"""
        (coach_dir / "resources.md").write_text(resources_content)

        # 7. Topics Covered file - track what has been reviewed
        topics_covered_content = f"""# Topics Covered

*Coach: {coach_name}*
*Last Updated: {now}*

This tracks concepts and topics we've reviewed together to avoid repetition.

## Covered Topics

| Topic/Concept | Date Covered | Confidence | Notes |
|---------------|--------------|------------|-------|

## Topics to Review

*Topics that need revisiting will be listed here.*

## Suggested Next Topics

*Based on your progress, here's what we should cover next.*
"""
        (coach_dir / "topics-covered.md").write_text(topics_covered_content)

        # 8. Ratings/Assessments file - track skill levels over time for charting
        ratings_content = f"""# Skill Ratings Over Time

*Coach: {coach_name}*
*Started: {now}*
*Last Updated: {now}*

Track your skill development over time. Each rating is on a scale of 1-10.

## Rating History

| Date | Overall | Understanding | Application | Confidence | Notes |
|------|---------|---------------|-------------|------------|-------|
| {now} | 3 | 3 | 2 | 3 | Starting assessment |

## Rating Scale

- 1-2: Beginner - Just starting, needs significant support
- 3-4: Elementary - Grasping basics, needs guidance
- 5-6: Intermediate - Solid understanding, some gaps
- 7-8: Advanced - Strong skills, refining details
- 9-10: Expert - Mastery level, can teach others

## Milestones

*Key breakthroughs and achievements will be noted here.*
"""
        (coach_dir / "ratings.md").write_text(ratings_content)

        # 9. Vocabulary file (for language topics only)
        if self._is_language_topic(topic_name):
            vocab_content = self._generate_vocabulary_file(topic_name, coach_name)
            (coach_dir / "vocabulary.md").write_text(vocab_content)
            logger.info(f"[ProgressTracker] Created vocabulary tracker for {coach_name}")

        logger.info(f"[ProgressTracker] Initialized files for coach: {coach_name}")

    def _is_language_topic(self, topic_name: str) -> bool:
        """Check if a topic is a language learning topic."""
        language_keywords = [
            'french', 'spanish', 'german', 'chinese', 'japanese', 'korean',
            'italian', 'portuguese', 'russian', 'arabic', 'hindi', 'language',
            'fluency', 'speaking', 'conversation', 'mandarin', 'cantonese'
        ]
        topic_lower = topic_name.lower()
        return any(kw in topic_lower for kw in language_keywords)

    def _generate_vocabulary_file(self, topic_name: str, coach_name: str) -> str:
        """Generate a vocabulary tracking file for language topics."""
        now = datetime.utcnow().strftime("%Y-%m-%d")
        return f"""# Vocabulary Tracker

*Topic: {topic_name}*
*Coach: {coach_name}*
*Created: {now}*
*Last Updated: {now}*

## How This Works

As you learn new words, they'll be added here automatically. Review them regularly!

## New Words to Learn

| Word/Phrase | Meaning | Example | Added | Mastered |
|-------------|---------|---------|-------|----------|

## Words Being Practiced

| Word/Phrase | Meaning | Times Seen | Last Reviewed |
|-------------|---------|------------|---------------|

## Mastered Words

| Word/Phrase | Meaning | Date Mastered |
|-------------|---------|---------------|

## Grammar Notes

*Grammar points and rules will be added as you learn them.*

## Common Mistakes

*Your common mistakes will be tracked here so we can work on them.*

"""

    def _generate_overview(
        self,
        topics: list[dict[str, Any]],
        coaching_style: dict[str, Any] | None,
    ) -> str:
        """Generate the overview.md content."""
        now = datetime.utcnow().strftime("%Y-%m-%d")
        style = coaching_style or {}

        topics_list = "\n".join(
            f"- **{t.get('name', 'Unknown')}**: {t.get('current_level', 'beginner')} → {t.get('target_level', 'intermediate')}"
            for t in topics
        )

        return f"""# Learning Progress Overview

*Started: {now}*
*Last Updated: {now}*

## Learning Topics

{topics_list}

## Current Status

| Topic | Coach | Level | Sessions | Last Active |
|-------|-------|-------|----------|-------------|
{chr(10).join(f"| {t.get('name', 'Unknown')} | {t.get('coach_name', '-')} | {t.get('current_level', 'beginner')} | 0 | - |" for t in topics)}

## Milestones

- [ ] **Getting Started** - Complete initial assessments
- [ ] **Building Foundations** - Master basics of each topic
- [ ] **Consistent Practice** - Maintain regular schedule

## Weekly Summary

*No sessions recorded yet. Start chatting with your coaches!*

## Notes

- Encouragement level: {style.get('encouragement_level', 'high')}
- Check-in frequency: {style.get('check_in_frequency', 'every_few_days')}
- Focus: {style.get('focus', 'mastery')}
"""

    async def record_conversation(
        self,
        topic: str,
        user_message: str,
        coach_response: str,
        coach_name: str,
    ) -> None:
        """
        Record a conversation exchange.
        
        Instead of logging full conversations, we:
        1. Increment turn count
        2. Periodically summarize and add to summary.md
        3. Extract learnings about the user
        4. Extract vocabulary for language topics
        """
        coach_dir = self._ensure_coach_dir(coach_name)
        logger.info(f"[ProgressTracker] Recording conversation for coach='{coach_name}'")
        
        try:
            # Update progress file - increment turn count
            progress_path = coach_dir / "progress.md"
            if progress_path.exists():
                content = progress_path.read_text()
                
                # Increment turn count
                match = re.search(r"\*\*Conversation Turns\*\*: (\d+)", content)
                if match:
                    current_turns = int(match.group(1))
                    new_turns = current_turns + 1
                    content = content.replace(
                        f"**Conversation Turns**: {current_turns}",
                        f"**Conversation Turns**: {new_turns}"
                    )
                    logger.info(f"[ProgressTracker] Turn count now: {new_turns}")
                    
                    # Periodically summarize the conversation
                    if new_turns % SUMMARIZE_EVERY_N_TURNS == 0:
                        await self._add_conversation_summary(
                            coach_dir, user_message, coach_response, coach_name
                        )
                else:
                    # Add turn count if missing
                    if "## Current Status" in content:
                        content = content.replace(
                            "## Current Status",
                            "## Current Status\n\n- **Conversation Turns**: 1"
                        )
                
                content = self._update_timestamp(content)
                progress_path.write_text(content)
            else:
                # Create progress file if missing
                await self._initialize_coach_files(coach_name, {"name": topic, "coach_name": coach_name})

            # Extract learnings (30% chance to avoid too many API calls)
            await self._extract_learnings(coach_dir, user_message, coach_response)

            # Extract topics covered from this conversation
            await self._extract_topics_covered(coach_dir, user_message, coach_response)

            # Periodically assess skill level (every 10 turns)
            progress_path = coach_dir / "progress.md"
            if progress_path.exists():
                content = progress_path.read_text()
                match = re.search(r"\*\*Conversation Turns\*\*: (\d+)", content)
                if match and int(match.group(1)) % 10 == 0:
                    await self._assess_skill_rating(coach_dir, topic, user_message, coach_response)

            # Update overview
            await self._update_overview_activity(topic, coach_name)

            # If language topic, check for vocabulary
            if self._is_language_topic(topic):
                await self._extract_vocabulary(coach_dir, topic, user_message, coach_response)

        except Exception as e:
            logger.error(f"[ProgressTracker] Error recording conversation: {e}")
            import traceback
            logger.error(f"[ProgressTracker] Traceback: {traceback.format_exc()}")

    async def _add_conversation_summary(
        self,
        coach_dir: Path,
        user_message: str,
        coach_response: str,
        coach_name: str,
    ) -> None:
        """Add a summary of recent conversation to summary.md."""
        try:
            client = self._get_client()
            
            response = await client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=150,
                messages=[{
                    "role": "user",
                    "content": f"""Summarize this learning exchange in 1-2 sentences. Focus on what was taught/learned.

User: "{user_message[:300]}"
Coach: "{coach_response[:500]}"

Summary:"""
                }]
            )
            
            summary = response.content[0].text.strip()
            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
            
            summary_path = coach_dir / "summary.md"
            if summary_path.exists():
                content = summary_path.read_text()
                
                # Add new summary entry
                entry = f"\n**[{now}]** {summary}\n"
                
                if "## Session Summaries" in content:
                    content = content.replace(
                        "## Session Summaries\n",
                        f"## Session Summaries\n{entry}"
                    )
                    # Remove the placeholder text
                    content = content.replace(
                        "*No sessions yet - let's start learning!*",
                        ""
                    )
                else:
                    content += f"\n## Session Summaries\n{entry}"
                
                content = self._update_timestamp(content)
                summary_path.write_text(content)
                logger.info(f"[ProgressTracker] Added conversation summary")

        except Exception as e:
            logger.error(f"[ProgressTracker] Error adding summary: {e}")

    async def _extract_learnings(
        self,
        coach_dir: Path,
        user_message: str,
        coach_response: str,
    ) -> None:
        """Extract learnings about the user from the conversation."""
        try:
            import random
            if random.random() > 0.3:  # 30% chance
                return

            client = self._get_client()
            
            response = await client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=200,
                messages=[{
                    "role": "user",
                    "content": f"""From this exchange, extract any NEW information about the learner. Include:
- Learning preferences or style
- Background/experience level
- Specific struggles or strengths  
- Personal context (job, goals, etc.)
- Motivation or emotional state

User said: "{user_message[:500]}"
Coach responded: "{coach_response[:500]}"

If there's something new to remember, state it in 1 sentence. If nothing new, respond "NOTHING_NEW".

Learning:"""
                }]
            )
            
            learning = response.content[0].text.strip()
            
            if learning and learning != "NOTHING_NEW" and len(learning) < 200:
                learnings_path = coach_dir / "learnings.md"
                if learnings_path.exists():
                    content = learnings_path.read_text()
                    now = datetime.utcnow().strftime("%Y-%m-%d")
                    entry = f"\n- *({now})* {learning}"
                    
                    if "## Learnings" in content:
                        content = content.replace(
                            "## Learnings\n",
                            f"## Learnings\n{entry}"
                        )
                        # Remove placeholder
                        content = content.replace(
                            "*Nothing learned yet - let's start chatting!*",
                            ""
                        )
                    else:
                        content += f"\n## Learnings\n{entry}"
                    
                    content = self._update_timestamp(content)
                    learnings_path.write_text(content)
                    logger.info(f"[ProgressTracker] Added learning: {learning[:50]}...")

        except Exception as e:
            logger.error(f"[ProgressTracker] Error extracting learnings: {e}")

    async def _extract_topics_covered(
        self,
        coach_dir: Path,
        user_message: str,
        coach_response: str,
    ) -> None:
        """Extract topics/concepts covered in this conversation."""
        try:
            import random
            if random.random() > 0.5:  # 50% chance to extract topics
                return

            client = self._get_client()
            
            response = await client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=200,
                messages=[{
                    "role": "user",
                    "content": f"""What specific concept, topic, or skill was taught or practiced in this exchange?

User: "{user_message[:400]}"
Coach: "{coach_response[:600]}"

If a clear topic/concept was covered, respond with just the topic name (2-5 words).
Also rate the learner's understanding: LOW, MEDIUM, or HIGH.

Format: TOPIC_NAME | CONFIDENCE_LEVEL
Example: "Quadratic equations | MEDIUM"

If no clear topic was covered (just chit-chat), respond "NONE".

Topic:"""
                }]
            )
            
            result = response.content[0].text.strip()
            
            if result and result != "NONE" and "|" in result:
                parts = [p.strip() for p in result.split("|")]
                if len(parts) >= 2:
                    topic_name = parts[0]
                    confidence = parts[1].upper()
                    
                    # Map confidence to numeric
                    confidence_map = {"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High"}
                    conf_display = confidence_map.get(confidence, "Medium")
                    
                    topics_path = coach_dir / "topics-covered.md"
                    if topics_path.exists():
                        content = topics_path.read_text()
                        now = datetime.utcnow().strftime("%Y-%m-%d")
                        
                        # Check if topic already exists
                        if topic_name.lower() not in content.lower():
                            entry = f"| {topic_name} | {now} | {conf_display} | First covered |\n"
                            content = content.replace(
                                "| Topic/Concept | Date Covered | Confidence | Notes |\n|---------------|--------------|------------|-------|",
                                f"| Topic/Concept | Date Covered | Confidence | Notes |\n|---------------|--------------|------------|-------|\n{entry}"
                            )
                            content = self._update_timestamp(content)
                            topics_path.write_text(content)
                            logger.info(f"[ProgressTracker] Added topic covered: {topic_name}")

        except Exception as e:
            logger.error(f"[ProgressTracker] Error extracting topics: {e}")

    async def _assess_skill_rating(
        self,
        coach_dir: Path,
        topic: str,
        user_message: str,
        coach_response: str,
    ) -> None:
        """Periodically assess and record the learner's skill level."""
        try:
            # Read recent context for better assessment
            learnings_path = coach_dir / "learnings.md"
            topics_path = coach_dir / "topics-covered.md"
            
            context = ""
            if learnings_path.exists():
                context += learnings_path.read_text()[:1000]
            if topics_path.exists():
                context += "\n" + topics_path.read_text()[:1000]

            client = self._get_client()
            
            response = await client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=200,
                messages=[{
                    "role": "user",
                    "content": f"""Based on this learning interaction and context, rate the learner's current skill level.

Topic: {topic}

Recent exchange:
User: "{user_message[:300]}"
Coach: "{coach_response[:400]}"

Context about the learner:
{context[:800]}

Rate on a scale of 1-10 for each dimension:
- Overall: General skill level
- Understanding: Conceptual grasp
- Application: Ability to apply knowledge
- Confidence: Self-assurance in the topic

Also provide a brief note about progress.

Format exactly as: OVERALL|UNDERSTANDING|APPLICATION|CONFIDENCE|NOTE
Example: 5|6|4|5|Solid on theory, needs practice applying concepts

Rating:"""
                }]
            )
            
            result = response.content[0].text.strip()
            
            if result and "|" in result:
                parts = [p.strip() for p in result.split("|")]
                if len(parts) >= 5:
                    try:
                        overall = min(10, max(1, int(parts[0])))
                        understanding = min(10, max(1, int(parts[1])))
                        application = min(10, max(1, int(parts[2])))
                        confidence = min(10, max(1, int(parts[3])))
                        note = parts[4][:100] if len(parts) > 4 else ""
                        
                        ratings_path = coach_dir / "ratings.md"
                        if ratings_path.exists():
                            content = ratings_path.read_text()
                            now = datetime.utcnow().strftime("%Y-%m-%d")
                            
                            entry = f"| {now} | {overall} | {understanding} | {application} | {confidence} | {note} |\n"
                            content = content.replace(
                                "## Rating History\n\n| Date | Overall | Understanding | Application | Confidence | Notes |\n|------|---------|---------------|-------------|------------|-------|",
                                f"## Rating History\n\n| Date | Overall | Understanding | Application | Confidence | Notes |\n|------|---------|---------------|-------------|------------|-------|\n{entry}"
                            )
                            content = self._update_timestamp(content)
                            ratings_path.write_text(content)
                            logger.info(f"[ProgressTracker] Added skill rating: {overall}/10")
                    except ValueError:
                        logger.warning(f"[ProgressTracker] Could not parse ratings: {result}")

        except Exception as e:
            logger.error(f"[ProgressTracker] Error assessing skill: {e}")

    async def _extract_vocabulary(
        self,
        coach_dir: Path,
        topic: str,
        user_message: str,
        coach_response: str,
    ) -> None:
        """Extract vocabulary words from language learning conversations."""
        try:
            vocab_path = coach_dir / "vocabulary.md"
            
            # Create vocabulary file if it doesn't exist
            if not vocab_path.exists():
                logger.info(f"[ProgressTracker] Creating vocabulary file")
                vocab_content = self._generate_vocabulary_file(topic, coach_dir.name)
                vocab_path.write_text(vocab_content)

            # Look for vocabulary indicators
            vocab_indicators = [
                'means', 'is called', 'vocabulary', 'word for', 'how to say',
                'translates to', 'correction', 'the correct', 'you said', 'should be',
                'spelled', 'written as', 'pronounced', 'actually', 'not "', "not '",
                'instead of', 'rather than', 'gently correct', 'let me correct',
                'le mot', 'la phrase', 'en français', 'en anglais', 'signifie',
                'veut dire', 'se dit', 'vocabulaire', 'nouveau mot', "s'écrit",
                "c'est", 'contraction', 'trois mots',
                'la palabra', 'en español', 'significa',
                'das wort', 'auf deutsch', 'bedeutet',
                'remember', 'note that', 'tip:', 'hint:', 'grammar', 'rule',
            ]
            
            combined = (user_message + " " + coach_response).lower()
            has_correction = 'correct' in combined or 'spelled' in combined or 'written' in combined
            
            if not any(indicator in combined for indicator in vocab_indicators) and not has_correction:
                return

            client = self._get_client()
            
            response = await client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": f"""Extract vocabulary from this language learning exchange.

Look for:
- Words the coach corrected
- New vocabulary introduced
- Grammar corrections

User: "{user_message[:500]}"
Coach: "{coach_response[:500]}"

Format: WORD | MEANING | EXAMPLE
One per line. If no vocabulary, respond "NONE".

Vocabulary:"""
                }]
            )
            
            result = response.content[0].text.strip()
            
            if result and result != "NONE":
                content = vocab_path.read_text()
                now = datetime.utcnow().strftime("%Y-%m-%d")
                
                for line in result.split("\n"):
                    if "|" in line:
                        parts = [p.strip() for p in line.split("|")]
                        if len(parts) >= 2:
                            word = parts[0]
                            meaning = parts[1]
                            example = parts[2] if len(parts) > 2 else ""
                            
                            if word.lower() not in content.lower():
                                entry = f"| {word} | {meaning} | {example} | {now} | ☐ |\n"
                                content = content.replace(
                                    "| Word/Phrase | Meaning | Example | Added | Mastered |\n|-------------|---------|---------|-------|----------|",
                                    f"| Word/Phrase | Meaning | Example | Added | Mastered |\n|-------------|---------|---------|-------|----------|\n{entry}"
                                )
                
                content = self._update_timestamp(content)
                vocab_path.write_text(content)
                logger.info(f"[ProgressTracker] Added vocabulary")

        except Exception as e:
            logger.error(f"[ProgressTracker] Error extracting vocabulary: {e}")

    async def _update_overview_activity(self, topic: str, coach_name: str) -> None:
        """Update the overview file when activity happens."""
        overview_path = self.coaching_dir / "overview.md"
        if not overview_path.exists():
            return

        try:
            content = overview_path.read_text()
            now = datetime.utcnow().strftime("%Y-%m-%d")

            # Update the topic row
            pattern = rf"\| {re.escape(topic)} \| ([^|]+) \| ([^|]+) \| (\d+) \| ([^|]+) \|"
            match = re.search(pattern, content)
            if match:
                coach = match.group(1).strip()
                level = match.group(2).strip()
                sessions = int(match.group(3).strip()) + 1
                content = re.sub(
                    pattern,
                    f"| {topic} | {coach} | {level} | {sessions} | {now} |",
                    content
                )

            content = self._update_timestamp(content)
            overview_path.write_text(content)

        except Exception as e:
            logger.error(f"[ProgressTracker] Error updating overview: {e}")

    def _update_timestamp(self, content: str) -> str:
        """Update the Last Updated timestamp in a file."""
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        return re.sub(
            r"\*Last Updated: [^\*]+\*",
            f"*Last Updated: {now}*",
            content
        )

    async def get_overview(self) -> str | None:
        """Get the overview file content."""
        overview_path = self.coaching_dir / "overview.md"
        if overview_path.exists():
            return overview_path.read_text()
        return None

    async def get_topic_progress(self, topic: str) -> str | None:
        """Get a topic's progress - tries both old and new file structures."""
        # Try old structure first
        topic_path = self.coaching_dir / f"{self._slugify(topic)}.md"
        if topic_path.exists():
            return topic_path.read_text()
        return None

    async def get_coach_progress(self, coach_name: str) -> dict[str, str]:
        """Get all progress files for a specific coach."""
        coach_dir = self._get_coach_dir(coach_name)
        if not coach_dir.exists():
            return {}

        files = {}
        for file_path in coach_dir.iterdir():
            if file_path.suffix == ".md":
                files[file_path.stem] = file_path.read_text()
        return files

    async def get_vocabulary(self, topic_or_coach: str) -> str | None:
        """Get vocabulary file content - supports both old and new structures."""
        # Try new structure (coach folder)
        coach_dir = self._get_coach_dir(topic_or_coach)
        vocab_path = coach_dir / "vocabulary.md"
        if vocab_path.exists():
            return vocab_path.read_text()
        
        # Try old structure
        vocab_path = self.coaching_dir / f"{self._slugify(topic_or_coach)}-vocabulary.md"
        if vocab_path.exists():
            return vocab_path.read_text()
        
        return None

    async def list_topics(self) -> list[str]:
        """List all topics being tracked (legacy compatibility)."""
        if not self.coaching_dir.exists():
            return []

        topics = []
        for f in self.coaching_dir.iterdir():
            if f.suffix == ".md" and f.name != "overview.md" and "-vocabulary" not in f.name:
                topics.append(f.stem.replace("-", " ").title())
        return topics

    async def list_coaches(self) -> list[str]:
        """List all coaches (by their folder names)."""
        if not self.coaching_dir.exists():
            return []

        coaches = []
        for f in self.coaching_dir.iterdir():
            if f.is_dir():
                coaches.append(f.name.replace("-", " ").title())
        return coaches

    async def get_coach_prompts(self, coach_name: str) -> dict[str, str | None]:
        """
        Get the soul and skills prompts from files for a coach.
        
        Returns dict with "soul_prompt" and "skills_prompt" keys.
        These are the EDITABLE versions from the files.
        """
        coach_dir = self._get_coach_dir(coach_name)
        
        result = {
            "soul_prompt": None,
            "skills_prompt": None,
        }
        
        # Read soul.md
        soul_path = coach_dir / "soul.md"
        if soul_path.exists():
            content = soul_path.read_text()
            # Extract the actual prompt (after the "---" separator)
            if "---" in content:
                parts = content.split("---", 2)
                if len(parts) >= 2:
                    result["soul_prompt"] = parts[-1].strip()
                else:
                    result["soul_prompt"] = content
            else:
                result["soul_prompt"] = content
        
        # Read skills.md
        skills_path = coach_dir / "skills.md"
        if skills_path.exists():
            content = skills_path.read_text()
            # Extract the actual prompt (after the "---" separator)
            if "---" in content:
                parts = content.split("---", 2)
                if len(parts) >= 2:
                    result["skills_prompt"] = parts[-1].strip()
                else:
                    result["skills_prompt"] = content
            else:
                result["skills_prompt"] = content
        
        return result

    async def save_coach_prompts(
        self, 
        coach_name: str, 
        soul_prompt: str | None = None, 
        skills_prompt: str | None = None
    ) -> None:
        """
        Save/update the soul and skills prompts to files.
        
        This can be used to update prompts after the agent is created,
        or to sync database prompts to files.
        """
        coach_dir = self._ensure_coach_dir(coach_name)
        now = datetime.utcnow().strftime("%Y-%m-%d")
        
        if soul_prompt is not None:
            soul_content = f"""# {coach_name}'s Soul

*This file defines the coach's personality and character.*
*You can edit this file to customize how the coach behaves!*
*Changes take effect on the next conversation.*
*Last Updated: {now}*

---

{soul_prompt}
"""
            (coach_dir / "soul.md").write_text(soul_content)
            logger.info(f"[ProgressTracker] Updated soul.md for {coach_name}")
        
        if skills_prompt is not None:
            skills_content = f"""# {coach_name}'s Skills & Expertise

*This file defines what the coach knows and how they teach.*
*You can edit this file to customize the coach's knowledge and approach!*
*Changes take effect on the next conversation.*
*Last Updated: {now}*

---

{skills_prompt}
"""
            (coach_dir / "skills.md").write_text(skills_content)
            logger.info(f"[ProgressTracker] Updated skills.md for {coach_name}")

    async def get_memory_context(self, topic_or_coach: str) -> str:
        """
        Get the memory context for prompts - supports both old and new structures.
        """
        sections = []
        
        # Try new structure first (coach folder)
        coach_dir = self._get_coach_dir(topic_or_coach)
        if coach_dir.exists():
            # Read learnings
            learnings_path = coach_dir / "learnings.md"
            if learnings_path.exists():
                content = learnings_path.read_text()
                if "## Learnings" in content:
                    match = re.search(r"## Learnings\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
                    if match and match.group(1).strip():
                        learnings = match.group(1).strip()
                        if "Nothing learned yet" not in learnings:
                            sections.append(f"What I remember about you:\n{learnings}")
            
            # Read summary
            summary_path = coach_dir / "summary.md"
            if summary_path.exists():
                content = summary_path.read_text()
                if "## Session Summaries" in content:
                    match = re.search(r"## Session Summaries\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
                    if match and match.group(1).strip():
                        summaries = match.group(1).strip()
                        if "No sessions yet" not in summaries:
                            sections.append(f"Our past conversations:\n{summaries[:1500]}")
            
            # Read strengths
            strengths_path = coach_dir / "strengths.md"
            if strengths_path.exists():
                content = strengths_path.read_text()
                if "## Strengths" in content:
                    match = re.search(r"## Strengths\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
                    if match and match.group(1).strip():
                        strengths = match.group(1).strip()
                        if "discover your strengths" not in strengths:
                            sections.append(f"Your strengths:\n{strengths}")
            
            # Read improvements
            improvements_path = coach_dir / "improvements.md"
            if improvements_path.exists():
                content = improvements_path.read_text()
                if "## Focus Areas" in content:
                    match = re.search(r"## Focus Areas\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
                    if match and match.group(1).strip():
                        improvements = match.group(1).strip()
                        if "identify focus areas" not in improvements:
                            sections.append(f"Areas to work on:\n{improvements}")
        
        else:
            # Fall back to old structure
            topic_slug = self._slugify(topic_or_coach)
            topic_path = self.coaching_dir / f"{topic_slug}.md"
            
            if topic_path.exists():
                content = topic_path.read_text()
                
                # What I Know About You
                known_match = re.search(
                    r"## What I Know About You\n(.*?)(?=\n## |\Z)",
                    content,
                    re.DOTALL
                )
                if known_match and known_match.group(1).strip():
                    sections.append(f"What I remember about you:\n{known_match.group(1).strip()}")
                
                # Recent Conversations / Summary
                conv_match = re.search(
                    r"## (Recent Conversations|Conversation Summary)\n(.*?)(?=\n## |\Z)",
                    content,
                    re.DOTALL
                )
                if conv_match and conv_match.group(2).strip():
                    sections.append(f"Our past conversations:\n{conv_match.group(2).strip()[:1500]}")
        
        return "\n\n".join(sections)

    async def add_strength(self, coach_name: str, strength: str) -> None:
        """Add a strength to a coach's strengths file."""
        coach_dir = self._get_coach_dir(coach_name)
        strengths_path = coach_dir / "strengths.md"
        
        if strengths_path.exists():
            content = strengths_path.read_text()
            now = datetime.utcnow().strftime("%Y-%m-%d")
            entry = f"\n- *({now})* {strength}"
            
            if "## Strengths" in content:
                content = content.replace("## Strengths\n", f"## Strengths\n{entry}")
                content = content.replace("*We'll discover your strengths as we work together!*", "")
            
            content = self._update_timestamp(content)
            strengths_path.write_text(content)
            logger.info(f"[ProgressTracker] Added strength: {strength[:50]}...")

    async def add_improvement(self, coach_name: str, improvement: str) -> None:
        """Add an improvement area to a coach's improvements file."""
        coach_dir = self._get_coach_dir(coach_name)
        improvements_path = coach_dir / "improvements.md"
        
        if improvements_path.exists():
            content = improvements_path.read_text()
            now = datetime.utcnow().strftime("%Y-%m-%d")
            entry = f"\n- *({now})* {improvement}"
            
            if "## Focus Areas" in content:
                content = content.replace("## Focus Areas\n", f"## Focus Areas\n{entry}")
                content = content.replace("*We'll identify focus areas as we progress!*", "")
            
            content = self._update_timestamp(content)
            improvements_path.write_text(content)
            logger.info(f"[ProgressTracker] Added improvement: {improvement[:50]}...")

    # Legacy compatibility methods
    async def record_session(
        self,
        topic: str,
        summary: str,
        duration_minutes: int | None = None,
        key_learnings: list[str] | None = None,
        areas_to_review: list[str] | None = None,
        mood: str | None = None,
    ) -> None:
        """Legacy method - records a session summary."""
        # This is kept for backward compatibility
        pass

    async def update_skill_level(
        self,
        topic: str,
        level: str,
        notes: str | None = None,
    ) -> None:
        """Update the skill level for a topic."""
        pass
