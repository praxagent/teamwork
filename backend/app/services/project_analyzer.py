"""Project analyzer service using Claude to break down app requirements."""

import json
import logging
import time
import traceback
from typing import Any

from anthropic import AsyncAnthropic

from app.config import settings

logger = logging.getLogger(__name__)


def strip_markdown_json(text: str) -> str:
    """Strip markdown code block wrappers from JSON responses."""
    text = text.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        else:
            text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


class ProjectAnalyzer:
    """Analyzes project descriptions and creates breakdowns using Claude."""

    def __init__(self) -> None:
        api_key = settings.anthropic_api_key
        if not api_key:
            logger.error("[ProjectAnalyzer] No ANTHROPIC_API_KEY found!")
            raise ValueError("ANTHROPIC_API_KEY is not set in environment variables")
        
        # Strip quotes if present (common .env issue)
        api_key = api_key.strip('"').strip("'")
        
        # Log key presence (not the actual key)
        logger.info(f"[ProjectAnalyzer] Initializing with API key: {api_key[:12]}...{api_key[-4:] if len(api_key) > 16 else ''}")
        self.client = AsyncAnthropic(api_key=api_key, timeout=60.0)  # 60 second timeout
        # Use a valid model name
        self.model = "claude-sonnet-4-20250514"
        logger.info(f"[ProjectAnalyzer] Using model: {self.model}")

    async def analyze_description(self, description: str) -> dict[str, Any]:
        """
        Analyze the app description and extract key information.

        Returns dict with:
        - suggested_name: Project name suggestion
        - app_type: Type of application (web, mobile, api, etc.)
        - complexity: Estimated complexity (simple, moderate, complex)
        - core_features: List of core features identified
        - tech_suggestions: Suggested technologies
        """
        logger.info(f"[ProjectAnalyzer] analyze_description called with {len(description)} chars")
        
        prompt = f"""Analyze this app/project description and extract key information.

Description: {description}

Return a JSON object with:
- suggested_name: A short, catchy project name (2-3 words max)
- app_type: Type of application (web_app, mobile_app, api, cli, desktop, etc.)
- complexity: Estimated complexity (simple, moderate, complex)
- core_features: Array of 3-7 core features/functionalities identified
- tech_suggestions: Object with suggested technologies:
  - frontend: Suggested frontend tech
  - backend: Suggested backend tech
  - database: Suggested database
  - other: Any other relevant tech

Respond ONLY with valid JSON, no markdown or explanation."""

        try:
            start_time = time.time()
            msg = f"[ProjectAnalyzer] Calling Claude API for analysis (model={self.model})..."
            logger.info(msg)
            print(msg, flush=True)
            
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            elapsed = time.time() - start_time
            msg = f"[ProjectAnalyzer] Claude API response received in {elapsed:.2f}s, parsing JSON..."
            logger.info(msg)
            print(msg, flush=True)
            
            result = json.loads(strip_markdown_json(response.content[0].text))
            msg = f"[ProjectAnalyzer] Analysis complete: suggested_name={result.get('suggested_name')}"
            logger.info(msg)
            print(msg, flush=True)
            return result
        except json.JSONDecodeError as e:
            msg = f"[ProjectAnalyzer] JSON parse error: {e}, using defaults"
            logger.warning(msg)
            print(msg, flush=True)
            print(f"[ProjectAnalyzer] Raw response: {response.content[0].text[:500]}", flush=True)
            # Return a basic structure if parsing fails
            return {
                "suggested_name": "New Project",
                "app_type": "web_app",
                "complexity": "moderate",
                "core_features": ["Core functionality"],
                "tech_suggestions": {
                    "frontend": "React",
                    "backend": "FastAPI",
                    "database": "PostgreSQL",
                },
            }
        except Exception as e:
            msg = f"[ProjectAnalyzer] Error calling Claude API: {str(e)}"
            logger.error(msg)
            print(msg, flush=True)
            print(f"[ProjectAnalyzer] Traceback: {traceback.format_exc()}", flush=True)
            raise

    async def generate_clarifying_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        """
        Generate 3-5 clarifying questions based on the description and analysis.
        """
        logger.info("[ProjectAnalyzer] generate_clarifying_questions called")
        
        prompt = f"""Based on this app description and initial analysis, generate 3-5 clarifying questions
to better understand the requirements. Focus on questions that will help break down the work.

Description: {description}

Initial Analysis:
- App Type: {analysis.get('app_type')}
- Complexity: {analysis.get('complexity')}
- Core Features: {', '.join(analysis.get('core_features', []))}

Generate questions that:
1. Clarify ambiguous requirements
2. Help define scope and priorities
3. Understand user expectations for key features
4. Identify any constraints or preferences

Return ONLY a JSON array of question strings, no explanation."""

        try:
            start_time = time.time()
            logger.info(f"[ProjectAnalyzer] Calling Claude API for questions (model={self.model})...")
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            elapsed = time.time() - start_time
            logger.info(f"[ProjectAnalyzer] Claude API response received in {elapsed:.2f}s, parsing JSON...")
            
            questions = json.loads(strip_markdown_json(response.content[0].text))
            logger.info(f"[ProjectAnalyzer] Generated {len(questions)} questions")
            return questions
        except json.JSONDecodeError as e:
            logger.warning(f"[ProjectAnalyzer] JSON parse error for questions: {e}, using defaults")
            return [
                "What is the primary user persona for this application?",
                "Are there any specific design or technology preferences?",
                "What is the expected scale of the application?",
                "Are there any third-party integrations required?",
                "What is the timeline expectation for an MVP?",
            ]
        except Exception as e:
            logger.error(f"[ProjectAnalyzer] Error generating questions: {str(e)}")
            logger.error(f"[ProjectAnalyzer] Traceback: {traceback.format_exc()}")
            raise

    async def auto_answer_questions(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
    ) -> list[str]:
        """
        Automatically generate reasonable answers to clarifying questions.
        """
        questions_text = "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions))

        prompt = f"""You are helping a user who wants to build an app but wants the AI to make reasonable decisions for them.

Based on this app description and analysis, provide sensible default answers to the clarifying questions.
Make reasonable assumptions that would work well for most users. Be specific but not overly complex.

Description: {description}

Analysis:
- App Type: {analysis.get('app_type')}
- Complexity: {analysis.get('complexity')}
- Core Features: {', '.join(analysis.get('core_features', []))}

Questions to answer:
{questions_text}

Provide thoughtful, practical answers that:
1. Make reasonable assumptions for a typical user
2. Keep the scope manageable for an MVP
3. Choose modern, standard technologies
4. Balance simplicity with good practices

Return ONLY a JSON array of answer strings (one answer per question, in order), no explanation."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            answers = json.loads(strip_markdown_json(response.content[0].text))
            # Ensure we have the right number of answers
            if len(answers) != len(questions):
                return [f"Let the AI decide based on best practices" for _ in questions]
            return answers
        except json.JSONDecodeError:
            return [f"Let the AI decide based on best practices" for _ in questions]

    async def create_project_breakdown(
        self,
        description: str,
        analysis: dict[str, Any],
        questions: list[str],
        answers: list[str],
    ) -> dict[str, Any]:
        """
        Create a detailed project breakdown with components and teams.
        """
        qa_pairs = "\n".join(
            f"Q: {q}\nA: {a}" for q, a in zip(questions, answers)
        )

        prompt = f"""Create a detailed project breakdown for this application.

Description: {description}

Analysis:
{json.dumps(analysis, indent=2)}

Clarifications:
{qa_pairs}

Create a breakdown with:
1. components: Array of components/features to build, each with:
   - name: Component name
   - description: What it does
   - team: Which team should work on it (Frontend, Backend, Full Stack, etc.)
   - priority: 1-5 (5 is highest)
   - estimated_complexity: simple, moderate, complex
   - dependencies: Array of other component names this depends on

2. teams: Array of team names needed (typically 2-4 teams)

3. architecture: Brief architecture description

4. mvp_scope: What should be in the MVP

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
            return {
                "components": [
                    {
                        "name": "Core Application",
                        "description": "Main application functionality",
                        "team": "Full Stack",
                        "priority": 5,
                        "estimated_complexity": "moderate",
                        "dependencies": [],
                    }
                ],
                "teams": ["Full Stack", "Frontend", "Backend"],
                "architecture": "Standard web application architecture",
                "mvp_scope": "Core functionality",
            }
