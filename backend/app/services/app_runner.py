"""Service for running and testing apps built by the virtual dev team."""

import asyncio
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Agent, ActivityLog, Channel, Message, Project
from app.websocket import manager as ws_manager, WebSocketEvent, EventType


@dataclass
class RunResult:
    """Result of running an app."""
    success: bool
    output: str
    error: str | None
    port: int | None
    run_command: str
    install_command: str | None
    duration_seconds: float


class AppRunner:
    """
    Runs and tests apps built by the virtual dev team.
    
    Supports:
    - Node.js/npm projects
    - Python projects
    - Generic shell commands
    """

    def __init__(self, workspace_base: Path):
        self.workspace_base = workspace_base
        self._running_processes: dict[str, subprocess.Popen] = {}

    def detect_project_type(self, project_path: Path) -> str | None:
        """Detect the type of project based on files present."""
        if (project_path / "package.json").exists():
            return "nodejs"
        elif (project_path / "requirements.txt").exists():
            return "python"
        elif (project_path / "pyproject.toml").exists():
            return "python"
        elif (project_path / "Cargo.toml").exists():
            return "rust"
        elif (project_path / "go.mod").exists():
            return "go"
        return None

    def get_install_command(self, project_type: str) -> str | None:
        """Get the install command for a project type."""
        commands = {
            "nodejs": "npm install",
            "python": "pip install -r requirements.txt",
            "rust": "cargo build",
            "go": "go mod download",
        }
        return commands.get(project_type)

    def get_run_command(self, project_path: Path, project_type: str) -> str:
        """Get the run command for a project type."""
        if project_type == "nodejs":
            # Check package.json for scripts
            import json
            pkg_path = project_path / "package.json"
            if pkg_path.exists():
                with open(pkg_path) as f:
                    pkg = json.load(f)
                    scripts = pkg.get("scripts", {})
                    if "dev" in scripts:
                        return "npm run dev"
                    elif "start" in scripts:
                        return "npm start"
            return "npm start"
        elif project_type == "python":
            # Look for common entry points
            if (project_path / "main.py").exists():
                return "python main.py"
            elif (project_path / "app.py").exists():
                return "python app.py"
            elif (project_path / "src" / "main.py").exists():
                return "python src/main.py"
            return "python -m app"
        elif project_type == "rust":
            return "cargo run"
        elif project_type == "go":
            return "go run ."
        return "echo 'Unknown project type'"

    async def install_dependencies(
        self, 
        project_id: str, 
        timeout: int = 120
    ) -> tuple[bool, str]:
        """Install dependencies for a project."""
        project_path = self.workspace_base / project_id
        
        if not project_path.exists():
            return False, "Project workspace not found"
        
        project_type = self.detect_project_type(project_path)
        if not project_type:
            return False, "Could not detect project type"
        
        install_cmd = self.get_install_command(project_type)
        if not install_cmd:
            return True, "No dependencies to install"
        
        try:
            result = subprocess.run(
                install_cmd,
                shell=True,
                cwd=project_path,
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, "CI": "true"},  # Suppress interactive prompts
            )
            
            if result.returncode == 0:
                return True, result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout
            else:
                return False, f"Install failed:\n{result.stderr[-1000:]}"
                
        except subprocess.TimeoutExpired:
            return False, f"Install timed out after {timeout} seconds"
        except Exception as e:
            return False, f"Install error: {str(e)}"

    async def run_app(
        self,
        project_id: str,
        timeout: int = 30,
        port: int = 3000,
    ) -> RunResult:
        """
        Run the app and capture output.
        
        For web servers, this runs the app briefly to verify it starts,
        then captures the initial output.
        """
        project_path = self.workspace_base / project_id
        start_time = datetime.now()
        
        if not project_path.exists():
            return RunResult(
                success=False,
                output="",
                error="Project workspace not found",
                port=None,
                run_command="",
                install_command=None,
                duration_seconds=0,
            )
        
        project_type = self.detect_project_type(project_path)
        if not project_type:
            return RunResult(
                success=False,
                output="",
                error="Could not detect project type",
                port=None,
                run_command="",
                install_command=None,
                duration_seconds=0,
            )
        
        run_cmd = self.get_run_command(project_path, project_type)
        install_cmd = self.get_install_command(project_type)
        
        try:
            # Set PORT environment variable
            env = {**os.environ, "PORT": str(port), "NODE_ENV": "development"}
            
            # Start the process
            process = subprocess.Popen(
                run_cmd,
                shell=True,
                cwd=project_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
            )
            
            # Wait briefly for it to start
            await asyncio.sleep(3)
            
            # Check if it's still running (good for servers)
            poll_result = process.poll()
            
            # Try to read output
            try:
                stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                # Process is still running - this is expected for servers
                process.terminate()
                try:
                    stdout, stderr = process.communicate(timeout=5)
                except:
                    stdout, stderr = "", ""
                    process.kill()
            
            duration = (datetime.now() - start_time).total_seconds()
            
            # If process exited immediately with error, it failed
            if poll_result is not None and poll_result != 0:
                return RunResult(
                    success=False,
                    output=stdout[-2000:] if stdout else "",
                    error=stderr[-1000:] if stderr else f"Process exited with code {poll_result}",
                    port=None,
                    run_command=run_cmd,
                    install_command=install_cmd,
                    duration_seconds=duration,
                )
            
            # If we got here, the app started successfully
            return RunResult(
                success=True,
                output=stdout[-2000:] if stdout else "(Server started successfully)",
                error=None,
                port=port,
                run_command=run_cmd,
                install_command=install_cmd,
                duration_seconds=duration,
            )
            
        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            return RunResult(
                success=False,
                output="",
                error=str(e),
                port=None,
                run_command=run_cmd,
                install_command=install_cmd,
                duration_seconds=duration,
            )

    async def test_app(
        self,
        project_id: str,
    ) -> dict[str, Any]:
        """
        Full test of the app: install deps, run, verify.
        Returns comprehensive test results.
        """
        results = {
            "project_id": project_id,
            "timestamp": datetime.now().isoformat(),
            "project_type": None,
            "install_success": False,
            "install_output": "",
            "run_success": False,
            "run_output": "",
            "run_error": None,
            "run_command": "",
            "install_command": None,
            "port": None,
            "instructions": "",
        }
        
        project_path = self.workspace_base / project_id
        
        if not project_path.exists():
            results["run_error"] = "Project workspace not found"
            return results
        
        # Detect project type
        project_type = self.detect_project_type(project_path)
        results["project_type"] = project_type
        
        if not project_type:
            results["run_error"] = "Could not detect project type - no package.json, requirements.txt, etc."
            return results
        
        # Install dependencies
        install_success, install_output = await self.install_dependencies(project_id)
        results["install_success"] = install_success
        results["install_output"] = install_output
        
        if not install_success:
            results["run_error"] = f"Dependency installation failed: {install_output}"
            return results
        
        # Run the app
        run_result = await self.run_app(project_id)
        results["run_success"] = run_result.success
        results["run_output"] = run_result.output
        results["run_error"] = run_result.error
        results["run_command"] = run_result.run_command
        results["install_command"] = run_result.install_command
        results["port"] = run_result.port
        
        # Generate instructions
        if run_result.success:
            results["instructions"] = self.generate_run_instructions(
                project_path, project_type, run_result
            )
        
        return results

    def generate_run_instructions(
        self,
        project_path: Path,
        project_type: str,
        run_result: RunResult,
    ) -> str:
        """Generate human-readable instructions for running the app."""
        instructions = []
        instructions.append("## How to Run This App\n")
        instructions.append(f"**Project Type:** {project_type.title()}\n")
        instructions.append(f"**Directory:** `{project_path}`\n")
        
        instructions.append("\n### Steps:\n")
        instructions.append(f"1. `cd {project_path}`")
        
        if run_result.install_command:
            instructions.append(f"2. `{run_result.install_command}` (install dependencies)")
            instructions.append(f"3. `{run_result.run_command}` (start the app)")
        else:
            instructions.append(f"2. `{run_result.run_command}` (start the app)")
        
        if run_result.port:
            instructions.append(f"\nThe app will be available at: **http://localhost:{run_result.port}**")
        
        return "\n".join(instructions)


# Global instance
_app_runner: AppRunner | None = None


def get_app_runner() -> AppRunner:
    global _app_runner
    if _app_runner is None:
        _app_runner = AppRunner(settings.workspace_path)
    return _app_runner
