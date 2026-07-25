"""The wizard bypass: one call gives you a workspace you can actually type in.

The Startup / Personal Coaching options are dead — their backend went away in
v0.2.0 and they 404 on step one. This is the path that replaces them, so it has
to be the thing they were not: complete on arrival.

The subtle requirement is the channel. `POST /projects` creates the row and no
channels, so a user sent there lands somewhere with nothing to type into — a
different flavour of the same dead end.
"""
from __future__ import annotations


def test_creates_a_project(client):
    r = client.post("/api/projects/blank")
    assert r.status_code == 201
    body = r.json()
    assert body["project_id"]
    assert body["id"] == body["project_id"]  # both keys, so either caller shape works


def test_the_workspace_has_a_channel_to_type_in(client):
    r = client.post("/api/projects/blank")
    assert r.json()["channels"]["general"], "a blank workspace with no channel is not usable"


def test_the_channel_actually_exists_and_is_fetchable(client):
    body = client.post("/api/projects/blank").json()
    channels = client.get("/api/channels", params={"project_id": body["project_id"]})
    assert channels.status_code == 200
    payload = channels.json()
    listing = payload if isinstance(payload, list) else payload.get("channels", [])
    assert "general" in [c["name"] for c in listing]


def test_marked_external_so_an_agent_reconnects_instead_of_duplicating(client):
    # An agent's startup matches existing projects before creating one; getting
    # this wrong leaves two workspaces and a confusing split-brain.
    pid = client.post("/api/projects/blank").json()["project_id"]
    detail = client.get(f"/api/projects/{pid}")
    assert detail.json()["config"]["project_type"] == "external"


def test_it_is_returned_by_the_project_list(client):
    pid = client.post("/api/projects/blank").json()["project_id"]
    body = client.get("/api/projects").json()
    projects = body if isinstance(body, list) else body.get("projects", [])
    assert any(p["id"] == pid for p in projects)


def test_repeated_calls_do_not_collide(client):
    a = client.post("/api/projects/blank").json()["project_id"]
    b = client.post("/api/projects/blank").json()["project_id"]
    assert a != b


def test_it_needs_no_request_body(client):
    # The endpoint exists so the browser needs no knowledge of project_type or
    # config internals — posting nothing must work.
    assert client.post("/api/projects/blank").status_code == 201
