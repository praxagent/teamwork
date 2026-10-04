"""The cover upload reaches Prax with the image (it used to send an empty
POST, so every upload came back 'No file uploaded')."""
from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from teamwork.routers import library as lib


class _Client:
    def __init__(self, status=201, body=None):
        self.calls, self.status, self.body = [], status, body or {"status": "saved"}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kw):
        self.calls.append((url, kw.get("files")))
        return httpx.Response(self.status, json=self.body)


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(lib.settings, "prax_url", "http://prax.test")
    app = FastAPI()
    app.include_router(lib.router, prefix="/api")

    def use(client):
        monkeypatch.setattr(lib, "prax_client", lambda timeout: client)
        return client
    return TestClient(app), use


def test_the_image_is_forwarded(setup):
    tc, use = setup
    prax = use(_Client())
    resp = tc.post("/api/library/spaces/la/cover", files={"file": ("cover.png", b"\x89PNG data", "image/png")})
    assert resp.status_code == 201
    url, files = prax.calls[0]
    assert url == "http://prax.test/teamwork/library/spaces/la/cover"
    assert files["file"] == ("cover.png", b"\x89PNG data", "image/png")


def test_prax_refusals_come_through(setup):
    tc, use = setup
    use(_Client(status=413, body={"error": "Cover image too large (max 10 MB)"}))
    resp = tc.post("/api/library/spaces/la/cover", files={"file": ("big.png", b"x", "image/png")})
    assert resp.status_code == 413 and "too large" in resp.json()["error"]
