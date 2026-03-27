"""WebSocket module for real-time communication."""

from teamwork.websocket.connection_manager import (
    ConnectionManager,
    EventType,
    WebSocketEvent,
    manager,
)

__all__ = ["ConnectionManager", "EventType", "WebSocketEvent", "manager"]
