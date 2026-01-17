"""Message model for chat messages."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.agent import Agent
    from app.models.channel import Channel


class Message(Base):
    """Represents a chat message in a channel or DM."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    channel_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("channels.id"), nullable=False
    )
    agent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("agents.id"), nullable=True
    )  # null if from user (CEO)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(
        String(50), default="chat"
    )  # chat, status_update, task_update, system
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Thread support
    thread_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("messages.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    channel: Mapped["Channel"] = relationship("Channel", back_populates="messages")
    agent: Mapped["Agent | None"] = relationship("Agent", back_populates="messages")
    # Thread replies
    replies: Mapped[list["Message"]] = relationship(
        "Message",
        backref="parent_message",
        remote_side=[id],
        foreign_keys=[thread_id],
    )

    def __repr__(self) -> str:
        sender = self.agent_id or "CEO"
        return f"<Message(id={self.id}, sender={sender})>"
