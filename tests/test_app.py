"""Smoke tests for TeamWork application."""

from teamwork import __version__, create_app


def test_version():
    # Just check it's a non-empty semver-shaped string; pinning the
    # exact version here means every release bump breaks CI.
    assert isinstance(__version__, str)
    assert __version__.count(".") >= 2


def test_create_app():
    app = create_app()
    assert app.title == "TeamWork"


def test_health_endpoint():
    from fastapi.testclient import TestClient

    app = create_app()
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
