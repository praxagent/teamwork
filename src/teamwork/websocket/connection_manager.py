"""WebSocket connection manager for real-time updates."""

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

from fastapi import WebSocket


class EventType(str, Enum):
    """Types of WebSocket events."""

    MESSAGE_NEW = "message:new"
    MESSAGE_UPDATE = "message:update"
    AGENT_STATUS = "agent:status"
    AGENT_ACTIVITY = "agent:activity"
    AGENT_TYPING = "agent:typing"  # Typing indicator
    TASK_UPDATE = "task:update"
    TASK_NEW = "task:new"
    PROJECT_UPDATE = "project:update"
    CHANNEL_NEW = "channel:new"
    ERROR = "error"
    CONNECTED = "connected"


@dataclass
class WebSocketEvent:
    """Represents a WebSocket event to be sent to clients."""

    type: EventType
    data: dict[str, Any]
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    project_id: str | None = None
    channel_id: str | None = None

    def to_json(self) -> str:
        """Serialize the event to JSON."""
        return json.dumps(
            {
                "type": self.type.value,
                "data": self.data,
                "timestamp": self.timestamp,
                "projectId": self.project_id,
                "channelId": self.channel_id,
            }
        )


class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""

    def __init__(self) -> None:
        # Map of project_id -> set of connections
        self._project_connections: dict[str, set[WebSocket]] = defaultdict(set)
        # Map of channel_id -> set of connections
        self._channel_connections: dict[str, set[WebSocket]] = defaultdict(set)
        # All active connections
        self._active_connections: set[WebSocket] = set()
        # Map of websocket -> subscribed project_ids
        self._connection_projects: dict[WebSocket, set[str]] = defaultdict(set)
        # Map of websocket -> subscribed channel_ids
        self._connection_channels: dict[WebSocket, set[str]] = defaultdict(set)

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket connection."""
        await websocket.accept()
        self._active_connections.add(websocket)
        # Send connection confirmation
        event = WebSocketEvent(type=EventType.CONNECTED, data={"status": "connected"})
        await websocket.send_text(event.to_json())

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        self._active_connections.discard(websocket)
        # Remove from all project subscriptions
        for project_id in self._connection_projects.get(websocket, set()):
            self._project_connections[project_id].discard(websocket)
        # Remove from all channel subscriptions
        for channel_id in self._connection_channels.get(websocket, set()):
            self._channel_connections[channel_id].discard(websocket)
        # Clean up connection tracking
        self._connection_projects.pop(websocket, None)
        self._connection_channels.pop(websocket, None)

    def subscribe_to_project(self, websocket: WebSocket, project_id: str) -> None:
        """Subscribe a connection to a project's updates."""
        self._project_connections[project_id].add(websocket)
        self._connection_projects[websocket].add(project_id)

    def unsubscribe_from_project(self, websocket: WebSocket, project_id: str) -> None:
        """Unsubscribe a connection from a project's updates."""
        self._project_connections[project_id].discard(websocket)
        self._connection_projects[websocket].discard(project_id)

    def subscribe_to_channel(self, websocket: WebSocket, channel_id: str) -> None:
        """Subscribe a connection to a channel's updates."""
        self._channel_connections[channel_id].add(websocket)
        self._connection_channels[websocket].add(channel_id)

    def unsubscribe_from_channel(self, websocket: WebSocket, channel_id: str) -> None:
        """Unsubscribe a connection from a channel's updates."""
        self._channel_connections[channel_id].discard(websocket)
        self._connection_channels[websocket].discard(channel_id)

    async def send_to_connection(
        self, websocket: WebSocket, event: WebSocketEvent
    ) -> None:
        """Send an event to a specific connection."""
        try:
            await websocket.send_text(event.to_json())
        except Exception:
            # Connection might be closed
            self.disconnect(websocket)

    async def broadcast_to_project(
        self, project_id: str, event: WebSocketEvent
    ) -> None:
        """Broadcast an event to all connections subscribed to a project."""
        event.project_id = project_id
        dead_connections: list[WebSocket] = []
        for websocket in self._project_connections.get(project_id, set()):
            try:
                await websocket.send_text(event.to_json())
            except Exception:
                dead_connections.append(websocket)
        # Clean up dead connections
        for ws in dead_connections:
            self.disconnect(ws)

    async def broadcast_to_channel(
        self, channel_id: str, event: WebSocketEvent
    ) -> None:
        """Broadcast an event to all connections subscribed to a channel."""
        event.channel_id = channel_id
        dead_connections: list[WebSocket] = []
        for websocket in self._channel_connections.get(channel_id, set()):
            try:
                await websocket.send_text(event.to_json())
            except Exception:
                dead_connections.append(websocket)
        # Clean up dead connections
        for ws in dead_connections:
            self.disconnect(ws)

    async def broadcast_all(self, event: WebSocketEvent) -> None:
        """Broadcast an event to all active connections."""
        dead_connections: list[WebSocket] = []
        for websocket in self._active_connections:
            try:
                await websocket.send_text(event.to_json())
            except Exception:
                dead_connections.append(websocket)
        # Clean up dead connections
        for ws in dead_connections:
            self.disconnect(ws)

    @property
    def active_connection_count(self) -> int:
        """Get the number of active connections."""
        return len(self._active_connections)


# Global connection manager instance
manager = ConnectionManager()
