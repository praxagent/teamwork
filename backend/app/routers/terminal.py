"""Terminal WebSocket router for in-browser terminal access."""

import asyncio
import base64
import json
import os
import pty
import select
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/terminal", tags=["terminal"])


class TerminalInfo(BaseModel):
    """Information about terminal capabilities."""
    docker_available: bool
    claude_code_available: bool
    runtime_mode: str


@router.get("/info")
async def get_terminal_info() -> TerminalInfo:
    """Check terminal capabilities."""
    import shutil
    
    docker_available = shutil.which("docker") is not None
    claude_code_available = shutil.which("claude") is not None
    
    return TerminalInfo(
        docker_available=docker_available,
        claude_code_available=claude_code_available,
        runtime_mode=settings.default_agent_runtime,
    )


@router.websocket("/ws/{project_id}")
async def terminal_websocket(
    websocket: WebSocket,
    project_id: str,
    mode: str = Query(default="local"),  # "local" or "docker"
    start_claude: bool = Query(default=False),
):
    """
    WebSocket endpoint for terminal sessions.
    
    Args:
        project_id: The project ID to open terminal for
        mode: "local" or "docker" - where to run the terminal
        start_claude: If True, start Claude Code CLI automatically
    """
    await websocket.accept()
    
    # Get workspace path for this project
    from sqlalchemy import select
    from app.models import Project
    from app.models.base import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        
        if project and project.workspace_dir:
            workspace_path = settings.workspace_path / project.workspace_dir
        else:
            workspace_path = settings.workspace_path / project_id
    
    # Ensure workspace exists
    workspace_path.mkdir(parents=True, exist_ok=True)
    
    try:
        if mode == "docker":
            await run_docker_terminal(websocket, workspace_path, project_id, start_claude)
        else:
            await run_local_terminal(websocket, workspace_path, start_claude)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(f"\r\n\x1b[31mError: {str(e)}\x1b[0m\r\n")
        except:
            pass


async def run_local_terminal(
    websocket: WebSocket,
    workspace_path: Path,
    start_claude: bool = False,
):
    """Run a local terminal session with PTY."""
    
    # Create a pseudo-terminal
    master_fd, slave_fd = pty.openpty()
    
    # Determine shell and initial command
    shell = os.environ.get("SHELL", "/bin/bash")
    
    if start_claude:
        # Start Claude Code CLI directly
        cmd = ["claude"]
    else:
        cmd = [shell]
    
    # Spawn the process
    process = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=str(workspace_path),
        env={
            **os.environ,
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
        },
        preexec_fn=os.setsid,
    )
    
    os.close(slave_fd)
    
    # Set terminal to non-blocking
    os.set_blocking(master_fd, False)
    
    try:
        # Task to read from PTY and send to WebSocket
        async def read_pty():
            while True:
                try:
                    # Check if there's data to read
                    r, _, _ = select.select([master_fd], [], [], 0.01)
                    if r:
                        data = os.read(master_fd, 4096)
                        if data:
                            await websocket.send_bytes(data)
                    else:
                        await asyncio.sleep(0.01)
                    
                    # Check if process is still running
                    if process.poll() is not None:
                        await websocket.send_text("\r\n\x1b[33m[Process exited]\x1b[0m\r\n")
                        break
                except OSError:
                    break
                except Exception as e:
                    break
        
        # Task to read from WebSocket and write to PTY
        async def write_pty():
            while True:
                try:
                    data = await websocket.receive()
                    if "text" in data:
                        text = data["text"]
                        # Handle resize events
                        if text.startswith("\x1b[8;"):
                            # Parse resize: \x1b[8;rows;colst
                            try:
                                parts = text[4:-1].split(";")
                                if len(parts) == 2:
                                    rows, cols = int(parts[0]), int(parts[1])
                                    import fcntl
                                    import struct
                                    import termios
                                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                            except:
                                pass
                        else:
                            os.write(master_fd, text.encode())
                    elif "bytes" in data:
                        os.write(master_fd, data["bytes"])
                except WebSocketDisconnect:
                    break
                except Exception:
                    break
        
        # Run both tasks concurrently
        read_task = asyncio.create_task(read_pty())
        write_task = asyncio.create_task(write_pty())
        
        done, pending = await asyncio.wait(
            [read_task, write_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    
    finally:
        # Clean up
        try:
            process.terminate()
            process.wait(timeout=2)
        except:
            process.kill()
        
        try:
            os.close(master_fd)
        except:
            pass


async def run_docker_terminal(
    websocket: WebSocket,
    workspace_path: Path,
    project_id: str,
    start_claude: bool = False,
):
    """Run a terminal session inside a Docker container."""
    import shutil
    
    if not shutil.which("docker"):
        await websocket.send_text("\x1b[31mError: Docker is not installed or not in PATH\x1b[0m\r\n")
        return
    
    # Container name for this project
    container_name = f"vteam-terminal-{project_id[:8]}"
    
    # Config volume for Claude Code settings persistence
    config_volume = f"vteam-claude-config-{project_id[:8]}"
    
    # Check if container exists and is running
    check_result = subprocess.run(
        ["docker", "ps", "-a", "--filter", f"name=^{container_name}$", "--format", "{{.Names}} {{.Status}}"],
        capture_output=True,
        text=True,
    )
    
    container_exists = container_name in check_result.stdout
    container_running = "Up" in check_result.stdout
    
    # Debug output
    await websocket.send_text(f"\x1b[90m[Debug] Container check: exists={container_exists}, running={container_running}\x1b[0m\r\n")
    await websocket.send_text(f"\x1b[90m[Debug] Docker ps output: {check_result.stdout.strip()}\x1b[0m\r\n")
    
    if not container_exists:
        await websocket.send_text("\x1b[33mStarting Docker container...\x1b[0m\r\n")
        await websocket.send_text("\x1b[90m(Using official Docker sandbox template)\x1b[0m\r\n")
        
        # Use the official Docker sandbox template which has Claude pre-installed
        # Note: No persistent volume for Claude config (security - no API key storage)
        # User will need to complete Claude setup each session
        create_result = subprocess.run(
            [
                "docker", "run", "-d",
                "--name", container_name,
                "-v", f"{workspace_path.absolute()}:/workspace",
                "-e", f"ANTHROPIC_API_KEY={settings.anthropic_api_key}",
                "-w", "/workspace",
                "docker/sandbox-templates:claude-code",
                "tail", "-f", "/dev/null",
            ],
            capture_output=True,
            text=True,
        )
        
        if create_result.returncode == 0:
            # Fix workspace permissions for agent user (agent has sudo access)
            subprocess.run(
                ["docker", "exec", container_name, "sudo", "chown", "-R", "agent:agent", "/workspace"],
                capture_output=True,
            )
            
            # If user provided their Claude config as base64, inject it
            if settings.claude_config_base64:
                await websocket.send_text("\x1b[33mInjecting Claude config...\x1b[0m\r\n")
                
                # Find the agent user's home directory
                home_result = subprocess.run(
                    ["docker", "exec", "-u", "agent", container_name, "bash", "-c", "echo $HOME"],
                    capture_output=True,
                    text=True,
                )
                agent_home = home_result.stdout.strip() or "/home/agent"
                
                # Decode the config, add current API key to approved list, re-encode
                try:
                    config_json = base64.b64decode(settings.claude_config_base64).decode('utf-8')
                    config = json.loads(config_json)
                    
                    # Extract API key suffix (Claude uses this as identifier)
                    api_key = settings.anthropic_api_key
                    key_suffix = api_key.split('-')[-1] if '-' in api_key else api_key[-20:]
                    
                    # Add to approved list if not already there
                    if "customApiKeyResponses" not in config:
                        config["customApiKeyResponses"] = {"approved": [], "rejected": []}
                    if key_suffix not in config["customApiKeyResponses"]["approved"]:
                        config["customApiKeyResponses"]["approved"].append(key_suffix)
                    
                    # Also set the primaryApiKey to match
                    config["primaryApiKey"] = api_key
                    
                    # Re-encode
                    modified_config = json.dumps(config)
                    config_b64 = base64.b64encode(modified_config.encode()).decode()
                except Exception as e:
                    await websocket.send_text(f"\x1b[31mConfig parse error: {e}\x1b[0m\r\n")
                    config_b64 = settings.claude_config_base64
                
                # Decode and write the config to home directory (ephemeral - not persisted)
                result = subprocess.run(
                    ["docker", "exec", "-u", "agent", container_name, "bash", "-c",
                     f"echo '{config_b64}' | base64 -d > {agent_home}/.claude.json && echo 'OK'"],
                    capture_output=True,
                    text=True,
                )
                
                if "OK" in result.stdout:
                    await websocket.send_text("\x1b[32mClaude config loaded!\x1b[0m\r\n")
                else:
                    await websocket.send_text(f"\x1b[31mFailed to inject config: {result.stderr}\x1b[0m\r\n")
            else:
                await websocket.send_text("\x1b[32mContainer ready!\x1b[0m\r\n")
                if start_claude:
                    await websocket.send_text("\x1b[33mTip: Set CLAUDE_CONFIG_BASE64 to skip setup. See README.\x1b[0m\r\n")
        
        if create_result.returncode != 0:
            # Fallback to node image if official image not available
            await websocket.send_text("\x1b[33mFalling back to manual setup...\x1b[0m\r\n")
            
            create_result = subprocess.run(
                [
                    "docker", "run", "-d",
                    "--name", container_name,
                    "-v", f"{workspace_path.absolute()}:/workspace",
                    "-e", f"ANTHROPIC_API_KEY={settings.anthropic_api_key}",
                    "-w", "/workspace",
                    "node:20-slim",
                    "tail", "-f", "/dev/null",
                ],
                capture_output=True,
                text=True,
            )
            
            if create_result.returncode != 0:
                await websocket.send_text(f"\x1b[31mFailed to create container: {create_result.stderr}\x1b[0m\r\n")
                return
            
            # Install dependencies in the container
            await websocket.send_text("\x1b[33mInstalling dependencies...\x1b[0m\r\n")
            
            subprocess.run(
                ["docker", "exec", container_name, "apt-get", "update"],
                capture_output=True,
            )
            subprocess.run(
                ["docker", "exec", container_name, "apt-get", "install", "-y", "git", "curl", "bash"],
                capture_output=True,
            )
            
            # Install Claude Code CLI
            await websocket.send_text("\x1b[33mInstalling Claude Code CLI...\x1b[0m\r\n")
            subprocess.run(
                ["docker", "exec", container_name, "bash", "-c", 
                 "curl -fsSL https://claude.ai/install.sh | bash || npm install -g @anthropic-ai/claude-code"],
                capture_output=True,
            )
        
        await websocket.send_text("\x1b[32mContainer ready!\x1b[0m\r\n")
    elif not container_running:
        # Container exists but is stopped, start it
        await websocket.send_text("\x1b[33mStarting stopped container...\x1b[0m\r\n")
        subprocess.run(["docker", "start", container_name], capture_output=True)
    
    # Check if using the official sandbox template (runs as 'agent' user)
    # or our fallback node image (runs as root)
    inspect_result = subprocess.run(
        ["docker", "inspect", "--format", "{{.Config.Image}}", container_name],
        capture_output=True,
        text=True,
    )
    is_sandbox_template = "sandbox-templates" in inspect_result.stdout
    
    # Now exec into the container with PTY
    if start_claude:
        if is_sandbox_template:
            cmd = ["docker", "exec", "-it", "-u", "agent",
                   "-e", f"ANTHROPIC_API_KEY={settings.anthropic_api_key}",
                   "-e", "TERM=xterm-256color",
                   container_name, "claude", "--dangerously-skip-permissions"]
        else:
            cmd = ["docker", "exec", "-it",
                   "-e", f"ANTHROPIC_API_KEY={settings.anthropic_api_key}",
                   "-e", "TERM=xterm-256color",
                   container_name, "claude"]
    else:
        if is_sandbox_template:
            cmd = ["docker", "exec", "-it", "-u", "agent",
                   "-e", "TERM=xterm-256color",
                   container_name, "bash"]
        else:
            cmd = ["docker", "exec", "-it",
                   "-e", "TERM=xterm-256color",
                   container_name, "bash"]
    
    await websocket.send_text(f"\x1b[32mConnecting to container {container_name}...\x1b[0m\r\n")
    await websocket.send_text(f"\x1b[90m[Debug] Command: {' '.join(cmd)}\x1b[0m\r\n")
    
    # Create PTY for docker exec
    master_fd, slave_fd = pty.openpty()
    
    process = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env={
            **os.environ,
            "TERM": "xterm-256color",
        },
        preexec_fn=os.setsid,
    )
    
    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    
    try:
        async def read_pty():
            while True:
                try:
                    r, _, _ = select.select([master_fd], [], [], 0.01)
                    if r:
                        data = os.read(master_fd, 4096)
                        if data:
                            await websocket.send_bytes(data)
                    else:
                        await asyncio.sleep(0.01)
                    
                    exit_code = process.poll()
                    if exit_code is not None:
                        await websocket.send_text(f"\r\n\x1b[33m[Container session ended, exit code: {exit_code}]\x1b[0m\r\n")
                        break
                except OSError:
                    break
                except Exception:
                    break
        
        async def write_pty():
            while True:
                try:
                    data = await websocket.receive()
                    if "text" in data:
                        text = data["text"]
                        if text.startswith("\x1b[8;"):
                            try:
                                parts = text[4:-1].split(";")
                                if len(parts) == 2:
                                    rows, cols = int(parts[0]), int(parts[1])
                                    import fcntl
                                    import struct
                                    import termios
                                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                            except:
                                pass
                        else:
                            os.write(master_fd, text.encode())
                    elif "bytes" in data:
                        os.write(master_fd, data["bytes"])
                except WebSocketDisconnect:
                    break
                except Exception:
                    break
        
        read_task = asyncio.create_task(read_pty())
        write_task = asyncio.create_task(write_pty())
        
        done, pending = await asyncio.wait(
            [read_task, write_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    
    finally:
        try:
            process.terminate()
            process.wait(timeout=2)
        except:
            process.kill()
        
        try:
            os.close(master_fd)
        except:
            pass


@router.delete("/container/{project_id}")
async def cleanup_container(project_id: str):
    """Stop and remove a terminal container."""
    container_name = f"vteam-terminal-{project_id[:8]}"
    
    subprocess.run(
        ["docker", "rm", "-f", container_name],
        capture_output=True,
    )
    
    return {"status": "removed", "container": container_name}
