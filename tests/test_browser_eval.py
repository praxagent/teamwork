"""Browser relay: ``type=eval`` is restricted to the three navigation expressions."""
from __future__ import annotations

import asyncio
import json

import pytest

from teamwork.routers import browser
from teamwork.routers.browser import EVAL_ALLOWLIST, is_allowed_eval


@pytest.mark.parametrize("expr", sorted(EVAL_ALLOWLIST))
def test_frontend_expressions_are_allowed(expr):
    assert is_allowed_eval(expr)


@pytest.mark.parametrize("expr", [
    "alert(1)", "document.cookie", "history.back(); fetch('http://evil')",
    " history.back()", "history.back()\n", "History.back()", "location.reload(true)",
    "", None, 42, ["history.back()"],
])
def test_anything_else_is_refused(expr):
    assert not is_allowed_eval(expr)


class _FakeCDP:
    """Stands in for the Chrome DevTools websocket: records sends, never answers."""

    def __init__(self):
        self.sent: list[dict] = []
        self._closed = asyncio.Event()

    async def send(self, raw):
        self.sent.append(json.loads(raw))

    async def close(self):
        self._closed.set()

    def __aiter__(self):
        return self

    async def __anext__(self):
        await self._closed.wait()
        raise StopAsyncIteration


def test_relay_refuses_arbitrary_eval_and_forwards_allowed(client, monkeypatch):
    fake = _FakeCDP()

    async def discover():
        return "ws://fake-cdp/devtools/page/1"

    async def connect(*_args, **_kwargs):
        return fake

    monkeypatch.setattr(browser, "_discover_cdp_ws_url", discover)
    monkeypatch.setattr(browser.websockets, "connect", connect)

    with client.websocket_connect("/api/browser/ws/p1?fps=1") as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_json({"type": "eval", "expression": "alert(document.cookie)"})
        msg = ws.receive_json()
        assert msg["type"] == "error" and "not allowed" in msg["message"]

        ws.send_json({"type": "eval", "expression": "history.back()"})
        # A second refused eval acts as a barrier: read_client is sequential, so
        # by the time its error arrives the allowed one has been relayed.
        ws.send_json({"type": "eval", "expression": "fetch('http://evil')"})
        assert ws.receive_json()["type"] == "error"

    evaluated = [m["params"]["expression"] for m in fake.sent if m["method"] == "Runtime.evaluate"]
    # Old code: every expression went to Runtime.evaluate.
    assert evaluated == ["history.back()"]
