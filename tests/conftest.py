"""Pytest configuration and shared fixtures for TeamWork tests."""

import os

# Set DATABASE_URL BEFORE importing teamwork — the engine is created at
# import time, so the env var must be visible when Settings() runs.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

from collections.abc import AsyncGenerator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from teamwork.models.base import Base


@pytest.fixture(autouse=True)
def setup_test_environment():
    """Set up test environment variables."""
    original_env = os.environ.copy()
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    yield
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture(scope="function")
async def async_engine():
    """Create an async engine with in-memory SQLite for testing."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture(scope="function")
async def db_session(async_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional database session for tests."""
    async_session_factory = async_sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False,
    )
    async with async_session_factory() as session:
        yield session
        await session.rollback()


@pytest.fixture(scope="function")
async def db(db_session: AsyncSession) -> AsyncSession:
    """Alias for db_session."""
    return db_session


@pytest.fixture()
def client() -> TestClient:
    """HTTP test client wired to the real app with a fresh in-memory DB per test."""
    from teamwork import create_app
    from teamwork.models.base import Base, engine

    app = create_app()
    with TestClient(app) as c:
        yield c

    # Tear down: drop all tables so the next test starts clean.
    import asyncio

    async def _reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(_reset())
