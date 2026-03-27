"""Qualitative tests for the Kanban / task-manager feature.

Exercises the full lifecycle a real agent orchestrator would drive:
  - Create tasks with priorities, teams, and assignments
  - Move tasks through status columns (pending → in_progress → review → completed)
  - Subtask hierarchy (parent ↔ child)
  - Dependency blocking / auto-unblocking
  - Filtering by status, team, and assignee
  - Deletion
"""


# ── Helpers ────────────────────────────────────────────────────────────────


def _setup_project_with_agents(client, n_agents=2):
    """Create a project + N agents via the external API, return (pid, [aid], channels)."""
    resp = client.post("/api/external/projects", json={
        "name": "Kanban Test Project",
        "webhook_url": "http://agent:9000/webhook",
    })
    assert resp.status_code == 201
    data = resp.json()
    pid = data["project_id"]
    channels = data["channels"]

    aids = []
    for i in range(n_agents):
        r = client.post(f"/api/external/projects/{pid}/agents", json={
            "name": f"Agent-{i}",
            "role": "developer",
        })
        assert r.status_code == 201
        aids.append(r.json()["agent_id"])

    return pid, aids, channels


def _create_task(client, pid, title, **kwargs):
    """Create a task via the internal tasks API and return the response JSON."""
    payload = {"project_id": pid, "title": title, **kwargs}
    resp = client.post("/api/tasks", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Basic CRUD ─────────────────────────────────────────────────────────────


def test_create_and_get_task(client):
    pid, aids, _ = _setup_project_with_agents(client)
    task = _create_task(client, pid, "Design landing page", description="Figma mockup", assigned_to=aids[0])

    assert task["title"] == "Design landing page"
    assert task["description"] == "Figma mockup"
    assert task["assigned_to"] == aids[0]
    assert task["assigned_agent_name"] == "Agent-0"
    assert task["status"] == "pending"

    # Fetch by ID
    resp = client.get(f"/api/tasks/{task['id']}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Design landing page"


def test_list_tasks_empty_board(client):
    pid, _, _ = _setup_project_with_agents(client)
    resp = client.get(f"/api/tasks?project_id={pid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tasks"] == []
    assert data["total"] == 0


def test_delete_task(client):
    pid, _, _ = _setup_project_with_agents(client)
    task = _create_task(client, pid, "Throwaway task")

    resp = client.delete(f"/api/tasks/{task['id']}")
    assert resp.status_code == 204

    resp = client.get(f"/api/tasks/{task['id']}")
    assert resp.status_code == 404


# ── Status lifecycle ───────────────────────────────────────────────────────


def test_full_status_lifecycle(client):
    """pending → in_progress → review → completed — the happy path."""
    pid, aids, _ = _setup_project_with_agents(client)
    task = _create_task(client, pid, "Implement auth", assigned_to=aids[0])
    tid = task["id"]

    for next_status in ["in_progress", "review", "completed"]:
        resp = client.patch(f"/api/tasks/{tid}", json={"status": next_status})
        assert resp.status_code == 200
        assert resp.json()["status"] == next_status

    # Final state check
    final = client.get(f"/api/tasks/{tid}").json()
    assert final["status"] == "completed"


def test_reassign_task(client):
    """Move a task from one agent to another mid-flight."""
    pid, aids, _ = _setup_project_with_agents(client)
    task = _create_task(client, pid, "Write tests", assigned_to=aids[0])
    tid = task["id"]

    resp = client.patch(f"/api/tasks/{tid}", json={"assigned_to": aids[1]})
    assert resp.status_code == 200
    assert resp.json()["assigned_to"] == aids[1]
    assert resp.json()["assigned_agent_name"] == "Agent-1"


# ── Priority ───────────────────────────────────────────────────────────────


def test_priority_ordering(client):
    """Tasks are returned highest-priority first."""
    pid, _, _ = _setup_project_with_agents(client)

    _create_task(client, pid, "Low priority", priority=1)
    _create_task(client, pid, "High priority", priority=10)
    _create_task(client, pid, "Medium priority", priority=5)

    resp = client.get(f"/api/tasks?project_id={pid}")
    tasks = resp.json()["tasks"]
    assert len(tasks) == 3
    assert tasks[0]["title"] == "High priority"
    assert tasks[1]["title"] == "Medium priority"
    assert tasks[2]["title"] == "Low priority"


# ── Filtering ──────────────────────────────────────────────────────────────


def test_filter_by_status(client):
    pid, aids, _ = _setup_project_with_agents(client)

    t1 = _create_task(client, pid, "Done task", assigned_to=aids[0])
    _create_task(client, pid, "Pending task")

    client.patch(f"/api/tasks/{t1['id']}", json={"status": "completed"})

    resp = client.get(f"/api/tasks?project_id={pid}&status=completed")
    tasks = resp.json()["tasks"]
    assert len(tasks) == 1
    assert tasks[0]["title"] == "Done task"

    resp = client.get(f"/api/tasks?project_id={pid}&status=pending")
    assert resp.json()["total"] == 1


def test_filter_by_team(client):
    pid, _, _ = _setup_project_with_agents(client)

    _create_task(client, pid, "Backend work", team="backend")
    _create_task(client, pid, "Frontend work", team="frontend")
    _create_task(client, pid, "More backend", team="backend")

    resp = client.get(f"/api/tasks?project_id={pid}&team=backend")
    assert resp.json()["total"] == 2


def test_filter_by_assignee(client):
    pid, aids, _ = _setup_project_with_agents(client)

    _create_task(client, pid, "Task A", assigned_to=aids[0])
    _create_task(client, pid, "Task B", assigned_to=aids[1])
    _create_task(client, pid, "Task C", assigned_to=aids[0])

    resp = client.get(f"/api/tasks?project_id={pid}&assigned_to={aids[0]}")
    assert resp.json()["total"] == 2


# ── Subtasks ───────────────────────────────────────────────────────────────


def test_subtask_hierarchy(client):
    """Create a parent task with subtasks; verify parent_only default hides children."""
    pid, aids, _ = _setup_project_with_agents(client)
    parent = _create_task(client, pid, "Epic: Payment system", assigned_to=aids[0])

    child1 = _create_task(client, pid, "Add Stripe integration", parent_task_id=parent["id"])
    child2 = _create_task(client, pid, "Add PayPal integration", parent_task_id=parent["id"])

    # Default listing (parent_only=True) should show only the parent
    resp = client.get(f"/api/tasks?project_id={pid}")
    tasks = resp.json()["tasks"]
    assert len(tasks) == 1
    assert tasks[0]["title"] == "Epic: Payment system"
    assert tasks[0]["subtask_count"] == 2

    # Fetch subtasks endpoint
    resp = client.get(f"/api/tasks/{parent['id']}/subtasks")
    assert resp.status_code == 200
    subs = resp.json()["tasks"]
    assert len(subs) == 2
    sub_titles = {s["title"] for s in subs}
    assert sub_titles == {"Add Stripe integration", "Add PayPal integration"}

    # parent_only=false shows everything
    resp = client.get(f"/api/tasks?project_id={pid}&parent_only=false")
    assert resp.json()["total"] == 3


# ── Dependency blocking / auto-unblocking ──────────────────────────────────


def test_blocking_sets_status_to_blocked(client):
    """A task created with an incomplete blocker should auto-set to 'blocked'."""
    pid, _, _ = _setup_project_with_agents(client)

    blocker = _create_task(client, pid, "Setup CI")
    assert blocker["status"] == "pending"  # not completed

    dependent = _create_task(client, pid, "Deploy to prod", blocked_by=[blocker["id"]])
    assert dependent["status"] == "blocked"
    assert dependent["is_blocked"] is True
    assert dependent["blocked_by"] == [blocker["id"]]
    assert dependent["blocked_by_titles"] == ["Setup CI"]


def test_completing_blocker_unblocks_dependent(client):
    """When a blocker task is completed, dependent tasks should auto-unblock."""
    pid, aids, _ = _setup_project_with_agents(client)

    blocker = _create_task(client, pid, "Build API", assigned_to=aids[0])
    dependent = _create_task(client, pid, "Build frontend", blocked_by=[blocker["id"]])
    assert dependent["status"] == "blocked"

    # Complete the blocker
    resp = client.patch(f"/api/tasks/{blocker['id']}", json={"status": "completed"})
    assert resp.status_code == 200

    # Dependent should now be unblocked (pending)
    dep_resp = client.get(f"/api/tasks/{dependent['id']}")
    assert dep_resp.json()["status"] == "pending"
    assert dep_resp.json()["is_blocked"] is False


def test_multiple_blockers(client):
    """Task blocked by two tasks — only unblocked when both are done."""
    pid, aids, _ = _setup_project_with_agents(client)

    b1 = _create_task(client, pid, "Design schema", assigned_to=aids[0])
    b2 = _create_task(client, pid, "Provision DB", assigned_to=aids[1])
    dep = _create_task(client, pid, "Write migrations", blocked_by=[b1["id"], b2["id"]])
    assert dep["status"] == "blocked"

    # Complete first blocker — still blocked
    client.patch(f"/api/tasks/{b1['id']}", json={"status": "completed"})
    dep_check = client.get(f"/api/tasks/{dep['id']}").json()
    assert dep_check["status"] == "blocked"

    # Complete second blocker — now unblocked
    client.patch(f"/api/tasks/{b2['id']}", json={"status": "completed"})
    dep_check = client.get(f"/api/tasks/{dep['id']}").json()
    assert dep_check["status"] == "pending"


# ── Board-level view (simulated Kanban columns) ───────────────────────────


def test_kanban_board_view(client):
    """Simulate what the frontend Kanban board fetches: tasks grouped by status."""
    pid, aids, _ = _setup_project_with_agents(client)

    # Seed board with tasks in various states
    t1 = _create_task(client, pid, "Backlog item 1")
    t2 = _create_task(client, pid, "Backlog item 2")
    t3 = _create_task(client, pid, "Active work", assigned_to=aids[0])
    t4 = _create_task(client, pid, "In review", assigned_to=aids[1])
    t5 = _create_task(client, pid, "Already done", assigned_to=aids[0])

    client.patch(f"/api/tasks/{t3['id']}", json={"status": "in_progress"})
    client.patch(f"/api/tasks/{t4['id']}", json={"status": "review"})
    client.patch(f"/api/tasks/{t5['id']}", json={"status": "completed"})

    # Fetch all tasks (the way the frontend does)
    all_tasks = client.get(f"/api/tasks?project_id={pid}").json()["tasks"]
    assert len(all_tasks) == 5

    # Group by status (what the Kanban component does)
    columns = {}
    for t in all_tasks:
        columns.setdefault(t["status"], []).append(t["title"])

    assert len(columns.get("pending", [])) == 2
    assert len(columns.get("in_progress", [])) == 1
    assert len(columns.get("review", [])) == 1
    assert len(columns.get("completed", [])) == 1
    assert "Active work" in columns["in_progress"]
    assert "Already done" in columns["completed"]


def test_update_priority_and_description(client):
    """Verify non-status field updates work correctly."""
    pid, _, _ = _setup_project_with_agents(client)
    task = _create_task(client, pid, "Refactor utils", priority=1)

    resp = client.patch(f"/api/tasks/{task['id']}", json={
        "priority": 10,
        "description": "Split into focused modules",
    })
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["priority"] == 10
    assert updated["description"] == "Split into focused modules"
