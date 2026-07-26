"""The MCP transport: one authenticated ``POST /mcp`` endpoint.

Mounted only when :func:`mcp_is_available` says so, which needs both the
deployment flag *and* at least one credential granted MCP. An un-mounted route
404s, so a deployment that has not turned this on does not answer probes for it.

Authentication reuses the same dependency the REST agent API uses, so a
credential behaves identically over both: same token, same optional Ed25519
signature, same identity. MCP is a protocol this server speaks, not a second
way in.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork import mcp_server
from teamwork.agent_auth import AgentClient
from teamwork.models import get_db
from teamwork.routers.external import _verify_api_key
from teamwork.websocket import EventType, WebSocketEvent, manager

router = APIRouter(tags=["mcp"])
logger = logging.getLogger(__name__)


def _comment_poster(request: Request, db: AsyncSession, client: AgentClient):
    """Hand the tool layer a way to post a channel message.

    Rather than re-implement posting, this calls the existing external endpoint
    function, so membership enforcement, the audit event and the websocket
    broadcast all happen exactly once in exactly one place. A second copy would
    drift, and the copy that drifts is the one without the membership check.
    """
    async def post(*, project_id: str, channel_id: str, content: str) -> Any:
        from teamwork.routers.external import ExternalMessage, send_external_message

        try:
            return await send_external_message(
                project_id=project_id,
                request=ExternalMessage(channel_id=channel_id, content=content),
                http_request=request, db=db, api_key=client)
        except HTTPException as exc:
            raise mcp_server.McpError(f"{exc.detail}") from exc

    return post


def _change_announcer():
    """Tell every open browser that a Library space changed.

    The Kanban and note queries do not poll, so a write that did not come from
    the UI was invisible until someone reloaded — which is exactly what an agent
    working in the background produces. Broadcast to all: a Library space is not
    scoped to a project on the TeamWork side, and a client that does not care
    ignores an event it has no query for.
    """
    async def announce(*, space: str | None, tool: str) -> None:
        await manager.broadcast_all(WebSocketEvent(
            type=EventType.LIBRARY_UPDATE,
            data={"space": space, "tool": tool, "source": "mcp"},
        ))

    return announce


@router.post("/mcp")
async def mcp_endpoint(
    request: Request,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    client: AgentClient = Depends(_verify_api_key),
) -> Any:
    """One JSON-RPC request or a batch of them."""
    if isinstance(payload, list):
        responses = [await mcp_server.handle_request(
            client, item, post_comment=_comment_poster(request, db, client),
            on_change=_change_announcer())
            for item in payload]
        return [r for r in responses if r is not None]

    result = await mcp_server.handle_request(
        client, payload, post_comment=_comment_poster(request, db, client),
        on_change=_change_announcer())
    if result is None:
        return {}                       # notification: acknowledged, no body
    return result
