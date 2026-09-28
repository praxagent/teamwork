"""Database base configuration and session management."""

import glob
import logging
import os
import re
import time
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateIndex, CreateTable

from teamwork.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


def engine_options(database_url: str) -> dict:
    """Pool settings for *database_url*.

    A file-backed SQLite database gets a connection per session. It used to
    share ONE connection across every concurrent session (``StaticPool``),
    and a session closing resets that shared connection with a ROLLBACK —
    which silently discarded another request's flushed-but-not-yet-committed
    writes. That request still answered 200. WAL mode (set in ``init_db``,
    persistent in the file) lets separate connections read while one writes;
    ``busy_timeout`` on each connection makes a second writer wait instead of
    failing.

    An in-memory database exists only on its one connection, so it keeps
    ``StaticPool`` (tests).
    """
    if database_url.startswith("sqlite") and ":memory:" in database_url:
        return {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}}
    if database_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False, "timeout": 30}}
    return {}


engine = create_async_engine(
    settings.database_url,
    echo=settings.sqlalchemy_echo,
    **engine_options(settings.database_url),
)


def enable_sqlite_foreign_keys(target_engine: AsyncEngine) -> None:
    """Turn on SQLite foreign-key enforcement for every connection *target_engine* opens.

    SQLite ignores ``REFERENCES`` clauses unless ``PRAGMA foreign_keys=ON`` is
    issued on the connection, and it is per-connection, not per-database — so it
    is set from the pool's ``connect`` event.  With ``StaticPool`` that is one
    connection for the life of the process, but the event is the right hook
    either way: any future pool gets the same guarantee.

    Before this the pragma was never issued anywhere.  The models declared
    ``passive_deletes=True`` ("let the database cascade") on an engine where
    the database cascaded nothing, so ``DELETE /api/projects/{id}`` removed the
    project row and left every agent, channel, task and message behind.
    """
    @event.listens_for(target_engine.sync_engine, "connect")
    def _on_connect(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # Per connection, now that there is more than one: wait for a lock
        # instead of failing with "database is locked".
        cursor.execute("PRAGMA busy_timeout=30000")  # matches the connect timeout
        cursor.close()


enable_sqlite_foreign_keys(engine)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db() -> None:
    """Initialize the database by creating all tables."""
    async with engine.begin() as conn:
        # Enable WAL mode for better concurrency
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA busy_timeout=5000"))
        await conn.run_sync(Base.metadata.create_all)

        # Run migrations for new columns on existing tables
        await _run_migrations(conn)

    # Existing databases were created with foreign keys that declare no ON
    # DELETE action.  SQLite cannot ALTER a constraint, so tables whose actions
    # lag the models are rebuilt (own transaction handling — see the function).
    await migrate_foreign_key_actions(engine)


async def _run_migrations(conn) -> None:
    """Run database migrations for new columns."""
    # Migrate agents table
    result = await conn.execute(text("PRAGMA table_info(agents)"))
    agent_columns = {row[1] for row in result.fetchall()}

    # Add specialization column if it doesn't exist
    if "specialization" not in agent_columns:
        try:
            await conn.execute(
                text("ALTER TABLE agents ADD COLUMN specialization VARCHAR(255)")
            )
            print("Migration: Added specialization column to agents table")
        except Exception as e:
            print(f"Migration warning: {e}")

    # Get existing columns in the tasks table
    result = await conn.execute(text("PRAGMA table_info(tasks)"))
    columns = {row[1] for row in result.fetchall()}

    # Add blocked_by_json column if it doesn't exist
    if "blocked_by_json" not in columns:
        try:
            await conn.execute(
                text("ALTER TABLE tasks ADD COLUMN blocked_by_json TEXT DEFAULT '[]'")
            )
            print("Migration: Added blocked_by_json column to tasks table")
        except Exception as e:
            print(f"Migration warning: {e}")

    # Add start_commit column if it doesn't exist
    if "start_commit" not in columns:
        try:
            await conn.execute(
                text("ALTER TABLE tasks ADD COLUMN start_commit VARCHAR(40)")
            )
            print("Migration: Added start_commit column to tasks table")
        except Exception as e:
            print(f"Migration warning: {e}")

    # Add end_commit column if it doesn't exist
    if "end_commit" not in columns:
        try:
            await conn.execute(
                text("ALTER TABLE tasks ADD COLUMN end_commit VARCHAR(40)")
            )
            print("Migration: Added end_commit column to tasks table")
        except Exception as e:
            print(f"Migration warning: {e}")

    # ── FTS5 full-text search for messages ──
    await _migrate_fts5(conn)


async def _migrate_fts5(conn) -> None:
    """Create or rebuild the FTS5 virtual table for message search."""
    # Check if the FTS table already exists
    result = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
    )
    fts_exists = result.first() is not None

    if not fts_exists:
        # Create the FTS5 virtual table — content-sync'd to messages table
        # content="" means we only store the index, not a copy of the data
        # content_rowid maps the FTS rowid to messages.rowid
        await conn.execute(text("""
            CREATE VIRTUAL TABLE messages_fts USING fts5(
                content,
                content='messages',
                content_rowid='rowid',
                tokenize='porter unicode61'
            )
        """))

        await _ensure_fts_triggers(conn)

        # Backfill existing messages into the FTS index
        await conn.execute(text("""
            INSERT INTO messages_fts(rowid, content)
                SELECT rowid, content FROM messages
        """))

        print("Migration: Created FTS5 full-text search index for messages")


async def _ensure_fts_triggers(conn) -> None:
    """(Re)create the triggers that keep ``messages_fts`` in step with ``messages``.

    Idempotent, so it can run after anything that recreates the ``messages``
    table — triggers belong to the table and are dropped with it.
    """
    await conn.execute(text("""
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END
    """))
    await conn.execute(text("""
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content)
                VALUES('delete', old.rowid, old.content);
        END
    """))
    await conn.execute(text("""
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content)
                VALUES('delete', old.rowid, old.content);
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END
    """))


# ── Foreign-key ON DELETE actions: rebuild tables whose schema lags the models ──

def _declared_fk_actions(table) -> dict[tuple[str, str, str], str]:
    """``{(column, referenced table, referenced column): ON DELETE action}`` per the model."""
    return {
        (fk.parent.name, fk.column.table.name, fk.column.name): (fk.ondelete or "NO ACTION").upper()
        for fk in table.foreign_keys
    }


async def _actual_fk_actions(conn, table_name: str) -> dict[tuple[str, str, str], str]:
    """The same map, read back from the live schema (``PRAGMA foreign_key_list``)."""
    rows = (await conn.exec_driver_sql(f'PRAGMA foreign_key_list("{table_name}")')).fetchall()
    # row: (id, seq, table, from, to, on_update, on_delete, match)
    return {(r[3], r[2], r[4] or "id"): (r[6] or "NO ACTION").upper() for r in rows}


async def _table_exists(conn, name: str) -> bool:
    row = (await conn.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,))).first()
    return row is not None


async def _rebuild_table_with_current_ddl(conn, table) -> None:
    """SQLite's documented way to change a constraint: create the table under a
    temporary name from the model's current DDL, copy every row (rowid included,
    so FTS external-content indexes stay valid), drop the old table, rename."""
    tmp = f"_fk_rebuild_{table.name}"
    ddl = str(CreateTable(table).compile(dialect=conn.dialect)).strip()
    ddl, n = re.subn(rf'^CREATE TABLE\s+"?{re.escape(table.name)}"?\s*\(',
                     f'CREATE TABLE "{tmp}" (', ddl, count=1)
    if n != 1:
        raise RuntimeError(f"could not rename DDL for {table.name}: {ddl[:80]!r}")

    # The copy takes the columns the model and the live table share.  A column
    # the live table has and the model does not would be dropped with the old
    # table — silently and irreversibly — so that case is refused outright,
    # before any DDL is issued; the caller rolls back.
    present = {r[1] for r in (await conn.exec_driver_sql(
        f'PRAGMA table_info("{table.name}")')).fetchall()}
    extra = present - {c.name for c in table.columns}
    if extra:
        raise RuntimeError(f"{table.name} has columns not in the model {sorted(extra)}; "
                           "refusing to rebuild and drop them")

    await conn.exec_driver_sql(f'DROP TABLE IF EXISTS "{tmp}"')
    await conn.exec_driver_sql(ddl)

    cols = ", ".join(f'"{c.name}"' for c in table.columns if c.name in present)
    await conn.exec_driver_sql(
        f'INSERT INTO "{tmp}" (rowid, {cols}) SELECT rowid, {cols} FROM "{table.name}"')

    n_old = (await conn.exec_driver_sql(f'SELECT COUNT(*) FROM "{table.name}"')).scalar()
    n_new = (await conn.exec_driver_sql(f'SELECT COUNT(*) FROM "{tmp}"')).scalar()
    if n_old != n_new:
        raise RuntimeError(f"row count mismatch rebuilding {table.name}: {n_old} → {n_new}")

    await conn.exec_driver_sql(f'DROP TABLE "{table.name}"')
    await conn.exec_driver_sql(f'ALTER TABLE "{tmp}" RENAME TO "{table.name}"')

    # Indexes were dropped with the old table; create_all will not add them to
    # an existing table, so recreate the model's indexes here.
    for index in table.indexes:
        exists = (await conn.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (index.name,))).first()
        if exists is None:
            await conn.exec_driver_sql(str(CreateIndex(index).compile(dialect=conn.dialect)))


async def _backup_sqlite_file(conn, target_engine: AsyncEngine) -> str | None:
    """``VACUUM INTO`` a timestamped copy next to a file-backed database.

    ``VACUUM INTO`` is safe on a live WAL database (a plain file copy is not).
    Returns the backup path, or None when the database is not a file.

    A backup made less than an hour ago is reused instead of writing another.
    The caller runs from ``init_db`` and raises on any rebuild failure, and the
    service units restart the process every 10 s — so without this a rebuild
    that keeps failing would write a fresh database-sized ``.bak`` on every
    restart, next to the database, until the disk is full.
    """
    db_file = target_engine.url.database or ""
    if not db_file or db_file == ":memory:":
        return None
    existing = sorted(glob.glob(glob.escape(db_file) + ".pre-fk-cascade.*.bak"),
                      key=os.path.getmtime)
    if existing:
        age = time.time() - os.path.getmtime(existing[-1])
        if age < 3600:
            logger.warning("Migration: reusing backup %s made %ds ago (restart loop?)",
                           existing[-1], age)
            return existing[-1]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    backup = f"{db_file}.pre-fk-cascade.{stamp}.bak"
    await conn.exec_driver_sql("VACUUM INTO ?", (backup,))
    return backup


async def migrate_foreign_key_actions(target_engine: AsyncEngine) -> list[str]:
    """Bring the ON DELETE actions of the live schema up to the models'.

    Idempotent: each table's ``PRAGMA foreign_key_list`` is compared with the
    model's declared ``ondelete``; only tables that differ are rebuilt, so a
    database created from the current models — or already migrated — is left
    untouched.  Returns the names of the rebuilt tables.

    Why a rebuild: SQLite cannot alter a foreign-key constraint in place.  With
    enforcement now ON (see :func:`enable_sqlite_foreign_keys`) a project delete
    on the OLD schema would not orphan the children any more — it would fail
    with a constraint error instead, because the old FKs say NO ACTION.

    Transaction discipline: ``PRAGMA foreign_keys`` is a no-op inside a
    transaction, so it is toggled only with none open (verified by reading it
    back), the rebuilds run in ONE transaction that is rolled back on any
    error, and enforcement is switched back on and verified afterwards
    regardless of outcome.  The transaction is opened with an explicit
    ``BEGIN``: under pysqlite's legacy transaction control the driver only
    begins one before the first INSERT/UPDATE/DELETE, so the first rebuild's
    ``CREATE TABLE`` would otherwise run in autocommit and survive the
    rollback as a stray empty ``_fk_rebuild_*`` table.  A file-backed
    database is backed up first with ``VACUUM INTO``.
    """
    async with target_engine.connect() as conn:
        stale = []
        for table in Base.metadata.sorted_tables:
            if not table.foreign_keys or not await _table_exists(conn, table.name):
                continue
            if await _actual_fk_actions(conn, table.name) != _declared_fk_actions(table):
                stale.append(table)
        if not stale:
            return []

        names = [t.name for t in stale]
        logger.warning("Migration: rebuilding %s to add ON DELETE actions", ", ".join(names))
        try:
            backup = await _backup_sqlite_file(conn, target_engine)
        except Exception as exc:  # noqa: BLE001 - the rebuild itself is transactional
            logger.error("Migration: could not back up the database before the rebuild: %s", exc)
        else:
            if backup:
                logger.warning("Migration: database backed up to %s", backup)

        await conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        if (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar() != 0:
            raise RuntimeError("PRAGMA foreign_keys=OFF had no effect (a transaction is open); "
                               "refusing to rebuild tables with enforcement on")
        # Explicit so the DDL is inside the transaction too (see the docstring);
        # sqlite3 recognises it and commit()/rollback() below close it.
        await conn.exec_driver_sql("BEGIN")
        try:
            for table in stale:
                await _rebuild_table_with_current_ddl(conn, table)
            if "messages" in names and await _table_exists(conn, "messages_fts"):
                await _ensure_fts_triggers(conn)
                await conn.exec_driver_sql("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
            await conn.commit()
        except Exception:
            await conn.rollback()
            logger.exception("Migration: table rebuild FAILED and was rolled back")
            raise
        finally:
            await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            await conn.commit()

        if (await conn.exec_driver_sql("PRAGMA foreign_keys")).scalar() != 1:
            raise RuntimeError("foreign-key enforcement could not be re-enabled after the rebuild")
        violations = (await conn.exec_driver_sql("PRAGMA foreign_key_check")).fetchall()
        if violations:
            # Rows orphaned by the years without enforcement.  Not deleted here —
            # that is a decision for the operator — but no longer invisible.
            by_table: dict[str, int] = {}
            for v in violations:
                by_table[v[0]] = by_table.get(v[0], 0) + 1
            logger.warning("Migration: %d pre-existing orphaned row(s) reference missing "
                           "parents: %s", len(violations), by_table)
        logger.warning("Migration: rebuilt %s with ON DELETE actions", ", ".join(names))
        return names


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides a database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
