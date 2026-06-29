"""Reverse-proxy authentication middleware (defense-in-depth).

For the "bind 0.0.0.0 behind an authenticating proxy" deployment (Google IAP,
Cloudflare Access, ...): when ``PROXY_AUTH_ENABLED`` is set, every request (except
exempt health paths) must carry a **valid signed JWT assertion** from the fronting
proxy. A request that bypasses the proxy straight to the bound port is then
rejected by the app itself — not only by the firewall.

Default OFF → a complete no-op (the middleware isn't even added). When ON it is
**fail-closed**: misconfiguration refuses to start, and a missing/invalid
assertion returns 401. See ``docs/security/network-exposure.md`` (Scenario B).
"""
from __future__ import annotations

import logging

import jwt
from jwt import PyJWKClient
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

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


class ProxyAuthMiddleware(BaseHTTPMiddleware):
    """Require a valid proxy-issued JWT on every non-exempt request."""

    def __init__(self, app, config: ProxyAuthConfig) -> None:
        super().__init__(app)
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

    async def dispatch(self, request: Request, call_next):
        # CORS preflight carries no credentials and is handled by CORSMiddleware
        # (registered outermost); exempt OPTIONS + health checks so the LB and
        # browsers aren't blocked.
        if request.method == "OPTIONS" or self._is_exempt(request.url.path):
            return await call_next(request)

        token = request.headers.get(self.cfg.header)
        if not token:
            return JSONResponse({"detail": "missing proxy authentication"}, status_code=401)
        try:
            claims = await run_in_threadpool(self._verify, token)
        except Exception as exc:  # noqa: BLE001 — any failure is a hard reject
            logger.warning("proxy auth rejected (%s)", type(exc).__name__)
            return JSONResponse({"detail": "invalid proxy authentication"}, status_code=401)

        request.state.proxy_identity = claims.get("email") or claims.get("sub")
        return await call_next(request)
