"""Relay egress-gate questions to a person, and the person's answers back.

An egress gate (prax-sandbox's gate for the sandbox, the secrets proxy's
policy for the agent's own traffic) holds a request it has been told to ask
about. Someone has to put that question to a person and carry the answer back
— and it must NOT be the agent whose traffic is being judged: whoever holds a
gate's admin token can approve anything. So TeamWork, which has no model and
already owns the approval dialog, is the relay:

1. poll each configured gate's ``GET /pending``;
2. turn each new question into an approval request (``request_for_client``,
   so a person's "Allow for 1 hour" grant covers later questions for the same
   destination);
3. when a person decides, ``POST /pending/{id}`` the answer to the gate;
4. when the gate gives up first, withdraw the question from the dialog.

Configure with ``EGRESS_GATES`` — ``name=url|admin_token`` entries separated
by ``;`` — e.g. ``sandbox=http://127.0.0.1:8790|…;prax=http://127.0.0.1:8791|…``.
The agent keeps only each gate's raise-only taint token.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx
from sqlalchemy import select

logger = logging.getLogger(__name__)

POLL_SECONDS = 2.0


@dataclass(frozen=True)
class Gate:
    name: str
    url: str
    token: str


def parse_gates(spec: str) -> list[Gate]:
    gates = []
    for entry in filter(None, (e.strip() for e in (spec or "").split(";"))):
        name, _, rest = entry.partition("=")
        url, _, token = rest.partition("|")
        if name and url and token:
            gates.append(Gate(name.strip(), url.strip().rstrip("/"), token.strip()))
        else:
            logger.warning("EGRESS_GATES entry %r is not name=url|token — ignored", entry)
    return gates


def describe(gate: str, item: dict) -> tuple[str, str]:
    """``(capability, reason)`` a person sees for one gate question."""
    host = str(item.get("host", "?"))
    after = " while the current work has read private data." if item.get("tainted") else "."
    method, path = item.get("method"), item.get("path")
    if method:
        what = f"{method} {host}{path or '/'}"
    else:
        what = f"connect to {host}:{item.get('port')}"
    who = "The sandbox" if gate == "sandbox" else "The agent" if gate == "prax" else f"Gate {gate}"
    return f"egress.{gate}.{host}"[:64], f"{who} wants to {what}{after}"


class Relay:
    def __init__(self, gates: list[Gate], session_factory, client: httpx.AsyncClient | None = None):
        self.gates = gates
        self.session_factory = session_factory
        self.client = client or httpx.AsyncClient(timeout=5)
        self.tracked: dict[tuple[str, str], str] = {}   # (gate, question id) -> approval id

    async def _call(self, gate: Gate, method: str, path: str, body: dict | None = None):
        resp = await self.client.request(method, gate.url + path, json=body,
                                         headers={"Authorization": f"Bearer {gate.token}"})
        resp.raise_for_status()
        return resp.json()

    async def tick(self) -> None:
        for gate in self.gates:
            try:
                pending = (await self._call(gate, "GET", "/pending")).get("pending", [])
            except Exception as exc:
                logger.debug("gate %s poll failed: %s", gate.name, exc)
                continue
            await self._sync_gate(gate, pending)

    async def _sync_gate(self, gate: Gate, pending: list[dict]) -> None:
        from datetime import datetime, timedelta, timezone

        from teamwork.models.approval import (
            STATUS_APPROVED, STATUS_PENDING, STATUS_REJECTED, ApprovalRequest)
        from teamwork.services.approvals import request_for_client

        live = {str(i["id"]): i for i in pending}
        async with self.session_factory() as db:
            # New questions -> approval requests.
            for qid, item in live.items():
                if (gate.name, qid) in self.tracked:
                    continue
                capability, reason = describe(gate.name, item)
                payload = {k: item.get(k) for k in ("host", "port", "method", "path", "tainted")}
                payload["gate"], payload["question"] = gate.name, qid
                req = await request_for_client(
                    db, capability=capability, client_name=f"gate:{gate.name}",
                    payload=payload, reason=reason)
                expires_in = item.get("expires_in_seconds")
                if expires_in is not None and req.status == STATUS_PENDING:
                    req.expires_at = (datetime.now(timezone.utc).replace(tzinfo=None)
                                      + timedelta(seconds=float(expires_in)))
                self.tracked[(gate.name, qid)] = req.id
            await db.commit()

            # Decided -> tell the gate. Vanished at the gate -> withdraw.
            for (gname, qid), approval_id in list(self.tracked.items()):
                if gname != gate.name:
                    continue
                req = (await db.execute(select(ApprovalRequest).where(
                    ApprovalRequest.id == approval_id))).scalar_one_or_none()
                if req is None:
                    self.tracked.pop((gname, qid), None)
                    continue
                if qid not in live:
                    if req.status == STATUS_PENDING:
                        req.status, req.decided_by = STATUS_REJECTED, "gate-timeout"
                        req.decision_note = "the gate stopped waiting before anyone answered"
                    self.tracked.pop((gname, qid), None)
                    continue
                if req.status in (STATUS_APPROVED, STATUS_REJECTED):
                    allow = req.status == STATUS_APPROVED
                    try:
                        await self._call(gate, "POST", f"/pending/{qid}",
                                         {"allow": allow, "by": f"{req.decided_by} via TeamWork"})
                    except Exception as exc:
                        logger.warning("could not answer gate %s question %s: %s", gname, qid, exc)
                        continue
                    self.tracked.pop((gname, qid), None)
            await db.commit()

    async def run(self) -> None:
        logger.info("egress gate relay: %s", ", ".join(g.name for g in self.gates))
        while True:
            try:
                await self.tick()
            except Exception:
                logger.exception("egress gate relay tick failed")
            await asyncio.sleep(POLL_SECONDS)
