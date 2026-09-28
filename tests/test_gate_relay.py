"""TeamWork relays egress-gate questions to a person — the agent never holds the answer key."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from teamwork.models.approval import STATUS_APPROVED, STATUS_REJECTED, ApprovalRequest
from teamwork.services.gate_relay import Gate, Relay, describe, parse_gates


class FakeGate:
    def __init__(self):
        self.pending = [{"id": "1", "host": "example.org", "port": 443, "method": "POST",
                         "path": "/upload", "tainted": True, "expires_in_seconds": 90}]
        self.answers = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer admin"
        if request.method == "GET" and request.url.path == "/pending":
            return httpx.Response(200, json={"pending": self.pending})
        if request.method == "POST" and request.url.path.startswith("/pending/"):
            import json
            self.answers.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
            self.pending = [p for p in self.pending if p["id"] != request.url.path.rsplit("/", 1)[-1]]
            return httpx.Response(200, json={"answered": True})
        return httpx.Response(404)


def test_parse_gates():
    gates = parse_gates("sandbox=http://127.0.0.1:8790|a;prax=http://127.0.0.1:8791/|b;broken")
    assert [(g.name, g.url, g.token) for g in gates] == [
        ("sandbox", "http://127.0.0.1:8790", "a"), ("prax", "http://127.0.0.1:8791", "b")]


def test_describe_names_the_request():
    cap, reason = describe("prax", {"host": "example.org", "method": "POST", "path": "/upload", "tainted": True})
    assert cap == "egress.prax.example.org"
    assert reason == "The agent wants to POST example.org/upload while the current work has read private data."


@pytest.fixture
def db_session():
    from teamwork.models.base import AsyncSessionLocal
    return AsyncSessionLocal


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_question_becomes_an_approval_and_the_decision_reaches_the_gate(client, db_session):
    fake = FakeGate()
    relay = Relay([Gate("prax", "http://gate", "admin")], db_session,
                  client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))

    async def flow():
        await relay.tick()
        async with db_session() as db:
            from sqlalchemy import select
            req = (await db.execute(select(ApprovalRequest).where(
                ApprovalRequest.requested_by_client == "gate:prax"))).scalar_one()
            assert "POST example.org/upload" in req.reason
            req.status, req.decided_by = STATUS_REJECTED, "human:teamwork-ui"
            await db.commit()
        await relay.tick()
    _run(flow())
    assert fake.answers == [("1", {"allow": False, "by": "human:teamwork-ui via TeamWork"})]


def test_a_question_the_gate_gave_up_on_is_withdrawn(client, db_session):
    fake = FakeGate()
    relay = Relay([Gate("sandbox", "http://gate", "admin")], db_session,
                  client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))

    async def flow():
        await relay.tick()
        fake.pending = []          # the gate timed out
        await relay.tick()
        async with db_session() as db:
            from sqlalchemy import select
            req = (await db.execute(select(ApprovalRequest).where(
                ApprovalRequest.requested_by_client == "gate:sandbox"))).scalar_one()
            return req.status, req.decided_by
    assert _run(flow()) == (STATUS_REJECTED, "gate-timeout")
    assert fake.answers == []


def test_an_hour_grant_answers_later_questions_without_asking(client, db_session):
    from teamwork.services.approvals import decide
    fake = FakeGate()
    relay = Relay([Gate("prax", "http://gate", "admin")], db_session,
                  client=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))

    async def flow():
        await relay.tick()
        async with db_session() as db:
            from sqlalchemy import select
            req = (await db.execute(select(ApprovalRequest))).scalar_one()
            await decide(db, approval_id=req.id, approve=True, decided_by="human:teamwork-ui", scope="hour")
            await db.commit()
        await relay.tick()                       # answers question 1
        fake.pending = [{**fake.pending[0], "id": "2"}] if fake.pending else [
            {"id": "2", "host": "example.org", "port": 443, "method": "POST", "path": "/upload", "tainted": True}]
        await relay.tick()                       # question 2: approved on arrival by the grant
        await relay.tick()                       # ...and answered
    _run(flow())
    assert [a[0] for a in fake.answers] == ["1", "2"] and all(a[1]["allow"] for a in fake.answers)
