"""Restarting the sandbox from the UI (POST /api/sandbox/restart).

`docker restart` keeps the container, so files and installed packages survive.
It runs one at a time and is recorded in the event log.
"""
from __future__ import annotations

import asyncio

import pytest

from teamwork.config import settings
from teamwork.routers import sandbox as mod


class FakeProc:
    def __init__(self, rc=0, err=b""):
        self.returncode, self._err = rc, err

    async def communicate(self):
        return b"", self._err

    def kill(self):
        pass


def _event_types() -> list[str]:
    from sqlalchemy import select

    from teamwork.models.base import AsyncSessionLocal
    from teamwork.models.event import Event

    async def read():
        async with AsyncSessionLocal() as db:
            return [e.event_type for e in (await db.execute(select(Event))).scalars()]
    return asyncio.get_event_loop().run_until_complete(read())


@pytest.fixture
def docker(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "sandbox_container", "prax-sandbox-sandbox-1")
    monkeypatch.setattr(mod.shutil, "which", lambda name: "/usr/bin/docker")
    outcome = {"proc": FakeProc()}

    async def fake_exec(*argv, **kw):
        calls.append(list(argv))
        return outcome["proc"]
    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", fake_exec)
    return calls, outcome


def test_it_restarts_the_configured_container_and_logs_it(client, docker):
    calls, _ = docker
    resp = client.post("/api/sandbox/restart")
    assert resp.status_code == 200 and resp.json()["status"] == "restarted"
    assert calls == [["docker", "restart", "-t", "10", "prax-sandbox-sandbox-1"]]
    assert "sandbox.restarted" in _event_types()


def test_no_sandbox_configured_is_503(client, monkeypatch):
    monkeypatch.setattr(settings, "sandbox_container", "")
    assert client.post("/api/sandbox/restart").status_code == 503


def test_a_failed_restart_says_why(client, docker):
    _, outcome = docker
    outcome["proc"] = FakeProc(rc=1, err=b"Error response from daemon: No such container")
    resp = client.post("/api/sandbox/restart")
    assert resp.status_code == 500 and "No such container" in resp.json()["detail"]


def test_one_restart_at_a_time(client, docker):
    async def hold():
        await mod._restart_lock.acquire()
    asyncio.get_event_loop().run_until_complete(hold())
    try:
        assert client.post("/api/sandbox/restart").status_code == 409
    finally:
        mod._restart_lock.release()
