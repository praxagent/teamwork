"""Channels API router."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from teamwork.models import Channel, Message, Project, get_db
from teamwork.websocket import manager, WebSocketEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/channels", tags=["channels"])


class ChannelCreate(BaseModel):
    """Schema for creating a channel."""

    project_id: str
    name: str
    type: str = "public"  # public, team, dm
    team: str | None = None
    description: str | None = None
    dm_participants: str | None = None  # Comma-separated agent IDs for DMs


class ChannelResponse(BaseModel):
    """Schema for channel response."""

    id: str
    project_id: str
    name: str
    type: str
    team: str | None
    description: str | None
    dm_participants: str | None
    created_at: str

    class Config:
        from_attributes = True


class ChannelListResponse(BaseModel):
    """Schema for list of channels."""

    channels: list[ChannelResponse]
    total: int


def channel_to_response(channel: Channel) -> ChannelResponse:
    """Convert Channel model to response schema."""
    return ChannelResponse(
        id=channel.id,
        project_id=channel.project_id,
        name=channel.name,
        type=channel.type,
        team=channel.team,
        description=channel.description,
        dm_participants=channel.dm_participants,
        created_at=channel.created_at.isoformat(),
    )


@router.get("", response_model=ChannelListResponse)
async def list_channels(
    db: AsyncSession = Depends(get_db),
    project_id: str | None = None,
    type: str | None = None,
    team: str | None = None,
) -> ChannelListResponse:
    """List channels, optionally filtered."""
    import logging
    import uuid
    from sqlalchemy import text
    logger = logging.getLogger(__name__)
    
    query = select(Channel)

    if project_id:
        query = query.where(Channel.project_id == project_id)
    if type:
        query = query.where(Channel.type == type)
    if team:
        query = query.where(Channel.team == team)

    result = await db.execute(query.order_by(Channel.created_at))
    channels = list(result.scalars().all())
    
    # Auto-create default channels for projects missing them
    if project_id and not type:  # Only when fetching all channels for a project
        # Check if project has any public or team channels
        has_public_channels = any(ch.type in ('public', 'team') for ch in channels)
        
        if not has_public_channels:
            # Check if user deliberately deleted channels (future feature)
            from teamwork.models import Project, Agent
            project_result = await db.execute(select(Project).where(Project.id == project_id))
            project = project_result.scalar_one_or_none()
            
            if project:
                config = project.config or {}
                
                # Don't auto-create if user has explicitly deleted channels
                if not config.get("channels_initialized_deleted", False):
                    logger.info(f"[Channels] Project {project_id} missing public channels, creating defaults...")
                    
                    # Get team names from agents
                    agents_result = await db.execute(select(Agent).where(Agent.project_id == project_id))
                    agents = agents_result.scalars().all()
                    teams = set(a.team for a in agents if a.team)
                    
                    # Default channels to create
                    default_channels = [
                        ("general", "public", None, "General project updates and announcements"),
                        ("random", "public", None, "Off-topic discussions and team bonding"),
                    ]
                    
                    # Add team channels
                    for team_name in teams:
                        default_channels.append(
                            (team_name.lower().replace(" ", "-"), "team", team_name, f"{team_name} team discussions")
                        )
                    
                    # Create channels using raw SQL (more reliable)
                    created_channels = []
                    for name, channel_type, team_val, description in default_channels:
                        channel_id = str(uuid.uuid4())
                        try:
                            await db.execute(
                                text("""
                                    INSERT INTO channels (id, project_id, name, type, team, description, created_at)
                                    VALUES (:id, :project_id, :name, :type, :team, :description, datetime('now'))
                                """),
                                {
                                    "id": channel_id,
                                    "project_id": project_id,
                                    "name": name,
                                    "type": channel_type,
                                    "team": team_val,
                                    "description": description,
                                }
                            )
                            logger.info(f"[Channels] Created channel: {name} (type={channel_type})")
                            
                            # Create a response object for the new channel
                            created_channels.append(Channel(
                                id=channel_id,
                                project_id=project_id,
                                name=name,
                                type=channel_type,
                                team=team_val,
                                description=description,
                            ))
                        except Exception as e:
                            logger.error(f"[Channels] Failed to create channel {name}: {e}")
                    
                    await db.commit()
                    
                    # Mark project as having channels initialized
                    config["channels_initialized"] = True
                    project.config = config
                    await db.commit()
                    
                    # Prepend created channels to the list
                    channels = created_channels + channels
                    logger.info(f"[Channels] Created {len(created_channels)} default channels for project {project_id}")
    
    logger.info(f"[Channels] Returning {len(channels)} channels for project {project_id}")

    return ChannelListResponse(
        channels=[channel_to_response(c) for c in channels],
        total=len(channels),
    )


@router.post("", response_model=ChannelResponse, status_code=201)
async def create_channel(
    channel: ChannelCreate,
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    """Create a new channel."""
    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == channel.project_id)
    )
    if not project_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    db_channel = Channel(
        project_id=channel.project_id,
        name=channel.name,
        type=channel.type,
        team=channel.team,
        description=channel.description,
        dm_participants=channel.dm_participants,
    )
    db.add(db_channel)
    await db.flush()
    await db.refresh(db_channel)

    # Broadcast channel creation
    await manager.broadcast_to_project(
        channel.project_id,
        WebSocketEvent(
            type=EventType.CHANNEL_NEW,
            data={
                "channel_id": db_channel.id,
                "name": db_channel.name,
                "type": db_channel.type,
            },
        ),
    )

    return channel_to_response(db_channel)


@router.post("/dm/{agent_id}", response_model=ChannelResponse)
async def get_or_create_dm_channel(
    agent_id: str,
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    """Get or create a DM channel with an agent."""
    from teamwork.models import Agent

    # Verify agent exists
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check if DM channel already exists
    dm_result = await db.execute(
        select(Channel).where(
            Channel.project_id == project_id,
            Channel.type == "dm",
            Channel.dm_participants == agent_id,
        ).limit(1)
    )
    existing_dm = dm_result.scalar_one_or_none()

    if existing_dm:
        return channel_to_response(existing_dm)

    # Create new DM channel
    dm_channel = Channel(
        project_id=project_id,
        name=f"dm-{agent.name.lower().replace(' ', '-')}",
        type="dm",
        description=f"Direct message with {agent.name}",
        dm_participants=agent_id,
    )
    db.add(dm_channel)
    await db.flush()
    await db.refresh(dm_channel)
    await db.commit()

    return channel_to_response(dm_channel)


class PanelChannelRequest(BaseModel):
    """Schema for getting/creating a panel channel."""

    project_id: str
    panel: str  # browser, desktop, terminal, files


@router.post("/panels/get-or-create", response_model=ChannelResponse)
async def get_or_create_panel_channel(
    req: PanelChannelRequest,
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    """Get or create a dedicated channel for a workspace panel.

    Panel channels have a fixed slug like 'panel-browser-{project_id[:8]}'
    so they're reusable across sessions.
    """
    VALID_PANELS = {"browser", "desktop", "terminal", "files"}
    if req.panel not in VALID_PANELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid panel: {req.panel}. Must be one of {sorted(VALID_PANELS)}",
        )

    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == req.project_id)
    )
    if not project_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Deterministic channel name so it's idempotent
    channel_name = f"panel-{req.panel}-{req.project_id[:8]}"

    # Look for existing panel channel
    result = await db.execute(
        select(Channel).where(
            Channel.project_id == req.project_id,
            Channel.type == "panel",
            Channel.name == channel_name,
        ).limit(1)
    )
    existing = result.scalar_one_or_none()

    if existing:
        return channel_to_response(existing)

    # Create new panel channel
    panel_labels = {
        "browser": "Browser Chat",
        "desktop": "Desktop Chat",
        "terminal": "Terminal Chat",
        "files": "Files Chat",
    }
    panel_channel = Channel(
        project_id=req.project_id,
        name=channel_name,
        type="panel",
        description=panel_labels.get(req.panel, f"{req.panel.title()} Chat"),
    )
    db.add(panel_channel)
    await db.flush()
    await db.refresh(panel_channel)
    await db.commit()

    logger.info("Created panel channel %s for project %s", channel_name, req.project_id)

    return channel_to_response(panel_channel)


@router.delete("/{channel_id}/messages", status_code=204)
async def clear_channel_messages(
    channel_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete all messages in a channel (reset conversation).

    The channel itself is preserved — only messages are removed.
    """
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    await db.execute(sa_delete(Message).where(Message.channel_id == channel_id))
    await db.commit()

    logger.info("Cleared all messages in channel %s (%s)", channel.name, channel_id)

    # Broadcast so other clients refresh
    await manager.broadcast_to_project(
        channel.project_id,
        WebSocketEvent(
            type=EventType.CHANNEL_NEW,  # reuse — frontend refreshes
            data={"channel_id": channel.id, "name": channel.name, "type": channel.type},
        ),
    )


@router.get("/{channel_id}", response_model=ChannelResponse)
async def get_channel(
    channel_id: str,
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    """Get a channel by ID."""
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()

    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    return channel_to_response(channel)


class ChannelUpdate(BaseModel):
    """Schema for renaming / updating a channel."""
    name: str | None = None
    description: str | None = None
    archived: bool | None = None


@router.patch("/{channel_id}", response_model=ChannelResponse)
async def update_channel(
    channel_id: str,
    update: ChannelUpdate,
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    """Update a channel (rename, change description, archive/unarchive)."""
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    if update.name is not None:
        channel.name = update.name
    if update.description is not None:
        channel.description = update.description

    await db.flush()
    await db.refresh(channel)

    # Broadcast update
    await manager.broadcast_to_project(
        channel.project_id,
        WebSocketEvent(
            type=EventType.CHANNEL_NEW,  # reuse — frontend refreshes channel list
            data={"channel_id": channel.id, "name": channel.name, "type": channel.type},
        ),
    )

    return channel_to_response(channel)


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: str,
    purge_messages: bool = Query(default=True, description="Also delete all messages in the channel"),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a channel. Optionally purge all messages (default: true)."""
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    if purge_messages:
        await db.execute(sa_delete(Message).where(Message.channel_id == channel_id))
        logger.info("Purged messages for channel %s (%s)", channel.name, channel_id)

    await db.delete(channel)
