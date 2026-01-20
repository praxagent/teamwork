"""Task model for project tasks and subtasks."""

import json
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.agent import Agent
    from app.models.project import Project


class Task(Base):
    """Represents a development task assigned to the team."""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    team: Mapped[str | None] = mapped_column(String(100), nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("agents.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(50), default="pending"
    )  # pending, in_progress, blocked, review, completed
    priority: Mapped[int] = mapped_column(Integer, default=0)
    parent_task_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tasks.id"), nullable=True
    )
    # JSON array of task IDs that this task depends on
    blocked_by_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default="[]"
    )
    # Git commit tracking for code changes
    start_commit: Mapped[str | None] = mapped_column(
        String(40), nullable=True
    )  # Git commit hash when task started
    end_commit: Mapped[str | None] = mapped_column(
        String(40), nullable=True
    )  # Git commit hash when task completed
    retry_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )  # Number of times this task has been retried
    last_error: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # Last error message if task failed
    config: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, default=None
    )  # Extra task metadata (task_type, complexity, dependencies, etc.)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    
    @property
    def blocked_by(self) -> list[str]:
        """Get list of task IDs this task is blocked by."""
        if not self.blocked_by_json:
            return []
        try:
            return json.loads(self.blocked_by_json)
        except (json.JSONDecodeError, TypeError):
            return []
    
    @blocked_by.setter
    def blocked_by(self, value: list[str]) -> None:
        """Set the list of blocking task IDs."""
        self.blocked_by_json = json.dumps(value) if value else "[]"

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="tasks")
    assigned_agent: Mapped["Agent | None"] = relationship(
        "Agent", back_populates="assigned_tasks", foreign_keys=[assigned_to]
    )
    subtasks: Mapped[list["Task"]] = relationship(
        "Task",
        backref="parent_task",
        remote_side=[id],
        foreign_keys=[parent_task_id],
    )

    def __repr__(self) -> str:
        return f"<Task(id={self.id}, title={self.title[:30]}, status={self.status})>"
