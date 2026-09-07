"""PRAX_API_KEY — the credential TeamWork presents to Prax (default off)."""
from __future__ import annotations

import httpx
import pytest
import respx

from teamwork.config import settings
from teamwork.routers.messages import _forward_to_external_webhook
from teamwork.routers.prax import prax_client, prax_headers, prax_headers_for_url

PRAX = "http://prax.test:5001"


@pytest.fixture()
def prax_configured(monkeypatch):
    monkeypatch.setattr(settings, "prax_url", PRAX)
    monkeypatch.setattr(settings, "prax_api_key", "")
    return monkeypatch


def test_no_key_means_no_header(prax_configured):
    assert prax_headers() == {}
    assert "x-api-key" not in prax_client(timeout=1.0).headers
    assert prax_headers_for_url(f"{PRAX}/teamwork/webhook") == {}


def test_key_is_attached_by_the_client_factory(prax_configured):
    prax_configured.setattr(settings, "prax_api_key", "sekrit")
    assert prax_headers() == {"X-API-Key": "sekrit"}
    assert prax_client(timeout=1.0).headers["x-api-key"] == "sekrit"


@respx.mock
def test_proxied_request_carries_the_header(client, prax_configured):
    prax_configured.setattr(settings, "prax_api_key", "sekrit")
    route = respx.get(f"{PRAX}/teamwork/model").mock(
        return_value=httpx.Response(200, json={"model": "m"}))
    assert client.get("/api/prax/model").status_code == 200
    assert route.called
    assert route.calls.last.request.headers["x-api-key"] == "sekrit"


@respx.mock
def test_proxied_request_without_key_has_no_header(client, prax_configured):
    route = respx.get(f"{PRAX}/teamwork/model").mock(
        return_value=httpx.Response(200, json={"model": "m"}))
    assert client.get("/api/prax/model").status_code == 200
    assert "x-api-key" not in route.calls.last.request.headers


@respx.mock
@pytest.mark.parametrize("path, url", [
    ("/api/agent-plan", "/teamwork/agent-plan"),
    ("/api/observability/health", "/teamwork/health"),
    ("/api/agents/graphs/active", "/execution/graphs"),
    ("/api/library/schema", "/teamwork/library/schema"),
    ("/api/plugins", "/plugins"),
    ("/api/scheduler/schedules", "/teamwork/schedules"),
    ("/api/memory/config", "/teamwork/memory/config"),
    ("/api/claude-code/sessions", "/teamwork/claude-code/sessions"),
])
def test_every_proxy_router_uses_the_shared_client(client, prax_configured, path, url):
    prax_configured.setattr(settings, "prax_api_key", "sekrit")
    route = respx.get(url__startswith=f"{PRAX}{url}").mock(
        return_value=httpx.Response(200, json={}))
    client.get(path)
    assert route.called, f"{path} did not reach Prax at {url}"
    assert route.calls.last.request.headers["x-api-key"] == "sekrit"


# ── The webhook: key goes to Prax's origin and nowhere else ─────────────────

def test_webhook_header_only_for_prax_origin(prax_configured):
    prax_configured.setattr(settings, "prax_api_key", "sekrit")
    assert prax_headers_for_url(f"{PRAX}/teamwork/webhook") == {"X-API-Key": "sekrit"}
    assert prax_headers_for_url("HTTP://PRAX.TEST:5001/teamwork/webhook") == {"X-API-Key": "sekrit"}
    assert prax_headers_for_url("http://evil.example/collect") == {}
    assert prax_headers_for_url("http://prax.test:9999/teamwork/webhook") == {}
    assert prax_headers_for_url("https://prax.test:5001/teamwork/webhook") == {}
    assert prax_headers_for_url("not a url") == {}
    assert prax_headers_for_url("http://prax.test:notaport/x") == {}
    prax_configured.setattr(settings, "prax_url", "")
    assert prax_headers_for_url(f"{PRAX}/teamwork/webhook") == {}


@respx.mock
async def test_webhook_post_carries_key_for_prax_and_not_for_others(prax_configured):
    prax_configured.setattr(settings, "prax_api_key", "sekrit")
    prax_hook = respx.post(f"{PRAX}/teamwork/webhook").mock(return_value=httpx.Response(200))
    other_hook = respx.post("http://other.test/hook").mock(return_value=httpx.Response(200))
    await _forward_to_external_webhook(f"{PRAX}/teamwork/webhook", "p", "c", "hi", "m1")
    await _forward_to_external_webhook("http://other.test/hook", "p", "c", "hi", "m2")
    assert prax_hook.calls.last.request.headers["x-api-key"] == "sekrit"
    assert "x-api-key" not in other_hook.calls.last.request.headers
