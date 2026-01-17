"""Agent model for storing AI team members."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.activity import ActivityLog
    from app.models.message import Message
    from app.models.project import Project
    from app.models.task import Task


class Agent(Base):
    """Represents an AI agent (team member) in the virtual dev team."""

    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)  # pm, developer, qa
    team: Mapped[str | None] = mapped_column(String(100), nullable=True)
    soul_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    skills_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    profile_image_type: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # selfie, pet, vacation, etc.
    persona: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    session_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )  # Claude Code session for continuity
    status: Mapped[str] = mapped_column(
        String(50), default="idle"
    )  # idle, working, offline
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="agents")
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="agent", cascade="all, delete-orphan"
    )
    assigned_tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="assigned_agent", foreign_keys="Task.assigned_to"
    )
    activities: Mapped[list["ActivityLog"]] = relationship(
        "ActivityLog", back_populates="agent", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Agent(id={self.id}, name={self.name}, role={self.role})>"
