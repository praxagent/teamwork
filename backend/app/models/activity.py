"""Activity log model for tracking agent actions."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.agent import Agent


class ActivityLog(Base):
    """Tracks all agent activities for the activity trace feature."""

    __tablename__ = "activity_log"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    agent_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agents.id"), nullable=False
    )
    activity_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # task_started, file_edited, commit, message, thinking, tool_use
    description: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True
    )  # files, commit hash, etc.
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    agent: Mapped["Agent"] = relationship("Agent", back_populates="activities")

    def __repr__(self) -> str:
        return f"<ActivityLog(id={self.id}, type={self.activity_type})>"
