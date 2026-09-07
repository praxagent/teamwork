"""Reverse-proxy authentication middleware (defense-in-depth).

For the "bind 0.0.0.0 behind an authenticating proxy" deployment (Google IAP,
Cloudflare Access, ...): when ``PROXY_AUTH_ENABLED`` is set, every request (except
exempt health paths) must carry a **valid signed JWT assertion** from the fronting
proxy. A request that bypasses the proxy straight to the bound port is then
rejected by the app itself — not only by the firewall.

Default OFF → a complete no-op (the middleware isn't even added). When ON it is
**fail-closed**: misconfiguration refuses to start, and a missing/invalid
assertion returns 401. See ``docs/security/network-exposure.md`` (Scenario B).

Implemented as a pure ASGI middleware, not ``BaseHTTPMiddleware``: the latter is
HTTP-only and never sees ``websocket`` scopes, so ``/ws`` (every live channel
feed) and the terminal/browser/desktop sockets bypassed the check entirely.
Websocket handshakes that fail the check are closed with code 4401 before
accept.
"""
from __future__ import annotations

import logging

import jwt
from jwt import PyJWKClient
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from teamwork.internal_auth import header_from_scope

logger = logging.getLogger(__name__)

# Per-provider defaults. Anything explicitly set in config overrides these.
_PRESETS: dict[str, dict[str, str]] = {
    "iap": {
        "header": "x-goog-iap-jwt-assertion",
        "algorithms": "ES256",
        "jwks_url": "https://www.gstatic.com/iap/verify/public_key-jwk",
        "issuer": "https://cloud.google.com/iap",
    },
    # Cloudflare Access: jwks_url is derived from the issuer (team domain) below.
    "cloudflare_access": {
        "header": "cf-access-jwt-assertion",
        "algorithms": "RS256",
        "jwks_url": "",
        "issuer": "",
    },
}


class ProxyAuthConfig:
    """Resolve the effective proxy-auth config; fail-closed if incomplete."""

    def __init__(self, settings) -> None:
        preset = _PRESETS.get((settings.proxy_auth_provider or "").lower(), {})
        self.header = (settings.proxy_auth_header or preset.get("header", "")).lower()
        self.issuer = settings.proxy_auth_issuer or preset.get("issuer", "")
        jwks = settings.proxy_auth_jwks_url or preset.get("jwks_url", "")
        if not jwks and self.issuer and (settings.proxy_auth_provider or "").lower() == "cloudflare_access":
            jwks = self.issuer.rstrip("/") + "/cdn-cgi/access/certs"
        self.jwks_url = jwks
        self.audience = settings.proxy_auth_audience
        algs = settings.proxy_auth_algorithms or preset.get("algorithms", "")
        self.algorithms = [a.strip() for a in algs.split(",") if a.strip()]
        self.exempt = tuple(
            p.strip() for p in settings.proxy_auth_exempt_paths.split(",") if p.strip()
        )
        missing = [
            name for name, val in (
                ("header", self.header),
                ("jwks_url", self.jwks_url),
                ("audience", self.audience),
                ("algorithms", self.algorithms),
            ) if not val
        ]
        if missing:
            raise RuntimeError(
                "PROXY_AUTH_ENABLED but misconfigured (missing: "
                f"{', '.join(missing)}). Refusing to start fail-open — set a "
                "PROXY_AUTH_PROVIDER preset or the explicit fields. See "
                "docs/security/network-exposure.md."
            )


#: Close code for a refused websocket handshake (private range 4000-4999).
WS_CLOSE_UNAUTHORIZED = 4401


class ProxyAuthMiddleware:
    """Require a valid proxy-issued JWT on every non-exempt http/websocket scope."""

    def __init__(self, app, config: ProxyAuthConfig) -> None:
        self.app = app
        self.cfg = config
        # PyJWKClient caches signing keys (network fetch only on cache miss).
        self._jwks = PyJWKClient(config.jwks_url)

    def _is_exempt(self, path: str) -> bool:
        return any(
            path == p or path.startswith(p.rstrip("/") + "/") for p in self.cfg.exempt
        )

    def _verify(self, token: str) -> dict:
        # Blocking (JWKS fetch + crypto) — run off the event loop by the caller.
        key = self._jwks.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=self.cfg.algorithms,
            audience=self.cfg.audience,
            issuer=self.cfg.issuer or None,
        )

    async def _reject(self, scope, receive, send, detail: str) -> None:
        if scope["type"] == "websocket":
            # Before accept, so the app never sees the connection.
            await send({"type": "websocket.close", "code": WS_CLOSE_UNAUTHORIZED,
                        "reason": detail})
            return
        await JSONResponse({"detail": detail}, status_code=401)(scope, receive, send)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        # CORS preflight carries no credentials and is handled by CORSMiddleware
        # (registered outermost); exempt OPTIONS + health checks so the LB and
        # browsers aren't blocked.
        is_preflight = scope["type"] == "http" and scope.get("method", "").upper() == "OPTIONS"
        if is_preflight or self._is_exempt(scope.get("path") or "/"):
            await self.app(scope, receive, send)
            return

        token = header_from_scope(scope, self.cfg.header)
        if not token:
            await self._reject(scope, receive, send, "missing proxy authentication")
            return
        try:
            claims = await run_in_threadpool(self._verify, token)
        except Exception as exc:  # noqa: BLE001 — any failure is a hard reject
            logger.warning("proxy auth rejected (%s)", type(exc).__name__)
            await self._reject(scope, receive, send, "invalid proxy authentication")
            return

        # Same slot Request.state reads from, so handlers see request.state.proxy_identity.
        scope.setdefault("state", {})["proxy_identity"] = claims.get("email") or claims.get("sub")
        await self.app(scope, receive, send)
