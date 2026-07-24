"""Channel membership — *where* an agent may speak.

Capabilities gate what an agent may do; they say nothing about which channel. So
an agent with message.post could post into every channel of every project. These
pin the scope, and the back-compatibility rules that make enabling it safe.
"""
from __future__ import annotations

from teamwork.models.channel import Channel
from teamwork.models.channel_member import MEMBER_AGENT, MEMBER_HUMAN, ChannelMember
from teamwork.services.membership import (
    add_member,
    dm_key,
    ensure_dm,
    has_any_members,
    is_member,
    list_members,
    may_post,
    remove_member,
)


async def _channel(db, project_id="p1", name="general", type_="public") -> Channel:
    ch = Channel(project_id=project_id, name=name, type=type_)
    db.add(ch)
    await db.flush()
    return ch


# ── The scope ────────────────────────────────────────────────────────────────

async def test_a_member_may_post_and_a_stranger_may_not(db_session):
    ch = await _channel(db_session)
    await add_member(db_session, channel_id=ch.id, member_id="agent-research",
                     member_name="research", project_id="p1")
    await db_session.commit()

    ok, _ = await may_post(db_session, channel_id=ch.id,
                           agent_id="agent-research", enforce=True)
    assert ok is True

    ok, why = await may_post(db_session, channel_id=ch.id,
                             agent_id="agent-ops", enforce=True)
    assert ok is False and "not a member" in why


# ── Back-compatibility: enabling this must not mute a live deployment ────────

async def test_enforcement_off_lets_anyone_post(db_session):
    ch = await _channel(db_session)
    await add_member(db_session, channel_id=ch.id, member_id="agent-research")
    await db_session.commit()
    ok, _ = await may_post(db_session, channel_id=ch.id,
                           agent_id="agent-ops", enforce=False)
    assert ok is True


async def test_channels_with_no_membership_list_stay_open(db_session):
    # Channels predating membership have no rows. Enforcement must treat them as
    # open, or flipping the flag would silence every existing channel.
    ch = await _channel(db_session)
    await db_session.commit()
    assert await has_any_members(db_session, channel_id=ch.id) is False
    ok, _ = await may_post(db_session, channel_id=ch.id,
                           agent_id="agent-anyone", enforce=True)
    assert ok is True


async def test_system_messages_are_not_scoped_by_membership(db_session):
    ch = await _channel(db_session)
    await add_member(db_session, channel_id=ch.id, member_id="agent-research")
    await db_session.commit()
    ok, _ = await may_post(db_session, channel_id=ch.id, agent_id=None, enforce=True)
    assert ok is True


# ── Membership bookkeeping ───────────────────────────────────────────────────

async def test_joining_twice_is_idempotent_not_a_second_seat(db_session):
    ch = await _channel(db_session)
    a = await add_member(db_session, channel_id=ch.id, member_id="agent-1")
    b = await add_member(db_session, channel_id=ch.id, member_id="agent-1")
    await db_session.commit()
    assert a.id == b.id
    assert len(await list_members(db_session, channel_id=ch.id)) == 1


async def test_humans_and_agents_share_the_same_shape(db_session):
    # The Buzz idea worth borrowing: agents have the same surface area as humans.
    ch = await _channel(db_session)
    await add_member(db_session, channel_id=ch.id, member_id="agent-1",
                     member_type=MEMBER_AGENT)
    await add_member(db_session, channel_id=ch.id, member_id="tj",
                     member_type=MEMBER_HUMAN, member_name="TJ")
    await db_session.commit()
    members = await list_members(db_session, channel_id=ch.id)
    assert {m.member_type for m in members} == {MEMBER_AGENT, MEMBER_HUMAN}
    assert await is_member(db_session, channel_id=ch.id, member_id="tj",
                           member_type=MEMBER_HUMAN)


async def test_removing_a_member_revokes_posting(db_session):
    ch = await _channel(db_session)
    await add_member(db_session, channel_id=ch.id, member_id="agent-1")
    await db_session.commit()

    assert await remove_member(db_session, channel_id=ch.id, member_id="agent-1") is True
    await db_session.commit()
    ok, _ = await may_post(db_session, channel_id=ch.id, agent_id="agent-1", enforce=True)
    # With the list now empty the channel reverts to open — documented behaviour,
    # not an oversight: an empty list means "not configured".
    assert ok is True


async def test_removing_a_nonmember_is_false_not_an_error(db_session):
    ch = await _channel(db_session)
    await db_session.commit()
    assert await remove_member(db_session, channel_id=ch.id, member_id="ghost") is False


async def test_membership_is_per_channel(db_session):
    a = await _channel(db_session, name="research")
    b = await _channel(db_session, name="ops")
    await add_member(db_session, channel_id=a.id, member_id="agent-research")
    await db_session.commit()
    assert await is_member(db_session, channel_id=a.id, member_id="agent-research")
    assert not await is_member(db_session, channel_id=b.id, member_id="agent-research")


# ── Agent-to-agent DMs ───────────────────────────────────────────────────────

def test_dm_key_is_order_independent():
    assert dm_key("a", "b") == dm_key("b", "a")


async def test_opening_a_dm_twice_returns_the_same_channel(db_session):
    first = await ensure_dm(db_session, project_id="p1",
                            agent_a="agent-1", agent_b="agent-2")
    await db_session.commit()
    second = await ensure_dm(db_session, project_id="p1",
                             agent_a="agent-2", agent_b="agent-1")  # reversed
    await db_session.commit()
    assert first.id == second.id


async def test_a_dm_enrols_both_participants(db_session):
    ch = await ensure_dm(db_session, project_id="p1", agent_a="agent-1",
                         agent_b="agent-2", name_a="one", name_b="two")
    await db_session.commit()
    ids = {m.member_id for m in await list_members(db_session, channel_id=ch.id)}
    assert ids == {"agent-1", "agent-2"}
    assert ch.type == "dm"


async def test_a_third_agent_cannot_post_into_someone_elses_dm(db_session):
    ch = await ensure_dm(db_session, project_id="p1", agent_a="agent-1",
                         agent_b="agent-2")
    await db_session.commit()
    ok, why = await may_post(db_session, channel_id=ch.id,
                             agent_id="agent-3", enforce=True)
    assert ok is False and "not a member" in why


# ── The log ──────────────────────────────────────────────────────────────────

async def test_membership_changes_are_recorded_in_the_event_log(db_session):
    from teamwork.services.event_log import read_events, verify_chain

    ch = await _channel(db_session)
    await add_member(db_session, channel_id=ch.id, member_id="agent-1",
                     project_id="p1")
    await remove_member(db_session, channel_id=ch.id, member_id="agent-1",
                        project_id="p1")
    await db_session.commit()

    types = [e.event_type for e in await read_events(db_session, project_id="p1")]
    assert types == ["channel.member_added", "channel.member_removed"]
    assert (await verify_chain(db_session))["ok"] is True
