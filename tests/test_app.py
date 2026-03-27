"""Smoke tests for TeamWork application."""

from teamwork import __version__, create_app


def test_version():
    assert __version__ == "0.1.0"


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
