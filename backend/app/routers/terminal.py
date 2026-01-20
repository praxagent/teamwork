"""Terminal WebSocket router for in-browser terminal access."""

import asyncio
import base64
import codecs
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

# Custom terminal image name
TERMINAL_IMAGE = "vteam-terminal:latest"
TERMINAL_DOCKERFILE = Path(__file__).parent.parent.parent.parent / "docker" / "terminal.Dockerfile"


def ensure_terminal_image() -> tuple[bool, str]:
    """Ensure the custom terminal image is built. Returns (success, message)."""
    # Check if image exists
    check = subprocess.run(
        ["docker", "images", "-q", TERMINAL_IMAGE],
        capture_output=True,
        text=True,
    )
    
    if check.stdout.strip():
        return True, "Image exists"
    
    # Build the image
    if not TERMINAL_DOCKERFILE.exists():
        # Fall back to official image if Dockerfile not found
        return False, f"Dockerfile not found: {TERMINAL_DOCKERFILE}"
    
    build_result = subprocess.run(
        [
            "docker", "build",
            "-t", TERMINAL_IMAGE,
            "-f", str(TERMINAL_DOCKERFILE),
            str(TERMINAL_DOCKERFILE.parent),
        ],
        capture_output=True,
        text=True,
    )
    
    if build_result.returncode == 0:
        return True, "Image built successfully"
    else:
        return False, f"Build failed: {build_result.stderr[:500]}"


class TerminalInfo(BaseModel):
    """Information about terminal capabilities."""
    docker_available: bool
    claude_code_available: bool
    runtime_mode: str
    terminal_image_ready: bool = False


class ImageBuildResult(BaseModel):
    """Result of building the terminal image."""
    success: bool
    message: str


@router.post("/build-image")
async def build_terminal_image(force: bool = False) -> ImageBuildResult:
    """Build the custom terminal image with vim, python, uv, etc."""
    # Check if image already exists
    if not force:
        check = subprocess.run(
            ["docker", "images", "-q", TERMINAL_IMAGE],
            capture_output=True,
            text=True,
        )
        if check.stdout.strip():
            return ImageBuildResult(success=True, message="Image already exists. Use force=true to rebuild.")
    
    # Build the image
    if not TERMINAL_DOCKERFILE.exists():
        return ImageBuildResult(success=False, message=f"Dockerfile not found: {TERMINAL_DOCKERFILE}")
    
    build_result = subprocess.run(
        [
            "docker", "build",
            "-t", TERMINAL_IMAGE,
            "-f", str(TERMINAL_DOCKERFILE),
            str(TERMINAL_DOCKERFILE.parent),
        ],
        capture_output=True,
        text=True,
        timeout=600,  # 10 minute timeout
    )
    
    if build_result.returncode == 0:
        return ImageBuildResult(success=True, message="Image built successfully")
    else:
        return ImageBuildResult(success=False, message=f"Build failed: {build_result.stderr}")


@router.get("/info")
async def get_terminal_info() -> TerminalInfo:
    """Check terminal capabilities."""
    import shutil
    
    docker_available = shutil.which("docker") is not None
    claude_code_available = shutil.which("claude") is not None
    
    # Check if custom terminal image exists
    terminal_image_ready = False
    if docker_available:
        check = subprocess.run(
            ["docker", "images", "-q", TERMINAL_IMAGE],
            capture_output=True,
            text=True,
        )
        terminal_image_ready = bool(check.stdout.strip())
    
    return TerminalInfo(
        docker_available=docker_available,
        claude_code_available=claude_code_available,
        runtime_mode=settings.default_agent_runtime,
        terminal_image_ready=terminal_image_ready,
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
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
        },
        preexec_fn=os.setsid,
    )
    
    os.close(slave_fd)
    
    # Set terminal to non-blocking
    os.set_blocking(master_fd, False)
    
    # UTF-8 decoder that buffers incomplete sequences
    utf8_decoder = codecs.getincrementaldecoder('utf-8')('replace')
    
    try:
        # Task to read from PTY and send to WebSocket
        async def read_pty():
            nonlocal utf8_decoder
            while True:
                try:
                    # Check if there's data to read
                    r, _, _ = select.select([master_fd], [], [], 0.01)
                    if r:
                        data = os.read(master_fd, 4096)
                        if data:
                            # Decode with incremental decoder to handle partial UTF-8 sequences
                            text = utf8_decoder.decode(data)
                            if text:
                                await websocket.send_text(text)
                    else:
                        await asyncio.sleep(0.01)
                    
                    # Check if process is still running
                    if process.poll() is not None:
                        # Flush any remaining buffered bytes
                        remaining = utf8_decoder.decode(b'', final=True)
                        if remaining:
                            await websocket.send_text(remaining)
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
                            # Text input (fallback) - use UTF-8
                            os.write(master_fd, text.encode('utf-8'))
                    elif "bytes" in data:
                        # Binary input - write directly (preserves control chars like Ctrl+C)
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
    
    if not container_exists:
        await websocket.send_text("\x1b[33mStarting Docker container...\x1b[0m\r\n")
        
        # Try to use custom image with additional tools (vim, python, uv, etc.)
        image_ok, image_msg = ensure_terminal_image()
        if image_ok:
            image_to_use = TERMINAL_IMAGE
            await websocket.send_text(f"\x1b[90m(Using custom terminal image with vim, python, uv)\x1b[0m\r\n")
        else:
            # Fall back to official image
            image_to_use = "docker/sandbox-templates:claude-code"
            await websocket.send_text(f"\x1b[90m(Using official Docker sandbox template)\x1b[0m\r\n")
            await websocket.send_text(f"\x1b[33mNote: {image_msg}\x1b[0m\r\n")
        
        # Start the container with workspace and Claude config mounted
        import base64
        import tempfile
        
        docker_run_cmd = [
            "docker", "run", "-d",
            "--name", container_name,
            "-v", f"{workspace_path.absolute()}:/workspace",
            "-w", "/workspace",
        ]
        
        # Mount Claude config from CLAUDE_CONFIG_BASE64 (required)
        # Mount to a temp location, then copy inside container (Claude needs write access)
        claude_config_mounted = False
        config_temp_path = None
        if settings.claude_config_base64:
            try:
                decoded_config = base64.b64decode(settings.claude_config_base64).decode('utf-8')
                config_temp_path = Path(tempfile.gettempdir()) / f"claude_config_terminal_{container_name}.json"
                config_temp_path.write_text(decoded_config)
                config_temp_path.chmod(0o644)
                # Mount to temp location - will copy to ~/.claude.json after container starts
                docker_run_cmd.extend(["-v", f"{config_temp_path}:/tmp/claude_config_mount.json:ro"])
                claude_config_mounted = True
            except Exception as e:
                await websocket.send_text(f"\x1b[31mError decoding CLAUDE_CONFIG_BASE64: {e}\x1b[0m\r\n")
        else:
            await websocket.send_text(f"\x1b[33mWARNING: CLAUDE_CONFIG_BASE64 not set!\x1b[0m\r\n")
        
        docker_run_cmd.extend([image_to_use, "tail", "-f", "/dev/null"])
        
        create_result = subprocess.run(
            docker_run_cmd,
            capture_output=True,
            text=True,
        )
        
        if create_result.returncode == 0:
            # Fix workspace permissions for agent user (agent has sudo access)
            subprocess.run(
                ["docker", "exec", container_name, "sudo", "chown", "-R", "agent:agent", "/workspace"],
                capture_output=True,
            )
            
            # Copy Claude config from mount to writable location (Claude needs write access)
            if claude_config_mounted:
                copy_result = subprocess.run(
                    ["docker", "exec", container_name, "bash", "-c",
                     "cp /tmp/claude_config_mount.json /home/agent/.claude.json && "
                     "chown agent:agent /home/agent/.claude.json && "
                     "chmod 600 /home/agent/.claude.json"],
                    capture_output=True,
                    text=True,
                )
                if copy_result.returncode == 0:
                    await websocket.send_text("\x1b[32mClaude config ready!\x1b[0m\r\n")
                else:
                    await websocket.send_text(f"\x1b[33mWarning: Could not copy Claude config: {copy_result.stderr}\x1b[0m\r\n")
            else:
                await websocket.send_text("\x1b[33mNo Claude config. Set CLAUDE_CONFIG_BASE64.\x1b[0m\r\n")
        
        if create_result.returncode != 0:
            # Fallback to node image if official image not available
            await websocket.send_text("\x1b[33mFalling back to manual setup...\x1b[0m\r\n")
            
            fallback_cmd = [
                "docker", "run", "-d",
                "--name", container_name,
                "-v", f"{workspace_path.absolute()}:/workspace",
                "-w", "/workspace",
            ]
            
            # Reuse the same claude config mount (to temp location)
            if claude_config_mounted and config_temp_path and config_temp_path.exists():
                fallback_cmd.extend(["-v", f"{config_temp_path}:/tmp/claude_config_mount.json:ro"])
            
            fallback_cmd.extend(["node:20-slim", "tail", "-f", "/dev/null"])
            
            create_result = subprocess.run(
                fallback_cmd,
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
    
    # Check if using a proper agent image (sandbox-template or our custom vteam images)
    # These run as 'agent' user and support --dangerously-skip-permissions
    inspect_result = subprocess.run(
        ["docker", "inspect", "--format", "{{.Config.Image}}", container_name],
        capture_output=True,
        text=True,
    )
    image_name = inspect_result.stdout.strip()
    is_agent_image = any(x in image_name for x in ["sandbox-templates", "vteam-terminal", "vteam/agent"])
    print(f">>> Terminal: image={image_name}, is_agent_image={is_agent_image}", flush=True)
    
    # Now exec into the container with PTY
    # Use script command to create a proper TTY wrapper
    api_key = settings.anthropic_api_key_clean
    
    if not api_key or len(api_key) < 20:
        print(f">>> ERROR: ANTHROPIC_API_KEY is empty or too short! Claude Code will fail.", flush=True)
    
    if start_claude:
        # IS_SANDBOX=1 suppresses the bypass permissions warning
        if is_agent_image:
            inner_cmd = f"docker exec -it -u agent -e ANTHROPIC_API_KEY={api_key} -e IS_SANDBOX=1 -e TERM=xterm-256color {container_name} claude --dangerously-skip-permissions"
        else:
            inner_cmd = f"docker exec -it -e ANTHROPIC_API_KEY={api_key} -e IS_SANDBOX=1 -e TERM=xterm-256color {container_name} claude"
        print(f">>> Starting Claude Code with API key and IS_SANDBOX=1 in container {container_name}", flush=True)
    else:
        if is_agent_image:
            inner_cmd = f"docker exec -it -u agent -e TERM=xterm-256color {container_name} bash"
        else:
            inner_cmd = f"docker exec -it -e TERM=xterm-256color {container_name} bash"
    
    # Use script to ensure proper TTY handling on macOS
    import platform
    if platform.system() == "Darwin":
        # macOS: script -q /dev/null command
        cmd = ["script", "-q", "/dev/null", "bash", "-c", inner_cmd]
    else:
        # Linux: script -q -c command /dev/null
        cmd = ["script", "-q", "-c", inner_cmd, "/dev/null"]
    
    print(f">>> Terminal command: {cmd}", flush=True)
    
    await websocket.send_text(f"\x1b[32mConnecting to container {container_name}...\x1b[0m\r\n")
    
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
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
        },
        preexec_fn=os.setsid,
    )
    
    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    
    # UTF-8 decoder that buffers incomplete sequences
    utf8_decoder = codecs.getincrementaldecoder('utf-8')('replace')
    
    try:
        async def read_pty():
            nonlocal utf8_decoder
            while True:
                try:
                    r, _, _ = select.select([master_fd], [], [], 0.01)
                    if r:
                        data = os.read(master_fd, 4096)
                        if data:
                            # Decode with incremental decoder to handle partial UTF-8 sequences
                            text = utf8_decoder.decode(data)
                            if text:
                                await websocket.send_text(text)
                    else:
                        await asyncio.sleep(0.01)
                    
                    if process.poll() is not None:
                        # Flush any remaining buffered bytes
                        remaining = utf8_decoder.decode(b'', final=True)
                        if remaining:
                            await websocket.send_text(remaining)
                        await websocket.send_text("\r\n\x1b[33m[Session ended]\x1b[0m\r\n")
                        break
                except OSError:
                    break
                except Exception:
                    break
        
        async def write_pty():
            while True:
                try:
                    data = await websocket.receive()
                    print(f">>> Terminal WS received: {data.keys()}", flush=True)
                    if "text" in data:
                        text = data["text"]
                        print(f">>> Terminal text input: {repr(text[:50] if len(text) > 50 else text)}", flush=True)
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
                            # Text input (fallback) - use UTF-8
                            os.write(master_fd, text.encode('utf-8'))
                    elif "bytes" in data:
                        # Binary input - write directly (preserves control chars like Ctrl+C)
                        raw_bytes = data["bytes"]
                        print(f">>> Terminal bytes input: {repr(raw_bytes)}", flush=True)
                        bytes_written = os.write(master_fd, raw_bytes)
                        print(f">>> Terminal wrote {bytes_written} bytes to PTY", flush=True)
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
