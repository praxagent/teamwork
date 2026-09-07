"""workspace_dir validation and workspace file containment.

Two holes: ``str(path).startswith(str(root))`` accepted a sibling directory
whose name merely starts with the root's (``<root>-evil``), and ``workspace_dir``
was stored verbatim, so ``../../etc`` (or an absolute path) re-rooted every
file endpoint and the project delete/reset ``rmtree``.
"""
from __future__ import annotations

import pytest

from teamwork.config import settings
from teamwork.utils.workspace import validate_workspace_dir


# ── The validator ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["abc", "my_project_1a2b3c4d", "+15551234567", "12678093704",
                                   "a.b-c_d", "x" * 255])
def test_validator_accepts_single_directory_names(value):
    assert validate_workspace_dir(value) == value


@pytest.mark.parametrize("value", ["../../etc", "..", ".", "a/b", "a\\b", "/etc", "/", "",
                                   ".hidden", "-flag", "a b", "a\x00b", "a\nb", "x" * 256,
                                   "%2e%2e/x", "~"])
def test_validator_rejects_traversal_and_separators(value):
    with pytest.raises(ValueError):
        validate_workspace_dir(value)


# ── Write-time validation on the external API ───────────────────────────────

@pytest.mark.parametrize("bad", ["../../etc", "/etc", "a/b", ".."])
def test_external_create_refuses_unsafe_workspace_dir(client, bad):
    resp = client.post("/api/external/projects", json={
        "name": "Evil", "webhook_url": "http://agent:9000/webhook", "workspace_dir": bad,
    })
    # Old code: 201 and the value stored verbatim.
    assert resp.status_code == 400
    assert "workspace_dir" in resp.json()["detail"]


@pytest.mark.parametrize("bad", ["../../etc", "/etc", "a/b"])
def test_external_update_refuses_unsafe_workspace_dir(client, bad):
    pid = client.post("/api/external/projects", json={
        "name": "P", "webhook_url": "http://agent:9000/webhook"}).json()["project_id"]
    resp = client.patch(f"/api/external/projects/{pid}", json={"workspace_dir": bad})
    assert resp.status_code == 400


def test_external_still_accepts_phone_number_workspace_dir(client):
    resp = client.post("/api/external/projects", json={
        "name": "Phone", "webhook_url": "http://agent:9000/webhook", "workspace_dir": "+15551234567",
    })
    assert resp.status_code == 201 and resp.json()["workspace_dir"] == "+15551234567"


# ── Read-time containment on the workspace router ───────────────────────────

@pytest.fixture()
def sibling_layout(client, tmp_path, monkeypatch):
    """<root>/abc (the project's workspace) next to <root>/abc-evil (not)."""
    root = tmp_path / "ws"
    (root / "abc").mkdir(parents=True)
    (root / "abc" / "ok.txt").write_text("fine")
    (root / "abc-evil").mkdir()
    (root / "abc-evil" / "secret.txt").write_text("sibling secret")
    (tmp_path / "outside.txt").write_text("outside")
    monkeypatch.setattr(settings, "workspace_path", root)
    pid = client.post("/api/external/projects", json={
        "name": "P", "webhook_url": "http://agent:9000/webhook", "workspace_dir": "abc",
    }).json()["project_id"]
    return pid, root


def test_sibling_prefix_directory_is_refused(client, sibling_layout):
    pid, _ = sibling_layout
    ok = client.get(f"/api/workspace/{pid}/file", params={"path": "ok.txt"})
    assert ok.status_code == 200 and ok.json()["content"] == "fine"

    # Old code: str(".../ws/abc-evil/secret.txt").startswith(".../ws/abc") → True → 200.
    for endpoint in ("file", "download"):
        resp = client.get(f"/api/workspace/{pid}/{endpoint}",
                          params={"path": "../abc-evil/secret.txt"})
        assert resp.status_code == 403, endpoint
        assert "sibling secret" not in resp.text
    resp = client.put(f"/api/workspace/{pid}/file",
                      json={"path": "../abc-evil/planted.txt", "content": "x"})
    assert resp.status_code == 403
    assert not (sibling_layout[1] / "abc-evil" / "planted.txt").exists()


def test_parent_escape_is_refused(client, sibling_layout):
    pid, _ = sibling_layout
    resp = client.get(f"/api/workspace/{pid}/file", params={"path": "../../outside.txt"})
    assert resp.status_code == 403


def test_unknown_project_id_cannot_name_the_root_parent(client, sibling_layout):
    # Fallback path is <root>/<project_id>; ".." must not list <root>'s parent.
    resp = client.get("/api/workspace/%2e%2e/files")
    assert resp.status_code == 400


def test_stored_unsafe_workspace_dir_is_refused_at_read_time(client, sibling_layout):
    """A legacy row written before validation existed must not re-root reads."""
    import asyncio

    from sqlalchemy import text

    from teamwork.models.base import engine

    pid, _ = sibling_layout

    async def _poison():
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE projects SET workspace_dir = '../..' WHERE id = :id"),
                               {"id": pid})

    asyncio.get_event_loop().run_until_complete(_poison())
    resp = client.get(f"/api/workspace/{pid}/files")
    assert resp.status_code == 400
    resp = client.get(f"/api/workspace/{pid}/file", params={"path": "outside.txt"})
    assert resp.status_code == 400
