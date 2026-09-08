"""``DELETE /api/projects/{id}`` must take the project's children with it.

The models said ``passive_deletes=True`` ("the database cascades"), but
``PRAGMA foreign_keys`` was never turned on and the child foreign keys declared
no ``ON DELETE`` action — so SQLite cascaded nothing and every agent, channel,
task and message of a deleted project stayed behind as orphans.

Three layers are pinned here: enforcement is ON for every connection the app
engine opens, the current models cascade end to end through the HTTP API, and
an existing database whose foreign keys predate the actions is rebuilt in
place — idempotently, with rows and rowids preserved.
"""
from __future__ import annotations

import re

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateTable

from teamwork.models.base import (
    Base,
    _migrate_fts5,
    enable_sqlite_foreign_keys,
    migrate_foreign_key_actions,
)

# ── Enforcement is on ────────────────────────────────────────────────────────

async def _pragma(engine, name: str):
    async with engine.connect() as conn:
        return (await conn.exec_driver_sql(f"PRAGMA {name}")).scalar()


async def test_engines_with_the_hook_enforce_foreign_keys():
    plain = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                connect_args={"check_same_thread": False})
    hooked = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    enable_sqlite_foreign_keys(hooked)
    try:
        assert await _pragma(plain, "foreign_keys") == 0    # SQLite's default: off
        assert await _pragma(hooked, "foreign_keys") == 1
    finally:
        await plain.dispose()
        await hooked.dispose()


async def test_the_app_engine_enforces_foreign_keys():
    from teamwork.models.base import engine
    assert await _pragma(engine, "foreign_keys") == 1


# ── The API: delete_project zeroes the children ─────────────────────────────

def _populated_project(client) -> dict:
    pid = client.post("/api/projects", json={"name": "Doomed"}).json()["id"]
    ch = client.post("/api/channels", json={"project_id": pid, "name": "general"}).json()["id"]
    agent = client.post("/api/agents", json={"project_id": pid, "name": "Bot", "role": "dev"}).json()["id"]
    task = client.post("/api/tasks", json={"project_id": pid, "title": "t", "assigned_to": agent}).json()["id"]
    sub = client.post("/api/tasks", json={"project_id": pid, "title": "sub", "parent_task_id": task}).json()["id"]
    human_msg = client.post("/api/messages", json={"channel_id": ch, "content": "hi"}).json()["id"]
    agent_msg = client.post("/api/messages", json={"channel_id": ch, "content": "yo",
                                                   "agent_id": agent, "thread_id": human_msg}).json()["id"]
    return {"pid": pid, "channel": ch, "agent": agent, "task": task, "subtask": sub,
            "messages": [human_msg, agent_msg]}


def test_delete_project_zeroes_agents_channels_tasks_and_messages(client):
    ids = _populated_project(client)
    # Sanity: everything exists before the delete.
    assert client.get(f"/api/channels/{ids['channel']}").status_code == 200
    assert client.get(f"/api/agents/{ids['agent']}").status_code == 200
    assert client.get(f"/api/tasks/{ids['task']}").status_code == 200

    assert client.delete(f"/api/projects/{ids['pid']}").status_code == 204

    assert client.get(f"/api/projects/{ids['pid']}").status_code == 404
    # Old code: every one of these still answered 200 — orphaned, not deleted.
    assert client.get(f"/api/channels/{ids['channel']}").status_code == 404
    assert client.get(f"/api/agents/{ids['agent']}").status_code == 404
    assert client.get(f"/api/tasks/{ids['task']}").status_code == 404
    assert client.get(f"/api/tasks/{ids['subtask']}").status_code == 404
    for mid in ids["messages"]:
        assert client.get(f"/api/messages/{mid}").status_code == 404


def test_delete_project_appends_an_event_and_leaves_the_chain_intact(client):
    ids = _populated_project(client)
    client.delete(f"/api/projects/{ids['pid']}")
    events = client.get(f"/api/external/projects/{ids['pid']}/events").json()["events"]
    deleted = [e for e in events if e["event_type"] == "project.deleted"]
    assert deleted and deleted[0]["actor_type"] == "internal"
    assert client.get("/api/external/events/verify").json()["ok"] is True


def test_deleting_an_agent_unassigns_its_tasks_rather_than_deleting_them(client):
    ids = _populated_project(client)
    assert client.delete(f"/api/agents/{ids['agent']}").status_code == 204
    task = client.get(f"/api/tasks/{ids['task']}")
    assert task.status_code == 200 and task.json()["assigned_to"] is None


# ── Existing databases: the rebuild ──────────────────────────────────────────

def _old_schema_ddl(dialect) -> list[str]:
    """The current models' DDL with every ON DELETE action stripped — i.e. what
    ``create_all`` produced before the actions were declared."""
    out = []
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=dialect))
        out.append(re.sub(r"\s+ON DELETE (SET NULL|CASCADE)", "", ddl))
    return out


@pytest.fixture
async def old_db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'legacy.db'}"
    engine = create_async_engine(url, poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    enable_sqlite_foreign_keys(engine)
    async with engine.begin() as conn:
        for ddl in _old_schema_ddl(conn.dialect):
            await conn.exec_driver_sql(ddl)
        await _migrate_fts5(conn)
        await conn.exec_driver_sql(
            "INSERT INTO projects (id, name, description, status, config, created_at, updated_at) "
            "VALUES ('p1', 'P', '', 'active', '{}', '2026-01-01', '2026-01-01')")
        await conn.exec_driver_sql(
            "INSERT INTO agents (id, project_id, name, role, status, created_at) "
            "VALUES ('a1', 'p1', 'Bot', 'dev', 'idle', '2026-01-01')")
        await conn.exec_driver_sql(
            "INSERT INTO channels (id, project_id, name, type, created_at) "
            "VALUES ('c1', 'p1', 'general', 'public', '2026-01-01')")
        for i in range(3):
            await conn.exec_driver_sql(
                "INSERT INTO messages (id, channel_id, agent_id, content, message_type, created_at) "
                f"VALUES ('m{i}', 'c1', 'a1', 'hello {i}', 'chat', '2026-01-01')")
        await conn.exec_driver_sql(
            "INSERT INTO tasks (id, project_id, title, assigned_to, status, priority, "
            "retry_count, created_at, updated_at) "
            "VALUES ('t1', 'p1', 'T', 'a1', 'pending', 0, 0, '2026-01-01', '2026-01-01')")
    yield engine
    await engine.dispose()


async def _fk_actions(engine, table: str) -> set[str]:
    async with engine.connect() as conn:
        rows = (await conn.exec_driver_sql(f"PRAGMA foreign_key_list({table})")).fetchall()
    return {r[6] for r in rows}


async def test_legacy_schema_is_rebuilt_with_cascade_and_data_intact(old_db):
    assert await _fk_actions(old_db, "agents") == {"NO ACTION"}
    async with old_db.connect() as conn:
        rowids_before = dict((await conn.exec_driver_sql(
            "SELECT id, rowid FROM messages")).fetchall())

    rebuilt = await migrate_foreign_key_actions(old_db)

    assert {"agents", "channels", "tasks", "messages", "activity_log"} <= set(rebuilt)
    assert await _fk_actions(old_db, "agents") == {"CASCADE"}
    assert await _fk_actions(old_db, "messages") == {"CASCADE", "SET NULL"}
    async with old_db.connect() as conn:
        assert (await conn.exec_driver_sql("SELECT COUNT(*) FROM messages")).scalar() == 3
        assert dict((await conn.exec_driver_sql(
            "SELECT id, rowid FROM messages")).fetchall()) == rowids_before
        triggers = {r[0] for r in (await conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='trigger'")).fetchall()}
        assert {"messages_fts_insert", "messages_fts_delete", "messages_fts_update"} <= triggers
        hits = (await conn.exec_driver_sql(
            "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'hello'")).scalar()
        assert hits == 3
        assert (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar() == 1

    # Idempotent: a second pass finds nothing to do.
    assert await migrate_foreign_key_actions(old_db) == []


async def test_rebuilt_legacy_schema_cascades_a_project_delete(old_db):
    await migrate_foreign_key_actions(old_db)
    async with old_db.begin() as conn:
        await conn.exec_driver_sql("DELETE FROM projects WHERE id = 'p1'")
    async with old_db.connect() as conn:
        for table in ("agents", "channels", "tasks", "messages"):
            assert (await conn.exec_driver_sql(f"SELECT COUNT(*) FROM {table}")).scalar() == 0, table


async def test_legacy_schema_without_the_rebuild_cannot_delete_a_project(old_db):
    """Why the rebuild is not optional: enforcement ON + the old NO ACTION FKs
    turns the silent orphaning into a hard constraint failure."""
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        async with old_db.begin() as conn:
            await conn.exec_driver_sql("DELETE FROM projects WHERE id = 'p1'")


async def test_current_schema_needs_no_rebuild(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'fresh.db'}", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    enable_sqlite_foreign_keys(engine)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        assert await migrate_foreign_key_actions(engine) == []
    finally:
        await engine.dispose()


# ── Deleting an agent: the cascade is logged ─────────────────────────────────

def test_deleting_an_agent_cascades_its_messages_and_logs_the_counts(client):
    """With ``messages.agent_id`` / ``activity_log.agent_id`` ON DELETE CASCADE
    and enforcement on, ``DELETE /api/agents/{id}`` takes every message the
    agent posted and its whole activity log with it.  Irreversible — so the
    counts about to go are written to the event log first."""
    proj = client.post("/api/external/projects", json={
        "name": "Ext", "webhook_url": "http://agent:9000/webhook"}).json()
    pid, ch = proj["project_id"], proj["channels"]["general"]
    aid = client.post(f"/api/external/projects/{pid}/agents",
                      json={"name": "Bot", "role": "dev"}).json()["agent_id"]
    agent_msgs = [client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": ch, "agent_id": aid, "content": f"m{i}"}).json()["message_id"]
        for i in range(2)]
    human_msg = client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": ch, "content": "human"}).json()["message_id"]
    assert client.post(f"/api/external/projects/{pid}/activity", json={
        "agent_id": aid, "activity_type": "tool_use", "description": "x"}).status_code == 200

    assert client.delete(f"/api/agents/{aid}").status_code == 204

    for mid in agent_msgs:
        assert client.get(f"/api/messages/{mid}").status_code == 404
    assert client.get(f"/api/messages/{human_msg}").status_code == 200
    events = client.get(f"/api/external/projects/{pid}/events",
                        params={"event_type": "agent.deleted"}).json()["events"]
    # Old code: [] — the cascade ran with no record of what went.
    assert [e["subject_id"] for e in events] == [aid]
    assert events[0]["actor_type"] == "internal"
    assert events[0]["payload"]["messages"] == 2
    assert events[0]["payload"]["activity_log"] == 1
    assert client.get("/api/external/events/verify").json()["ok"] is True


# ── The rebuild's guards ─────────────────────────────────────────────────────

def _backups(engine) -> list[str]:
    import glob
    return sorted(glob.glob(glob.escape(engine.url.database) + ".pre-fk-cascade.*.bak"))


async def _tables_like(engine, pattern: str) -> list[str]:
    async with engine.connect() as conn:
        rows = (await conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ESCAPE '\\'",
            (pattern,))).fetchall()
    return [r[0] for r in rows]


async def test_a_recent_backup_is_reused_rather_than_written_again(old_db):
    """init_db raises on a failed rebuild and the service units restart every
    10 s, so a backup per attempt would fill the disk.  Within an hour of the
    last one, the existing backup is returned instead."""
    from teamwork.models.base import _backup_sqlite_file
    async with old_db.connect() as conn:
        first = await _backup_sqlite_file(conn, old_db)
        # Old code: a second VACUUM INTO — either a second file, or (same
        # second, same timestamp) an "output file already exists" error.
        second = await _backup_sqlite_file(conn, old_db)
    assert first == second
    assert _backups(old_db) == [first]


async def test_rebuild_refuses_to_drop_a_column_the_model_does_not_know(old_db):
    """A column present in the live table but absent from the model would be
    dropped with the old table.  Refuse instead, and leave everything as it
    was — including the tables rebuilt before the refusing one."""
    async with old_db.begin() as conn:
        await conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN legacy_note TEXT")
        await conn.exec_driver_sql("UPDATE tasks SET legacy_note = 'keep'")

    # Old code: no error, and legacy_note was gone.
    with pytest.raises(RuntimeError, match=r"tasks has columns not in the model \['legacy_note'\]"):
        await migrate_foreign_key_actions(old_db)

    # tasks is rebuilt last, so agents & co. were rebuilt and then rolled back.
    for table in ("agents", "channels", "messages", "tasks", "activity_log"):
        assert await _fk_actions(old_db, table) == {"NO ACTION"}, table
    async with old_db.connect() as conn:
        assert (await conn.exec_driver_sql(
            "SELECT legacy_note FROM tasks WHERE id = 't1'")).scalar() == "keep"
        assert (await conn.exec_driver_sql("SELECT COUNT(*) FROM messages")).scalar() == 3
        assert (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar() == 1
    assert await _tables_like(old_db, r"\_fk\_rebuild\_%") == []


async def test_a_failed_rebuild_rolls_back_completely(old_db, monkeypatch):
    """Every statement of the rebuild — the DDL included — is inside one
    transaction.  pysqlite only auto-begins before DML, so without the explicit
    BEGIN the first table's CREATE ran in autocommit and its empty
    ``_fk_rebuild_*`` table survived the rollback."""
    import teamwork.models.base as base
    real = base._rebuild_table_with_current_ddl
    calls = []

    async def flaky(conn, table):
        calls.append(table.name)
        if len(calls) == 2:
            raise RuntimeError("boom on the second table")
        await real(conn, table)

    monkeypatch.setattr(base, "_rebuild_table_with_current_ddl", flaky)
    with pytest.raises(RuntimeError, match="boom"):
        await migrate_foreign_key_actions(old_db)
    assert len(calls) == 2

    for table in ("agents", "channels", "messages", "tasks", "activity_log"):
        assert await _fk_actions(old_db, table) == {"NO ACTION"}, table
    async with old_db.connect() as conn:
        assert (await conn.exec_driver_sql("SELECT COUNT(*) FROM messages")).scalar() == 3
        assert (await conn.exec_driver_sql("SELECT COUNT(*) FROM agents")).scalar() == 1
        assert (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar() == 1
    # Old code: ['_fk_rebuild_agents'] — created before the implicit BEGIN.
    assert await _tables_like(old_db, r"\_fk\_rebuild\_%") == []

    # And the retry, unpatched, succeeds from the same state.
    monkeypatch.setattr(base, "_rebuild_table_with_current_ddl", real)
    assert "agents" in await migrate_foreign_key_actions(old_db)
    assert await _fk_actions(old_db, "agents") == {"CASCADE"}
