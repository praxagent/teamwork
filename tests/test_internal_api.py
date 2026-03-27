"""Tests for internal API endpoints (projects, channels, agents, tasks, messages)."""


# ── Health ──────────────────────────────────────────────────────────────────


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert "connections" in data


# ── Projects (internal) ────────────────────────────────────────────────────


def test_create_project(client):
    resp = client.post("/api/projects", json={
        "name": "Internal Project",
        "description": "Testing internal routes",
    })
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["name"] == "Internal Project"


def test_list_projects(client):
    client.post("/api/projects", json={"name": "P1"})
    client.post("/api/projects", json={"name": "P2"})

    resp = client.get("/api/projects")
    assert resp.status_code == 200
    data = resp.json()
    names = [p["name"] for p in data["projects"]]
    assert "P1" in names
    assert "P2" in names


def test_get_project(client):
    create_resp = client.post("/api/projects", json={"name": "Fetchable"})
    pid = create_resp.json()["id"]

    resp = client.get(f"/api/projects/{pid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Fetchable"


def test_get_nonexistent_project(client):
    resp = client.get("/api/projects/does-not-exist")
    assert resp.status_code == 404


def test_update_project(client):
    create_resp = client.post("/api/projects", json={"name": "Old Name"})
    pid = create_resp.json()["id"]

    resp = client.patch(f"/api/projects/{pid}", json={"name": "New Name"})
    assert resp.status_code == 200

    fetched = client.get(f"/api/projects/{pid}").json()
    assert fetched["name"] == "New Name"


# ── Channels ────────────────────────────────────────────────────────────────


def _make_project(client) -> str:
    resp = client.post("/api/projects", json={"name": "Channel Test"})
    return resp.json()["id"]


def test_create_channel(client):
    pid = _make_project(client)

    resp = client.post("/api/channels", json={
        "project_id": pid,
        "name": "design",
        "type": "public",
    })
    assert resp.status_code in (200, 201)
    assert resp.json()["name"] == "design"


def test_list_channels(client):
    pid = _make_project(client)
    client.post("/api/channels", json={"project_id": pid, "name": "chan1", "type": "public"})
    client.post("/api/channels", json={"project_id": pid, "name": "chan2", "type": "public"})

    resp = client.get(f"/api/channels?project_id={pid}")
    assert resp.status_code == 200
    data = resp.json()
    names = [c["name"] for c in data["channels"]]
    assert "chan1" in names
    assert "chan2" in names


def test_get_channel(client):
    pid = _make_project(client)
    create_resp = client.post("/api/channels", json={
        "project_id": pid,
        "name": "fetchable-chan",
        "type": "public",
    })
    cid = create_resp.json()["id"]

    resp = client.get(f"/api/channels/{cid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "fetchable-chan"


# ── Agents (internal) ──────────────────────────────────────────────────────


def test_create_agent_internal(client):
    pid = _make_project(client)

    resp = client.post("/api/agents", json={
        "project_id": pid,
        "name": "InternalBot",
        "role": "assistant",
    })
    assert resp.status_code in (200, 201)
    assert resp.json()["name"] == "InternalBot"


def test_list_agents(client):
    pid = _make_project(client)
    client.post("/api/agents", json={"project_id": pid, "name": "A1", "role": "dev"})
    client.post("/api/agents", json={"project_id": pid, "name": "A2", "role": "pm"})

    resp = client.get(f"/api/agents?project_id={pid}")
    assert resp.status_code == 200
    data = resp.json()
    names = [a["name"] for a in data["agents"]]
    assert "A1" in names
    assert "A2" in names


def test_get_agent(client):
    pid = _make_project(client)
    create_resp = client.post("/api/agents", json={
        "project_id": pid,
        "name": "Solo",
        "role": "dev",
    })
    aid = create_resp.json()["id"]

    resp = client.get(f"/api/agents/{aid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Solo"


def test_update_agent_status_internal(client):
    pid = _make_project(client)
    create_resp = client.post("/api/agents", json={
        "project_id": pid,
        "name": "StatusBot",
        "role": "dev",
    })
    aid = create_resp.json()["id"]

    resp = client.patch(f"/api/agents/{aid}/status?status=working")
    assert resp.status_code == 200


def test_delete_agent(client):
    pid = _make_project(client)
    create_resp = client.post("/api/agents", json={
        "project_id": pid,
        "name": "Deletable",
        "role": "dev",
    })
    aid = create_resp.json()["id"]

    resp = client.delete(f"/api/agents/{aid}")
    assert resp.status_code in (200, 204)

    # Should be gone
    resp = client.get(f"/api/agents/{aid}")
    assert resp.status_code == 404


# ── Tasks (internal) ───────────────────────────────────────────────────────


def test_create_task_internal(client):
    pid = _make_project(client)

    resp = client.post("/api/tasks", json={
        "project_id": pid,
        "title": "Internal task",
        "description": "Testing",
        "status": "pending",
    })
    assert resp.status_code in (200, 201)
    assert resp.json()["title"] == "Internal task"


def test_list_tasks(client):
    pid = _make_project(client)
    client.post("/api/tasks", json={"project_id": pid, "title": "T1"})
    client.post("/api/tasks", json={"project_id": pid, "title": "T2"})

    resp = client.get(f"/api/tasks?project_id={pid}")
    assert resp.status_code == 200
    data = resp.json()
    titles = [t["title"] for t in data["tasks"]]
    assert "T1" in titles
    assert "T2" in titles


def test_get_task(client):
    pid = _make_project(client)
    create_resp = client.post("/api/tasks", json={
        "project_id": pid,
        "title": "Fetchable task",
    })
    tid = create_resp.json()["id"]

    resp = client.get(f"/api/tasks/{tid}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Fetchable task"


def test_update_task_internal(client):
    pid = _make_project(client)
    create_resp = client.post("/api/tasks", json={
        "project_id": pid,
        "title": "Updatable",
        "status": "pending",
    })
    tid = create_resp.json()["id"]

    resp = client.patch(f"/api/tasks/{tid}", json={
        "status": "in_progress",
        "title": "Now in progress",
    })
    assert resp.status_code == 200


def test_delete_task(client):
    pid = _make_project(client)
    create_resp = client.post("/api/tasks", json={
        "project_id": pid,
        "title": "To delete",
    })
    tid = create_resp.json()["id"]

    resp = client.delete(f"/api/tasks/{tid}")
    assert resp.status_code in (200, 204)


# ── Messages (internal) ────────────────────────────────────────────────────


def test_create_and_read_message(client):
    pid = _make_project(client)
    ch_resp = client.post("/api/channels", json={
        "project_id": pid,
        "name": "msg-test",
        "type": "public",
    })
    cid = ch_resp.json()["id"]

    # Post a user message (no agent_id)
    msg_resp = client.post("/api/messages", json={
        "channel_id": cid,
        "content": "Hello from user",
    })
    assert msg_resp.status_code in (200, 201)

    # Read it back
    resp = client.get(f"/api/messages/channel/{cid}")
    assert resp.status_code == 200
    data = resp.json()
    assert any(m["content"] == "Hello from user" for m in data["messages"])


def test_delete_message(client):
    pid = _make_project(client)
    ch_resp = client.post("/api/channels", json={
        "project_id": pid,
        "name": "del-test",
        "type": "public",
    })
    cid = ch_resp.json()["id"]

    msg_resp = client.post("/api/messages", json={
        "channel_id": cid,
        "content": "Temporary",
    })
    mid = msg_resp.json()["id"]

    resp = client.delete(f"/api/messages/{mid}")
    assert resp.status_code in (200, 204)


# ── Static serving ──────────────────────────────────────────────────────────


def test_static_index(client):
    resp = client.get("/")
    # 200 if static files built, 404 otherwise — either is acceptable in test
    assert resp.status_code in (200, 404)


def test_api_docs(client):
    resp = client.get("/docs")
    assert resp.status_code == 200
