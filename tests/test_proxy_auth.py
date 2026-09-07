"""Tests for the reverse-proxy authentication middleware (defense-in-depth)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request, WebSocket
from fastapi.testclient import TestClient

from teamwork.proxy_auth import ProxyAuthConfig, ProxyAuthMiddleware


def _settings(**over):
    base = dict(
        proxy_auth_provider="",
        proxy_auth_audience="",
        proxy_auth_issuer="",
        proxy_auth_jwks_url="",
        proxy_auth_header="",
        proxy_auth_algorithms="",
        proxy_auth_exempt_paths="/health,/healthz",
    )
    base.update(over)
    return SimpleNamespace(**base)


# ── Config resolution + fail-closed ─────────────────────────────────────────

def test_iap_preset_fills_defaults():
    cfg = ProxyAuthConfig(_settings(proxy_auth_provider="iap", proxy_auth_audience="/projects/123/global/backendServices/456"))
    assert cfg.header == "x-goog-iap-jwt-assertion"
    assert cfg.algorithms == ["ES256"]
    assert cfg.jwks_url.startswith("https://www.gstatic.com/iap/")
    assert cfg.issuer == "https://cloud.google.com/iap"


def test_cloudflare_derives_jwks_from_issuer():
    cfg = ProxyAuthConfig(_settings(
        proxy_auth_provider="cloudflare_access",
        proxy_auth_audience="aud-tag",
        proxy_auth_issuer="https://myteam.cloudflareaccess.com",
    ))
    assert cfg.header == "cf-access-jwt-assertion"
    assert cfg.jwks_url == "https://myteam.cloudflareaccess.com/cdn-cgi/access/certs"


def test_fail_closed_when_audience_missing():
    # Enabled (provider set) but no audience → refuse to construct (fail-closed).
    with pytest.raises(RuntimeError) as exc:
        ProxyAuthConfig(_settings(proxy_auth_provider="iap"))
    assert "audience" in str(exc.value)


def test_fail_closed_when_custom_unconfigured():
    with pytest.raises(RuntimeError):
        ProxyAuthConfig(_settings(proxy_auth_audience="x"))  # no provider, no header/jwks/algs


# ── Middleware dispatch ─────────────────────────────────────────────────────

def _app(monkeypatch, *, verify_returns=None):
    cfg = ProxyAuthConfig(_settings(proxy_auth_provider="iap", proxy_auth_audience="aud"))
    app = FastAPI()
    app.add_middleware(ProxyAuthMiddleware, config=cfg)

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/api/secret")
    def secret():
        return {"ok": True}

    if verify_returns is not None:
        # Bypass real crypto/JWKS — exercise the dispatch flow deterministically.
        monkeypatch.setattr(ProxyAuthMiddleware, "_verify", lambda self, token: verify_returns)
    return TestClient(app)


def test_missing_token_is_rejected(monkeypatch):
    client = _app(monkeypatch)
    assert client.get("/api/secret").status_code == 401


def test_health_is_exempt(monkeypatch):
    client = _app(monkeypatch)
    assert client.get("/health").status_code == 200


def test_valid_token_passes_and_sets_identity(monkeypatch):
    client = _app(monkeypatch, verify_returns={"email": "alice@example.com"})
    r = client.get("/api/secret", headers={"x-goog-iap-jwt-assertion": "tok"})
    assert r.status_code == 200


def test_invalid_token_is_rejected(monkeypatch):
    def boom(self, token):
        raise ValueError("bad signature")

    monkeypatch.setattr(ProxyAuthMiddleware, "_verify", boom)
    cfg = ProxyAuthConfig(_settings(proxy_auth_provider="iap", proxy_auth_audience="aud"))
    app = FastAPI()
    app.add_middleware(ProxyAuthMiddleware, config=cfg)

    @app.get("/api/secret")
    def secret():
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/api/secret", headers={"x-goog-iap-jwt-assertion": "tok"}).status_code == 401


# ── Websocket scopes (pure ASGI) ────────────────────────────────────────────
#
# The previous BaseHTTPMiddleware implementation never saw websocket scopes, so
# /ws connected with no assertion at all while /api/* was refused.

from starlette.websockets import WebSocketDisconnect  # noqa: E402

from teamwork.proxy_auth import WS_CLOSE_UNAUTHORIZED  # noqa: E402


def _ws_app(monkeypatch, *, verify_returns=None):
    cfg = ProxyAuthConfig(_settings(proxy_auth_provider="iap", proxy_auth_audience="aud"))
    app = FastAPI()
    app.add_middleware(ProxyAuthMiddleware, config=cfg)

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_json({"identity": websocket.scope["state"].get("proxy_identity")})
        await websocket.close()

    @app.get("/api/whoami")
    def whoami(request: Request):
        return {"identity": request.state.proxy_identity}

    if verify_returns is not None:
        monkeypatch.setattr(ProxyAuthMiddleware, "_verify", lambda self, token: verify_returns)
    return TestClient(app)


def test_websocket_without_assertion_is_closed_4401_before_accept(monkeypatch):
    client = _ws_app(monkeypatch)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws"):
            pass
    assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_websocket_with_invalid_assertion_is_refused(monkeypatch):
    def boom(self, token):
        raise ValueError("bad signature")

    monkeypatch.setattr(ProxyAuthMiddleware, "_verify", boom)
    client = _ws_app(monkeypatch)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws", headers={"x-goog-iap-jwt-assertion": "tok"}):
            pass
    assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_websocket_with_valid_assertion_connects_and_carries_identity(monkeypatch):
    client = _ws_app(monkeypatch, verify_returns={"email": "alice@example.com"})
    with client.websocket_connect("/ws", headers={"x-goog-iap-jwt-assertion": "tok"}) as ws:
        assert ws.receive_json() == {"identity": "alice@example.com"}
    r = client.get("/api/whoami", headers={"x-goog-iap-jwt-assertion": "tok"})
    assert r.status_code == 200 and r.json() == {"identity": "alice@example.com"}


def test_options_preflight_is_exempt(monkeypatch):
    client = _ws_app(monkeypatch)
    # No assertion; must not be a 401 from the middleware (the route itself 405s).
    assert client.options("/api/whoami").status_code != 401


def test_real_app_refuses_api_and_ws_with_preset_enabled(client):
    """PROXY_AUTH_ENABLED with the IAP preset on the real app: HTTP 401 and /ws refused."""
    cfg = ProxyAuthConfig(_settings(proxy_auth_provider="iap", proxy_auth_audience="aud"))
    gated = TestClient(ProxyAuthMiddleware(client.app, config=cfg))
    assert gated.get("/api/projects").status_code == 401
    assert gated.get("/health").status_code == 200
    with pytest.raises(WebSocketDisconnect) as exc:
        with gated.websocket_connect("/ws"):
            pass
    assert exc.value.code == WS_CLOSE_UNAUTHORIZED
