"""Database base configuration and session management."""

from collections.abc import AsyncGenerator
from sqlalchemy import event, text

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool

from teamwork.config import settings


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


# Configure engine with SQLite-specific settings for better concurrency
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    # Use StaticPool for SQLite to share connection across threads
    poolclass=StaticPool,
    # Required for aiosqlite
    connect_args={"check_same_thread": False},
)

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

        # Triggers to keep FTS in sync with messages table
        await conn.execute(text("""
            CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
            END
        """))

        await conn.execute(text("""
            CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content)
                    VALUES('delete', old.rowid, old.content);
            END
        """))

        await conn.execute(text("""
            CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content)
                    VALUES('delete', old.rowid, old.content);
                INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
            END
        """))

        # Backfill existing messages into the FTS index
        await conn.execute(text("""
            INSERT INTO messages_fts(rowid, content)
                SELECT rowid, content FROM messages
        """))

        print("Migration: Created FTS5 full-text search index for messages")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides a database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
