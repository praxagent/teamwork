"""Subprocess-based agent runner for Claude Code CLI."""

import asyncio
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from app.config import settings


@dataclass
class AgentOutput:
    """Output from agent execution."""

    content: str
    output_type: str  # text, tool_use, error
    metadata: dict[str, Any] | None = None


class SubprocessRunner:
    """
    Runs Claude Code as a subprocess.

    Uses the Claude Code CLI with -p flag for prompts and --resume for session continuity.
    """

    def __init__(
        self,
        workspace_path: Path,
        session_id: str | None = None,
    ) -> None:
        self.workspace_path = workspace_path
        self.session_id = session_id
        self._process: subprocess.Popen | None = None

    async def execute_prompt(
        self,
        prompt: str,
        system_prompt: str | None = None,
    ) -> AsyncIterator[AgentOutput]:
        """
        Execute a prompt using Claude Code CLI.

        Args:
            prompt: The prompt to send to Claude Code
            system_prompt: Optional system prompt (for first message in session)

        Yields:
            AgentOutput objects as they stream from the CLI
        """
        # Build command
        cmd = ["claude"]

        # Add prompt
        cmd.extend(["-p", prompt])

        # Add resume flag if we have a session
        if self.session_id:
            cmd.extend(["--resume", self.session_id])

        # Add system prompt for new sessions
        if system_prompt and not self.session_id:
            cmd.extend(["--system-prompt", system_prompt])

        # Set working directory
        env = os.environ.copy()
        env["ANTHROPIC_API_KEY"] = settings.anthropic_api_key

        try:
            # Run the command
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.workspace_path),
                env=env,
            )

            # Stream output
            if self._process.stdout:
                async for line in self._process.stdout:
                    decoded = line.decode("utf-8").strip()
                    if decoded:
                        yield AgentOutput(
                            content=decoded,
                            output_type="text",
                        )

            # Wait for completion
            await self._process.wait()

            # Check for errors
            if self._process.returncode != 0 and self._process.stderr:
                error = await self._process.stderr.read()
                yield AgentOutput(
                    content=error.decode("utf-8"),
                    output_type="error",
                )

        except FileNotFoundError:
            yield AgentOutput(
                content="Claude Code CLI not found. Please install it first.",
                output_type="error",
            )
        except Exception as e:
            yield AgentOutput(
                content=str(e),
                output_type="error",
            )
        finally:
            self._process = None

    async def execute_prompt_sync(
        self,
        prompt: str,
        system_prompt: str | None = None,
        timeout: float = 300,
    ) -> str:
        """
        Execute a prompt and return the full response.

        Args:
            prompt: The prompt to send
            system_prompt: Optional system prompt
            timeout: Maximum time to wait for response

        Returns:
            The complete response text
        """
        outputs: list[str] = []

        try:
            async with asyncio.timeout(timeout):
                async for output in self.execute_prompt(prompt, system_prompt):
                    if output.output_type == "text":
                        outputs.append(output.content)
                    elif output.output_type == "error":
                        return f"Error: {output.content}"
        except asyncio.TimeoutError:
            return "Error: Request timed out"

        return "\n".join(outputs)

    def cancel(self) -> None:
        """Cancel the current execution."""
        if self._process:
            self._process.terminate()

    async def get_session_id(self) -> str | None:
        """
        Get the session ID from Claude Code.

        This would be used to save the session for later resumption.
        """
        # In a real implementation, we would parse the Claude Code output
        # to extract the session ID
        return self.session_id
