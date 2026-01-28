"""Channel model for chat channels and DMs."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.message import Message
    from app.models.project import Project


class Channel(Base):
    """Represents a chat channel or DM thread."""

    __tablename__ = "channels"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="public"
    )  # public, team, dm
    team: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )  # null for public channels
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # For DMs, store the participant IDs as comma-separated string
    dm_participants: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    # passive_deletes=True tells SQLAlchemy to let the database CASCADE handle deletes
    project: Mapped["Project"] = relationship("Project", back_populates="channels")
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="channel", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Channel(id={self.id}, name={self.name}, type={self.type})>"
