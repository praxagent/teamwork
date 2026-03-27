"""Terminal WebSocket router for in-browser terminal access.

Provides a PTY-backed terminal that runs inside the sandbox container
(configured via SANDBOX_CONTAINER).  The frontend connects via WebSocket
and gets a full interactive shell.
"""

import asyncio
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
from sqlalchemy import select as sa_select

from teamwork.config import settings

router = APIRouter(prefix="/terminal", tags=["terminal"])


class TerminalInfo(BaseModel):
    """Information about terminal capabilities."""
    docker_available: bool
    sandbox_container: str
    sandbox_running: bool


@router.get("/info")
async def get_terminal_info() -> TerminalInfo:
    """Check terminal capabilities."""
    import shutil

    docker_available = shutil.which("docker") is not None
    sandbox_running = False

    if docker_available and settings.sandbox_container:
        check = subprocess.run(
            ["docker", "ps", "--filter", f"name={settings.sandbox_container}",
             "--format", "{{.Names}}"],
            capture_output=True, text=True,
        )
        sandbox_running = settings.sandbox_container in check.stdout

    return TerminalInfo(
        docker_available=docker_available,
        sandbox_container=settings.sandbox_container,
        sandbox_running=sandbox_running,
    )


@router.websocket("/ws/{project_id}")
async def terminal_websocket(
    websocket: WebSocket,
    project_id: str,
    mode: str = Query(default="docker"),
    start_claude: bool = Query(default=False),
):
    """WebSocket endpoint for terminal sessions.

    Execs into the sandbox container and bridges PTY I/O over WebSocket.
    """
    await websocket.accept()

    from teamwork.models import Project
    from teamwork.models.base import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            sa_select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if project and project.workspace_dir:
            workspace_subdir = project.workspace_dir
        else:
            workspace_subdir = project_id

    try:
        if mode == "docker" and settings.sandbox_container:
            await _run_sandbox_terminal(websocket, workspace_subdir, start_claude)
        else:
            await _run_local_terminal(websocket, workspace_subdir, start_claude)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(f"\r\n\x1b[31mError: {e}\x1b[0m\r\n")
        except Exception:
            pass


async def _run_sandbox_terminal(
    websocket: WebSocket,
    workspace_subdir: str,
    start_claude: bool = False,
) -> None:
    """Exec into the shared sandbox container."""
    import shutil

    container = settings.sandbox_container
    if not shutil.which("docker"):
        await websocket.send_text("\x1b[31mDocker not available.\x1b[0m\r\n")
        return

    # Verify sandbox is running
    check = subprocess.run(
        ["docker", "ps", "--filter", f"name={container}", "--format", "{{.Names}}"],
        capture_output=True, text=True,
    )
    if container not in check.stdout:
        await websocket.send_text(
            f"\x1b[31mSandbox container '{container}' is not running.\x1b[0m\r\n"
        )
        return

    sandbox_ws = f"/workspaces/{workspace_subdir}"

    if start_claude:
        inner_cmd = (
            f"docker exec -it -w {sandbox_ws}"
            f" -e TERM=xterm-256color"
            f" {container} claude --dangerously-skip-permissions"
        )
    else:
        inner_cmd = (
            f"docker exec -it -w {sandbox_ws} -e TERM=xterm-256color"
            f" {container} bash"
        )

    await websocket.send_text(f"\x1b[32mConnecting to sandbox ({container})...\x1b[0m\r\n")

    import platform
    if platform.system() == "Darwin":
        cmd = ["script", "-q", "/dev/null", "bash", "-c", inner_cmd]
    else:
        cmd = ["script", "-q", "-c", inner_cmd, "/dev/null"]

    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(cmd, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, close_fds=True)
    os.close(slave_fd)

    await _terminal_io_loop(websocket, process, master_fd)


async def _run_local_terminal(
    websocket: WebSocket,
    workspace_subdir: str,
    start_claude: bool = False,
) -> None:
    """Run a local terminal session with PTY."""
    workspace_path = settings.workspace_path / workspace_subdir
    workspace_path.mkdir(parents=True, exist_ok=True)

    shell = os.environ.get("SHELL", "/bin/bash")
    cmd = ["claude", "--dangerously-skip-permissions"] if start_claude else [shell]

    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        cmd,
        stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
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

    await _terminal_io_loop(websocket, process, master_fd)


async def _terminal_io_loop(
    websocket: WebSocket,
    process: subprocess.Popen,
    master_fd: int,
) -> None:
    """Shared PTY <-> WebSocket bridge."""
    os.set_blocking(master_fd, False)
    utf8_decoder = codecs.getincrementaldecoder("utf-8")("replace")

    try:
        async def read_pty():
            nonlocal utf8_decoder
            while True:
                try:
                    r, _, _ = select.select([master_fd], [], [], 0.01)
                    if r:
                        data = os.read(master_fd, 4096)
                        if data:
                            text = utf8_decoder.decode(data)
                            if text:
                                await websocket.send_text(text)
                    else:
                        await asyncio.sleep(0.01)
                    if process.poll() is not None:
                        remaining = utf8_decoder.decode(b"", final=True)
                        if remaining:
                            await websocket.send_text(remaining)
                        await websocket.send_text("\r\n\x1b[33m[Session ended]\x1b[0m\r\n")
                        break
                except OSError:
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
                            except Exception:
                                pass
                        else:
                            os.write(master_fd, text.encode("utf-8"))
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
        except Exception:
            process.kill()
        try:
            os.close(master_fd)
        except Exception:
            pass
