"""Channel membership — *where* an agent may speak, as opposed to *what* it may do.

Capabilities answer "may this agent post a message". They deliberately say
nothing about **which channel**, so an agent granted ``message.post`` can post
into every channel of every project. With one agent that is invisible. With a
team of agents it is the difference between a research agent answering in
``#research`` and the same agent injecting itself into ``#ops`` mid-incident.

Membership is the missing scope: an agent belongs to channels the way a teammate
does, and — when enforcement is on — may only speak where it belongs.

Humans are modelled here too, with the same row shape. That is the point of the
Buzz idea worth borrowing: *"agents have the same surface area as humans"*. If
membership had been agent-only it would encode agents as second-class occupants
of a channel, and agent↔agent DMs would need a parallel mechanism.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from teamwork.models.base import Base

MEMBER_AGENT = "agent"
MEMBER_HUMAN = "human"

ROLE_MEMBER = "member"
ROLE_OWNER = "owner"


class ChannelMember(Base):
    """One occupant of one channel. Agents and humans share the shape."""

    __tablename__ = "channel_members"
    __table_args__ = (
        # Joining twice is a no-op, not a second seat — and it keeps membership
        # checks unambiguous.
        UniqueConstraint("channel_id", "member_type", "member_id",
                         name="uq_channel_member"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False, index=True)

    member_type: Mapped[str] = mapped_column(String(20), nullable=False)  # agent|human
    # Not a foreign key: a membership row should survive the roster entry it
    # names, so history does not silently lose who was in the room.
    member_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    member_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    role: Mapped[str] = mapped_column(String(20), default=ROLE_MEMBER, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False)

    def __repr__(self) -> str:
        return f"<ChannelMember({self.member_type}:{self.member_id} in {self.channel_id})>"
