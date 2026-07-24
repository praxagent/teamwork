"""Joining, leaving and checking channel membership — plus agent↔agent DMs."""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models.channel import Channel
from teamwork.models.channel_member import (
    MEMBER_AGENT,
    ROLE_MEMBER,
    ChannelMember,
)
from teamwork.services.event_log import append_event

logger = logging.getLogger(__name__)


async def add_member(db: AsyncSession, *, channel_id: str, member_id: str,
                     member_type: str = MEMBER_AGENT, member_name: str | None = None,
                     role: str = ROLE_MEMBER, project_id: str | None = None
                     ) -> ChannelMember:
    """Add an occupant. Joining twice returns the existing row rather than erroring."""
    existing = (await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel_id,
            ChannelMember.member_type == member_type,
            ChannelMember.member_id == member_id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    member = ChannelMember(channel_id=channel_id, member_type=member_type,
                           member_id=member_id, member_name=member_name, role=role)
    db.add(member)
    await db.flush()
    await append_event(
        db, event_type="channel.member_added", actor_type=member_type,
        actor_id=member_id, actor_name=member_name, project_id=project_id,
        subject_id=channel_id, payload={"role": role})
    return member


async def remove_member(db: AsyncSession, *, channel_id: str, member_id: str,
                        member_type: str = MEMBER_AGENT,
                        project_id: str | None = None) -> bool:
    row = (await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel_id,
            ChannelMember.member_type == member_type,
            ChannelMember.member_id == member_id,
        )
    )).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    await append_event(
        db, event_type="channel.member_removed", actor_type=member_type,
        actor_id=member_id, project_id=project_id, subject_id=channel_id)
    return True


async def list_members(db: AsyncSession, *, channel_id: str) -> list[ChannelMember]:
    return list((await db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == channel_id)
        .order_by(ChannelMember.joined_at.asc())
    )).scalars().all())


async def is_member(db: AsyncSession, *, channel_id: str, member_id: str,
                    member_type: str = MEMBER_AGENT) -> bool:
    return (await db.execute(
        select(ChannelMember.id).where(
            ChannelMember.channel_id == channel_id,
            ChannelMember.member_type == member_type,
            ChannelMember.member_id == member_id,
        ).limit(1)
    )).scalar_one_or_none() is not None


async def has_any_members(db: AsyncSession, *, channel_id: str) -> bool:
    """Whether membership has been configured for this channel at all.

    Channels that predate membership have no rows, and enforcement treats them as
    open — otherwise switching the flag on would silence every existing channel.
    """
    return (await db.execute(
        select(ChannelMember.id).where(ChannelMember.channel_id == channel_id).limit(1)
    )).scalar_one_or_none() is not None


async def may_post(db: AsyncSession, *, channel_id: str, agent_id: str | None,
                   enforce: bool) -> tuple[bool, str]:
    """May *agent_id* post into this channel? ``(ok, reason)``.

    Open by default. Enforcement is opt-in, and even then only bites on channels
    that actually declare a membership list — so turning it on cannot mute an
    existing deployment that never configured one.
    """
    if not enforce:
        return True, ""
    if agent_id is None:
        return True, ""                      # system/human messages are not scoped here
    if not await has_any_members(db, channel_id=channel_id):
        return True, ""
    if await is_member(db, channel_id=channel_id, member_id=agent_id):
        return True, ""
    return False, "this agent is not a member of that channel"


def dm_key(a: str, b: str) -> str:
    """Order-independent identity for a pair, so A→B and B→A are one DM."""
    return ",".join(sorted([a, b]))


async def ensure_dm(db: AsyncSession, *, project_id: str, agent_a: str, agent_b: str,
                    name_a: str | None = None, name_b: str | None = None) -> Channel:
    """Find or create the direct channel between two participants.

    Agent↔agent DMs are the same object as human↔agent ones. A team of agents
    that can only talk in public channels either floods them with coordination
    chatter or coordinates invisibly through the orchestrator; a DM is where two
    agents settle something without an audience — still fully in the event log.
    """
    key = dm_key(agent_a, agent_b)
    existing = (await db.execute(
        select(Channel).where(Channel.project_id == project_id,
                              Channel.type == "dm",
                              Channel.dm_participants == key)
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    channel = Channel(project_id=project_id, name=f"dm-{key}", type="dm",
                      dm_participants=key,
                      description="Direct messages")
    db.add(channel)
    await db.flush()
    for member_id, member_name in ((agent_a, name_a), (agent_b, name_b)):
        await add_member(db, channel_id=channel.id, member_id=member_id,
                         member_name=member_name, project_id=project_id)
    await append_event(db, event_type="channel.dm_created", actor_type="system",
                       project_id=project_id, subject_id=channel.id,
                       payload={"participants": key})
    return channel
