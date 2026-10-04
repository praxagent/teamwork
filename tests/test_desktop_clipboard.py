"""The desktop clipboard: the module the noVNC page imports, and the proxy to
the sandbox's clipboard bridge.

The proxy used to connect to port 6090 whatever CLIPBOARD_PORT said, so a dev
checkout beside production (its sandbox's bridge on 6091) synced its desktop
clipboard with production's sandbox.
"""
from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from teamwork import main
from teamwork.config import settings


def test_the_clipboard_module_is_served_by_teamwork_not_proxied(client, monkeypatch):
    monkeypatch.setattr(settings, "desktop_vnc_url", "")      # the proxy would 503
    resp = client.get("/api/desktop/teamwork-clipboard.js")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/javascript")
    assert "export class ClipboardSync" in resp.text


def test_the_page_imports_it():
    page = (main.Path(main.__file__).parent / "desktop_vnc.html").read_text()
    assert "from './teamwork-clipboard.js'" in page


@pytest.mark.parametrize("port", [6090, 6091])
def test_the_proxy_connects_to_the_configured_bridge_port(client, monkeypatch, port):
    monkeypatch.setattr(settings, "desktop_vnc_url", "http://127.0.0.1:6081")
    monkeypatch.setattr(settings, "clipboard_port", port)
    targets = []

    import websockets

    def fake_connect(url, **kw):
        targets.append(url)
        raise OSError("no bridge in tests")
    monkeypatch.setattr(websockets, "connect", fake_connect)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/desktop/clipboard") as ws:
            ws.receive_text()
    assert targets == [f"ws://127.0.0.1:{port}"]
