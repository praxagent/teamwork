"""Project analyzer service using Claude to break down app requirements."""

import json
import logging
import time
import traceback
from typing import Any

from app.services.base import BaseAnalyzer
from app.utils.text import strip_markdown_json

logger = logging.getLogger(__name__)


class ProjectAnalyzer(BaseAnalyzer):
    """Analyzes project descriptions and creates breakdowns using Claude."""

    # Implement abstract methods from BaseAnalyzer
    async def analyze(self, description: str) -> dict[str, Any]:
        """Alias for analyze_description to satisfy base class."""
        return await self.analyze_description(description)

    async def generate_questions(
        self, description: str, analysis: dict[str, Any]
    ) -> list[str]:
        """Alias for generate_clarifying_questions to satisfy base class."""
        return await self.generate_clarifying_questions(description, analysis)

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
        Create a detailed project breakdown with actionable tasks.
        """
        qa_pairs = "\n".join(
            f"Q: {q}\nA: {a}" for q, a in zip(questions, answers)
        )

        prompt = f"""Create a detailed project breakdown with SPECIFIC, ACTIONABLE TASKS for this application.

Description: {description}

Analysis:
{json.dumps(analysis, indent=2)}

Clarifications:
{qa_pairs}

Create a breakdown with 6-12 SPECIFIC tasks. IMPORTANT RULES:
- Each task must be concrete and achievable by ONE developer in 1-4 hours
- Do NOT create vague tasks like "Implement Core Application" - be SPECIFIC
- Include BOTH development AND testing tasks
- Testing tasks should be assigned to QA team
- Order tasks by dependency (things that need to be done first get higher priority)

CRITICAL - SPLIT LARGE TASKS INTO SMALLER FOCUSED TASKS:
- "Set up project with dependencies" should be SEPARATE from "Create folder structure"
- "Install and configure tooling" should be SEPARATE from "Create sample components"
- "Write tests" should be SEPARATE from "Set up testing infrastructure"
- Each task should focus on ONE clear deliverable, not a multi-step workflow
- If a task has multiple distinct phases (install, configure, create, verify), split it into multiple tasks
- Tasks involving both setup AND verification/testing should be split into separate tasks
- Avoid bundling "set up X and create sample Y" into one task - these are two tasks

Create a breakdown with:
1. components: Array of SPECIFIC tasks (NOT vague features), each with:
   - name: Specific task name (e.g., "Create user registration form with email validation", NOT "Implement User Auth")
   - description: Detailed description of exactly what to build/test (2-3 sentences)
   - team: "Frontend", "Backend", "Full Stack", or "QA" (use QA for testing tasks)
   - task_type: "development" or "testing"
   - priority: 1-5 (5 is highest, things needed first get higher priority)
   - estimated_complexity: simple, moderate, complex
   - dependencies: Array of other task names this depends on

EXAMPLE GOOD TASKS (focused, single-deliverable):
- "Initialize project with package manager and dependencies" (priority 5)
- "Create folder structure for components, utils, and services" (priority 5)
- "Create database schema for users table" (priority 5)
- "Build login form UI component" (priority 4)
- "Implement authentication API endpoint" (priority 4)
- "Set up testing framework and configuration" (priority 4)
- "Write unit tests for authentication" (priority 3, QA)
- "Create reusable button and input components" (priority 3)
- "End-to-end testing of login flow" (priority 2, QA)

EXAMPLE BAD TASKS (DO NOT DO THIS):
- "Implement Core Application" (too vague)
- "Build the frontend" (too vague)
- "Handle backend logic" (too vague)
- "Set up project structure with tooling and create sample components" (BUNDLED - split into separate tasks!)
- "Install dependencies, configure linting, and write tests" (BUNDLED - split into 3 tasks!)

2. teams: Array of team names needed

3. architecture: Brief architecture description

4. mvp_scope: What should be in the MVP

Return ONLY valid JSON, no markdown or explanation."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            return json.loads(strip_markdown_json(response.content[0].text))
        except json.JSONDecodeError:
            # Return a more useful basic structure with specific tasks
            return {
                "components": [
                    {
                        "name": "Set up project structure and dependencies",
                        "description": "Initialize the project with proper folder structure, package.json/requirements, and basic configuration files",
                        "team": "Full Stack",
                        "task_type": "development",
                        "priority": 5,
                        "estimated_complexity": "simple",
                        "dependencies": [],
                    },
                    {
                        "name": "Create database models and schema",
                        "description": "Design and implement the database schema with all necessary tables and relationships",
                        "team": "Backend",
                        "task_type": "development",
                        "priority": 5,
                        "estimated_complexity": "moderate",
                        "dependencies": [],
                    },
                    {
                        "name": "Build core API endpoints",
                        "description": "Implement the main REST API endpoints for CRUD operations",
                        "team": "Backend",
                        "task_type": "development",
                        "priority": 4,
                        "estimated_complexity": "moderate",
                        "dependencies": ["Create database models and schema"],
                    },
                    {
                        "name": "Create main UI layout and navigation",
                        "description": "Build the core layout components including header, sidebar, and navigation structure",
                        "team": "Frontend",
                        "task_type": "development",
                        "priority": 4,
                        "estimated_complexity": "moderate",
                        "dependencies": ["Set up project structure and dependencies"],
                    },
                    {
                        "name": "Implement core feature components",
                        "description": "Build the main feature UI components that users will interact with",
                        "team": "Frontend",
                        "task_type": "development",
                        "priority": 3,
                        "estimated_complexity": "moderate",
                        "dependencies": ["Create main UI layout and navigation"],
                    },
                    {
                        "name": "Write unit tests for API endpoints",
                        "description": "Create comprehensive unit tests for all API endpoints including edge cases",
                        "team": "QA",
                        "task_type": "testing",
                        "priority": 2,
                        "estimated_complexity": "moderate",
                        "dependencies": ["Build core API endpoints"],
                    },
                    {
                        "name": "End-to-end testing of complete user flows",
                        "description": "Test the complete application flow from user perspective, including all main features",
                        "team": "QA",
                        "task_type": "testing",
                        "priority": 1,
                        "estimated_complexity": "moderate",
                        "dependencies": ["Implement core feature components"],
                    },
                ],
                "teams": ["Full Stack", "Frontend", "Backend", "QA"],
                "architecture": "Standard web application architecture",
                "mvp_scope": "Core functionality with essential features",
            }
