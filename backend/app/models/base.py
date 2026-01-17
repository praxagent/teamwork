"""Database base configuration and session management."""

from collections.abc import AsyncGenerator
from sqlalchemy import event, text

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool

from app.config import settings


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


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides a database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
