"""SPA catch-all containment (main.py serve_spa) and unknown-/api 404s.

Before the fix the catch-all joined the request path under the static dir and
served whatever ``is_file()`` found: ``Path(static) / "/etc/hostname"`` is
``/etc/hostname`` and ``..`` segments were followed by the OS, so a request
whose decoded path climbed out of the bundle returned a host file.
"""
from __future__ import annotations

import pytest

from teamwork.main import STATIC_DIR, resolve_static_file

# TestClient (httpx) collapses a literal ``/../`` before sending, so the raw
# form is spelled percent-encoded; the server decodes it into ``..`` segments
# before routing, which is the --path-as-is shape a real client can send.
_TRAVERSAL = "/" + "/".join(["%2e%2e"] * 12) + "/etc/hostname"


# ── Unit: the containment helper (runs with or without a built bundle) ──────

def test_resolve_static_file_serves_files_inside_the_bundle(tmp_path):
    (tmp_path / "index.html").write_text("<html/>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("1")
    assert resolve_static_file(tmp_path, "index.html") == (tmp_path / "index.html").resolve()
    assert resolve_static_file(tmp_path, "assets/app.js") == (tmp_path / "assets" / "app.js").resolve()


def test_resolve_static_file_refuses_dotdot_and_absolute_paths(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html/>")
    secret = tmp_path / "secret.txt"
    secret.write_text("host file")
    # Old code: Path(static) / "../secret.txt" .is_file() → True → served.
    assert resolve_static_file(static, "../secret.txt") is None
    assert resolve_static_file(static, "a/../../secret.txt") is None
    # Old code: Path(static) / "/etc/hostname" == Path("/etc/hostname").
    assert resolve_static_file(static, str(secret)) is None
    assert resolve_static_file(static, "") is None
    assert resolve_static_file(static, "missing.html") is None


def test_resolve_static_file_refuses_symlink_escapes(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("x")
    (static / "link.txt").symlink_to(outside)
    # A symlink inside the bundle that points outside resolves outside → refused.
    assert resolve_static_file(static, "link.txt") is None


# ── Integration: the real catch-all (needs a built frontend bundle) ─────────

needs_bundle = pytest.mark.skipif(
    not STATIC_DIR.exists(), reason="frontend bundle not built; catch-all not mounted"
)


@needs_bundle
def test_catch_all_never_serves_a_host_file(client):
    resp = client.get(_TRAVERSAL)
    # Old code: 200 text/plain with the machine's hostname.
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "<html" in resp.text.lower()
    assert "/etc/hostname" not in resp.text


@needs_bundle
def test_catch_all_refuses_absolute_path_under_double_slash(client):
    resp = client.get("//etc/hostname")
    assert resp.headers["content-type"].startswith("text/html")
    assert "<html" in resp.text.lower()


@needs_bundle
def test_unknown_api_path_is_404_not_index_html(client):
    resp = client.get("/api/definitely-not-a-route")
    # Old code: 200 text/html (the SPA shell) — an API typo looked like success.
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")
    assert client.get("/api").status_code == 404


@needs_bundle
def test_spa_deep_link_still_serves_index(client):
    resp = client.get("/project/some-id")
    assert resp.status_code == 200
    assert "<html" in resp.text.lower()
