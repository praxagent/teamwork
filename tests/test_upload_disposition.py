"""Active content (HTML/SVG/XML) downloads instead of rendering; nosniff everywhere."""
from __future__ import annotations

import httpx
import pytest
import respx

from teamwork.config import settings
from teamwork.routers.uploads import content_disposition_type


@pytest.fixture()
def project(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "workspace_path", tmp_path / "ws")
    return client.post("/api/external/projects", json={
        "name": "P", "webhook_url": "http://agent:9000/webhook"}).json()["project_id"]


@pytest.mark.parametrize("media_type, expected", [
    ("text/html", "attachment"),
    ("text/html; charset=utf-8", "attachment"),
    ("image/svg+xml", "attachment"),
    ("application/xhtml+xml", "attachment"),
    ("text/xml", "attachment"),
    ("application/xml", "attachment"),
    ("IMAGE/SVG+XML", "attachment"),
    ("image/png", "inline"),
    ("application/pdf", "inline"),
    ("audio/mpeg", "inline"),
    ("video/mp4", "inline"),
    ("text/plain", "inline"),
    (None, "inline"),
])
def test_content_disposition_type(media_type, expected):
    assert content_disposition_type(media_type) == expected


def _upload(client, pid, name, body, ctype):
    resp = client.post(f"/api/uploads/{pid}", files={"file": (name, body, ctype)})
    assert resp.status_code == 200
    return resp.json()["url"]


def test_uploaded_svg_is_an_attachment_with_nosniff(client, project):
    url = _upload(client, project, "x.svg", b"<svg onload=alert(1)></svg>", "image/svg+xml")
    resp = client.get(url)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/svg+xml")
    # Old code: no Content-Disposition (inline render) and no nosniff.
    assert resp.headers["content-disposition"].startswith("attachment")
    assert 'filename="' in resp.headers["content-disposition"]
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_uploaded_html_and_xml_are_attachments(client, project):
    for name, ctype in (("p.html", "text/html"), ("d.xml", "text/xml")):
        resp = client.get(_upload(client, project, name, b"<x/>", ctype))
        assert resp.headers["content-disposition"].startswith("attachment"), name


def test_images_pdf_media_stay_inline(client, project):
    for name, ctype in (("i.png", "image/png"), ("d.pdf", "application/pdf"),
                        ("a.mp3", "audio/mpeg"), ("v.mp4", "video/mp4")):
        resp = client.get(_upload(client, project, name, b"\x00\x01", ctype))
        assert resp.status_code == 200
        assert "content-disposition" not in resp.headers, name
        assert resp.headers["x-content-type-options"] == "nosniff"


def test_every_response_carries_nosniff(client):
    assert client.get("/health").headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/projects").headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/nope-404").headers["x-content-type-options"] == "nosniff"


@respx.mock
def test_library_space_file_proxy_downloads_active_content(client, monkeypatch):
    monkeypatch.setattr(settings, "prax_url", "http://prax.test")
    base = "http://prax.test/teamwork/library/spaces/s/files"
    respx.get(f"{base}/page.html").mock(return_value=httpx.Response(
        200, content=b"<script>1</script>", headers={"content-type": "text/html; charset=utf-8"}))
    respx.get(f"{base}/pic.png").mock(return_value=httpx.Response(
        200, content=b"\x89PNG", headers={"content-type": "image/png"}))

    html = client.get("/api/library/spaces/s/files/page.html")
    assert html.status_code == 200
    # Old code: always 'inline; filename=...'.
    assert html.headers["content-disposition"].startswith("attachment")
    assert html.headers["x-content-type-options"] == "nosniff"

    png = client.get("/api/library/spaces/s/files/pic.png")
    assert png.headers["content-disposition"].startswith("inline")
