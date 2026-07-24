"""Per-agent credentials — the token decides *who* the caller is.

TeamWork's external API originally authenticated every caller with a single
workspace-wide ``EXTERNAL_API_KEY`` and then believed whatever ``agent_id`` the
caller put in the request body. With one agent that is harmless bookkeeping.
With several agents governed by an orchestrator it means **there is no boundary
between the agents at all**: any holder of the one key can post, act, and be
logged as any agent in the roster, and the audit trail records the impersonation
as fact.

So identity is **derived from the presented credential**, never asserted by the
caller. Each agent gets its own token; the token maps to exactly one
``AgentClient`` carrying the agent's id, its project scope, and its capability
allowlist. A body-asserted ``agent_id`` is only ever *checked against* the
resolved identity — it can narrow, never widen.

The shape is deliberately the same one Prax already uses for inbound MCP callers
(``prax/mcp/clients.py``): ``{name, token_sha256, agent_id, project_id, allow}``,
hashed at rest, compared in constant time. Same problem, same answer.

Registry (JSON) at ``TEAMWORK_AGENT_CLIENTS_PATH``::

    [
      {"name": "prax-research", "token_sha256": "…", "agent_id": "…",
       "project_id": "…", "allow": ["message.post", "task.update"]},
      {"name": "prax-ops", "token": "plaintext-ok-but-prefer-hash", "agent_id": "…"}
    ]
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Capability wildcard. A client with this may perform any action (the legacy
# single-key credential, and any registry entry that omits `allow`).
ALL_CAPABILITIES = "*"

# The capability vocabulary: what a credential may *do*, independent of which
# agent it is. Scoping by identity means a research agent holding a valid
# credential still cannot reorganise the board or rewrite another channel's
# history — the same way you would not give a teammate every permission just
# because they are on the team.
#
# Grouped `noun.verb`; a registry entry may also grant a whole noun with
# `"message.*"`. Read capabilities are separated from writes because the
# interesting privilege boundary is *mutation*.
CAP_PROJECT_READ = "project.read"
CAP_PROJECT_WRITE = "project.write"        # create/update a project, ensure channels
CAP_AGENT_WRITE = "agent.write"            # register an agent, set its status
CAP_MESSAGE_POST = "message.post"
CAP_MESSAGE_DELETE = "message.delete"      # purge a channel's history — destructive
CAP_MESSAGE_BULK = "message.bulk"          # backfill history with forged timestamps
CAP_PRESENCE = "presence"                  # typing indicators, live output
CAP_TASK_WRITE = "task.write"              # create/update board items
CAP_ACTIVITY_WRITE = "activity.write"

KNOWN_CAPABILITIES = frozenset({
    CAP_PROJECT_READ, CAP_PROJECT_WRITE, CAP_AGENT_WRITE, CAP_MESSAGE_POST,
    CAP_MESSAGE_DELETE, CAP_MESSAGE_BULK, CAP_PRESENCE, CAP_TASK_WRITE,
    CAP_ACTIVITY_WRITE,
})


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AgentClient:
    """One credential = one identity = one capability set."""

    name: str
    token_sha256: str
    agent_id: str | None = None      # the Agent row this credential speaks as
    project_id: str | None = None    # scope; None = any project
    allow: frozenset[str] = field(default_factory=lambda: frozenset({ALL_CAPABILITIES}))
    legacy: bool = False             # the shared workspace-wide key
    public_key: str | None = None    # Ed25519 (base64/hex) — enables signing
    require_signature: bool = False  # reject this client's unsigned requests

    def matches(self, presented: str | None) -> bool:
        """Constant-time credential check (never leaks a prefix via timing)."""
        if not presented:
            return False
        return hmac.compare_digest(self.token_sha256, _sha256(presented))

    def can(self, capability: str) -> bool:
        """May this credential perform *capability*?

        Accepts an exact grant, a noun wildcard (``message.*`` covers
        ``message.post``), or the global wildcard.
        """
        if ALL_CAPABILITIES in self.allow or capability in self.allow:
            return True
        noun = capability.split(".", 1)[0]
        return f"{noun}.{ALL_CAPABILITIES}" in self.allow

    def may_act_as(self, asserted_agent_id: str | None) -> bool:
        """May this credential act as *asserted_agent_id*?

        A credential bound to an agent may only ever act as that agent. An
        unbound credential (the legacy shared key) keeps the old behaviour of
        speaking for anyone — which is exactly why binding matters.
        """
        if self.agent_id is None:
            return True
        return asserted_agent_id is None or asserted_agent_id == self.agent_id

    def scoped_to(self, project_id: str | None) -> bool:
        return self.project_id is None or project_id is None or self.project_id == project_id


def _parse_allow(raw) -> frozenset[str]:
    if raw is None:
        return frozenset({ALL_CAPABILITIES})
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(",")]
    return frozenset(p for p in raw if p) or frozenset({ALL_CAPABILITIES})


def load_clients(path: str | None = None, legacy_key: str | None = None) -> list[AgentClient]:
    """Build the client registry: file entries first, then the legacy shared key."""
    clients: list[AgentClient] = []
    if path:
        p = Path(path)
        if not p.exists():
            logger.warning("TEAMWORK_AGENT_CLIENTS_PATH set but %s does not exist", p)
        else:
            try:
                entries = json.loads(p.read_text())
            except Exception as exc:  # noqa: BLE001 - a bad registry must not 500 every request
                logger.error("agent client registry %s is unreadable: %s", p, exc)
                entries = []
            for entry in entries or []:
                name = entry.get("name") or "<unnamed>"
                digest = entry.get("token_sha256") or (
                    _sha256(entry["token"]) if entry.get("token") else None)
                if not digest:
                    logger.warning("agent client %r has no token/token_sha256 — skipped", name)
                    continue
                clients.append(AgentClient(
                    name=name,
                    token_sha256=digest,
                    agent_id=entry.get("agent_id") or None,
                    project_id=entry.get("project_id") or None,
                    allow=_parse_allow(entry.get("allow")),
                    public_key=entry.get("public_key") or None,
                    # A client that published a key defaults to requiring
                    # signatures: having registered one, an unsigned request
                    # from it is more likely a downgrade attack than intent.
                    require_signature=bool(entry.get(
                        "require_signature", bool(entry.get("public_key")))),
                ))
    if legacy_key:
        # Unbound on purpose: the shared key predates per-agent identity and can
        # still speak for anyone. Deployments should migrate to the registry.
        clients.append(AgentClient(name="legacy-shared-key", token_sha256=_sha256(legacy_key),
                                   legacy=True))
    return clients


def resolve_client(presented: str | None, clients: list[AgentClient]) -> AgentClient | None:
    """Resolve a presented token to its client. Every candidate is checked so a
    non-match costs the same as a match (no early-out timing signal)."""
    found: AgentClient | None = None
    for c in clients:
        if c.matches(presented) and found is None:
            found = c
    return found
