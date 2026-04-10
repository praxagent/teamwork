"""Terminal WebSocket router for in-browser terminal access.

Provides a PTY-backed terminal that runs inside the sandbox container
(configured via SANDBOX_CONTAINER).  The frontend connects via WebSocket
and gets a full interactive shell.

Agents can inject commands into the active terminal via the REST endpoints
so the user sees them execute in real time (shared pairing model).
"""

import asyncio
import codecs
import logging
import os
import pty
import re
import select
import subprocess
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
from sqlalchemy import select as sa_select

from teamwork.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/terminal", tags=["terminal"])


# ---------------------------------------------------------------------------
# Active terminal sessions — keyed by project_id so agents can write to them
# ---------------------------------------------------------------------------

@dataclass
class TerminalSession:
    """Tracks an active PTY session for programmatic access."""
    master_fd: int
    process: subprocess.Popen
    output_chunks: list[str] = field(default_factory=list)

    def record_output(self, text: str) -> None:
        self.output_chunks.append(text)
        # Keep bounded — drop oldest chunks
        if len(self.output_chunks) > 2000:
            self.output_chunks = self.output_chunks[-1000:]


_active_sessions: dict[str, TerminalSession] = {}  # project_id -> session


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

class TerminalInfo(BaseModel):
    """Information about terminal capabilities."""
    docker_available: bool
    sandbox_container: str
    sandbox_running: bool


class TerminalInputRequest(BaseModel):
    """Write raw text to the terminal PTY."""
    input: str


class TerminalExecRequest(BaseModel):
    """Execute a command in the terminal and capture output."""
    command: str
    timeout: float = 5.0


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


@router.get("/{project_id}/recent")
async def terminal_recent(project_id: str, lines: int = 50):
    """Return recent terminal output (last N lines).

    Used by agents to "see" what's on the user's terminal screen
    and understand context before responding.
    """
    session = _active_sessions.get(project_id)
    if not session:
        raise HTTPException(404, "No active terminal session")

    # Join all buffered output and take last N lines
    raw = "".join(session.output_chunks)
    # Strip ANSI escape codes for readable output
    clean = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', raw)
    clean = clean.replace('\r', '')
    output_lines = clean.strip().split('\n')
    recent = "\n".join(output_lines[-lines:])
    return {"output": recent}


@router.post("/{project_id}/input")
async def terminal_input(project_id: str, body: TerminalInputRequest):
    """Write raw text to the active terminal's PTY.

    Use this to inject keystrokes or commands into the user's terminal.
    The text appears exactly as if the user typed it.
    """
    session = _active_sessions.get(project_id)
    if not session:
        raise HTTPException(404, "No active terminal session")
    try:
        os.write(session.master_fd, body.input.encode("utf-8"))
        return {"status": "ok"}
    except OSError as e:
        raise HTTPException(500, str(e))


@router.post("/{project_id}/exec")
async def terminal_exec(project_id: str, body: TerminalExecRequest):
    """Execute a command in the active terminal and capture output.

    Writes the command to the PTY (user sees it), waits for output to
    settle, and returns the captured output.  The command runs in the
    terminal's current working directory and environment.
    """
    session = _active_sessions.get(project_id)
    if not session:
        raise HTTPException(404, "No active terminal session")

    # Record where output starts
    capture_start = len(session.output_chunks)

    # Write command + newline to PTY
    try:
        os.write(session.master_fd, (body.command + "\n").encode("utf-8"))
    except OSError as e:
        raise HTTPException(500, str(e))

    # Wait for output to settle — poll until no new output for 0.3s
    deadline = asyncio.get_event_loop().time() + body.timeout
    prev_len = capture_start
    quiet_cycles = 0

    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(0.1)
        cur_len = len(session.output_chunks)
        if cur_len > prev_len:
            prev_len = cur_len
            quiet_cycles = 0
        else:
            quiet_cycles += 1
            if quiet_cycles >= 3:  # 0.3s of silence
                break

    # Collect output since command was sent
    raw = "".join(session.output_chunks[capture_start:])

    # Strip ANSI escape codes for clean output
    clean = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', raw)
    # Strip carriage returns
    clean = clean.replace('\r', '')

    return {"output": clean.strip()}


# ---------------------------------------------------------------------------
# WebSocket terminal
# ---------------------------------------------------------------------------

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
            await _run_sandbox_terminal(websocket, workspace_subdir, start_claude, project_id)
        else:
            await _run_local_terminal(websocket, workspace_subdir, start_claude, project_id)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(f"\r\n\x1b[31mError: {e}\x1b[0m\r\n")
        except Exception:
            pass
    finally:
        _active_sessions.pop(project_id, None)


async def _run_sandbox_terminal(
    websocket: WebSocket,
    workspace_subdir: str,
    start_claude: bool = False,
    project_id: str | None = None,
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

    sandbox_ws = f"/workspace/{workspace_subdir}"

    if start_claude:
        inner_cmd = (
            f"docker exec -it -w {sandbox_ws}"
            f" -e TERM=xterm-256color"
            f" {container} claude --dangerously-skip-permissions"
        )
    else:
        # Use the container's $SHELL (tmux-shell.sh) for persistent sessions.
        # Falls back to bash if $SHELL is not set.
        inner_cmd = (
            f"docker exec -it -w {sandbox_ws} -e TERM=xterm-256color"
            f' {container} sh -c \'exec "${{SHELL:-bash}}"\''
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

    # Register session for programmatic access by agents
    session = TerminalSession(master_fd=master_fd, process=process)
    if project_id:
        _active_sessions[project_id] = session

    await _terminal_io_loop(websocket, session)


async def _run_local_terminal(
    websocket: WebSocket,
    workspace_subdir: str,
    start_claude: bool = False,
    project_id: str | None = None,
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

    # Register session for programmatic access
    session = TerminalSession(master_fd=master_fd, process=process)
    if project_id:
        _active_sessions[project_id] = session

    await _terminal_io_loop(websocket, session)


async def _terminal_io_loop(
    websocket: WebSocket,
    session: TerminalSession,
) -> None:
    """Shared PTY <-> WebSocket bridge."""
    master_fd = session.master_fd
    process = session.process
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
                                session.record_output(text)
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
