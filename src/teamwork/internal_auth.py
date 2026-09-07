"""Internal UI key — a shared secret between the browser and TeamWork (default OFF).

TeamWork's ``/api`` and websockets have no authentication of their own: whoever
can reach the port can read every channel and drive every panel. That is fine
on a loopback/tailnet deployment and not fine anywhere else. Setting
``INTERNAL_API_KEY`` closes that gap without a user database: every ``http``
and ``websocket`` request must present either

* the header ``X-Internal-Key: <key>`` (scripts, curl), or
* the session cookie minted by ``POST /api/session/login`` (the browser).

The cookie carries an HMAC-signed expiry derived from the key, so there is no
server-side session store: rotating the key invalidates every session, and a
leaked cookie is good until it expires (30 days) — ``/logout`` clears the
browser's copy but cannot revoke it. Treat the cookie like the key.

Empty key (the default): the middleware is not installed at all and nothing
below changes any behaviour. See ``is_exempt`` for what stays open when it is.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.requests import cookie_parser
from starlette.responses import JSONResponse

from teamwork.config import settings

logger = logging.getLogger(__name__)

HEADER = "x-internal-key"
COOKIE = "teamwork_session"
SESSION_TTL_SECONDS = 30 * 24 * 3600
#: Close code sent on an unauthorised websocket handshake (private range 4000-4999).
WS_CLOSE_UNAUTHORIZED = 4401
ERROR_BODY = {"error": "internal_key_required"}

# Paths that stay open with the key set. Each has a reason:
#   /health, /healthz          – load balancers and docker healthchecks hold no key
#   /api/session/              – the login/logout/status endpoints themselves
#   /assets/                   – the SPA bundle; the login screen needs it to render
#   /api/external/             – its own credential model (X-API-Key / per-agent registry)
#   /api/browser/cast/sandbox  – Known gap: the sandbox's cast extension (prax-cast-ext)
#                                cannot hold a cookie or a custom header, so its
#                                end of the relay stays open. Only that role: the
#                                /client end is the user's browser, which has the
#                                cookie, and an open client end would hand the
#                                screencast to anyone who can reach the port.
#   /mcp                       – bearer-gated by its own credential registry
_EXEMPT_PREFIXES = (
    "/api/session/",
    "/assets/",
    "/api/external/",
)
_EXEMPT_EXACT = ("/health", "/healthz", "/mcp", "/api/browser/cast/sandbox")
# The content router serves Hugo-rendered courses/notes at root — real content,
# not the SPA shell — so it is gated like the API even though it is not /api.
_CONTENT_PREFIXES = ("/courses/", "/notes/", "/news/")


# ── ASGI scope helpers ───────────────────────────────────────────────────────

def header_from_scope(scope: dict, name: str) -> str | None:
    """First value of header *name* (case-insensitive) from an ASGI scope."""
    wanted = name.lower().encode("latin-1")
    for raw_name, raw_value in scope.get("headers") or ():
        if raw_name.lower() == wanted:
            return raw_value.decode("latin-1")
    return None


def cookie_from_scope(scope: dict, name: str) -> str | None:
    raw = header_from_scope(scope, "cookie")
    if not raw:
        return None
    return cookie_parser(raw).get(name)


# ── Session tokens ───────────────────────────────────────────────────────────

def _session_secret(key: str) -> bytes:
    # Derived rather than the key itself so a token never lets anyone recover
    # the key, and so the key can be used elsewhere without cross-protocol reuse.
    return hmac.new(key.encode("utf-8"), b"teamwork-session-cookie-v1", hashlib.sha256).digest()


def issue_session_token(key: str, *, now: float | None = None) -> tuple[str, int]:
    """Return ``(token, expires_at_epoch)`` for a caller who proved the key."""
    expires_at = int((now if now is not None else time.time()) + SESSION_TTL_SECONDS)
    sig = hmac.new(_session_secret(key), str(expires_at).encode("ascii"), hashlib.sha256).hexdigest()
    return f"{expires_at}.{sig}", expires_at


def verify_session_token(key: str, token: str | None, *, now: float | None = None) -> bool:
    if not key or not token:
        return False
    expires_s, _, sig = token.partition(".")
    # Total parser: the token is attacker-supplied and this runs inside the
    # middleware, so nothing here may raise. ``str.isdigit()`` alone is not
    # enough — it accepts characters ``int()`` rejects (e.g. latin-1
    # superscripts, which reach us verbatim from the cookie header), and
    # ``int()`` also refuses strings longer than ``sys.int_max_str_digits``.
    # Real expiries are 10-digit epochs; 20 is a generous ceiling.
    if not (expires_s.isascii() and expires_s.isdigit()) or len(expires_s) > 20 or not sig:
        return False
    if int(expires_s) <= (now if now is not None else time.time()):
        return False
    expected = hmac.new(_session_secret(key), expires_s.encode("ascii"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def is_authorised(key: str, *, header: str | None, cookie: str | None) -> bool:
    if header is not None and hmac.compare_digest(header.encode("utf-8"), key.encode("utf-8")):
        return True
    return verify_session_token(key, cookie)


# ── Exemptions ───────────────────────────────────────────────────────────────

def is_exempt(scope: dict) -> bool:
    """Whether this scope may pass without a key.

    Everything is gated except the listed prefixes and the SPA shell — a
    ``GET``/``HEAD`` of a non-API, non-content path, which the catch-all in
    ``main.py`` answers with ``index.html`` (or a file from the bundle). The
    login screen cannot render otherwise. Deep links like ``/project/<id>``
    are the shell too; what they load through ``/api`` is still gated.
    """
    path = scope.get("path") or "/"
    if path in _EXEMPT_EXACT or path.startswith(_EXEMPT_PREFIXES):
        return True
    if scope["type"] != "http":
        return False
    method = scope.get("method", "GET").upper()
    if method == "OPTIONS":
        # CORS preflight carries no credentials by design; the outermost
        # CORSMiddleware answers it. A bare OPTIONS reaching the app can only 405.
        return True
    if method not in ("GET", "HEAD"):
        return False
    if path == "/api" or path.startswith("/api/") or path.startswith(_CONTENT_PREFIXES):
        return False
    return True


# ── Middleware ───────────────────────────────────────────────────────────────

class InternalKeyMiddleware:
    """Pure ASGI middleware: gate ``http`` and ``websocket`` scopes on the key.

    Pure ASGI (not ``BaseHTTPMiddleware``) because the latter never sees
    websocket scopes — a gate that skips ``/ws`` would leave every live
    channel feed open.
    """

    def __init__(self, app, key: str) -> None:
        if not key:
            raise RuntimeError("InternalKeyMiddleware installed without a key")
        self.app = app
        self.key = key

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in ("http", "websocket") or is_exempt(scope):
            await self.app(scope, receive, send)
            return
        if is_authorised(
            self.key,
            header=header_from_scope(scope, HEADER),
            cookie=cookie_from_scope(scope, COOKIE),
        ):
            await self.app(scope, receive, send)
            return
        logger.info("internal key required: refused %s %s", scope["type"], scope.get("path"))
        if scope["type"] == "websocket":
            # Refused before accept: the app never sees the connection.
            await send({"type": "websocket.close", "code": WS_CLOSE_UNAUTHORIZED,
                        "reason": "internal_key_required"})
            return
        await JSONResponse(ERROR_BODY, status_code=401)(scope, receive, send)


# ── Session endpoints (mounted always; inert until a key is configured) ─────

router = APIRouter(prefix="/session", tags=["session"])

# Per-client exponential backoff on failed logins: the first few attempts are
# free (a mistyped key should not lock anyone out), then 1s, 2s, 4s ... capped
# so a shared proxy IP cannot be held out for long. In-process and best-effort:
# the real defence is a long random key, not this table.
_LOGIN_FAILURES: dict[str, tuple[int, float]] = {}
_LOGIN_FREE_ATTEMPTS = 3
_LOGIN_BACKOFF_CAP_SECONDS = 30.0
_LOGIN_TABLE_MAX = 1000


class LoginBody(BaseModel):
    key: str


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _request_is_https(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return request.url.scheme == "https" or forwarded == "https"


def _authorised_request(request: Request) -> bool:
    key = settings.internal_api_key
    if not key:
        return True
    return is_authorised(key, header=request.headers.get(HEADER),
                         cookie=request.cookies.get(COOKIE))


@router.get("/status")
async def session_status(request: Request) -> dict:
    """Tell the UI whether a key is required and whether this caller holds one."""
    return {
        "required": bool(settings.internal_api_key),
        "authenticated": _authorised_request(request),
    }


@router.post("/login")
async def session_login(body: LoginBody, request: Request):
    key = settings.internal_api_key
    if not key:
        return JSONResponse({"error": "internal_key_not_configured"}, status_code=400)

    ip = _client_ip(request)
    now = time.monotonic()
    failures, next_allowed = _LOGIN_FAILURES.get(ip, (0, 0.0))
    if next_allowed > now:
        return JSONResponse({"error": "too_many_attempts",
                             "retry_after": round(next_allowed - now, 1)}, status_code=429)

    if not hmac.compare_digest(body.key.encode("utf-8"), key.encode("utf-8")):
        failures += 1
        over = failures - _LOGIN_FREE_ATTEMPTS
        delay = min(2.0 ** (over - 1), _LOGIN_BACKOFF_CAP_SECONDS) if over > 0 else 0.0
        if len(_LOGIN_FAILURES) >= _LOGIN_TABLE_MAX and ip not in _LOGIN_FAILURES:
            _LOGIN_FAILURES.pop(next(iter(_LOGIN_FAILURES)))
        _LOGIN_FAILURES[ip] = (failures, now + delay)
        logger.warning("internal key login failed from %s (attempt %d)", ip, failures)
        return JSONResponse({"error": "invalid_key"}, status_code=401)

    _LOGIN_FAILURES.pop(ip, None)
    token, expires_at = issue_session_token(key)
    response = JSONResponse({"ok": True, "expires_at": expires_at})
    response.set_cookie(
        COOKIE, token,
        max_age=SESSION_TTL_SECONDS,
        path="/",
        httponly=True,
        samesite="strict",
        secure=_request_is_https(request),
    )
    return response


@router.post("/logout")
async def session_logout(request: Request):
    """Clear the browser's cookie. Stateless tokens cannot be revoked server-side."""
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict",
                           secure=_request_is_https(request))
    return response
