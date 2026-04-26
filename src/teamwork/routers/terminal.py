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
    """Long-lived PTY session — outlives any single WebSocket connection.

    The WebSocket handler attaches/detaches by setting `websocket`.  A
    background `drain_task` reads the PTY continuously and (a) appends
    every byte to `output_chunks` for replay/agent use, (b) forwards
    live to the currently-attached `websocket` if any.  The bash process
    keeps running while no client is attached, so a `tail -f`, build,
    or test suite started in the panel keeps progressing while the user
    is on another tab.
    """
    master_fd: int
    process: subprocess.Popen
    output_chunks: list[str] = field(default_factory=list)
    websocket: WebSocket | None = None
    drain_task: asyncio.Task | None = None

    def record_output(self, text: str) -> None:
        self.output_chunks.append(text)
        # Keep bounded — drop oldest chunks
        if len(self.output_chunks) > 2000:
            self.output_chunks = self.output_chunks[-1000:]

    def replay_text(self, max_bytes: int = 200_000) -> str:
        """Return the recent output, capped so a fresh attach doesn't dump megabytes."""
        out = "".join(self.output_chunks)
        if len(out) > max_bytes:
            return out[-max_bytes:]
        return out


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
    # Standard CSI + private-mode (?, >, <, =) prefixes — the older
    # `[0-9;]*` pattern missed bracketed-paste sequences like
    # \x1b[?2004l, leaving them in the agent-facing output and tanking
    # the model's command-generation accuracy when the context is
    # littered with them.
    clean = re.sub(r'\x1b\[[\?>=]?[0-9;]*[a-zA-Z]', '', raw)
    # Drop OSC sequences too — chromium and bash sometimes emit
    # \x1b]0;<title>\x07 to set window title; useless to the agent.
    clean = re.sub(r'\x1b\][^\x07]*\x07', '', clean)
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
    # Standard CSI + private-mode (?, >, <, =) prefixes — the older
    # `[0-9;]*` pattern missed bracketed-paste sequences like
    # \x1b[?2004l, leaving them in the agent-facing output and tanking
    # the model's command-generation accuracy when the context is
    # littered with them.
    clean = re.sub(r'\x1b\[[\?>=]?[0-9;]*[a-zA-Z]', '', raw)
    # Drop OSC sequences too — chromium and bash sometimes emit
    # \x1b]0;<title>\x07 to set window title; useless to the agent.
    clean = re.sub(r'\x1b\][^\x07]*\x07', '', clean)
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

    Sessions persist across WS disconnects: navigate to another tab and
    come back, same shell with full state.  A long-running command
    (build, `tail -f`, etc.) keeps progressing while you're away —
    output goes into the session's rolling buffer and is replayed on
    reattach.
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

    # Reuse an existing live session if one is registered for this project.
    # `start_claude` always gets a fresh session — Claude is interactive
    # and reattaching mid-conversation makes no sense.
    session = _active_sessions.get(project_id)
    if start_claude or session is None or session.process.poll() is not None:
        if session is not None and session.process.poll() is not None:
            # Stale — clean up and respawn.
            await _cleanup_session(session)
            _active_sessions.pop(project_id, None)
        session = await _spawn_terminal_session(
            websocket, workspace_subdir, start_claude, mode,
        )
        if session is None:
            return  # error already reported to the WS
        _active_sessions[project_id] = session
        # Background drain task lives for the entire session lifetime,
        # not per-WS.
        session.drain_task = asyncio.create_task(_drain_pty(session))
    else:
        await websocket.send_text(
            f"\x1b[32mReconnected to existing terminal session.\x1b[0m\r\n"
        )

    # Attach this WS to the session so the drain task forwards live output
    # here, and replay the recent buffer so the user lands on a screen
    # showing what already happened.
    session.websocket = websocket
    replay = session.replay_text()
    if replay:
        try:
            await websocket.send_text(replay)
        except Exception:
            pass

    try:
        await _ws_input_loop(websocket, session)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("terminal WS error")
        try:
            await websocket.send_text(f"\r\n\x1b[31mError: {e}\x1b[0m\r\n")
        except Exception:
            pass
    finally:
        # Detach this WS from the session, but DON'T kill the process —
        # the next reconnect will pick it back up.  Only clear the slot
        # if no other WS replaced us in the meantime.
        if session.websocket is websocket:
            session.websocket = None


async def _spawn_terminal_session(
    websocket: WebSocket,
    workspace_subdir: str,
    start_claude: bool,
    mode: str,
) -> TerminalSession | None:
    """Spawn a fresh PTY session.  Returns None if we couldn't.

    Routes to docker-exec into the sandbox container when configured,
    or to a local PTY otherwise (dev convenience).
    """
    import shutil

    if mode == "docker" and settings.sandbox_container:
        container = settings.sandbox_container
        if not shutil.which("docker"):
            await websocket.send_text("\x1b[31mDocker not available.\x1b[0m\r\n")
            return None
        check = subprocess.run(
            ["docker", "ps", "--filter", f"name={container}", "--format", "{{.Names}}"],
            capture_output=True, text=True,
        )
        if container not in check.stdout:
            await websocket.send_text(
                f"\x1b[31mSandbox container '{container}' is not running.\x1b[0m\r\n"
            )
            return None

        sandbox_ws = "/workspace"
        if start_claude:
            inner_cmd = (
                f"docker exec -it -w {sandbox_ws}"
                f" -e TERM=xterm-256color"
                f" {container} claude --dangerously-skip-permissions"
            )
        else:
            # bash-respawn.sh wraps `bash -l` in `while true; do ... done`
            # so typing `exit` spawns a fresh bash in the same PTY rather
            # than ending the session.  No tmux: native xterm.js scrolling
            # works, resize is one fewer translation layer, and the panel
            # behaves like a normal web terminal.
            inner_cmd = (
                f"docker exec -it -w {sandbox_ws} -e TERM=xterm-256color"
                f" {container} /usr/local/bin/bash-respawn.sh"
            )

        await websocket.send_text(
            f"\x1b[32mConnecting to sandbox ({container})...\x1b[0m\r\n"
        )

        import platform
        if platform.system() == "Darwin":
            cmd = ["script", "-q", "/dev/null", "bash", "-c", inner_cmd]
        else:
            cmd = ["script", "-q", "-c", inner_cmd, "/dev/null"]

        master_fd, slave_fd = pty.openpty()
        process = subprocess.Popen(
            cmd, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, close_fds=True,
        )
        os.close(slave_fd)
        return TerminalSession(master_fd=master_fd, process=process)

    # Local fallback (dev mode without docker).
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
    return TerminalSession(master_fd=master_fd, process=process)


async def _cleanup_session(session: TerminalSession) -> None:
    """Tear down a stale session (process already exited)."""
    if session.drain_task and not session.drain_task.done():
        session.drain_task.cancel()
        try:
            await session.drain_task
        except (asyncio.CancelledError, Exception):
            pass
    try:
        os.close(session.master_fd)
    except OSError:
        pass


async def _drain_pty(session: TerminalSession) -> None:
    """Forever-running PTY reader — outlives any single WebSocket.

    Every byte the shell writes goes (a) into `output_chunks` for replay
    and the agent's `terminal_history`, and (b) live to the currently
    attached WS if any.  Without this, the PTY's kernel buffer would
    fill up while no client is attached and the shell would block.
    """
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    os.set_blocking(session.master_fd, False)
    try:
        while True:
            r, _, _ = select.select([session.master_fd], [], [], 0.0)
            if r:
                try:
                    data = os.read(session.master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                text = decoder.decode(data)
                if text:
                    session.record_output(text)
                    ws = session.websocket
                    if ws is not None:
                        try:
                            await ws.send_text(text)
                        except Exception:
                            # Silently drop — WS likely disconnected.
                            pass
            else:
                await asyncio.sleep(0.02)
            if session.process.poll() is not None:
                # Drain any final bytes before quitting.
                try:
                    tail = os.read(session.master_fd, 65536)
                    if tail:
                        text = decoder.decode(tail, final=True)
                        if text:
                            session.record_output(text)
                            ws = session.websocket
                            if ws is not None:
                                try:
                                    await ws.send_text(text)
                                except Exception:
                                    pass
                except OSError:
                    pass
                ws = session.websocket
                if ws is not None:
                    try:
                        await ws.send_text("\r\n\x1b[33m[Session ended]\x1b[0m\r\n")
                    except Exception:
                        pass
                break
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("drain_pty failed")


async def _ws_input_loop(websocket: WebSocket, session: TerminalSession) -> None:
    """Forward bytes from the WS to the PTY (one direction only).

    The OTHER direction (PTY → WS) is handled by the session's drain
    task, so output flows even when no WS is attached.
    """
    while True:
        data = await websocket.receive()
        if "text" in data and data["text"] is not None:
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
                        fcntl.ioctl(session.master_fd, termios.TIOCSWINSZ, winsize)
                except Exception:
                    pass
            else:
                try:
                    os.write(session.master_fd, text.encode("utf-8"))
                except OSError:
                    break
        elif "bytes" in data and data["bytes"] is not None:
            try:
                os.write(session.master_fd, data["bytes"])
            except OSError:
                break
        elif data.get("type") == "websocket.disconnect":
            break


# NOTE: the previous _terminal_io_loop tied the PTY's lifetime to the
# WebSocket's lifetime — disconnect → process killed → next reconnect
# spawned fresh.  Replaced with the persistent-session model above:
# `_drain_pty` runs for the lifetime of the bash process, `_ws_input_loop`
# only handles the WS→PTY direction per-connection, and the session is
# never killed by a disconnect.
