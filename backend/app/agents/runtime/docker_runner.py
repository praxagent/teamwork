"""Docker-based agent runner for isolated Claude Code execution."""

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from app.config import settings


@dataclass
class DockerAgentOutput:
    """Output from Docker agent execution."""

    content: str
    output_type: str  # text, tool_use, error
    metadata: dict[str, Any] | None = None


class DockerRunner:
    """
    Runs Claude Code in a Docker container for isolated execution.

    This provides:
    - Isolated filesystem
    - Resource limits
    - Security sandboxing
    """

    def __init__(
        self,
        workspace_path: Path,
        session_id: str | None = None,
        image_name: str = "vteam/agent:latest",
    ) -> None:
        self.workspace_path = workspace_path
        self.session_id = session_id
        self.image_name = image_name
        self._container_id: str | None = None

    async def ensure_image_exists(self) -> bool:
        """Ensure the Docker image exists, building if necessary."""
        # Check if image exists
        proc = await asyncio.create_subprocess_exec(
            "docker", "image", "inspect", self.image_name,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()

        if proc.returncode == 0:
            return True

        # Image doesn't exist - would need to build it
        # For now, return False
        return False

    async def execute_prompt(
        self,
        prompt: str,
        system_prompt: str | None = None,
    ) -> AsyncIterator[DockerAgentOutput]:
        """
        Execute a prompt in a Docker container.

        Args:
            prompt: The prompt to send to Claude Code
            system_prompt: Optional system prompt

        Yields:
            DockerAgentOutput objects as they stream
        """
        if not await self.ensure_image_exists():
            yield DockerAgentOutput(
                content="Docker image not found. Please build the agent image first.",
                output_type="error",
            )
            return

        # Build docker run command
        cmd = [
            "docker", "run",
            "--rm",
            "-i",
            # Mount workspace
            "-v", f"{self.workspace_path}:/workspace",
            # Set working directory
            "-w", "/workspace",
            # Pass API key
            "-e", f"ANTHROPIC_API_KEY={settings.anthropic_api_key}",
            # Resource limits
            "--memory", "2g",
            "--cpus", "2",
            # Image
            self.image_name,
            # Claude Code command
            "claude", "-p", prompt,
        ]

        if self.session_id:
            cmd.extend(["--resume", self.session_id])

        if system_prompt and not self.session_id:
            cmd.extend(["--system-prompt", system_prompt])

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Stream output
            if proc.stdout:
                async for line in proc.stdout:
                    decoded = line.decode("utf-8").strip()
                    if decoded:
                        yield DockerAgentOutput(
                            content=decoded,
                            output_type="text",
                        )

            await proc.wait()

            if proc.returncode != 0 and proc.stderr:
                error = await proc.stderr.read()
                yield DockerAgentOutput(
                    content=error.decode("utf-8"),
                    output_type="error",
                )

        except FileNotFoundError:
            yield DockerAgentOutput(
                content="Docker not found. Please install Docker.",
                output_type="error",
            )
        except Exception as e:
            yield DockerAgentOutput(
                content=str(e),
                output_type="error",
            )

    async def execute_prompt_sync(
        self,
        prompt: str,
        system_prompt: str | None = None,
        timeout: float = 300,
    ) -> str:
        """Execute a prompt and return the full response."""
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

    async def cleanup(self) -> None:
        """Clean up any running containers."""
        if self._container_id:
            proc = await asyncio.create_subprocess_exec(
                "docker", "stop", self._container_id,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
            self._container_id = None
