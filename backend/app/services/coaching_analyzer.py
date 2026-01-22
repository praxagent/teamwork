"""Coaching analyzer service using Claude to analyze learning goals and topics."""

import json
import logging
from typing import Any

from app.services.base import BaseAnalyzer
from app.utils.text import strip_markdown_json

logger = logging.getLogger(__name__)


class CoachingAnalyzer(BaseAnalyzer):
    """Analyzes coaching goals and creates personalized learning plans using Claude."""

    # Implement abstract methods from BaseAnalyzer
    async def analyze(self, description: str) -> dict[str, Any]:
        """Alias for analyze_coaching_goals to satisfy base class."""
        return await self.analyze_coaching_goals(description)

    async def generate_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        """Alias for generate_coaching_questions to satisfy base class."""
        return await self.generate_coaching_questions(description, analysis)

    async def analyze_coaching_goals(self, description: str) -> dict[str, Any]:
        """
        Analyze the coaching description and extract learning topics and goals.

        Returns dict with:
        - suggested_name: A motivational project name
        - topics: List of 3-5 learning topics identified
        - skill_levels: Dict mapping topic to estimated current skill level
        - learning_goals: Overall learning objectives
        - time_commitment: Estimated time commitment preference
        - learning_style: Inferred learning style preferences
        """
        logger.info(f"[CoachingAnalyzer] analyze_coaching_goals called with {len(description)} chars")

        prompt = f"""Analyze this learning/coaching request and extract key information about what the user wants to learn.

Description: {description}

Return a JSON object with:
- suggested_name: A motivational project name (2-4 words, like "Math Mastery Journey" or "Interview Prep Academy")
- topics: Array of 3-5 specific learning topics identified (e.g., "Calculus", "System Design", "French Conversation")
- skill_levels: Object mapping each topic to estimated current level ("beginner", "intermediate", "advanced")
- learning_goals: Array of 2-4 overall learning objectives
- time_commitment: Estimated weekly time commitment preference ("light" = 2-5 hrs, "moderate" = 5-10 hrs, "intensive" = 10+ hrs)
- learning_style: Inferred learning style from description ("visual", "hands-on", "theoretical", "mixed")

Respond ONLY with valid JSON, no markdown or explanation."""

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            result = json.loads(strip_markdown_json(response.content[0].text))
            logger.info(f"[CoachingAnalyzer] Analysis complete: topics={result.get('topics')}")
            return result
        except json.JSONDecodeError as e:
            logger.warning(f"[CoachingAnalyzer] JSON parse error: {e}, using defaults")
            return {
                "suggested_name": "Learning Journey",
                "topics": ["General Learning"],
                "skill_levels": {"General Learning": "beginner"},
                "learning_goals": ["Improve skills", "Build confidence"],
                "time_commitment": "moderate",
                "learning_style": "mixed",
            }
        except Exception as e:
            logger.error(f"[CoachingAnalyzer] Error calling Claude API: {str(e)}")
            raise

    async def generate_coaching_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        """
        Generate 3-5 clarifying questions focused on learning preferences and goals.
        """
        logger.info("[CoachingAnalyzer] generate_coaching_questions called")

        topics_str = ", ".join(analysis.get("topics", ["learning"]))

        prompt = f"""Based on this learning request and analysis, generate 3-5 clarifying questions
to better understand the learner's needs and customize their coaching experience.

Description: {description}

Analysis:
- Topics: {topics_str}
- Learning Goals: {', '.join(analysis.get('learning_goals', []))}
- Time Commitment: {analysis.get('time_commitment', 'moderate')}

Generate questions that:
1. Understand current experience level in each topic
2. Clarify specific goals (e.g., "pass an exam", "career change", "personal enrichment")
3. Understand preferred learning schedule (morning/evening, weekdays/weekends)
4. Identify any deadlines or target dates
5. Understand accountability preferences (regular check-ins, progress tracking)

Return ONLY a JSON array of question strings, no explanation."""

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            questions = json.loads(strip_markdown_json(response.content[0].text))
            logger.info(f"[CoachingAnalyzer] Generated {len(questions)} questions")
            return questions
        except json.JSONDecodeError:
            logger.warning("[CoachingAnalyzer] JSON parse error for questions, using defaults")
            return [
                "What is your current experience level with these topics?",
                "What specific goals are you trying to achieve? (e.g., exam prep, career change, personal growth)",
                "What is your preferred learning schedule? (mornings, evenings, weekends)",
                "Do you have any specific deadlines or target dates?",
                "How do you prefer to be held accountable? (regular check-ins, progress tracking)",
            ]
        except Exception as e:
            logger.error(f"[CoachingAnalyzer] Error generating questions: {str(e)}")
            raise

    async def auto_answer_questions(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
    ) -> list[str]:
        """
        Automatically generate reasonable answers to coaching questions.
        """
        questions_text = "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions))

        prompt = f"""You are helping a user who wants to learn but wants the AI to make reasonable decisions for them.

Based on this learning request and analysis, provide sensible default answers to the clarifying questions.

Description: {description}

Analysis:
- Topics: {', '.join(analysis.get('topics', []))}
- Current Levels: {json.dumps(analysis.get('skill_levels', {}))}
- Goals: {', '.join(analysis.get('learning_goals', []))}

Questions to answer:
{questions_text}

Provide thoughtful, practical answers that:
1. Are realistic for a typical adult learner
2. Set achievable expectations
3. Favor consistency over intensity
4. Acknowledge the user might be busy

Return ONLY a JSON array of answer strings (one answer per question, in order), no explanation."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            answers = json.loads(strip_markdown_json(response.content[0].text))
            if len(answers) != len(questions):
                return ["Let the AI coach decide based on best practices" for _ in questions]
            return answers
        except json.JSONDecodeError:
            return ["Let the AI coach decide based on best practices" for _ in questions]

    async def create_coaching_breakdown(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
        answers: list[str],
    ) -> dict[str, Any]:
        """
        Create a detailed coaching breakdown with topics and initial learning paths.
        """
        qa_pairs = "\n".join(
            f"Q: {q}\nA: {a}" for q, a in zip(questions, answers)
        )

        prompt = f"""Create a personalized coaching breakdown for this learner.

Description: {description}

Analysis:
{json.dumps(analysis, indent=2)}

Clarifications:
{qa_pairs}

Create a breakdown with:
1. topics: Array of learning topics (3-5), each with:
   - name: The topic name
   - current_level: beginner/intermediate/advanced
   - target_level: The goal level
   - priority: 1-5 (5 is highest priority)
   - initial_goals: Array of 2-3 initial learning goals for this topic
   - suggested_resources: Array of 2-3 resource types (e.g., "practice problems", "video lectures", "flashcards")

2. schedule: Recommended learning schedule:
   - sessions_per_week: Number of sessions
   - minutes_per_session: Duration
   - best_times: Array of suggested times

3. milestones: Array of 3-5 milestones with:
   - name: Milestone name
   - description: What achieving it looks like
   - estimated_weeks: Weeks to reach it

4. coaching_style: Recommended coaching approach:
   - encouragement_level: "high", "moderate", "minimal"
   - check_in_frequency: "daily", "every_few_days", "weekly"
   - focus: "mastery", "breadth", "practical_application"

Return ONLY valid JSON, no markdown or explanation."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            return json.loads(strip_markdown_json(response.content[0].text))
        except json.JSONDecodeError:
            # Return a basic structure
            topics = analysis.get("topics", ["General Learning"])
            return {
                "topics": [
                    {
                        "name": topic,
                        "current_level": analysis.get("skill_levels", {}).get(topic, "beginner"),
                        "target_level": "intermediate" if analysis.get("skill_levels", {}).get(topic) == "beginner" else "advanced",
                        "priority": 5 - i,
                        "initial_goals": [f"Understand {topic} fundamentals", f"Practice {topic} regularly"],
                        "suggested_resources": ["practice problems", "video lectures", "notes"],
                    }
                    for i, topic in enumerate(topics[:5])
                ],
                "schedule": {
                    "sessions_per_week": 3,
                    "minutes_per_session": 45,
                    "best_times": ["evenings", "weekends"],
                },
                "milestones": [
                    {
                        "name": "Getting Started",
                        "description": "Complete initial assessments and set up learning routine",
                        "estimated_weeks": 1,
                    },
                    {
                        "name": "Building Foundations",
                        "description": "Master the basics of each topic",
                        "estimated_weeks": 4,
                    },
                    {
                        "name": "Consistent Practice",
                        "description": "Maintain regular practice schedule",
                        "estimated_weeks": 8,
                    },
                ],
                "coaching_style": {
                    "encouragement_level": "high",
                    "check_in_frequency": "every_few_days",
                    "focus": "mastery",
                },
            }
