"""A committed write survives another request finishing at the same moment.

TeamWork shared ONE SQLite connection between every concurrent session
(StaticPool). When a session closed, the pool reset that shared connection
with a ROLLBACK, discarding another session's flushed-but-uncommitted insert
— which then "committed" nothing and still answered 200. Found when an
approval request vanished while the approval dialog was polling.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from teamwork.models.base import engine_options


def _rows_after_concurrent_close(url: str) -> int:
    async def run() -> int:
        eng = create_async_engine(url, **engine_options(url))
        async with eng.begin() as c:
            await c.execute(text("PRAGMA journal_mode=WAL"))
            await c.execute(text("create table t (x int)"))
        make = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)

        async def writer():
            async with make() as s:
                await s.execute(text("insert into t values (1)"))
                await asyncio.sleep(0.05)  # a handler awaiting something mid-request
                await s.commit()

        async def reader():
            await asyncio.sleep(0.01)
            async with make() as s:  # a concurrent GET that finishes first
                await s.execute(text("select count(*) from t"))

        await asyncio.gather(writer(), reader())
        async with make() as s:
            n = (await s.execute(text("select count(*) from t"))).scalar()
        await eng.dispose()
        return n
    # A private loop: asyncio.run() would clear the thread's current loop,
    # which later tests in this suite rely on.
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(run())
    finally:
        loop.close()


def test_file_database_keeps_a_committed_write(tmp_path):
    assert _rows_after_concurrent_close(f"sqlite+aiosqlite:///{tmp_path}/tw.db") == 1


def test_file_database_is_not_on_a_single_shared_connection():
    assert "poolclass" not in engine_options("sqlite+aiosqlite:////data/teamwork/vteam.db")


def test_memory_database_keeps_its_one_connection():
    from sqlalchemy.pool import StaticPool
    assert engine_options("sqlite+aiosqlite:///:memory:")["poolclass"] is StaticPool
