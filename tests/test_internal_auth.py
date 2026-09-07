"""INTERNAL_API_KEY — the internal UI key middleware and session endpoints.

Default off: with an empty key the middleware is not installed and the app
behaves exactly as before (asserted below on the real app). With a key, every
``http`` and ``websocket`` scope needs the header or the session cookie.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from teamwork.config import settings
from teamwork.internal_auth import (
    COOKIE,
    HEADER,
    WS_CLOSE_UNAUTHORIZED,
    InternalKeyMiddleware,
    is_exempt,
    issue_session_token,
    verify_session_token,
)
from teamwork.main import STATIC_DIR

KEY = "test-internal-key-0123456789"


@pytest.fixture()
def gated(client, monkeypatch):
    """The real app behind the middleware, as main.py wires it when a key is set.

    Wrapped as a raw ASGI app so the module-level singleton is not mutated for
    other tests. The DB was initialised by the ``client`` fixture's lifespan.
    """
    from teamwork import internal_auth

    monkeypatch.setattr(settings, "internal_api_key", KEY)
    internal_auth._LOGIN_FAILURES.clear()
    return TestClient(InternalKeyMiddleware(client.app, key=KEY))


# ── Tokens ──────────────────────────────────────────────────────────────────

def test_session_token_round_trips_and_expires():
    token, expires_at = issue_session_token(KEY, now=1_000_000)
    assert expires_at == 1_000_000 + 30 * 24 * 3600
    assert verify_session_token(KEY, token, now=1_000_001)
    assert not verify_session_token(KEY, token, now=expires_at)          # expired
    assert not verify_session_token("other-key", token, now=1_000_001)  # rotated key
    flipped = "0" if token[-1] != "0" else "1"
    assert not verify_session_token(KEY, token[:-1] + flipped, now=1_000_001)  # tampered sig
    assert not verify_session_token(KEY, "9999999999.", now=1_000_001)
    assert not verify_session_token(KEY, "garbage", now=1_000_001)
    assert not verify_session_token(KEY, None)
    assert not verify_session_token("", token, now=1_000_001)


def test_forged_expiry_does_not_verify():
    token, _ = issue_session_token(KEY, now=1_000_000)
    _, sig = token.split(".")
    assert not verify_session_token(KEY, f"9999999999.{sig}", now=1_000_001)


def test_malformed_expiry_is_refused_not_raised():
    """The parser is total: no attacker-shaped token may raise out of it.

    ``str.isdigit()`` accepts latin-1 superscripts that ``int()`` rejects, and
    ``int()`` refuses strings over ``sys.int_max_str_digits``; both used to
    escape as ``ValueError`` (a 500 from the middleware).
    """
    assert verify_session_token(KEY, "\xb2\xb2.abc") is False
    assert verify_session_token(KEY, "٣.abc") is False          # arabic-indic digit
    assert verify_session_token(KEY, "9" * 5000 + ".x") is False
    assert verify_session_token(KEY, "9" * 21 + ".x") is False      # over the length ceiling
    # A well-formed token of the real shape still verifies (the guard is not over-tight).
    token, _ = issue_session_token(KEY, now=1_000_000)
    assert verify_session_token(KEY, token, now=1_000_001)


# ── Exemptions ──────────────────────────────────────────────────────────────

def _scope(path, method="GET", type_="http"):
    return {"type": type_, "path": path, "method": method, "headers": []}


@pytest.mark.parametrize("path", ["/health", "/healthz", "/api/session/login", "/api/session/status",
                                  "/assets/index-abc.js", "/api/external/projects", "/mcp"])
def test_exempt_paths(path):
    assert is_exempt(_scope(path, method="POST"))


@pytest.mark.parametrize("path", ["/", "/index.html", "/favicon.svg", "/project/abc", "/projects", "/new"])
def test_spa_shell_get_is_exempt(path):
    assert is_exempt(_scope(path))
    assert is_exempt(_scope(path, method="HEAD"))
    assert not is_exempt(_scope(path, method="POST"))


@pytest.mark.parametrize("path", ["/api", "/api/projects", "/api/workspace/x/files",
                                  "/api/desktop/vnc.html", "/courses/intro/", "/notes/x/", "/news/"])
def test_api_and_content_paths_are_gated(path):
    assert not is_exempt(_scope(path))


def test_websockets_are_gated_except_the_sandbox_cast_end():
    assert not is_exempt(_scope("/ws", type_="websocket"))
    assert not is_exempt(_scope("/api/terminal/ws/x", type_="websocket"))
    assert not is_exempt(_scope("/api/browser/ws/p1", type_="websocket"))
    # The extension inside the sandbox cannot hold a cookie; the user's browser can.
    assert is_exempt(_scope("/api/browser/cast/sandbox", type_="websocket"))
    assert not is_exempt(_scope("/api/browser/cast/client", type_="websocket"))
    assert not is_exempt(_scope("/api/browser/cast/sandbox/extra", type_="websocket"))


# ── Middleware on the real app ──────────────────────────────────────────────

def test_api_without_credentials_is_401_with_contract_body(gated):
    resp = gated.get("/api/projects")
    assert resp.status_code == 401
    assert resp.json() == {"error": "internal_key_required"}
    assert gated.post("/api/projects", json={"name": "x"}).status_code == 401


def test_header_grants_access(gated):
    assert gated.get("/api/projects", headers={HEADER: KEY}).status_code == 200
    assert gated.get("/api/projects", headers={HEADER: "wrong"}).status_code == 401


def test_login_sets_cookie_that_grants_access(gated):
    bad = gated.post("/api/session/login", json={"key": "nope"})
    assert bad.status_code == 401 and bad.json() == {"error": "invalid_key"}
    assert COOKIE not in bad.cookies

    ok = gated.post("/api/session/login", json={"key": KEY})
    assert ok.status_code == 200 and ok.json()["ok"] is True
    set_cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=strict" in set_cookie
    assert "secure" not in set_cookie          # plain http request
    token = ok.cookies[COOKIE]
    assert verify_session_token(KEY, token)

    # The TestClient persists the cookie jar.
    assert gated.get("/api/projects").status_code == 200
    status = gated.get("/api/session/status").json()
    assert status == {"required": True, "authenticated": True}

    out = gated.post("/api/session/logout")
    assert out.status_code == 200
    assert gated.get("/api/projects").status_code == 401


def test_login_marks_cookie_secure_behind_https(gated):
    ok = gated.post("/api/session/login", json={"key": KEY},
                    headers={"x-forwarded-proto": "https"})
    assert "secure" in ok.headers["set-cookie"].lower()


def test_exempt_surfaces_pass_without_credentials(gated):
    assert gated.get("/health").status_code == 200
    assert gated.get("/api/session/status").json() == {"required": True, "authenticated": False}
    # /api/external has its own credential model (dev mode in the test env).
    assert gated.get("/api/external/projects").status_code == 200


@pytest.mark.skipif(not STATIC_DIR.exists(), reason="frontend bundle not built")
def test_spa_shell_renders_without_credentials_but_content_router_is_gated(gated):
    assert gated.get("/").status_code == 200
    assert gated.get("/project/abc").status_code == 200
    assert gated.get("/assets/nope.js").status_code == 404   # exempt, plain 404
    assert gated.get("/courses/intro/").status_code == 401


def test_websocket_is_refused_with_4401_before_accept(gated):
    with pytest.raises(WebSocketDisconnect) as exc:
        with gated.websocket_connect("/ws"):
            pass
    assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_malformed_session_cookie_is_401_not_500(client, monkeypatch):
    """An unauthenticated caller must not be able to make the gate throw.

    ``raise_server_exceptions=False`` so a regression shows as a 500 body
    rather than an exception escaping the test. (The TestClient re-encodes
    non-ASCII header values as UTF-8, so only the long-digit variant reaches
    the middleware verbatim here; the superscript case is covered on the pure
    function above.)
    """
    from teamwork import internal_auth

    monkeypatch.setattr(settings, "internal_api_key", KEY)
    internal_auth._LOGIN_FAILURES.clear()
    lenient = TestClient(InternalKeyMiddleware(client.app, key=KEY), raise_server_exceptions=False)
    cookie = b"teamwork_session=" + b"9" * 5000 + b".x"

    resp = lenient.get("/api/projects", headers={b"cookie": cookie})
    assert resp.status_code == 401
    assert resp.json() == {"error": "internal_key_required"}

    # The same parser backs the exempt status endpoint via _authorised_request.
    status = lenient.get("/api/session/status", headers={b"cookie": cookie})
    assert status.status_code == 200
    assert status.json() == {"required": True, "authenticated": False}

    # And the websocket scope: refused before accept, not an exception.
    with pytest.raises(WebSocketDisconnect) as exc:
        with lenient.websocket_connect("/ws", headers={b"cookie": cookie}):
            pass
    assert exc.value.code == WS_CLOSE_UNAUTHORIZED


def test_websocket_connects_with_header_or_cookie(gated):
    with gated.websocket_connect("/ws", headers={HEADER: KEY}) as ws:
        assert ws.receive_json()["type"] == "connected"
    token, _ = issue_session_token(KEY)
    with gated.websocket_connect("/ws", headers={"cookie": f"{COOKIE}={token}"}) as ws:
        assert ws.receive_json()["type"] == "connected"


def test_login_backs_off_after_repeated_failures(gated):
    from teamwork import internal_auth

    internal_auth._LOGIN_FAILURES.clear()
    # The free attempts each answer 401; the one after them sets the first 1s lockout.
    for _ in range(internal_auth._LOGIN_FREE_ATTEMPTS + 1):
        assert gated.post("/api/session/login", json={"key": "a"}).status_code == 401
    # Inside that window even the right key is throttled, not evaluated.
    resp = gated.post("/api/session/login", json={"key": KEY})
    assert resp.status_code == 429 and resp.json()["error"] == "too_many_attempts"
    assert gated.get("/api/projects").status_code == 401   # still no session
    internal_auth._LOGIN_FAILURES.clear()


# ── Default off: an empty key changes nothing ───────────────────────────────

def test_empty_key_changes_nothing(client):
    """The real app as tests see it (no key): open API, open websocket, inert session routes."""
    assert settings.internal_api_key == ""
    assert client.get("/api/projects").status_code == 200
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "connected"
    assert client.get("/api/session/status").json() == {"required": False, "authenticated": True}
    resp = client.post("/api/session/login", json={"key": "anything"})
    assert resp.status_code == 400
    assert resp.json() == {"error": "internal_key_not_configured"}
    assert all(m.cls is not InternalKeyMiddleware for m in client.app.user_middleware)


def test_middleware_refuses_to_install_without_a_key(client):
    with pytest.raises(RuntimeError):
        InternalKeyMiddleware(client.app, key="")


def test_session_ttl_is_thirty_days():
    _, expires_at = issue_session_token(KEY, now=time.time())
    assert 29 * 86400 < expires_at - time.time() <= 30 * 86400
