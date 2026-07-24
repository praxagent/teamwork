"""Run a foreign agent as a TeamWork member.

TeamWork is agent-agnostic in principle: anything that can speak the REST API is
a member. In practice that still means *writing an HTTP integration*, which is
why every workspace tends to contain exactly one agent — the one somebody wrote
the integration for.

This closes that gap for the large class of agents that are **command-line
programs**: give it a command that reads a prompt on stdin and writes a reply on
stdout, and it becomes a channel member with its own identity, capability set and
audit trail. Goose, Codex and Claude Code all expose such a mode.

    adapter = ForeignAgent(
        name="goose", command=["goose", "run", "--quiet"],
        project_id="p1", channel_id="c1", agent_id="agent-goose")
    adapter.poll_once()          # read new messages, reply to those addressed to it

**Scope, stated plainly.** This is a *subprocess bridge*, not an implementation
of the Agent Client Protocol. Buzz's `buzz-acp` bridges ACP/MCP proper; matching
that spec is real work and claiming it here without having verified against the
specification would be a lie. What this provides is the **seam**: message intake,
addressing, identity and posting-back are protocol-independent, so an ACP or MCP
transport can replace :meth:`ForeignAgent.invoke` without touching anything else.

**Why this is the governance story, not just a convenience.** A foreign agent
gets a TeamWork credential like any other member, so everything already built
applies to it unchanged: identity is derived from its token, its capability set
bounds what it can do, channel membership bounds where it can speak, destructive
actions can sit behind an approval gate, and every action lands in the
hash-chained log. A heterogeneous team is *governed by construction* rather than
by trusting each vendor's agent to behave — which also hedges the correlated
failure you get when every agent in a workspace is the same model.
"""
from __future__ import annotations

import json
import logging
import os
import shlex
import subprocess
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# A reply longer than this is truncated before posting. A runaway agent should
# not be able to fill the message table (or the channel) with one response.
MAX_REPLY_CHARS = 16_000

DEFAULT_TIMEOUT_SECONDS = 300


class AdapterError(Exception):
    """The foreign agent could not be run, or refused to answer."""


@dataclass
class ForeignAgent:
    """A command-line agent participating as a TeamWork member."""

    name: str
    command: list[str]
    project_id: str
    channel_id: str
    agent_id: str | None = None
    #: Only reply to messages that name the agent. Without this, two adapters in
    #: one channel answer each other forever.
    require_mention: bool = True
    timeout: int = DEFAULT_TIMEOUT_SECONDS
    env: dict[str, str] = field(default_factory=dict)
    #: Highest message seq already handled, so a restart does not replay history.
    since_seq: int = 0

    # ── Protocol seam ────────────────────────────────────────────────────────

    def invoke(self, prompt: str) -> str:
        """Run the agent on *prompt* and return its reply.

        The one protocol-specific method. Swap it for an ACP/MCP client and the
        rest of this class is unchanged.
        """
        if not self.command:
            raise AdapterError("no command configured for this agent")
        try:
            proc = subprocess.run(  # noqa: S603 - the command is operator-supplied
                self.command,
                input=prompt,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                env={**os.environ, **self.env},
            )
        except FileNotFoundError as exc:
            raise AdapterError(f"command not found: {shlex.join(self.command)}") from exc
        except subprocess.TimeoutExpired as exc:
            raise AdapterError(
                f"{self.name} produced no reply within {self.timeout}s") from exc

        if proc.returncode != 0:
            # stderr is the useful half when a CLI agent fails; keep it bounded.
            detail = (proc.stderr or "").strip()[:500]
            raise AdapterError(f"{self.name} exited {proc.returncode}: {detail}")
        return (proc.stdout or "").strip()

    # ── Addressing ───────────────────────────────────────────────────────────

    def addressed_by(self, message: dict) -> bool:
        """Should this agent answer *message*?

        Two rules, both about not talking to yourself: never answer your own
        messages, and — unless the adapter is the channel's only responder —
        only answer when named. Without the second rule, two adapters sharing a
        channel reply to each other indefinitely.
        """
        if self.agent_id and message.get("agent_id") == self.agent_id:
            return False
        if not self.require_mention:
            return True
        content = (message.get("content") or "").lower()
        return f"@{self.name.lower()}" in content

    def build_prompt(self, message: dict) -> str:
        """What the foreign agent actually sees.

        The mention is stripped so the agent is not confused by its own name, and
        the speaker is labelled so it knows a human/another agent is talking to
        it rather than reading its own context back.
        """
        content = (message.get("content") or "").strip()
        for token in (f"@{self.name}", f"@{self.name.lower()}", f"@{self.name.upper()}"):
            content = content.replace(token, "")
        speaker = message.get("agent_name") or "user"
        return f"{speaker}: {content.strip()}"

    # ── One cycle ────────────────────────────────────────────────────────────

    def handle(self, message: dict) -> str | None:
        """Produce a reply for *message*, or ``None`` if it is not for us.

        A failing agent reports the failure into the channel rather than dying
        quietly: silence in a shared workspace reads as "still thinking".
        """
        if not self.addressed_by(message):
            return None
        try:
            reply = self.invoke(self.build_prompt(message))
        except AdapterError as exc:
            logger.warning("adapter %s failed: %s", self.name, exc)
            return f"⚠️ {self.name} could not answer: {exc}"
        if not reply:
            return f"⚠️ {self.name} returned an empty reply."
        if len(reply) > MAX_REPLY_CHARS:
            reply = reply[:MAX_REPLY_CHARS] + "\n\n…(truncated)"
        return reply


def load_agents(path: str) -> list[ForeignAgent]:
    """Build adapters from a JSON config.

    ``[{"name": "goose", "command": ["goose", "run"], "project_id": "...",
        "channel_id": "...", "agent_id": "...", "require_mention": true}]``
    """
    with open(path) as fh:
        entries = json.load(fh)
    agents: list[ForeignAgent] = []
    for entry in entries or []:
        command = entry.get("command")
        if isinstance(command, str):
            command = shlex.split(command)
        if not command:
            logger.warning("adapter %r has no command — skipped", entry.get("name"))
            continue
        agents.append(ForeignAgent(
            name=entry["name"], command=command,
            project_id=entry["project_id"], channel_id=entry["channel_id"],
            agent_id=entry.get("agent_id"),
            require_mention=bool(entry.get("require_mention", True)),
            timeout=int(entry.get("timeout", DEFAULT_TIMEOUT_SECONDS)),
            env=entry.get("env") or {},
        ))
    return agents
