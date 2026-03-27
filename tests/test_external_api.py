"""Tests for the external agent API — the primary interface for orchestrators like Prax."""


# ── Projects ────────────────────────────────────────────────────────────────


def test_create_project(client):
    resp = client.post("/api/external/projects", json={
        "name": "Test Project",
        "description": "A test workspace",
        "webhook_url": "http://agent:9000/webhook",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Project"
    assert "project_id" in data
    assert "general" in data["channels"]
    assert "engineering" in data["channels"]
    assert "research" in data["channels"]


def test_create_project_with_workspace_dir(client):
    resp = client.post("/api/external/projects", json={
        "name": "Custom Workspace",
        "webhook_url": "http://agent:9000/webhook",
        "workspace_dir": "+15551234567",
    })
    assert resp.status_code == 201
    assert resp.json()["workspace_dir"] == "+15551234567"


def test_list_projects_empty(client):
    resp = client.get("/api/external/projects")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_projects_returns_external_only(client):
    # Create an external project
    client.post("/api/external/projects", json={
        "name": "External One",
        "webhook_url": "http://agent:9000/webhook",
    })
    resp = client.get("/api/external/projects")
    assert resp.status_code == 200
    projects = resp.json()
    assert len(projects) == 1
    assert projects[0]["name"] == "External One"
    assert "channels" in projects[0]
    assert "agents" in projects[0]


def test_update_project(client):
    create_resp = client.post("/api/external/projects", json={
        "name": "Updatable",
        "webhook_url": "http://old/webhook",
    })
    pid = create_resp.json()["project_id"]

    resp = client.patch(f"/api/external/projects/{pid}", json={
        "webhook_url": "http://new/webhook",
        "workspace_dir": "new-dir",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


def test_update_nonexistent_project(client):
    resp = client.patch("/api/external/projects/no-such-id", json={
        "webhook_url": "http://x",
    })
    assert resp.status_code == 404


# ── Agents ──────────────────────────────────────────────────────────────────


def _create_project(client) -> dict:
    """Helper: create a project and return the response data."""
    resp = client.post("/api/external/projects", json={
        "name": "Agent Test Project",
        "webhook_url": "http://agent:9000/webhook",
    })
    return resp.json()


def test_create_agent(client):
    project = _create_project(client)
    pid = project["project_id"]

    resp = client.post(f"/api/external/projects/{pid}/agents", json={
        "name": "Atlas",
        "role": "orchestrator",
        "soul_prompt": "You are Atlas.",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Atlas"
    assert "agent_id" in data


def test_create_multiple_agents(client):
    project = _create_project(client)
    pid = project["project_id"]

    for name, role in [("Planner", "planner"), ("Coder", "developer"), ("Reviewer", "reviewer")]:
        resp = client.post(f"/api/external/projects/{pid}/agents", json={
            "name": name,
            "role": role,
        })
        assert resp.status_code == 201

    # Verify they show up in project listing
    projects = client.get("/api/external/projects").json()
    assert len(projects[0]["agents"]) == 3


def test_create_agent_nonexistent_project(client):
    resp = client.post("/api/external/projects/no-such-id/agents", json={
        "name": "Ghost",
        "role": "assistant",
    })
    assert resp.status_code == 404


def test_update_agent_status(client):
    project = _create_project(client)
    pid = project["project_id"]

    agent_resp = client.post(f"/api/external/projects/{pid}/agents", json={
        "name": "Worker",
        "role": "developer",
    })
    aid = agent_resp.json()["agent_id"]

    for status in ["working", "idle", "offline"]:
        resp = client.patch(
            f"/api/external/projects/{pid}/agents/{aid}/status",
            json={"status": status},
        )
        assert resp.status_code == 200


def test_update_agent_status_nonexistent(client):
    project = _create_project(client)
    pid = project["project_id"]

    resp = client.patch(
        f"/api/external/projects/{pid}/agents/no-such-agent/status",
        json={"status": "working"},
    )
    assert resp.status_code == 404


# ── Messages ────────────────────────────────────────────────────────────────


def _create_project_with_agent(client) -> tuple[str, str, dict[str, str]]:
    """Helper: create project + one agent. Returns (project_id, agent_id, channels)."""
    project = _create_project(client)
    pid = project["project_id"]
    channels = project["channels"]

    agent_resp = client.post(f"/api/external/projects/{pid}/agents", json={
        "name": "Messenger",
        "role": "assistant",
    })
    aid = agent_resp.json()["agent_id"]
    return pid, aid, channels


def test_send_message(client):
    pid, aid, channels = _create_project_with_agent(client)

    resp = client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": channels["general"],
        "agent_id": aid,
        "content": "Hello from the agent!",
    })
    assert resp.status_code == 201
    assert "message_id" in resp.json()


def test_send_system_message(client):
    pid, _, channels = _create_project_with_agent(client)

    resp = client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": channels["general"],
        "content": "System notification",
        "message_type": "system",
    })
    assert resp.status_code == 201


def test_send_message_wrong_channel(client):
    pid, aid, _ = _create_project_with_agent(client)

    resp = client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": "nonexistent-channel-id",
        "agent_id": aid,
        "content": "Should fail",
    })
    assert resp.status_code == 404


def test_send_message_wrong_agent(client):
    pid, _, channels = _create_project_with_agent(client)

    resp = client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": channels["general"],
        "agent_id": "nonexistent-agent-id",
        "content": "Should fail",
    })
    assert resp.status_code == 404


def test_read_messages(client):
    pid, aid, channels = _create_project_with_agent(client)
    ch_id = channels["general"]

    # Send a few messages
    for i in range(3):
        client.post(f"/api/external/projects/{pid}/messages", json={
            "channel_id": ch_id,
            "agent_id": aid,
            "content": f"Message {i}",
        })

    # Read them back via the internal messages API
    resp = client.get(f"/api/messages/channel/{ch_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 3
    assert len(data["messages"]) >= 3


def test_typing_indicator(client):
    pid, aid, channels = _create_project_with_agent(client)

    resp = client.post(f"/api/external/projects/{pid}/typing", json={
        "channel_id": channels["general"],
        "agent_id": aid,
        "is_typing": True,
    })
    assert resp.status_code == 200

    # Stop typing
    resp = client.post(f"/api/external/projects/{pid}/typing", json={
        "channel_id": channels["general"],
        "agent_id": aid,
        "is_typing": False,
    })
    assert resp.status_code == 200


def test_typing_indicator_nonexistent_agent(client):
    project = _create_project(client)
    pid = project["project_id"]

    resp = client.post(f"/api/external/projects/{pid}/typing", json={
        "channel_id": project["channels"]["general"],
        "agent_id": "ghost",
        "is_typing": True,
    })
    assert resp.status_code == 404


# ── Tasks ───────────────────────────────────────────────────────────────────


def test_create_task(client):
    pid, aid, _ = _create_project_with_agent(client)

    resp = client.post(f"/api/external/projects/{pid}/tasks", json={
        "title": "Implement login",
        "description": "OAuth2 with Google",
        "assigned_to": aid,
        "status": "in_progress",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Implement login"
    assert "task_id" in data


def test_create_task_unassigned(client):
    project = _create_project(client)
    pid = project["project_id"]

    resp = client.post(f"/api/external/projects/{pid}/tasks", json={
        "title": "Backlog item",
    })
    assert resp.status_code == 201


def test_update_task(client):
    pid, aid, _ = _create_project_with_agent(client)

    create_resp = client.post(f"/api/external/projects/{pid}/tasks", json={
        "title": "WIP Task",
        "assigned_to": aid,
        "status": "in_progress",
    })
    tid = create_resp.json()["task_id"]

    resp = client.patch(f"/api/external/projects/{pid}/tasks/{tid}", json={
        "status": "completed",
        "title": "Completed Task",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


def test_update_nonexistent_task(client):
    project = _create_project(client)
    pid = project["project_id"]

    resp = client.patch(f"/api/external/projects/{pid}/tasks/no-such-task", json={
        "status": "completed",
    })
    assert resp.status_code == 404


def test_task_lifecycle(client):
    """Full lifecycle: create -> assign -> in_progress -> completed."""
    pid, aid, _ = _create_project_with_agent(client)

    # Create
    resp = client.post(f"/api/external/projects/{pid}/tasks", json={
        "title": "Full lifecycle task",
        "status": "pending",
    })
    tid = resp.json()["task_id"]

    # Assign and start
    client.patch(f"/api/external/projects/{pid}/tasks/{tid}", json={
        "assigned_to": aid,
        "status": "in_progress",
    })

    # Complete
    resp = client.patch(f"/api/external/projects/{pid}/tasks/{tid}", json={
        "status": "completed",
    })
    assert resp.status_code == 200


# ── Full workflow ───────────────────────────────────────────────────────────


def test_full_agent_workflow(client):
    """Simulate Prax's startup and message flow end-to-end."""
    # 1. Create project
    project_resp = client.post("/api/external/projects", json={
        "name": "Prax Workspace",
        "description": "Controlled by Prax",
        "webhook_url": "http://prax:5001/teamwork/webhook",
    })
    assert project_resp.status_code == 201
    pid = project_resp.json()["project_id"]
    channels = project_resp.json()["channels"]

    # 2. Register agents (like Prax does at startup)
    agents = {}
    for name, role in [("Prax", "orchestrator"), ("Planner", "planner"), ("Executor", "developer")]:
        resp = client.post(f"/api/external/projects/{pid}/agents", json={
            "name": name,
            "role": role,
            "soul_prompt": f"You are {name}.",
        })
        assert resp.status_code == 201
        agents[name] = resp.json()["agent_id"]

    # 3. Prax sends a message
    msg_resp = client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": channels["general"],
        "agent_id": agents["Prax"],
        "content": "I'm online and ready.",
    })
    assert msg_resp.status_code == 201

    # 4. Create a task
    task_resp = client.post(f"/api/external/projects/{pid}/tasks", json={
        "title": "Build login page",
        "assigned_to": agents["Executor"],
        "status": "in_progress",
    })
    assert task_resp.status_code == 201
    tid = task_resp.json()["task_id"]

    # 5. Executor posts progress to engineering channel
    client.post(f"/api/external/projects/{pid}/messages", json={
        "channel_id": channels["engineering"],
        "agent_id": agents["Executor"],
        "content": "Starting work on login page.",
    })

    # 6. Update agent status
    client.patch(
        f"/api/external/projects/{pid}/agents/{agents['Executor']}/status",
        json={"status": "working"},
    )

    # 7. Complete task
    client.patch(f"/api/external/projects/{pid}/tasks/{tid}", json={
        "status": "completed",
    })

    # 8. Set agent back to idle
    resp = client.patch(
        f"/api/external/projects/{pid}/agents/{agents['Executor']}/status",
        json={"status": "idle"},
    )
    assert resp.status_code == 200

    # 9. Verify messages are persisted
    data = client.get(f"/api/messages/channel/{channels['general']}").json()
    assert any(m["content"] == "I'm online and ready." for m in data["messages"])

    data_eng = client.get(f"/api/messages/channel/{channels['engineering']}").json()
    assert any(m["content"] == "Starting work on login page." for m in data_eng["messages"])
