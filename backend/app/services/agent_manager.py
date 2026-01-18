"""Agent manager for spawning and managing Claude Code instances."""

import asyncio
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Agent, ActivityLog, Message, Channel, Task
from app.websocket import manager as ws_manager, WebSocketEvent, EventType


@dataclass
class AgentProcess:
    """Represents a running agent process."""

    agent_id: str
    project_id: str
    session_id: str | None = None
    is_running: bool = False
    started_at: datetime | None = None
    current_task_id: str | None = None
    workspace_dir: Path | None = None


@dataclass
class AgentMessage:
    """Message to send to an agent."""

    content: str
    channel_id: str | None = None
    from_user: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


def check_claude_code_available() -> bool:
    """Check if Claude Code CLI is available."""
    return shutil.which("claude") is not None


class AgentManager:
    """
    Manages Claude Code agent instances.

    Supports two runtime modes:
    - subprocess: Run agents as local subprocess
    - docker: Run agents in Docker containers
    """

    def __init__(self, db_session_factory: Callable[[], AsyncSession]) -> None:
        self._agents: dict[str, AgentProcess] = {}
        self._message_queues: dict[str, asyncio.Queue[AgentMessage]] = {}
        self._db_session_factory = db_session_factory
        self._workspace_path = settings.workspace_path
        self._live_output: dict[str, dict] = {}  # agent_id -> live Claude Code output

    async def _get_project_workspace(self, db: AsyncSession, project_id: str) -> Path:
        """Get the correct workspace path for a project."""
        from app.models import Project
        result = await db.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        
        if project and project.workspace_dir:
            return self._workspace_path / project.workspace_dir
        return self._workspace_path / project_id

    async def start_agent(
        self,
        agent_id: str,
        project_id: str,
        runtime_mode: str = "subprocess",
    ) -> bool:
        """
        Start an agent process.

        Args:
            agent_id: The agent's database ID
            project_id: The project's database ID
            runtime_mode: 'subprocess' or 'docker'

        Returns:
            True if agent started successfully
        """
        if agent_id in self._agents and self._agents[agent_id].is_running:
            return True  # Already running

        async with self._db_session_factory() as db:
            # Get agent from database
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()

            if not agent:
                return False

            # Get project to find correct workspace directory
            from app.models import Project
            project_result = await db.execute(
                select(Project).where(Project.id == project_id)
            )
            project = project_result.scalar_one_or_none()
            
            # Use project's workspace_dir if set, otherwise fall back to project_id
            workspace_dir_name = project.workspace_dir if project and project.workspace_dir else project_id
            workspace_dir = self._workspace_path / workspace_dir_name
            workspace_dir.mkdir(parents=True, exist_ok=True)

            # Create message queue for this agent
            self._message_queues[agent_id] = asyncio.Queue()

            if runtime_mode == "subprocess":
                success = await self._start_subprocess_agent(agent, workspace_dir, project_id)
            else:
                success = await self._start_docker_agent(agent, workspace_dir, project_id)

            if success:
                # Update agent status
                agent.status = "idle"
                await db.commit()

                # Log activity
                activity = ActivityLog(
                    agent_id=agent_id,
                    activity_type="agent_started",
                    description=f"{agent.name} came online",
                    extra_data={"runtime_mode": runtime_mode},
                )
                db.add(activity)
                await db.commit()

                # Broadcast status change
                await ws_manager.broadcast_to_project(
                    project_id,
                    WebSocketEvent(
                        type=EventType.AGENT_STATUS,
                        data={
                            "agent_id": agent_id,
                            "status": "idle",
                            "name": agent.name,
                        },
                    ),
                )

            return success

    async def _start_subprocess_agent(
        self, agent: Agent, workspace_dir: Path, project_id: str
    ) -> bool:
        """Start an agent as a subprocess using Claude Code CLI."""
        # Initialize git repo if not exists
        git_dir = workspace_dir / ".git"
        if not git_dir.exists():
            try:
                subprocess.run(
                    ["git", "init"],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=10,
                )
                subprocess.run(
                    ["git", "config", "user.email", "agent@vteam.local"],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=10,
                )
                subprocess.run(
                    ["git", "config", "user.name", "VTeam Agent"],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=10,
                )
            except Exception as e:
                print(f"Failed to init git: {e}")

        # Create the agent process record
        agent_process = AgentProcess(
            agent_id=agent.id,
            project_id=project_id,
            is_running=True,
            started_at=datetime.utcnow(),
            workspace_dir=workspace_dir,
        )

        # If agent has a session ID, we can resume
        if agent.session_id:
            agent_process.session_id = agent.session_id

        self._agents[agent.id] = agent_process
        return True

    async def _start_docker_agent(
        self, agent: Agent, workspace_dir: Path, project_id: str
    ) -> bool:
        """Start an agent in a Docker container."""
        # Docker implementation would go here
        # For now, fall back to subprocess
        return await self._start_subprocess_agent(agent, workspace_dir, project_id)

    async def stop_agent(self, agent_id: str) -> bool:
        """Stop an agent process."""
        if agent_id not in self._agents:
            return False

        agent_process = self._agents[agent_id]

        # Note: AgentProcess doesn't hold a persistent process - Claude Code is invoked
        # on-demand for each task. We just mark it as not running.
        agent_process.is_running = False

        # Clean up queue
        if agent_id in self._message_queues:
            del self._message_queues[agent_id]

        async with self._db_session_factory() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()

            if agent:
                agent.status = "offline"
                # Save session ID for potential resume
                if agent_process.session_id:
                    agent.session_id = agent_process.session_id
                await db.commit()

                # Log activity
                activity = ActivityLog(
                    agent_id=agent_id,
                    activity_type="agent_stopped",
                    description=f"{agent.name} went offline",
                )
                db.add(activity)
                await db.commit()

        return True

    async def send_message_to_agent(
        self,
        agent_id: str,
        message: AgentMessage,
    ) -> str | None:
        """
        Send a message to an agent and get their response.

        Args:
            agent_id: The agent's ID
            message: The message to send

        Returns:
            The agent's response, or None if failed
        """
        if agent_id not in self._agents:
            return None

        agent_process = self._agents[agent_id]
        if not agent_process.is_running:
            return None

        async with self._db_session_factory() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()

            if not agent:
                return None

            # Update agent status to working
            agent.status = "working"
            await db.commit()

            # Broadcast status change
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.AGENT_STATUS,
                    data={
                        "agent_id": agent_id,
                        "status": "working",
                        "name": agent.name,
                    },
                ),
            )

            # Log activity
            activity = ActivityLog(
                agent_id=agent_id,
                activity_type="processing_message",
                description=f"Processing message in channel",
                extra_data={"channel_id": message.channel_id},
            )
            db.add(activity)
            await db.commit()

            # Here we would actually invoke Claude Code CLI
            # For now, we'll simulate a response
            response = await self._invoke_claude_code(agent, message)

            # Update agent status back to idle
            agent.status = "idle"
            await db.commit()

            # Broadcast status change
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.AGENT_STATUS,
                    data={
                        "agent_id": agent_id,
                        "status": "idle",
                        "name": agent.name,
                    },
                ),
            )

            return response

    async def _invoke_claude_code(
        self,
        agent: Agent,
        prompt: str,
        workspace_dir: Path,
        session_id: str | None = None,
        allowed_tools: list[str] | None = None,
        model: str | None = None,
    ) -> tuple[str, str | None]:
        """
        Invoke Claude Code CLI to process a prompt.
        
        Returns:
            Tuple of (response_text, new_session_id)
        """
        if not check_claude_code_available():
            return (f"[Claude Code CLI not available. Install it to enable code generation.]", None)
        
        # Build the system prompt with agent personality
        system_prompt = f"""You are {agent.name}, a {agent.role} on a development team.

{agent.soul_prompt or ''}

{agent.skills_prompt or ''}

You write clean, well-documented code. When creating files:
- Follow best practices for the language/framework
- Add appropriate comments
- Create proper directory structure
- Commit your changes with meaningful messages"""

        # Build command - use text output format for streaming visibility
        # Note: -p (print mode) is for non-interactive output, prompt goes at the end
        cmd = ["claude", "-p"]
        
        # Add model selection if specified
        if model:
            cmd.extend(["--model", model])
            print(f">>> Using model: {model}", flush=True)
        
        # Add system prompt
        cmd.extend(["--append-system-prompt", system_prompt])
        
        # Use text output format for readable streaming output
        # (stream-json outputs JSON objects, text is human-readable)
        cmd.extend(["--output-format", "text"])
        
        # Resume session if available
        if session_id:
            cmd.extend(["--resume", session_id])
        
        # Add allowed tools
        if allowed_tools:
            cmd.extend(["--allowedTools", ",".join(allowed_tools)])
        else:
            # Default: allow read, write, and git operations
            cmd.extend(["--allowedTools", "Read,Edit,Write,Bash(git:*)"])
        
        # Add prompt as the final positional argument
        cmd.append(prompt)
        
        try:
            # Run Claude Code with timeout, streaming output for live logs
            full_cmd = ' '.join(cmd[:6])
            print(f">>> Running Claude Code: {full_cmd}...", flush=True)
            print(f">>> Working directory: {workspace_dir}", flush=True)
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=workspace_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,  # Merge stderr into stdout
                env={**os.environ, "ANTHROPIC_API_KEY": settings.anthropic_api_key},
            )
            
            print(f">>> Claude Code process started, PID: {process.pid}", flush=True)
            
            # Preserve any existing output (from preparation phase) and append
            existing_output = ""
            started_at = datetime.utcnow().isoformat()
            if agent.id in self._live_output:
                existing_output = self._live_output[agent.id].get("output", "")
                started_at = self._live_output[agent.id].get("started_at", started_at)
            
            # Update live output status
            self._live_output[agent.id] = {
                "status": "running",
                "output": existing_output + f"\n--- Claude Code Output (PID: {process.pid}) ---\n",
                "last_update": datetime.utcnow().isoformat(),
                "started_at": started_at,
            }
            
            # Read output in chunks for live updates
            output_chunks = []
            last_log_time = datetime.utcnow()
            try:
                while True:
                    try:
                        chunk = await asyncio.wait_for(
                            process.stdout.read(1024),
                            timeout=1.0
                        )
                        if not chunk:
                            # Check if process ended
                            if process.returncode is not None:
                                print(f">>> Claude Code process ended with code: {process.returncode}", flush=True)
                            break
                        decoded = chunk.decode("utf-8", errors="replace")
                        output_chunks.append(decoded)
                        
                        # Log progress every 5 seconds
                        now = datetime.utcnow()
                        if (now - last_log_time).total_seconds() > 5:
                            print(f">>> Claude Code still running, output so far: {len(''.join(output_chunks))} chars", flush=True)
                            last_log_time = now
                        
                        # Update live output - keep full history (up to 50k chars total)
                        current_output = "".join(output_chunks)
                        full_output = existing_output + f"\n--- Claude Code Output (PID: {process.pid}) ---\n" + current_output
                        # Only truncate if really huge, and keep the END (most recent)
                        if len(full_output) > 50000:
                            full_output = "...(truncated)...\n" + full_output[-50000:]
                        self._live_output[agent.id] = {
                            "status": "running",
                            "output": full_output,
                            "last_update": datetime.utcnow().isoformat(),
                            "started_at": started_at,
                        }
                    except asyncio.TimeoutError:
                        # Check if process is still running
                        if process.returncode is not None:
                            print(f">>> Claude Code process exited with code: {process.returncode}", flush=True)
                            break
                        # Update status to show we're still waiting
                        current_output = "".join(output_chunks) if output_chunks else "(waiting for output...)"
                        full_output = existing_output + f"\n--- Claude Code Output (PID: {process.pid}) ---\n" + current_output
                        self._live_output[agent.id]["output"] = full_output
                        self._live_output[agent.id]["last_update"] = datetime.utcnow().isoformat()
                        continue
                        
                # Wait for process to complete
                print(f">>> Waiting for Claude Code process to complete...", flush=True)
                await asyncio.wait_for(process.wait(), timeout=300)
                print(f">>> Claude Code process completed with return code: {process.returncode}", flush=True)
                
            except asyncio.TimeoutError:
                print(f">>> Claude Code timed out after 5 minutes", flush=True)
                process.kill()
                self._live_output[agent.id]["status"] = "timeout"
                self._live_output[agent.id]["error"] = "Task timed out after 5 minutes"
                self._live_output[agent.id]["output"] += "\n\n[TIMEOUT] Task timed out after 5 minutes\n"
                return ("[Task timed out after 5 minutes]", None)
            
            output = "".join(output_chunks)
            print(f">>> Claude Code completed, output length: {len(output)}, return code: {process.returncode}", flush=True)
            
            # If no output, that's suspicious
            if not output.strip():
                print(f">>> WARNING: Claude Code produced no output!", flush=True)
                output = f"(No output from Claude Code CLI. Return code: {process.returncode})"
            
            # Update final output - keep full history (up to 50k chars)
            full_output = existing_output + f"\n--- Claude Code Output (PID: {process.pid}) ---\n" + output
            full_output += f"\n\n[{datetime.utcnow().strftime('%H:%M:%S')}] Task completed (exit code: {process.returncode}).\n"
            if len(full_output) > 50000:
                full_output = "...(truncated)...\n" + full_output[-50000:]
            self._live_output[agent.id] = {
                "status": "completed",
                "output": full_output,
                "last_update": datetime.utcnow().isoformat(),
                "started_at": self._live_output[agent.id]["started_at"],
            }
            
            # Return text output (we use text format, not JSON)
            # Session ID tracking is handled separately via agent.session_id
            return (output, None)
                
        except asyncio.TimeoutError:
            if agent.id in self._live_output:
                self._live_output[agent.id]["status"] = "timeout"
            return ("[Task timed out after 5 minutes]", None)
        except Exception as e:
            if agent.id in self._live_output:
                self._live_output[agent.id]["status"] = "error"
                self._live_output[agent.id]["error"] = str(e)
            return (f"[Error invoking Claude Code: {str(e)}]", None)

    async def _get_chat_context(
        self,
        db: AsyncSession,
        project_id: str,
        agent_id: str,
        limit: int = 50,
    ) -> str:
        """
        Fetch recent chat messages for context.
        
        Returns formatted chat history string.
        """
        from sqlalchemy import or_
        
        # Get all channels for this project
        channels_result = await db.execute(
            select(Channel).where(Channel.project_id == project_id)
        )
        channels = channels_result.scalars().all()
        channel_ids = [c.id for c in channels]
        
        if not channel_ids:
            return ""
        
        # Get recent messages from all channels
        messages_result = await db.execute(
            select(Message)
            .where(Message.channel_id.in_(channel_ids))
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        messages = list(reversed(messages_result.scalars().all()))
        
        if not messages:
            return ""
        
        # Get all agents for name lookup
        agents_result = await db.execute(
            select(Agent).where(Agent.project_id == project_id)
        )
        agents = {a.id: a.name for a in agents_result.scalars().all()}
        
        # Get channel names
        channel_names = {c.id: c.name for c in channels}
        
        # Format messages
        formatted = []
        for msg in messages:
            if msg.agent_id:
                sender = agents.get(msg.agent_id, "Agent")
            else:
                sender = "CEO (User)"
            
            channel_name = channel_names.get(msg.channel_id, "channel")
            formatted.append(f"[#{channel_name}] {sender}: {msg.content}")
        
        return "\n".join(formatted)

    def _select_model_for_task(self, task, project_config: dict) -> str | None:
        """
        Select the appropriate Claude model based on task complexity and project config.
        
        Model selection modes:
        - "auto": PM decides based on task complexity
        - "opus", "sonnet", "haiku": Fixed model for all tasks
        - "hybrid": User can override per task, defaults to auto
        
        Returns model name or None (to use Claude Code default).
        """
        model_mode = project_config.get("model_mode", "auto")
        
        # If a specific model is set on the task, use that (hybrid mode override)
        task_model = None
        if hasattr(task, 'config') and task.config:
            task_model = task.config.get("model")
        if task_model:
            print(f">>> Task-specific model override: {task_model}", flush=True)
            return task_model
        
        # Fixed model modes
        if model_mode == "opus":
            return "claude-sonnet-4-20250514"  # Opus when available, fallback to Sonnet
        elif model_mode == "sonnet":
            return "claude-sonnet-4-20250514"
        elif model_mode == "haiku":
            return "claude-haiku-3-5-20241022"
        
        # Auto mode: determine based on task complexity
        if model_mode in ("auto", "hybrid"):
            complexity = "moderate"
            if hasattr(task, 'config') and task.config:
                complexity = task.config.get("complexity", "moderate")
            
            # Also check task description for complexity hints
            desc_lower = (task.description or "").lower()
            title_lower = (task.title or "").lower()
            
            # High complexity indicators
            high_complexity_keywords = [
                "architecture", "refactor", "redesign", "security", "authentication",
                "database schema", "api design", "complex", "critical", "integration",
                "migrate", "optimize performance", "algorithm"
            ]
            
            # Low complexity indicators
            low_complexity_keywords = [
                "fix typo", "update text", "change color", "simple", "minor",
                "readme", "documentation", "comment", "rename", "small change"
            ]
            
            for kw in high_complexity_keywords:
                if kw in desc_lower or kw in title_lower:
                    complexity = "complex"
                    break
            
            for kw in low_complexity_keywords:
                if kw in desc_lower or kw in title_lower:
                    complexity = "simple"
                    break
            
            # Map complexity to model
            if complexity == "complex":
                print(f">>> Auto-selected model: Sonnet (complex task)", flush=True)
                return "claude-sonnet-4-20250514"
            elif complexity == "simple":
                print(f">>> Auto-selected model: Haiku (simple task)", flush=True)
                return "claude-haiku-3-5-20241022"
            else:
                print(f">>> Auto-selected model: Sonnet (moderate task)", flush=True)
                return "claude-sonnet-4-20250514"
        
        return None  # Use Claude Code default

    async def execute_task(
        self,
        agent_id: str,
        task_id: str,
        include_chat_context: bool = True,
    ) -> dict[str, Any]:
        """
        Have an agent execute a task using Claude Code.
        
        Args:
            agent_id: The agent to execute the task
            task_id: The task to execute
            include_chat_context: Whether to include recent chat history for context
        
        Returns:
            Dict with status and any output
        """
        print(f">>> execute_task called: agent_id={agent_id}, task_id={task_id}", flush=True)
        
        # Get existing output to preserve history, or start fresh
        existing_output = ""
        started_at = datetime.utcnow().isoformat()
        if agent_id in self._live_output:
            existing_output = self._live_output[agent_id].get("output", "")
            # Add separator if there's existing content
            if existing_output and not existing_output.endswith("\n\n"):
                existing_output += "\n\n"
            existing_output += f"{'='*50}\n"
            existing_output += f"[{datetime.utcnow().strftime('%H:%M:%S')}] NEW TASK EXECUTION\n"
            existing_output += f"{'='*50}\n"
            started_at = self._live_output[agent_id].get("started_at", started_at)
        
        # Append to live output (don't replace)
        self._live_output[agent_id] = {
            "status": "initializing",
            "output": existing_output + f"Preparing to execute task {task_id}...\n",
            "last_update": datetime.utcnow().isoformat(),
            "started_at": started_at,
        }
        
        try:
            return await self._execute_task_inner(agent_id, task_id, include_chat_context)
        except Exception as e:
            # Global error handler - ensure agent is reset to idle on any failure
            error_msg = f"Unexpected error in execute_task: {str(e)}"
            print(f">>> {error_msg}", flush=True)
            import traceback
            traceback.print_exc()
            
            self._live_output[agent_id]["status"] = "error"
            self._live_output[agent_id]["error"] = error_msg
            self._live_output[agent_id]["output"] = self._live_output[agent_id].get("output", "") + f"\n\nFATAL ERROR: {error_msg}\n"
            
            # Try to reset agent status
            try:
                async with self._db_session_factory() as db:
                    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
                    agent = agent_result.scalar_one_or_none()
                    task_result = await db.execute(select(Task).where(Task.id == task_id))
                    task = task_result.scalar_one_or_none()
                    
                    if agent:
                        agent.status = "idle"
                    if task:
                        task.status = "pending"
                    await db.commit()
                    
                    if agent:
                        await ws_manager.broadcast_to_project(
                            agent.project_id,
                            WebSocketEvent(
                                type=EventType.AGENT_STATUS,
                                data={"agent_id": agent_id, "status": "idle", "name": agent.name},
                            ),
                        )
            except Exception as cleanup_error:
                print(f">>> Error during cleanup: {cleanup_error}", flush=True)
            
            return {"success": False, "error": error_msg}
    
    async def _execute_task_inner(
        self,
        agent_id: str,
        task_id: str,
        include_chat_context: bool = True,
    ) -> dict[str, Any]:
        """Inner implementation of execute_task, wrapped with error handling."""
        if agent_id not in self._agents:
            error_msg = "Agent not running - needs to be started first"
            print(f">>> execute_task error: {error_msg}", flush=True)
            self._live_output[agent_id]["status"] = "error"
            self._live_output[agent_id]["error"] = error_msg
            self._live_output[agent_id]["output"] += f"Error: {error_msg}\n"
            return {"success": False, "error": error_msg}
        
        agent_process = self._agents[agent_id]
        if not agent_process.is_running:
            error_msg = "Agent process not running"
            print(f">>> execute_task error: {error_msg}", flush=True)
            self._live_output[agent_id]["status"] = "error"
            self._live_output[agent_id]["error"] = error_msg
            self._live_output[agent_id]["output"] += f"Error: {error_msg}\n"
            return {"success": False, "error": error_msg}
        
        async with self._db_session_factory() as db:
            # Get agent and task
            agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_result.scalar_one_or_none()
            
            task_result = await db.execute(select(Task).where(Task.id == task_id))
            task = task_result.scalar_one_or_none()
            
            if not agent or not task:
                error_msg = f"Agent or task not found (agent={bool(agent)}, task={bool(task)})"
                print(f">>> execute_task error: {error_msg}", flush=True)
                self._live_output[agent_id]["status"] = "error"
                self._live_output[agent_id]["error"] = error_msg
                self._live_output[agent_id]["output"] += f"Error: {error_msg}\n"
                return {"success": False, "error": error_msg}
            
            # Get project config for model selection
            from app.models import Project
            project_result = await db.execute(select(Project).where(Project.id == agent.project_id))
            project = project_result.scalar_one_or_none()
            project_config = project.config if project else {}
            
            # Select model based on task and project config
            selected_model = self._select_model_for_task(task, project_config)
            
            # Update live output with task info
            self._live_output[agent_id]["output"] += f"Task: {task.title}\n"
            self._live_output[agent_id]["output"] += f"Agent: {agent.name}\n"
            self._live_output[agent_id]["status"] = "preparing"
            self._live_output[agent_id]["last_update"] = datetime.utcnow().isoformat()
            
            # Fetch chat context
            chat_context = ""
            if include_chat_context:
                self._live_output[agent_id]["output"] += "Fetching chat context...\n"
                chat_context = await self._get_chat_context(db, agent.project_id, agent_id)
                self._live_output[agent_id]["output"] += f"Got {len(chat_context)} chars of chat context\n"
            
            # Update status
            agent.status = "working"
            task.status = "in_progress"
            task.assigned_to = agent_id
            
            # Record start commit for diff tracking
            if agent_process.workspace_dir:
                workspace_dir = agent_process.workspace_dir
            else:
                workspace_dir = await self._get_project_workspace(db, agent.project_id)
            self._live_output[agent_id]["output"] += f"Workspace: {workspace_dir}\n"
            
            start_commit = await self._get_current_commit(workspace_dir)
            if start_commit:
                task.start_commit = start_commit
                self._live_output[agent_id]["output"] += f"Start commit: {start_commit[:8]}\n"
            
            await db.commit()
            self._live_output[agent_id]["last_update"] = datetime.utcnow().isoformat()
            
            # Build the prompt for the task with chat context FIRST (before logging)
            chat_section = ""
            if chat_context:
                chat_section = f"""
## Recent Team Chat History

The following is recent conversation from the team chat. Pay attention to any feedback,
corrections, or specific instructions from the CEO (User). If they mentioned a different
approach or rejected a previous suggestion, follow their guidance.

```
{chat_context}
```

"""
            
            # Determine if this is a QA task or development task
            is_qa_task = agent.role == "qa" or any(kw in task.title.lower() for kw in ["test", "qa", "quality", "verify", "validate"])
            
            if is_qa_task:
                testing_instructions = """
## Testing Instructions (QA Task)

You are working on a TESTING task. Your primary responsibilities:

1. **Write comprehensive unit tests** for the relevant code
2. **Write integration tests** if applicable
3. **Use appropriate testing frameworks** (pytest for Python, jest/vitest for JavaScript/TypeScript)
4. **Test edge cases and error handling**
5. **Aim for high code coverage** (80%+)
6. **Document test cases** and what they verify

Structure your tests properly:
- Create test files in appropriate locations (tests/, __tests__/, *.test.ts, etc.)
- Use descriptive test names that explain what's being tested
- Include setup/teardown as needed
- Mock external dependencies appropriately"""
            else:
                testing_instructions = """
## Testing Requirements (MANDATORY)

Your implementation MUST include tests. This is NOT optional.

1. **Write unit tests** for all new functions/components
2. **Use appropriate testing frameworks** (pytest for Python, jest/vitest for JavaScript/TypeScript)
3. **Test the happy path AND error cases**
4. **Aim for 80%+ coverage** on new code
5. Create test files alongside your implementation

A task is NOT complete without tests. Do not skip this step."""
            
            prompt = f"""You have been assigned the following task:

**Task:** {task.title}

**Description:** {task.description or 'No additional description provided.'}
{chat_section}
## Instructions

Please implement this task. Create any necessary files, write the code, and commit your changes.
{testing_instructions}

IMPORTANT: If the chat history shows the CEO/User gave specific instructions, corrections,
or rejected certain approaches - follow their guidance exactly. The user's preferences
take priority over your own implementation ideas.

When done, provide a summary of what you created, INCLUDING the tests you wrote."""

            # Broadcast status
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.AGENT_STATUS,
                    data={"agent_id": agent_id, "status": "working", "name": agent.name},
                ),
            )
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.TASK_UPDATE,
                    data={"id": task_id, "status": "in_progress", "assigned_to": agent_id},
                ),
            )
            
            # Log activity with full context (now prompt is defined)
            activity = ActivityLog(
                agent_id=agent_id,
                activity_type="task_started",
                description=f"Started working on: {task.title}",
                extra_data={
                    "task_id": task_id,
                    "task_title": task.title,
                    "task_description": task.description,
                    "prompt": prompt if len(prompt) < 2000 else prompt[:2000] + "...",
                    "start_commit": start_commit,
                },
            )
            db.add(activity)
            await db.commit()

            # Check if Claude Code is available
            if not check_claude_code_available():
                error_msg = "Claude Code CLI not available. Install it with: npm install -g @anthropic-ai/claude-code"
                print(f">>> execute_task error: {error_msg}", flush=True)
                self._live_output[agent_id]["status"] = "error"
                self._live_output[agent_id]["error"] = error_msg
                self._live_output[agent_id]["output"] += f"\nError: {error_msg}\n"
                # Reset agent and task status
                agent.status = "idle"
                task.status = "pending"
                await db.commit()
                return {"success": False, "error": error_msg}

            # Update live output before invoking
            self._live_output[agent_id]["output"] += "\n--- Starting Claude Code ---\n"
            self._live_output[agent_id]["output"] += f"Prompt length: {len(prompt)} chars\n"
            if selected_model:
                self._live_output[agent_id]["output"] += f"Model: {selected_model}\n"
            self._live_output[agent_id]["status"] = "invoking"
            self._live_output[agent_id]["last_update"] = datetime.utcnow().isoformat()
            print(f">>> Invoking Claude Code for agent {agent.name}, task: {task.title}, model: {selected_model}", flush=True)

            # Invoke Claude Code - use the workspace_dir we already computed above
            try:
                response, new_session_id = await self._invoke_claude_code(
                    agent,
                    prompt,
                    workspace_dir,
                    session_id=agent_process.session_id,
                    allowed_tools=["Read", "Edit", "Write", "Bash(git:*)", "Bash(npm:*)", "Bash(pip:*)", "Bash(ls:*)", "Bash(mkdir:*)"],
                    model=selected_model,
                )
            except Exception as e:
                error_msg = f"Claude Code invocation failed: {str(e)}"
                print(f">>> execute_task exception: {error_msg}", flush=True)
                import traceback
                traceback.print_exc()
                self._live_output[agent_id]["status"] = "error"
                self._live_output[agent_id]["error"] = error_msg
                self._live_output[agent_id]["output"] += f"\nException: {error_msg}\n"
                # Reset agent and task status
                agent.status = "idle"
                task.status = "pending"
                await db.commit()
                return {"success": False, "error": error_msg}
            
            # Update session ID
            if new_session_id:
                agent_process.session_id = new_session_id
                agent.session_id = new_session_id
            
            # Record end commit for diff tracking
            end_commit = await self._get_current_commit(workspace_dir)
            if end_commit:
                task.end_commit = end_commit
            
            # Update task status
            task.status = "completed"
            await db.commit()
            
            # Log completion with full execution log and Claude Code response
            full_execution_log = self._live_output.get(agent_id, {}).get("output", "")
            activity = ActivityLog(
                agent_id=agent_id,
                activity_type="task_completed",
                description=f"Completed: {task.title}",
                extra_data={
                    "task_id": task_id,
                    "task_title": task.title,
                    "response": response,  # Claude Code final response
                    "execution_log": full_execution_log,  # Full session log
                    "start_commit": task.start_commit,
                    "end_commit": task.end_commit,
                },
            )
            db.add(activity)
            await db.commit()
            
            # Post completion message to team channel
            await self._post_team_update(
                db,
                agent,
                f"I've completed the task: **{task.title}**\n\n{response[:300]}{'...' if len(response) > 300 else ''}",
            )
            
            # Check for new tasks to pick up
            next_task = await self._find_next_task(db, agent)
            
            if next_task:
                # Update status and pick up new task
                agent.status = "working"
                await db.commit()
                
                await ws_manager.broadcast_to_project(
                    agent.project_id,
                    WebSocketEvent(
                        type=EventType.TASK_UPDATE,
                        data={"id": task_id, "status": "completed"},
                    ),
                )
                
                # Execute the next task (in background to avoid blocking)
                asyncio.create_task(self._execute_next_task(agent_id, next_task.id))
                
                return {"success": True, "response": response, "next_task": next_task.title}
            else:
                # No more tasks - set to idle
                agent.status = "idle"
                await db.commit()
                
                # Broadcast updates
                await ws_manager.broadcast_to_project(
                    agent.project_id,
                    WebSocketEvent(
                        type=EventType.AGENT_STATUS,
                        data={"agent_id": agent_id, "status": "idle", "name": agent.name},
                    ),
                )
                await ws_manager.broadcast_to_project(
                    agent.project_id,
                    WebSocketEvent(
                        type=EventType.TASK_UPDATE,
                        data={"id": task_id, "status": "completed"},
                    ),
                )
                await ws_manager.broadcast_to_project(
                    agent.project_id,
                    WebSocketEvent(
                        type=EventType.AGENT_ACTIVITY,
                        data={
                            "agent_id": agent_id,
                            "activity_type": "task_completed",
                            "description": f"Completed: {task.title}",
                            "response_preview": response[:200],
                        },
                    ),
                )
                
                # Post that we're available
                await self._post_team_update(
                    db,
                    agent,
                    "I'm done with my current work. Ready for new tasks!",
                )
                
                return {"success": True, "response": response}

    async def _post_team_update(
        self,
        db: AsyncSession,
        agent: Agent,
        content: str,
    ) -> None:
        """Post a status update to the agent's team channel."""
        # Find the team channel for this agent
        team_name = agent.role.split()[0] if agent.role else "general"
        
        channel_result = await db.execute(
            select(Channel).where(
                Channel.project_id == agent.project_id,
                Channel.type == "team",
            )
        )
        channels = channel_result.scalars().all()
        
        # Try to find a matching team channel, fall back to general
        target_channel = None
        for ch in channels:
            if team_name.lower() in ch.name.lower():
                target_channel = ch
                break
        
        # Fall back to first team channel or any channel
        if not target_channel and channels:
            target_channel = channels[0]
        
        if not target_channel:
            # Try general channel
            general_result = await db.execute(
                select(Channel).where(
                    Channel.project_id == agent.project_id,
                    Channel.name == "general",
                )
            )
            target_channel = general_result.scalar_one_or_none()
        
        if not target_channel:
            return
        
        # Create the message
        message = Message(
            channel_id=target_channel.id,
            agent_id=agent.id,
            content=content,
            message_type="text",
        )
        db.add(message)
        await db.flush()
        await db.refresh(message)
        await db.commit()  # Explicitly commit to persist
        
        # Broadcast the message
        await ws_manager.broadcast_to_channel(
            target_channel.id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": message.id,
                    "channel_id": message.channel_id,
                    "agent_id": message.agent_id,
                    "content": message.content,
                    "created_at": message.created_at.isoformat(),
                },
            ),
        )
        await ws_manager.broadcast_to_project(
            agent.project_id,
            WebSocketEvent(
                type=EventType.MESSAGE_NEW,
                data={
                    "id": message.id,
                    "channel_id": message.channel_id,
                    "agent_id": message.agent_id,
                    "content": message.content,
                    "created_at": message.created_at.isoformat(),
                },
            ),
        )

    async def _get_current_commit(self, workspace_dir: Path) -> str | None:
        """Get the current HEAD commit hash."""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=workspace_dir,
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return result.stdout.strip()
            return None
        except Exception:
            return None

    async def _find_next_task(self, db: AsyncSession, agent: Agent) -> Task | None:
        """Find the next pending task for this agent to work on."""
        # First, check for tasks specifically assigned to this agent
        assigned_result = await db.execute(
            select(Task).where(
                Task.project_id == agent.project_id,
                Task.assigned_to == agent.id,
                Task.status == "pending",
            ).order_by(Task.priority.desc(), Task.created_at).limit(1)
        )
        assigned_task = assigned_result.scalar_one_or_none()
        if assigned_task:
            return assigned_task
        
        # Check if agent is a developer type
        role = (agent.role or "").lower()
        is_developer = "developer" in role or "engineer" in role or "dev" in role
        
        if not is_developer:
            return None
        
        # Find unassigned pending tasks
        unassigned_result = await db.execute(
            select(Task).where(
                Task.project_id == agent.project_id,
                Task.assigned_to.is_(None),
                Task.status == "pending",
            ).order_by(Task.priority.desc(), Task.created_at).limit(1)
        )
        return unassigned_result.scalar_one_or_none()

    async def _execute_next_task(self, agent_id: str, task_id: str) -> None:
        """Execute the next task in background."""
        # Small delay to let previous transaction complete
        await asyncio.sleep(0.5)
        await self.execute_task(agent_id, task_id)

    async def execute_from_chat(
        self,
        agent_id: str,
        request: str,
        channel_id: str,
    ) -> dict[str, Any]:
        """
        Execute a coding request directly from chat.
        
        This allows users to ask agents to implement things via chat messages
        rather than formal tasks. The agent will have access to the full chat
        context.
        
        Args:
            agent_id: The agent to execute the request
            request: The coding request/instruction from the user
            channel_id: The channel where the request was made
        
        Returns:
            Dict with status and response
        """
        if agent_id not in self._agents:
            # Try to start the agent
            async with self._db_session_factory() as db:
                agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = agent_result.scalar_one_or_none()
                if agent:
                    await self.start_agent(agent_id, agent.project_id)
                else:
                    return {"success": False, "error": "Agent not found"}
        
        agent_process = self._agents.get(agent_id)
        if not agent_process or not agent_process.is_running:
            return {"success": False, "error": "Agent not running"}
        
        async with self._db_session_factory() as db:
            # Get agent
            agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_result.scalar_one_or_none()
            
            if not agent:
                return {"success": False, "error": "Agent not found"}
            
            # Fetch chat context
            chat_context = await self._get_chat_context(db, agent.project_id, agent_id)
            
            # Update status
            agent.status = "working"
            await db.commit()
            
            # Broadcast status
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.AGENT_STATUS,
                    data={"agent_id": agent_id, "status": "working", "name": agent.name},
                ),
            )
            
            # Log activity
            activity = ActivityLog(
                agent_id=agent_id,
                activity_type="coding_request",
                description=f"Working on: {request[:100]}",
                extra_data={"channel_id": channel_id, "request": request[:500]},
            )
            db.add(activity)
            await db.commit()
            
            # Build prompt with chat context
            prompt = f"""You received the following request from the CEO (User) in team chat:

**Request:** {request}

## Recent Team Chat History

Pay careful attention to the conversation context. The user may have discussed
implementation details, rejected certain approaches, or given specific instructions.
Always follow the user's guidance.

```
{chat_context}
```

## Instructions

Please implement what the user requested. Create or modify files as needed, and commit your changes.

IMPORTANT:
- Follow the user's instructions exactly
- If they specified a particular approach, use that approach
- If they corrected or rejected something earlier in the chat, don't repeat that mistake
- When done, provide a summary of what you did

Implement the request now."""

            # Invoke Claude Code
            if agent_process.workspace_dir:
                workspace_dir = agent_process.workspace_dir
            else:
                workspace_dir = await self._get_project_workspace(db, agent.project_id)
            response, new_session_id = await self._invoke_claude_code(
                agent,
                prompt,
                workspace_dir,
                session_id=agent_process.session_id,
                allowed_tools=["Read", "Edit", "Write", "Bash(git:*)", "Bash(npm:*)", "Bash(pip:*)", "Bash(ls:*)", "Bash(mkdir:*)"],
            )
            
            # Update session ID
            if new_session_id:
                agent_process.session_id = new_session_id
                agent.session_id = new_session_id
            
            # Update status
            agent.status = "idle"
            await db.commit()
            
            # Log completion
            activity = ActivityLog(
                agent_id=agent_id,
                activity_type="coding_completed",
                description=f"Completed: {request[:50]}...",
                extra_data={"response": response[:500]},
            )
            db.add(activity)
            await db.commit()
            
            # Broadcast status
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.AGENT_STATUS,
                    data={"agent_id": agent_id, "status": "idle", "name": agent.name},
                ),
            )
            await ws_manager.broadcast_to_project(
                agent.project_id,
                WebSocketEvent(
                    type=EventType.AGENT_ACTIVITY,
                    data={
                        "agent_id": agent_id,
                        "activity_type": "coding_completed",
                        "description": f"Completed coding request",
                        "response_preview": response[:200],
                    },
                ),
            )
            
            return {"success": True, "response": response}

    async def assign_task_to_agent(
        self,
        agent_id: str,
        task_id: str,
        task_description: str,
    ) -> bool:
        """Assign a task to an agent."""
        if agent_id not in self._agents:
            return False

        agent_process = self._agents[agent_id]
        agent_process.current_task_id = task_id

        async with self._db_session_factory() as db:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()

            if agent:
                # Log activity
                activity = ActivityLog(
                    agent_id=agent_id,
                    activity_type="task_started",
                    description=f"Started working on: {task_description[:100]}",
                    extra_data={"task_id": task_id},
                )
                db.add(activity)
                await db.commit()

                # Broadcast activity
                await ws_manager.broadcast_to_project(
                    agent.project_id,
                    WebSocketEvent(
                        type=EventType.AGENT_ACTIVITY,
                        data={
                            "agent_id": agent_id,
                            "activity_type": "task_started",
                            "description": f"Started working on: {task_description[:100]}",
                            "task_id": task_id,
                        },
                    ),
                )

        return True

    def get_agent_status(self, agent_id: str) -> dict[str, Any] | None:
        """Get the current status of an agent."""
        if agent_id not in self._agents:
            return None

        agent_process = self._agents[agent_id]
        return {
            "agent_id": agent_id,
            "is_running": agent_process.is_running,
            "started_at": agent_process.started_at.isoformat() if agent_process.started_at else None,
            "current_task_id": agent_process.current_task_id,
            "session_id": agent_process.session_id,
        }

    def get_all_running_agents(self) -> list[str]:
        """Get list of all running agent IDs."""
        return [
            agent_id
            for agent_id, process in self._agents.items()
            if process.is_running
        ]

    def get_live_output(self, agent_id: str) -> dict | None:
        """
        Get the live Claude Code output for an agent.
        
        Returns:
            Dictionary with output status and content, or None if no output available.
        """
        return self._live_output.get(agent_id)

    def get_agent_status(self, agent_id: str) -> str | None:
        """Get the current runtime status of an agent."""
        process = self._agents.get(agent_id)
        if not process:
            return None
        if not process.is_running:
            return "stopped"
        if agent_id in self._live_output:
            return self._live_output[agent_id].get("status", "idle")
        return "idle"


# Global agent manager instance (initialized in main.py with db session factory)
agent_manager: AgentManager | None = None


def get_agent_manager() -> AgentManager:
    """Get the global agent manager instance."""
    if agent_manager is None:
        raise RuntimeError("Agent manager not initialized")
    return agent_manager
