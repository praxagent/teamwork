"""UI-facing MCP endpoints: is it on, and what do I paste where.

Separate from the MCP transport itself and always mounted, so the UI can say
"MCP is off" rather than getting a 404 it has to interpret. The transport
mounts only when enabled; a status endpoint that disappeared with it would make
"off" and "broken" look the same.

Nothing here returns a token. The skill text gets pasted into repos, chat
windows and issue threads, and a document that carries a live credential will
eventually land somewhere it should not. The user already has the token — they
put it in the registry — so the skill carries a placeholder and says so.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from teamwork import agent_registry, mcp_skill
from teamwork.agent_auth import load_clients
from teamwork.config import settings
from teamwork.mcp_server import mcp_is_available

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _server_url(request: Request) -> str:
    """The MCP URL as reachable from where the user is actually browsing.

    Derived from the request rather than configured, for the same reason the
    Grafana deep-link is: a backend that knows itself as ``localhost:8000``
    hands a tailnet or phone user an address that cannot work, and the failure
    looks like a broken feature rather than a wrong URL.
    """
    return str(request.base_url).rstrip("/") + "/mcp"


@router.get("/status")
async def mcp_status(request: Request, space: str | None = None) -> dict:
    """Whether MCP is usable, and for this space specifically.

    Reports the two gates separately. "Enabled but nothing granted" is a real
    state a user lands in — they flip the flag and expect it to work — and
    telling them it is simply "off" would send them to fix the wrong thing.
    """
    enabled = bool(getattr(settings, "mcp_enabled", False))
    clients = load_clients(getattr(settings, "agent_clients_path", "") or None,
                           getattr(settings, "external_api_key", "") or None)
    granted = [c for c in clients if c.mcp]

    keys = [
        {
            "name": c.name,
            # A key with no spaces reaches everything, which is worth saying out
            # loud next to one that is scoped.
            "spaces": sorted(c.spaces) if c.spaces else [],
            "scoped": bool(c.spaces),
            "capabilities": sorted(c.allow) if c.allow else [],
        }
        for c in granted
        if space is None or c.may_touch_space(space)
    ]

    return {
        "available": mcp_is_available(),
        "enabled": enabled,
        "granted": space in agent_registry.granted_spaces() if space else False,
        "registry_path": str(agent_registry.registry_path()),
        "granted_keys": len(granted),
        "keys_for_space": keys,
        "server_url": _server_url(request),
        # Distinguishes "turn the flag on" from "grant a key" in the UI.
        "reason": (
            None if mcp_is_available()
            else "MCP_ENABLED is not set"
            if not enabled
            else 'MCP is enabled but no credential is granted "mcp": true'
        ),
    }


@router.post("/spaces/{space}/enable")
async def enable_for_space(space: str, request: Request,
                           label: str | None = None) -> dict:
    """Mint a key scoped to this space and record it.

    This exists so nobody has to hand-author a credential file. Re-enabling an
    already-enabled space **rotates** the key — the registry stores only a hash,
    so there is no plaintext to hand back, and pretending otherwise would be the
    dishonest answer to "I lost my token".
    """
    try:
        result = agent_registry.grant_space(space, label=label)
    except agent_registry.RegistryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    url = _server_url(request)
    return {
        **result,
        "server_url": url,
        # Shown once, with the token in it, because this is the one moment the
        # user has the token. The SKILL still ships a placeholder — it gets
        # pasted into repos, and this does not.
        "connect": mcp_skill.connection_snippet(
            server_url=url, token_hint=result["token"]),
        "warning": ("This token is shown once. It is stored only as a hash, so "
                    "it cannot be recovered — re-enable to issue a new one."),
        "needs_restart": not bool(getattr(settings, "mcp_enabled", False)),
    }


@router.delete("/spaces/{space}/enable")
async def disable_for_space(space: str) -> dict:
    """Revoke this space's key. Any other client in the file is left alone."""
    try:
        return agent_registry.revoke_space(space)
    except agent_registry.RegistryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/skill")
async def mcp_skill_for_space(request: Request, space: str,
                              space_name: str | None = None) -> dict:
    """The paste-ready skill for one space.

    Generated per space rather than offered as a template with a blank to fill
    in: that blank is a step someone skips, and a skill naming the wrong space
    writes into the wrong space without complaining.
    """
    return {
        "space": space,
        "filename": f"{mcp_skill.SKILL_NAME}.md",
        "skill": mcp_skill.skill_markdown(
            space=space, space_name=space_name, server_url=_server_url(request)),
        "connect": mcp_skill.connection_snippet(server_url=_server_url(request)),
        # Said explicitly so the UI can warn rather than let someone paste a
        # placeholder into their config and wonder why it 401s.
        "token_included": False,
    }
