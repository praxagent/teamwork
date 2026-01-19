"""Agent manager for spawning and managing Claude Code instances."""

import asyncio
import fcntl
import os
import pty
import select as select_module
import shutil
import struct
import subprocess
import termios
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Agent, ActivityLog, Message, Channel, Task
from app.websocket import manager as ws_manager, WebSocketEvent, EventType


def _check_pty_waiting_for_input(master_fd: int, pid: int, output_buffer: str = "") -> tuple[bool, str]:
    """
    Check if a PTY process is waiting for input using multiple signals:
    
    1. ANSI escape sequences (most reliable):
       - \x1b[?25h = Show cursor = ready for input
       - \x1b[?25l = Hide cursor = processing
    
    2. Process state (Linux/macOS):
       - Sleeping state usually means waiting for I/O
    
    3. PTY buffer state:
       - No pending output = not actively writing
    
    Returns:
        Tuple of (is_waiting, reason)
    """
    import array
    
    reasons = []
    confidence = 0
    
    try:
        # ============================================================
        # CHECK 1: ANSI Cursor Visibility Escape Sequences
        # ============================================================
        cursor_state = "unknown"
        if output_buffer:
            # Look at the last portion of output for cursor sequences
            last_chunk = output_buffer[-2000:] if len(output_buffer) > 2000 else output_buffer
            
            # Find the last cursor show/hide sequence
            show_cursor = '\x1b[?25h'  # Show cursor = ready for TEXT input
            hide_cursor = '\x1b[?25l'  # Hide cursor = menu/processing
            
            last_show = last_chunk.rfind(show_cursor)
            last_hide = last_chunk.rfind(hide_cursor)
            
            if last_show > last_hide:
                # Cursor visible = waiting for text input (very strong signal)
                confidence += 60
                cursor_state = "visible"
                reasons.append("cursor visible (text input mode)")
            elif last_hide > last_show:
                # Cursor hidden could mean:
                # 1. Processing (actively working) - combine with process running
                # 2. Selection menu (waiting for arrow/number) - combine with process sleeping
                cursor_state = "hidden"
                # Don't add or subtract - let process state decide
        
        # ============================================================
        # CHECK 2: PTY Buffer State (FIONREAD)
        # ============================================================
        buf = array.array('i', [0])
        fcntl.ioctl(master_fd, termios.FIONREAD, buf)
        pending_bytes = buf[0]
        
        if pending_bytes > 0:
            return False, f"{pending_bytes} bytes pending in PTY buffer"
        else:
            confidence += 20
            reasons.append("no pending PTY output")
        
        # ============================================================
        # CHECK 3: Process State (OS-level)
        # ============================================================
        import platform
        process_sleeping = False
        
        if platform.system() == "Linux":
            try:
                with open(f"/proc/{pid}/stat", "r") as f:
                    stat = f.read().split()
                    state = stat[2] if len(stat) > 2 else "?"
                    if state == "S":
                        process_sleeping = True
                        confidence += 30
                        reasons.append("process sleeping")
                    elif state == "R":
                        # If process is RUNNING and cursor is hidden = actively processing
                        if cursor_state == "hidden":
                            return False, "process running + cursor hidden = processing"
            except (FileNotFoundError, PermissionError):
                pass
        
        elif platform.system() == "Darwin":  # macOS
            try:
                result = subprocess.run(
                    ["ps", "-o", "state=", "-p", str(pid)],
                    capture_output=True, text=True, timeout=1
                )
                state = result.stdout.strip()
                if state and state[0] in ("S", "U"):
                    process_sleeping = True
                    confidence += 30
                    reasons.append(f"process sleeping (state={state[0]})")
                elif state and state[0] == "R":
                    # If process is RUNNING and cursor is hidden = actively processing
                    if cursor_state == "hidden":
                        return False, "process running + cursor hidden = processing"
            except (subprocess.TimeoutExpired, Exception):
                pass
        
        # ============================================================
        # CHECK 4: Selection Menu Detection (cursor hidden + sleeping)
        # ============================================================
        # Selection menus hide cursor but process is sleeping waiting for key
        if cursor_state == "hidden" and process_sleeping:
            confidence += 40  # Strong signal: hidden cursor menu waiting for input
            reasons.append("selection menu (cursor hidden + process sleeping)")
        
        # ============================================================
        # DECISION: Is it waiting for input?
        # ============================================================
        # Thresholds:
        # - 60+ = cursor visible (text input) - definite
        # - 50+ = selection menu (cursor hidden + sleeping + no output) - very likely
        # - 40+ = moderate signals - likely
        if confidence >= 50:
            return True, " + ".join(reasons)
        elif confidence >= 40:
            return True, " + ".join(reasons) + " (moderate confidence)"
        else:
            return False, f"insufficient signals (confidence={confidence})"
        
    except Exception as e:
        return False, f"check failed: {e}"


@dataclass
class AgentTerminal:
    """Represents an agent's PTY terminal session."""
    
    agent_id: str
    master_fd: int  # PTY master file descriptor
    process: subprocess.Popen
    output_buffer: str = ""  # Accumulated output
    started_at: datetime = field(default_factory=datetime.utcnow)
    last_output_at: datetime | None = None
    is_running: bool = True
    attached_websockets: list = field(default_factory=list)  # Connected WebSocket clients
    prompt_sent: bool = False  # Whether the initial prompt has been sent
    prompt_submitted: bool = False  # Whether the prompt was submitted successfully
    last_llm_check_at: datetime | None = None  # When we last asked LLM about idle state
    llm_check_count: int = 0  # How many times we've checked with LLM for this terminal
    needs_immediate_llm_check: bool = False  # Flag to trigger LLM check on next iteration
    
    def is_waiting_for_input(self) -> tuple[bool, str]:
        """Check if the terminal process is waiting for input."""
        if not self.is_running or self.process.poll() is not None:
            return False, "process not running"
        return _check_pty_waiting_for_input(self.master_fd, self.process.pid, self.output_buffer)


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
        self._agent_terminals: dict[str, AgentTerminal] = {}  # agent_id -> PTY terminal session
        self._terminal_readers: dict[str, asyncio.Task] = {}  # Background tasks reading PTY output

    async def _get_project_workspace(self, db: AsyncSession, project_id: str) -> Path:
        """Get the correct workspace path for a project."""
        from app.models import Project
        result = await db.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        
        if project and project.workspace_dir:
            return self._workspace_path / project.workspace_dir
        return self._workspace_path / project_id

    def _create_agent_terminal(
        self,
        agent_id: str,
        cmd: list[str],
        workspace_dir: Path,
        env: dict[str, str] | None = None,
    ) -> AgentTerminal:
        """
        Create a PTY terminal session for an agent.
        
        This allows real-time output streaming and the ability to attach/interact.
        """
        # Close any existing terminal for this agent first
        if agent_id in self._agent_terminals:
            print(f">>> Closing existing terminal for agent {agent_id} before creating new one", flush=True)
            self._close_agent_terminal(agent_id)
        
        # Create PTY
        master_fd, slave_fd = pty.openpty()
        
        # Set terminal size (larger for Claude Code TUI)
        winsize = struct.pack("HHHH", 50, 140, 0, 0)  # 50 rows, 140 cols
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        
        # Set master to non-blocking for better async handling
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        
        # Build environment
        process_env = {
            **os.environ,
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
            "PYTHONUNBUFFERED": "1",
            **(env or {}),
        }
        
        # Spawn the process with PTY
        process = subprocess.Popen(
            cmd,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=str(workspace_dir),
            env=process_env,
            preexec_fn=os.setsid,
        )
        
        os.close(slave_fd)
        os.set_blocking(master_fd, False)
        
        terminal = AgentTerminal(
            agent_id=agent_id,
            master_fd=master_fd,
            process=process,
            started_at=datetime.utcnow(),
        )
        
        self._agent_terminals[agent_id] = terminal
        
        # Start background task to read output
        reader_task = asyncio.create_task(self._read_terminal_output(agent_id))
        self._terminal_readers[agent_id] = reader_task
        
        print(f">>> Created PTY terminal for agent {agent_id}, PID: {process.pid}", flush=True)
        
        return terminal

    def _parse_stream_json_line(self, line: str) -> str | None:
        """
        Parse a stream-json line from Claude Code and return human-readable text.
        
        Returns formatted text or None if the line should be skipped.
        """
        import json
        
        line = line.strip()
        if not line:
            return None
        
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            # Not JSON, return as-is
            return line if line else None
        
        msg_type = data.get("type", "")
        
        if msg_type == "assistant":
            # Main assistant message with content
            content = data.get("message", {}).get("content", [])
            texts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        texts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        tool_name = block.get("name", "unknown")
                        texts.append(f"\n🔧 Using tool: {tool_name}")
            return "\n".join(texts) if texts else None
        
        elif msg_type == "content_block_delta":
            # Streaming text delta
            delta = data.get("delta", {})
            if delta.get("type") == "text_delta":
                return delta.get("text", "")
            elif delta.get("type") == "input_json_delta":
                return None  # Skip raw JSON input
        
        elif msg_type == "content_block_start":
            block = data.get("content_block", {})
            if block.get("type") == "tool_use":
                tool_name = block.get("name", "unknown")
                return f"\n🔧 Using tool: {tool_name}\n"
            elif block.get("type") == "text":
                return ""  # Text block starting
        
        elif msg_type == "result":
            # Final result
            result = data.get("result", "")
            cost = data.get("cost_usd", 0)
            duration = data.get("duration_ms", 0)
            if result:
                return f"\n\n✅ Task completed\nCost: ${cost:.4f} | Duration: {duration/1000:.1f}s\n"
            return None
        
        elif msg_type == "error":
            error = data.get("error", {})
            msg = error.get("message", str(error))
            return f"\n❌ Error: {msg}\n"
        
        elif msg_type == "system":
            # System messages
            message = data.get("message", "")
            if message:
                return f"ℹ️ {message}\n"
        
        # Skip other message types
        return None

    def _detect_and_respond_to_prompts(self, agent_id: str, terminal: 'AgentTerminal') -> str | None:
        """
        Detect if Claude Code is asking a question and auto-respond appropriately.
        
        Returns the response to send, or None if no response needed.
        """
        import re
        
        text = terminal.output_buffer
        
        # Get the last portion of text to check for prompts
        lines = text.strip().split('\n')
        last_lines = '\n'.join(lines[-20:]) if len(lines) > 20 else text
        
        # ============================================================
        # PASTED TEXT PROMPT - We handle this in _invoke_claude_code
        # Only respond if prompt_submitted is somehow still False
        # ============================================================
        if '[Pasted text' in last_lines:
            if not terminal.prompt_submitted:
                print(f">>> Agent {agent_id}: Detected pasted text indicator, sending Enter to submit", flush=True)
                terminal.prompt_submitted = True
                return '\r'  # Use \r for terminal Enter
            # Otherwise, already submitted - don't send duplicate Enter
            return None
        
        # ============================================================
        # CLAUDE CODE API KEY PROMPT - Most common stuck point
        # ============================================================
        if 'Do you want to use this API key?' in last_lines:
            print(f">>> Agent {agent_id}: Detected API key prompt! Sending '1' + Enter to select Yes", flush=True)
            return '1\r'
        
        # ============================================================
        # CLAUDE CODE LOGIN METHOD SELECTION
        # Options: 1. Claude account with subscription | 2. Anthropic Console (API)
        # Select option 1 if we have subscription config, else 2 for API billing
        # ============================================================
        if 'Select login method' in last_lines or 'Claude account with subscription' in last_lines:
            # If we have CLAUDE_CONFIG_BASE64, use subscription (option 1)
            # Otherwise use API billing (option 2)
            if settings.claude_config_base64:
                print(f">>> Agent {agent_id}: Detected login prompt, selecting Claude subscription (option 1)", flush=True)
                return '1\r'
            else:
                print(f">>> Agent {agent_id}: Detected login prompt, selecting API billing (option 2)", flush=True)
                return '2\r'
        
        # ============================================================
        # CLAUDE CODE INTERACTIVE MENUS - Selection prompts
        # These show "Enter to select/confirm" or "Esc to cancel" at the bottom
        # ============================================================
        is_selection_menu = (
            'Enter to select' in last_lines or 
            'Enter to confirm' in last_lines or 
            'Esc to cancel' in last_lines
        )
        
        if is_selection_menu:
            # ============================================================
            # BYPASS PERMISSIONS WARNING - Must accept to continue
            # Options: 1. No, exit  |  2. Yes, I accept
            # ============================================================
            if 'Bypass Permissions mode' in last_lines or 'bypass permissions' in last_lines.lower():
                print(f">>> Agent {agent_id}: Detected Bypass Permissions warning, accepting (option 2)", flush=True)
                return '2\r'  # Select "Yes, I accept"
            
            # ============================================================
            # DANGEROUS COMMANDS / ACCEPT WARNINGS
            # If we see "accept" as an option, we want that one
            # ============================================================
            if 'I accept' in last_lines or 'accept' in last_lines.lower():
                # Find which option number has "accept"
                if '2. Yes' in last_lines or '2.' in last_lines and 'accept' in last_lines.lower():
                    print(f">>> Agent {agent_id}: Detected accept prompt, selecting option 2", flush=True)
                    return '2\r'
                elif '1. Yes' in last_lines:
                    print(f">>> Agent {agent_id}: Detected accept prompt, selecting option 1", flush=True)
                    return '1\r'
            
            # Permission prompts - Always allow access when possible
            if 'always allow' in last_lines.lower() or 'from this project' in last_lines:
                # Select option 2 which typically is "Yes, and always allow..."
                print(f">>> Agent {agent_id}: Detected permission prompt, selecting 'always allow' option", flush=True)
                return '2\r'
            
            # Check if this is a permission/approval prompt (Yes/No)
            if 'Do you want to proceed?' in last_lines or '1. Yes' in last_lines:
                print(f">>> Agent {agent_id}: Detected Yes/No selection menu, pressing '1' + Enter to select Yes", flush=True)
                return '1\r'  # Select option 1 (Yes)
            
            # For app type selection menus, select option 2 (Full-stack web app) as it's most common
            if 'What type of application' in last_lines:
                print(f">>> Agent {agent_id}: Detected app type selection, selecting Full-stack web app", flush=True)
                return '2\r'  # Select "Full-stack web app"
            
            # For backend tech selection
            if 'backend' in last_lines.lower() and ('1.' in last_lines and '2.' in last_lines):
                print(f">>> Agent {agent_id}: Detected backend tech selection, selecting option 1", flush=True)
                return '1\r'
            
            # ============================================================
            # UNKNOWN MENU - Use LLM to decide instead of blindly pressing Enter
            # This prevents selecting wrong options like "No, exit"
            # ============================================================
            print(f">>> Agent {agent_id}: Unknown selection menu detected, triggering immediate LLM check", flush=True)
            terminal.needs_immediate_llm_check = True
            return None
        
        # ============================================================
        # Don't auto-respond to other prompts until Claude is working
        # (i.e., until we see it actually processing the task)
        # ============================================================
        if not terminal.prompt_submitted:
            return None
        
        # Check if Claude Code is actually working on something
        working_indicators = [
            '● Reading', '● Writing', '● Editing', '● Running',
            '◐', '◑', '◒', '◓',  # Spinner characters
            'Thinking', 'Analyzing', 'Creating', 'Updating',
            '✓', '✔',  # Completion markers
        ]
        is_working = any(ind in last_lines for ind in working_indicators)
        
        # ============================================================
        # GENERIC PROMPTS - Only respond when Claude is actively working
        # ============================================================
        prompt_patterns = [
            # Yes/No prompts - usually approve
            (r'\[y/N\]\s*$', 'y\r', 'Approved (y/N prompt)'),
            (r'\[Y/n\]\s*$', 'Y\r', 'Approved (Y/n prompt)'),
            (r'\(y/n\)\s*[:\?]?\s*$', 'y\r', 'Approved (y/n prompt)'),
            (r'Do you want to proceed\?', 'y\r', 'Proceeding'),
            (r'Continue\?', 'y\r', 'Continuing'),
            
            # Permission prompts
            (r'Allow.*\?.*\[.*\]', 'y\r', 'Permission granted'),
            
            # Press Enter to continue
            (r'Press Enter to continue', '\r', 'Pressed Enter'),
            (r'press enter', '\r', 'Pressed Enter'),
            
            # Confirmation prompts
            (r'Are you sure\?', 'y\r', 'Confirmed'),
        ]
        
        for pattern, response, log_msg in prompt_patterns:
            if re.search(pattern, last_lines, re.IGNORECASE):
                print(f">>> Agent {agent_id}: Detected prompt, auto-responding: {log_msg}", flush=True)
                return response
        
        return None

    def _detect_task_completion(self, agent_id: str, terminal: 'AgentTerminal') -> bool:
        """
        Detect if Claude Code has completed the current task.
        
        Returns True if task appears complete, False otherwise.
        Uses pattern matching for fast detection before falling back to LLM.
        """
        import re
        
        # CRITICAL: If the task prompt was never submitted, the task can't be complete!
        if not terminal.prompt_submitted:
            return False
        
        text = terminal.output_buffer
        
        # Get the last portion of text
        lines = text.strip().split('\n')
        last_lines = '\n'.join(lines[-30:]) if len(lines) > 30 else text
        
        # Indicators that we're still in startup/setup mode (NOT task execution)
        startup_indicators = [
            'Select login method',
            'Claude account with subscription',
            'Anthropic Console account',
            'Choose the text style',
            'Dark mode',
            'Light mode',
            'Welcome to Claude Code',
            'Let\'s get started',
        ]
        if any(ind in text for ind in startup_indicators):
            # Still in startup - can't be complete
            return False
        
        # Must have evidence of actual work being done
        work_evidence = [
            'Created', 'Updated', 'Modified', 'Wrote', 'Edited',
            'committed', 'commit', 'Saved', 'Generated',
            '✓', '✔', 'Done', 'Completed',
            'file', 'package.json', '.ts', '.js', '.py', '.tsx', '.jsx',
        ]
        has_work_evidence = any(ind in text for ind in work_evidence)
        
        if not has_work_evidence:
            # No evidence any work was done
            return False
        
        # Completion indicators from Claude Code
        completion_patterns = [
            # Explicit completion messages
            r'Task completed',
            r'All done!',
            r'Successfully completed',
            r'Changes committed',
            r'I\'ve completed',
            r'I have completed',
            r'The task is complete',
            r'Work is complete',
            r'Implementation complete',
            
            # Git commit patterns (strong indicator)
            r'\[main [a-f0-9]+\]',  # Git commit hash
        ]
        
        for pattern in completion_patterns:
            if re.search(pattern, last_lines, re.IGNORECASE):
                # Make sure we're not in the middle of something
                working_indicators = ['Running', 'Reading', 'Writing', 'Thinking', '◐', '◑', '◒', '◓']
                if not any(ind in last_lines[-500:] for ind in working_indicators):
                    print(f">>> Agent {agent_id}: Detected task completion pattern: {pattern}", flush=True)
                    return True
        
        return False

    async def _llm_analyze_terminal_state(self, agent_id: str, terminal_output: str) -> dict:
        """
        Use LLM to analyze terminal output and determine its state.
        
        This is a fallback for when pattern matching doesn't catch prompts or completion.
        Returns a dict with:
        - state: 'waiting_for_input', 'task_completed', 'still_working', 'error'
        - suggested_input: str or None (for waiting_for_input state)
        - reason: explanation
        """
        import anthropic
        
        # Get last 100 lines of output for analysis (avoid huge payloads)
        lines = terminal_output.strip().split('\n')
        recent_output = '\n'.join(lines[-100:]) if len(lines) > 100 else terminal_output
        
        # Skip if output is too short (likely still loading)
        if len(recent_output.strip()) < 50:
            return {"state": "still_working", "reason": "Output too short", "suggested_input": None}
        
        prompt = f"""Analyze this terminal output from Claude Code (an AI coding assistant running in a terminal).

Determine the current state of the terminal:

1. **WAITING_FOR_INPUT** (MOST COMMON): Claude needs user input to continue. Look for:
   - Interactive menus with numbered options (1. Yes, 2. No, etc.)
   - Login/authentication prompts ("Select login method", "Claude account with subscription")
   - Theme selection ("Choose the text style", "Dark mode", "Light mode")
   - Yes/No prompts ([y/N], [Y/n])
   - Permission requests ("Do you want to proceed?")
   - Selection prompts with arrow indicators (❯) for CHOICES
   - "Welcome to Claude Code" startup screens with menus
   - Any numbered list where user must select an option

2. **STILL_WORKING**: Claude is actively working. Look for:
   - Progress indicators, spinners (●, ◐, ◑)
   - "Reading...", "Writing...", "Thinking..."
   - Command execution in progress
   - File operations happening
   - Loading animations

3. **TASK_COMPLETED**: Claude has ACTUALLY finished real work. ONLY use this if:
   - There is clear evidence of FILES CREATED OR MODIFIED
   - Git commits were made (you see commit hashes like "[main abc1234]")
   - Claude explicitly says "Task completed", "All done", "I've completed the task"
   - DO NOT use this for startup screens, menus, or login prompts!
   - DO NOT use this if no actual code/files were created!

4. **ERROR**: Something went wrong. Look for:
   - Error messages, stack traces
   - "Failed", "Error:", exceptions

IMPORTANT: Startup screens (login, theme selection) are WAITING_FOR_INPUT, not TASK_COMPLETED!

TERMINAL OUTPUT (last 3000 chars):
```
{recent_output[-3000:]}
```

Respond in JSON format ONLY:
{{
    "state": "waiting_for_input" | "still_working" | "task_completed" | "error",
    "reason": "brief explanation of why you chose this state",
    "suggested_input": "input to send if waiting_for_input, else null"
}}

For suggested_input:
- Login prompt with "Claude account with subscription": use "1" (subscription) or "2" (API)
- Theme selection: use "1" (dark mode is usually fine)
- Numbered menu: use the number for "Yes"/"proceed"/"accept" (often "1" or "2")
- y/n prompt: use "y"
- Just needs Enter: use ""
- Not waiting: use null"""

        try:
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            response = client.messages.create(
                model=settings.model_agent_simple,  # Use fast/cheap model (haiku)
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )
            
            response_text = response.content[0].text.strip()
            
            # Parse JSON response
            import json
            # Handle markdown code blocks
            if '```json' in response_text:
                response_text = response_text.split('```json')[1].split('```')[0]
            elif '```' in response_text:
                response_text = response_text.split('```')[1].split('```')[0]
            
            result = json.loads(response_text)
            
            state = result.get("state", "still_working")
            reason = result.get("reason", "unknown")
            suggested = result.get("suggested_input")
            
            print(f">>> Agent {agent_id}: LLM terminal analysis - state={state}, reason={reason}", flush=True)
            
            return {
                "state": state,
                "reason": reason,
                "suggested_input": suggested
            }
                
        except Exception as e:
            print(f">>> Agent {agent_id}: LLM analysis failed: {e}", flush=True)
            return {"state": "still_working", "reason": f"LLM error: {e}", "suggested_input": None}

    async def _read_terminal_output(self, agent_id: str) -> None:
        """Background task to read PTY output and stream to WebSocket clients."""
        import codecs
        
        terminal = self._agent_terminals.get(agent_id)
        if not terminal:
            return
        
        # UTF-8 decoder that buffers incomplete sequences
        decoder = codecs.getincrementaldecoder('utf-8')('replace')
        
        # Track started time
        started_at = terminal.started_at.isoformat()
        
        # Track when we last responded to avoid rapid-fire responses
        last_response_time = datetime.min
        response_cooldown = 0.5  # Seconds between auto-responses (reduced for faster handling)
        
        # Track what prompts we've already responded to
        responded_prompts = set()
        
        try:
            while terminal.is_running:
                try:
                    # Check if there's data to read
                    r, _, _ = select_module.select([terminal.master_fd], [], [], 0.1)
                    if r:
                        data = os.read(terminal.master_fd, 4096)
                        if data:
                            text = decoder.decode(data)
                            if text:
                                # Store raw output
                                terminal.output_buffer += text
                                terminal.last_output_at = datetime.utcnow()
                                
                                # Check for prompts and auto-respond (for non-interactive automation)
                                now = datetime.utcnow()
                                if (now - last_response_time).total_seconds() > response_cooldown:
                                    response = self._detect_and_respond_to_prompts(agent_id, terminal)
                                    if response:
                                        print(f">>> Auto-responding to prompt: {repr(response)}", flush=True)
                                        try:
                                            os.write(terminal.master_fd, response.encode('utf-8'))
                                            last_response_time = now
                                        except Exception as e:
                                            print(f">>> Failed to send auto-response: {e}", flush=True)
                                
                                # Update live output for the frontend
                                self._live_output[agent_id] = {
                                    "status": "running",
                                    "output": terminal.output_buffer,
                                    "last_update": datetime.utcnow().isoformat(),
                                    "started_at": started_at,
                                    "has_terminal": True,
                                }
                                
                                # Send raw output to attached WebSocket clients (xterm.js will render it)
                                for ws in terminal.attached_websockets:
                                    try:
                                        await ws.send_text(text)
                                    except Exception:
                                        pass
                                
                                # Check for immediate LLM if unknown menu was detected
                                if terminal.needs_immediate_llm_check:
                                    await asyncio.sleep(0.5)  # Brief delay for output to settle
                    else:
                        await asyncio.sleep(0.05)
                    
                    # ============================================================
                    # IDLE/STUCK DETECTION - Uses PTY state + pattern matching + LLM
                    # NOTE: This runs every iteration, not just when idle
                    # Detects: stuck prompts, task completion, errors
                    # ============================================================
                    now = datetime.utcnow()
                    idle_threshold_seconds = 10  # Consider idle after 10 seconds
                    pty_check_threshold_seconds = 3  # Check PTY state after 3 seconds of no output
                    llm_check_cooldown_seconds = 15  # Don't check LLM more than once per 15s
                    max_llm_checks = 10  # Max LLM checks per terminal session (prevent cost blowup)
                    
                    # Check for completion via pattern matching first (free!)
                    if (terminal.last_output_at and 
                        terminal.prompt_submitted and
                        (now - terminal.last_output_at).total_seconds() > idle_threshold_seconds):
                        
                        if self._detect_task_completion(agent_id, terminal):
                            print(f">>> Agent {agent_id}: Task completed (pattern match)!", flush=True)
                            os.write(terminal.master_fd, b"/exit\r")
                            terminal.is_running = False
                            self._live_output[agent_id]["status"] = "completed"
                            continue  # Skip to next iteration to exit cleanly
                    
                    # ============================================================
                    # PTY STATE CHECK - Fast, OS-level detection of waiting state
                    # NOTE: This runs even BEFORE prompt_submitted - catches startup prompts!
                    # ============================================================
                    pty_is_waiting = False
                    if (terminal.last_output_at and 
                        (now - terminal.last_output_at).total_seconds() > pty_check_threshold_seconds):
                        
                        is_waiting, reason = terminal.is_waiting_for_input()
                        if is_waiting:
                            pty_is_waiting = True
                            # Only log occasionally to avoid spam
                            if terminal.llm_check_count == 0 or (now - (terminal.last_llm_check_at or datetime.min)).total_seconds() > 5:
                                print(f">>> Agent {agent_id}: PTY state check: {reason}", flush=True)
                    
                    # Determine if we should run LLM check
                    # 1. Immediate check requested (unknown menu detected)
                    # 2. PTY is confirmed waiting for input (works even before task submitted!)
                    # 3. Or terminal has been idle for a while (fallback)
                    needs_llm_check = False
                    check_reason = ""
                    
                    if terminal.needs_immediate_llm_check and terminal.llm_check_count < max_llm_checks:
                        needs_llm_check = True
                        check_reason = "unknown menu detected"
                        terminal.needs_immediate_llm_check = False  # Reset flag
                    elif pty_is_waiting and terminal.llm_check_count < max_llm_checks:
                        # PTY confirmed waiting - check with LLM what to do
                        # This catches startup prompts like login selection!
                        can_check = (terminal.last_llm_check_at is None or 
                                    (now - terminal.last_llm_check_at).total_seconds() > llm_check_cooldown_seconds)
                        if can_check:
                            needs_llm_check = True
                            check_reason = "PTY waiting for input"
                    elif (terminal.last_output_at and 
                          (now - terminal.last_output_at).total_seconds() > idle_threshold_seconds and
                          terminal.llm_check_count < max_llm_checks):
                        # Fallback: time-based idle check (also works before prompt_submitted)
                        can_check = (terminal.last_llm_check_at is None or 
                                    (now - terminal.last_llm_check_at).total_seconds() > llm_check_cooldown_seconds)
                        if can_check:
                            needs_llm_check = True
                            idle_time = int((now - terminal.last_output_at).total_seconds())
                            check_reason = f"idle for {idle_time}s"
                    
                    if needs_llm_check:
                        print(f">>> Agent {agent_id}: LLM check triggered ({check_reason}) - check {terminal.llm_check_count + 1}/{max_llm_checks}", flush=True)
                        terminal.last_llm_check_at = now
                        terminal.llm_check_count += 1
                        
                        try:
                            analysis = await self._llm_analyze_terminal_state(agent_id, terminal.output_buffer)
                            state = analysis.get("state", "still_working")
                            
                            if state == "waiting_for_input":
                                suggested = analysis.get("suggested_input")
                                if suggested is not None:
                                    # Send the suggested input
                                    if suggested == "":
                                        response_to_send = "\r"
                                    else:
                                        response_to_send = f"{suggested}\r"
                                    print(f">>> Agent {agent_id}: Sending LLM-suggested input: {repr(response_to_send)}", flush=True)
                                    os.write(terminal.master_fd, response_to_send.encode('utf-8'))
                                    last_response_time = now
                            
                            elif state == "task_completed":
                                print(f">>> Agent {agent_id}: LLM detected task completion!", flush=True)
                                # Signal completion by marking terminal as done
                                # We'll send /exit to cleanly close Claude Code
                                os.write(terminal.master_fd, b"/exit\r")
                                terminal.is_running = False
                                self._live_output[agent_id]["status"] = "completed"
                            
                            elif state == "error":
                                print(f">>> Agent {agent_id}: LLM detected error state", flush=True)
                                # Don't exit, let the normal error handling deal with it
                            
                            # else: still_working - do nothing, keep waiting
                            
                        except Exception as e:
                            print(f">>> Agent {agent_id}: LLM fallback error: {e}", flush=True)
                    
                    # Check if process is still running
                    if terminal.process.poll() is not None:
                        # Flush remaining output
                        remaining = decoder.decode(b'', final=True)
                        if remaining:
                            terminal.output_buffer += remaining
                        
                        terminal.is_running = False
                        
                        self._live_output[agent_id] = {
                            "status": "completed" if terminal.process.returncode == 0 else "error",
                            "output": terminal.output_buffer,
                            "last_update": datetime.utcnow().isoformat(),
                            "started_at": started_at,
                            "has_terminal": True,
                        }
                        break
                        
                except OSError as e:
                    if e.errno == 5:  # Input/output error - PTY closed
                        break
                    print(f">>> Terminal read error: {e}", flush=True)
                    break
                except Exception as e:
                    print(f">>> Terminal read exception: {e}", flush=True)
                    break
                    
        finally:
            print(f">>> Terminal reader stopped for agent {agent_id}", flush=True)

    def _close_agent_terminal(self, agent_id: str) -> None:
        """Close an agent's terminal session."""
        terminal = self._agent_terminals.get(agent_id)
        if terminal:
            terminal.is_running = False
            
            try:
                terminal.process.terminate()
                terminal.process.wait(timeout=2)
            except Exception:
                try:
                    terminal.process.kill()
                except Exception:
                    pass
            
            try:
                os.close(terminal.master_fd)
            except Exception:
                pass
            
            del self._agent_terminals[agent_id]
            
        if agent_id in self._terminal_readers:
            self._terminal_readers[agent_id].cancel()
            del self._terminal_readers[agent_id]
        
        print(f">>> Closed terminal for agent {agent_id}", flush=True)

    def send_to_agent_terminal(self, agent_id: str, data: bytes) -> bool:
        """
        Send input to an agent's terminal (for user takeover).
        
        Returns True if sent successfully.
        """
        terminal = self._agent_terminals.get(agent_id)
        if not terminal or not terminal.is_running:
            print(f">>> send_to_agent_terminal: No active terminal for {agent_id}", flush=True)
            return False
        
        try:
            # Log what we're sending (for debugging)
            if len(data) <= 10:
                print(f">>> Sending to terminal {agent_id}: {repr(data)}", flush=True)
            else:
                print(f">>> Sending to terminal {agent_id}: {len(data)} bytes", flush=True)
            
            written = os.write(terminal.master_fd, data)
            print(f">>> Wrote {written} bytes to terminal", flush=True)
            return True
        except BlockingIOError:
            # Non-blocking write would block - try again
            import time
            time.sleep(0.01)
            try:
                os.write(terminal.master_fd, data)
                return True
            except Exception as e2:
                print(f">>> Error sending to terminal (retry): {e2}", flush=True)
                return False
        except Exception as e:
            print(f">>> Error sending to terminal: {e}", flush=True)
            return False

    def get_agent_terminal(self, agent_id: str) -> AgentTerminal | None:
        """Get an agent's terminal session if it exists."""
        return self._agent_terminals.get(agent_id)

    def attach_websocket_to_terminal(self, agent_id: str, websocket) -> bool:
        """Attach a WebSocket to an agent's terminal for live streaming."""
        terminal = self._agent_terminals.get(agent_id)
        if not terminal:
            return False
        terminal.attached_websockets.append(websocket)
        return True

    def detach_websocket_from_terminal(self, agent_id: str, websocket) -> None:
        """Detach a WebSocket from an agent's terminal."""
        terminal = self._agent_terminals.get(agent_id)
        if terminal and websocket in terminal.attached_websockets:
            terminal.attached_websockets.remove(websocket)

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
        """Start an agent in a Docker container with mounted workspace."""
        # Check if Docker is available
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "version",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
            if proc.returncode != 0:
                print(f">>> Docker not available, falling back to subprocess", flush=True)
                return await self._start_subprocess_agent(agent, workspace_dir, project_id)
        except FileNotFoundError:
            print(f">>> Docker not found, falling back to subprocess", flush=True)
            return await self._start_subprocess_agent(agent, workspace_dir, project_id)
        
        # Check if the agent image exists
        image_name = "vteam/agent:latest"
        proc = await asyncio.create_subprocess_exec(
            "docker", "image", "inspect", image_name,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        
        if proc.returncode != 0:
            # Image doesn't exist - we need to build it or use a base image
            print(f">>> Docker image {image_name} not found, falling back to subprocess", flush=True)
            print(f">>> To use Docker mode, build the image: docker build -t {image_name} -f docker/agent.Dockerfile .", flush=True)
            return await self._start_subprocess_agent(agent, workspace_dir, project_id)
        
        print(f">>> Starting Docker agent for {agent.name} with workspace: {workspace_dir}", flush=True)
        
        # Agent is ready but Claude Code is invoked per-task
        agent_process = AgentProcess(
            agent_id=agent.id,
            is_running=True,
            runtime_mode="docker",
        )
        
        if agent.session_id:
            agent_process.session_id = agent.session_id
        
        self._agents[agent.id] = agent_process
        return True

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
        claude_code_mode: str = "terminal",
        use_docker: bool = True,  # Default to Docker for security
    ) -> tuple[str, str | None]:
        """
        Invoke Claude Code CLI to process a prompt.
        
        Modes:
        - 'terminal': Interactive mode - run claude in a real terminal, user can watch and take over
        - 'programmatic': Use -p flag with stdin piping (legacy mode)
        
        Execution:
        - use_docker=True: Run in Docker container with workspace mounted (secure, isolated)
        - use_docker=False: Run directly on host (fallback if Docker unavailable)
        
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

        import tempfile
        import shlex
        
        # Track if we're using prompt file (needs cleanup)
        prompt_file = None
        
        if claude_code_mode == "terminal":
            # True Interactive Terminal Mode
            # Run claude in interactive mode - xterm.js on frontend renders the TUI properly
            # User can watch and take over at any time
            
            cmd_parts = ["claude"]
            
            # Add model selection if specified
            if model:
                cmd_parts.extend(["--model", model])
                print(f">>> Using model: {model}", flush=True)
            
            # Add system prompt
            cmd_parts.extend(["--append-system-prompt", system_prompt])
            
            # Resume session if available
            if session_id:
                cmd_parts.extend(["--resume", session_id])
            
            # Skip all permission prompts - we're running in Docker so it's isolated
            cmd_parts.extend(["--dangerously-skip-permissions"])
            
            # Build the shell command
            shell_cmd = ' '.join(shlex.quote(p) for p in cmd_parts)
            
            # Will send prompt as terminal input after startup
            prompt_to_send = prompt
            
            print(f">>> Running Claude Code in INTERACTIVE TERMINAL mode", flush=True)
            print(f">>> Command: {shell_cmd}", flush=True)
            print(f">>> Working directory: {workspace_dir}", flush=True)
            print(f">>> Prompt length: {len(prompt)} chars", flush=True)
            
        else:
            # Programmatic Mode (legacy) - use -p flag with stdin
            prompt_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
            prompt_file.write(prompt)
            prompt_file.close()
            
            cmd_parts = ["claude", "-p"]
            
            # Add model selection if specified
            if model:
                cmd_parts.extend(["--model", model])
                print(f">>> Using model: {model}", flush=True)
            
            # Add system prompt
            cmd_parts.extend(["--append-system-prompt", system_prompt])
            
            # Resume session if available
            if session_id:
                cmd_parts.extend(["--resume", session_id])
            
            # Skip all permission prompts - we're running in Docker so it's isolated
            cmd_parts.extend(["--dangerously-skip-permissions"])
            
            # Build shell command that pipes the prompt file
            shell_cmd = f"cat {shlex.quote(prompt_file.name)} | {' '.join(shlex.quote(p) for p in cmd_parts)}"
            prompt_to_send = None  # No prompt to send, it's piped via stdin
            
            print(f">>> Running Claude Code in PROGRAMMATIC mode", flush=True)
        
        try:
            print(f">>> Working directory: {workspace_dir}", flush=True)
            
            # Check if Docker mode should be used
            docker_available = False
            docker_image = "vteam/agent:latest"
            
            if use_docker:
                # Check Docker availability
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "docker", "version",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await proc.wait()
                    docker_available = proc.returncode == 0
                    
                    if docker_available:
                        # Check if image exists
                        proc = await asyncio.create_subprocess_exec(
                            "docker", "image", "inspect", docker_image,
                            stdout=asyncio.subprocess.DEVNULL,
                            stderr=asyncio.subprocess.DEVNULL,
                        )
                        await proc.wait()
                        docker_available = proc.returncode == 0
                        
                        if not docker_available:
                            print(f">>> Docker image {docker_image} not found, falling back to local", flush=True)
                except FileNotFoundError:
                    print(f">>> Docker not found, falling back to local execution", flush=True)
            
            # Ensure Claude Code settings exist with bypass permissions enabled
            # This prevents the "Do you accept?" warning for --dangerously-skip-permissions
            if not docker_available:
                claude_settings_dir = Path.home() / ".claude"
                claude_settings_file = claude_settings_dir / "settings.json"
                if not claude_settings_file.exists():
                    claude_settings_dir.mkdir(parents=True, exist_ok=True)
                    claude_settings_file.write_text('{"permissions":{"defaultMode":"bypassPermissions"}}')
                    print(f">>> Created Claude settings with bypass mode at {claude_settings_file}", flush=True)
                else:
                    # Check if bypass mode is already set
                    try:
                        import json
                        existing = json.loads(claude_settings_file.read_text())
                        if existing.get("permissions", {}).get("defaultMode") != "bypassPermissions":
                            existing.setdefault("permissions", {})["defaultMode"] = "bypassPermissions"
                            claude_settings_file.write_text(json.dumps(existing, indent=2))
                            print(f">>> Updated Claude settings with bypass mode", flush=True)
                    except Exception as e:
                        print(f">>> Could not update Claude settings: {e}", flush=True)
            
            # Build environment variables
            # For terminal mode, don't pass ANTHROPIC_API_KEY to avoid the 
            # "Do you want to use this API key?" prompt. Claude Code should
            # use its built-in auth (CLAUDE_CONFIG_BASE64 or OAuth).
            # For programmatic mode, we still pass it since -p mode doesn't prompt.
            if claude_code_mode == "terminal":
                terminal_env = {}  # Let Claude Code use its default auth
            else:
                terminal_env = {"ANTHROPIC_API_KEY": settings.anthropic_api_key}
            
            # If Docker is available, wrap the command
            if docker_available:
                print(f">>> Running in Docker container ({docker_image})", flush=True)
                # Build Docker command with workspace mount
                docker_cmd = [
                    "docker", "run", "--rm", "-it",
                    "-v", f"{workspace_dir}:/workspace",
                    "-w", "/workspace",
                    "--memory", "4g",
                    "--cpus", "2",
                ]
                
                # Pass CLAUDE_CONFIG_BASE64 for auth if available
                if settings.claude_config_base64:
                    docker_cmd.extend(["-e", f"CLAUDE_CONFIG_BASE64={settings.claude_config_base64}"])
                
                # Add API key for programmatic mode
                if terminal_env.get("ANTHROPIC_API_KEY"):
                    docker_cmd.extend(["-e", f"ANTHROPIC_API_KEY={terminal_env['ANTHROPIC_API_KEY']}"])
                
                docker_cmd.append(docker_image)
                docker_cmd.extend(["bash", "-c", shell_cmd])
                
                final_cmd = docker_cmd
                execution_dir = Path("/workspace")  # Inside container
            else:
                final_cmd = ["bash", "-c", shell_cmd]
                execution_dir = workspace_dir
            
            # Create PTY terminal for this agent
            terminal = self._create_agent_terminal(
                agent_id=agent.id,
                cmd=final_cmd,
                workspace_dir=execution_dir if not docker_available else workspace_dir,  # Use host path for PTY
                env=terminal_env if not docker_available else {},  # Docker handles env vars
            )
            
            print(f">>> Claude Code PTY process started, PID: {terminal.process.pid}", flush=True)
            
            # For interactive mode, send the prompt after a brief delay for claude to initialize
            if prompt_to_send:
                await asyncio.sleep(3)  # Give claude more time to fully start up
                print(f">>> Sending prompt to interactive terminal ({len(prompt_to_send)} chars)...", flush=True)
                
                # Mark that we're sending the prompt
                terminal.prompt_sent = True
                terminal.prompt_submitted = True  # Mark as submitted to prevent auto-responder duplicate
                
                # Send the prompt - Claude Code will show it as "[Pasted text #1 +X lines]"
                self.send_to_agent_terminal(agent.id, prompt_to_send.encode('utf-8'))
                
                # Wait for Claude Code to process the paste
                await asyncio.sleep(1.0)
                
                # Send Enter (carriage return) to submit
                # In terminal mode, \r is typically what the Enter key sends
                self.send_to_agent_terminal(agent.id, b"\r")
                
                print(f">>> Prompt sent and submitted", flush=True)
                
                # Update live output to show prompt was sent
                if agent.id in self._live_output:
                    self._live_output[agent.id]["output"] += f"\n>>> Prompt sent to Claude Code <<<\n\n"
            
            # Wait for the PTY process to complete (output is captured by background reader)
            timeout_seconds = 600  # 10 minutes
            start_time = datetime.utcnow()
            last_log_time = start_time
            
            while terminal.is_running:
                await asyncio.sleep(0.5)
                
                # Log progress every 30 seconds
                now = datetime.utcnow()
                elapsed = (now - start_time).total_seconds()
                if (now - last_log_time).total_seconds() > 30:
                    output_len = len(terminal.output_buffer)
                    print(f">>> Claude Code still running, elapsed: {int(elapsed)}s, output: {output_len} chars", flush=True)
                    last_log_time = now
                
                # Check for timeout
                if elapsed > timeout_seconds:
                    print(f">>> Claude Code timed out after {timeout_seconds}s", flush=True)
                    self._close_agent_terminal(agent.id)
                    self._live_output[agent.id]["status"] = "timeout"
                    self._live_output[agent.id]["error"] = f"Task timed out after {timeout_seconds // 60} minutes"
                    return (f"[Task timed out after {timeout_seconds // 60} minutes]", None)
            
            # Process completed - get the output
            output = terminal.output_buffer
            return_code = terminal.process.returncode
            
            print(f">>> Claude Code completed, output length: {len(output)}, return code: {return_code}", flush=True)
            
            # Clean up terminal (but preserve output in _live_output)
            self._close_agent_terminal(agent.id)
            
            return (output, None)
                
        except Exception as e:
            print(f">>> Error in PTY invoke: {e}", flush=True)
            import traceback
            traceback.print_exc()
            self._close_agent_terminal(agent.id)
            if agent.id in self._live_output:
                self._live_output[agent.id]["status"] = "error"
                self._live_output[agent.id]["error"] = str(e)
            return (f"[Error invoking Claude Code: {str(e)}]", None)
        finally:
            # Clean up temp file if it was created (only in programmatic mode)
            if prompt_file:
                try:
                    os.unlink(prompt_file.name)
                except Exception:
                    pass

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
        
        # Fixed model modes (using configurable settings)
        if model_mode == "opus":
            return settings.model_agent_complex  # Opus when available, fallback to complex model
        elif model_mode == "sonnet":
            return settings.model_agent_moderate
        elif model_mode == "haiku":
            return settings.model_agent_simple
        
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
            
            # Map complexity to model (using configurable settings)
            if complexity == "complex":
                print(f">>> Auto-selected model: {settings.model_agent_complex} (complex task)", flush=True)
                return settings.model_agent_complex
            elif complexity == "simple":
                print(f">>> Auto-selected model: {settings.model_agent_simple} (simple task)", flush=True)
                return settings.model_agent_simple
            else:
                print(f">>> Auto-selected model: {settings.model_agent_moderate} (moderate task)", flush=True)
                return settings.model_agent_moderate
        
        return None  # Use Claude Code default

    async def execute_task(
        self,
        agent_id: str,
        task_id: str,
        include_chat_context: bool = True,
        retry_attempt: int = 0,
    ) -> dict[str, Any]:
        """
        Have an agent execute a task using Claude Code.
        
        Args:
            agent_id: The agent to execute the task
            task_id: The task to execute
            include_chat_context: Whether to include recent chat history for context
            retry_attempt: Current retry attempt number (0 = first attempt)
        
        Returns:
            Dict with status and any output
        """
        max_retries = settings.max_task_retries
        print(f">>> execute_task called: agent_id={agent_id}, task_id={task_id}, attempt={retry_attempt + 1}/{max_retries}", flush=True)
        
        # Get existing output to preserve history, or start fresh
        existing_output = ""
        started_at = datetime.utcnow().isoformat()
        if agent_id in self._live_output:
            existing_output = self._live_output[agent_id].get("output", "")
            # Add separator if there's existing content
            if existing_output and not existing_output.endswith("\n\n"):
                existing_output += "\n\n"
            existing_output += f"{'='*50}\n"
            if retry_attempt > 0:
                existing_output += f"[{datetime.utcnow().strftime('%H:%M:%S')}] RETRY ATTEMPT {retry_attempt + 1}/{max_retries}\n"
            else:
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
            result = await self._execute_task_inner(agent_id, task_id, include_chat_context)
            
            # If successful, reset retry count on task
            if result.get("success"):
                async with self._db_session_factory() as db:
                    task_result = await db.execute(select(Task).where(Task.id == task_id))
                    task = task_result.scalar_one_or_none()
                    if task:
                        task.retry_count = 0
                        task.last_error = None
                        await db.commit()
                return result
            else:
                # Task execution returned failure (not an exception)
                error_msg = result.get("error", "Unknown error")
                # Only retry for certain error types (Claude Code failures, timeouts)
                if "Claude Code" in error_msg or "timeout" in error_msg.lower() or "invocation failed" in error_msg.lower():
                    return await self._handle_task_failure(
                        agent_id, task_id, error_msg, retry_attempt, include_chat_context
                    )
                else:
                    # Non-retryable error (e.g., missing CLI)
                    return result
            
        except Exception as e:
            # Global error handler - ensure agent is reset to idle on any failure
            error_msg = f"Unexpected error in execute_task: {str(e)}"
            print(f">>> {error_msg}", flush=True)
            import traceback
            traceback.print_exc()
            
            self._live_output[agent_id]["status"] = "error"
            self._live_output[agent_id]["error"] = error_msg
            self._live_output[agent_id]["output"] = self._live_output[agent_id].get("output", "") + f"\n\nFATAL ERROR: {error_msg}\n"
            
            # Handle retry logic
            return await self._handle_task_failure(
                agent_id, task_id, error_msg, retry_attempt, include_chat_context
            )
    
    async def _handle_task_failure(
        self,
        agent_id: str,
        task_id: str,
        error_msg: str,
        retry_attempt: int,
        include_chat_context: bool = True,
    ) -> dict[str, Any]:
        """
        Handle task failure with retry logic.
        
        If retries are available, schedules a retry.
        If max retries reached, moves task back to 'pending' (todo) with error info.
        """
        max_retries = settings.max_task_retries
        retry_delay = settings.task_retry_delay_seconds
        
        try:
            async with self._db_session_factory() as db:
                agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = agent_result.scalar_one_or_none()
                task_result = await db.execute(select(Task).where(Task.id == task_id))
                task = task_result.scalar_one_or_none()
                
                if not task:
                    return {"success": False, "error": error_msg}
                
                # Update retry count and error
                task.retry_count = retry_attempt + 1
                task.last_error = error_msg[:1000]  # Truncate long errors
                
                # Check if we should retry
                if retry_attempt + 1 < max_retries:
                    # Schedule retry
                    print(f">>> Task {task_id} failed, scheduling retry {retry_attempt + 2}/{max_retries} in {retry_delay}s", flush=True)
                    task.status = "pending"  # Keep in pending for retry
                    await db.commit()
                    
                    self._live_output[agent_id]["output"] += f"\n[RETRY] Scheduling retry {retry_attempt + 2}/{max_retries} in {retry_delay} seconds...\n"
                    
                    # Schedule retry after delay
                    asyncio.create_task(
                        self._retry_task_after_delay(agent_id, task_id, retry_delay, retry_attempt + 1, include_chat_context)
                    )
                    
                    return {"success": False, "error": error_msg, "retrying": True, "retry_attempt": retry_attempt + 1}
                else:
                    # Max retries reached - move to pending (todo) permanently
                    print(f">>> Task {task_id} failed after {max_retries} attempts, moving back to TODO", flush=True)
                    task.status = "pending"
                    task.assigned_to = None  # Unassign so PM can reassign
                    await db.commit()
                    
                    self._live_output[agent_id]["output"] += f"\n[FAILED] Max retries ({max_retries}) reached. Task moved back to TODO.\n"
                    
                    # Reset agent to idle
                    if agent:
                        agent.status = "idle"
                        await db.commit()
                        
                        await ws_manager.broadcast_to_project(
                            agent.project_id,
                            WebSocketEvent(
                                type=EventType.AGENT_STATUS,
                                data={"agent_id": agent_id, "status": "idle", "name": agent.name},
                            ),
                        )
                    
                    # Broadcast task update
                    await ws_manager.broadcast_to_project(
                        task.project_id,
                        WebSocketEvent(
                            type=EventType.TASK_UPDATE,
                            data={
                                "id": task_id,
                                "status": "pending",
                                "assigned_to": None,
                                "retry_count": task.retry_count,
                                "last_error": task.last_error,
                            },
                        ),
                    )
                    
                    # Log the failure
                    activity = ActivityLog(
                        agent_id=agent_id,
                        activity_type="task_failed",
                        description=f"Task failed after {max_retries} attempts: {task.title[:50]}",
                        extra_data={
                            "task_id": task_id,
                            "error": error_msg[:500],
                            "retry_count": task.retry_count,
                        },
                    )
                    db.add(activity)
                    await db.commit()
                    
                    return {"success": False, "error": error_msg, "max_retries_reached": True}
                    
        except Exception as cleanup_error:
            print(f">>> Error during failure handling: {cleanup_error}", flush=True)
            return {"success": False, "error": error_msg}
    
    async def _retry_task_after_delay(
        self,
        agent_id: str,
        task_id: str,
        delay_seconds: int,
        retry_attempt: int,
        include_chat_context: bool = True,
    ) -> None:
        """Wait for delay then retry the task."""
        await asyncio.sleep(delay_seconds)
        await self.execute_task(agent_id, task_id, include_chat_context, retry_attempt)
    
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

            # Get Claude Code mode from project config (default to terminal for best experience)
            claude_code_mode = project_config.get("claude_code_mode", "terminal")
            
            # Invoke Claude Code - use the workspace_dir we already computed above
            try:
                response, new_session_id = await self._invoke_claude_code(
                    agent,
                    prompt,
                    workspace_dir,
                    session_id=agent_process.session_id,
                    allowed_tools=["Read", "Edit", "Write", "Bash(git:*)", "Bash(npm:*)", "Bash(pip:*)", "Bash(ls:*)", "Bash(mkdir:*)"],
                    model=selected_model,
                    claude_code_mode=claude_code_mode,
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

    def init_live_output(self, agent_id: str, task_title: str, agent_name: str) -> None:
        """
        Initialize live output for an agent immediately when a task starts.
        
        This ensures the frontend sees output right away instead of "Agent is starting up..."
        """
        now = datetime.utcnow()
        self._live_output[agent_id] = {
            "status": "initializing",
            "output": f"[{now.strftime('%H:%M:%S')}] Starting task: {task_title}\nAgent: {agent_name}\nInitializing...\n",
            "last_update": now.isoformat(),
            "started_at": now.isoformat(),
        }
        print(f">>> Initialized live output for agent {agent_id}", flush=True)

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
