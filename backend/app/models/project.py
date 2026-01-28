"""Project model for storing application projects."""

import re
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.agent import Agent
    from app.models.channel import Channel
    from app.models.task import Task


def slugify(text: str) -> str:
    """Convert text to a filesystem-safe slug."""
    # Convert to lowercase
    text = text.lower()
    # Replace spaces and special chars with underscores
    text = re.sub(r'[^a-z0-9]+', '_', text)
    # Remove leading/trailing underscores
    text = text.strip('_')
    # Limit length
    return text[:50] if text else 'project'


class Project(Base):
    """Represents a development project created by a user."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active")
    # Workspace directory name (relative to workspace root)
    workspace_dir: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    
    def get_workspace_dir_name(self) -> str:
        """Get the workspace directory name for this project."""
        # If we have a stored workspace_dir, use it
        if self.workspace_dir:
            return self.workspace_dir
        
        # Check config for naming preference
        config = self.config or {}
        naming = config.get('workspace_naming', 'named')
        
        if naming == 'uuid_only':
            return self.id
        else:
            # Named format: {slug}_{short_uuid}
            slug = slugify(self.name)
            short_id = self.id[:8]
            return f"{slug}_{short_id}"

    # Relationships
    # passive_deletes=True tells SQLAlchemy to let the database CASCADE handle deletes
    agents: Mapped[list["Agent"]] = relationship(
        "Agent", back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    channels: Mapped[list["Channel"]] = relationship(
        "Channel", back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name={self.name})>"
