"""WebSocket module for real-time communication."""

from app.websocket.connection_manager import (
    ConnectionManager,
    EventType,
    WebSocketEvent,
    manager,
)

__all__ = ["ConnectionManager", "EventType", "WebSocketEvent", "manager"]
