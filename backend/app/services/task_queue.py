"""Task queue service for managing work distribution."""

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, Agent
from app.websocket import manager as ws_manager, WebSocketEvent, EventType


@dataclass
class QueuedTask:
    """A task in the queue."""

    task_id: str
    project_id: str
    team: str | None
    priority: int
    queued_at: datetime


class TaskQueue:
    """
    Manages task distribution to agents.

    Tasks are queued by team and picked up by available agents.
    """

    def __init__(self, db_session_factory: Callable[[], AsyncSession]) -> None:
        self._db_session_factory = db_session_factory
        # Queue per team (None key for cross-team tasks)
        self._queues: dict[str | None, asyncio.PriorityQueue[tuple[int, QueuedTask]]] = defaultdict(asyncio.PriorityQueue)
        # Track which agent is working on which task
        self._agent_tasks: dict[str, str] = {}  # agent_id -> task_id
        self._task_agents: dict[str, str] = {}  # task_id -> agent_id

    async def add_task(self, task_id: str, project_id: str, team: str | None, priority: int) -> None:
        """Add a task to the appropriate queue."""
        queued_task = QueuedTask(
            task_id=task_id,
            project_id=project_id,
            team=team,
            priority=priority,
            queued_at=datetime.utcnow(),
        )
        # Use negative priority so higher priority = lower number = picked first
        await self._queues[team].put((-priority, queued_task))

    async def get_next_task(self, team: str | None) -> QueuedTask | None:
        """Get the next task from a team's queue."""
        queue = self._queues.get(team)
        if not queue or queue.empty():
            return None

        try:
            _, task = queue.get_nowait()
            return task
        except asyncio.QueueEmpty:
            return None

    async def assign_task_to_agent(
        self, task_id: str, agent_id: str
    ) -> bool:
        """Assign a task to an agent."""
        if agent_id in self._agent_tasks:
            # Agent already has a task
            return False

        if task_id in self._task_agents:
            # Task already assigned
            return False

        async with self._db_session_factory() as db:
            # Update task in database
            result = await db.execute(select(Task).where(Task.id == task_id))
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.assigned_to = agent_id
            task.status = "in_progress"
            await db.commit()

            # Track assignment
            self._agent_tasks[agent_id] = task_id
            self._task_agents[task_id] = agent_id

            # Broadcast update
            await ws_manager.broadcast_to_project(
                task.project_id,
                WebSocketEvent(
                    type=EventType.TASK_UPDATE,
                    data={
                        "id": task_id,
                        "status": "in_progress",
                        "assigned_to": agent_id,
                    },
                ),
            )

            return True

    async def complete_task(self, task_id: str) -> bool:
        """Mark a task as completed."""
        async with self._db_session_factory() as db:
            result = await db.execute(select(Task).where(Task.id == task_id))
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.status = "completed"
            await db.commit()

            # Clean up tracking
            agent_id = self._task_agents.pop(task_id, None)
            if agent_id:
                self._agent_tasks.pop(agent_id, None)

            # Broadcast update
            await ws_manager.broadcast_to_project(
                task.project_id,
                WebSocketEvent(
                    type=EventType.TASK_UPDATE,
                    data={
                        "id": task_id,
                        "status": "completed",
                    },
                ),
            )

            return True

    async def move_task_to_review(self, task_id: str) -> bool:
        """Move a task to review status."""
        async with self._db_session_factory() as db:
            result = await db.execute(select(Task).where(Task.id == task_id))
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.status = "review"
            await db.commit()

            # Broadcast update
            await ws_manager.broadcast_to_project(
                task.project_id,
                WebSocketEvent(
                    type=EventType.TASK_UPDATE,
                    data={
                        "id": task_id,
                        "status": "review",
                    },
                ),
            )

            return True

    async def return_task_to_queue(self, task_id: str, reason: str | None = None) -> bool:
        """Return a task to the queue (e.g., after review rejection)."""
        async with self._db_session_factory() as db:
            result = await db.execute(select(Task).where(Task.id == task_id))
            task = result.scalar_one_or_none()

            if not task:
                return False

            # Clean up tracking
            agent_id = self._task_agents.pop(task_id, None)
            if agent_id:
                self._agent_tasks.pop(agent_id, None)

            # Reset task
            task.status = "pending"
            task.assigned_to = None
            await db.commit()

            # Re-add to queue
            await self.add_task(task_id, task.project_id, task.team, task.priority)

            # Broadcast update
            await ws_manager.broadcast_to_project(
                task.project_id,
                WebSocketEvent(
                    type=EventType.TASK_UPDATE,
                    data={
                        "id": task_id,
                        "status": "pending",
                        "assigned_to": None,
                        "return_reason": reason,
                    },
                ),
            )

            return True

    def get_agent_current_task(self, agent_id: str) -> str | None:
        """Get the task an agent is currently working on."""
        return self._agent_tasks.get(agent_id)

    def get_queue_sizes(self) -> dict[str | None, int]:
        """Get the size of each team's queue."""
        return {team: queue.qsize() for team, queue in self._queues.items()}


# Global task queue instance
task_queue: TaskQueue | None = None


def get_task_queue() -> TaskQueue:
    """Get the global task queue instance."""
    if task_queue is None:
        raise RuntimeError("Task queue not initialized")
    return task_queue
