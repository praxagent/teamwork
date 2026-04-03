"""API routers for TeamWork."""

from teamwork.routers.agents import router as agents_router
from teamwork.routers.browser import router as browser_router
from teamwork.routers.channels import router as channels_router
from teamwork.routers.content import router as content_router
from teamwork.routers.memory import router as memory_router
from teamwork.routers.messages import router as messages_router
from teamwork.routers.observability import router as observability_router
from teamwork.routers.plugins import router as plugins_router
from teamwork.routers.projects import router as projects_router
from teamwork.routers.tasks import router as tasks_router
from teamwork.routers.external import router as external_router
from teamwork.routers.terminal import router as terminal_router
from teamwork.routers.uploads import router as uploads_router
from teamwork.routers.workspace import router as workspace_router

__all__ = [
    "agents_router",
    "browser_router",
    "channels_router",
    "content_router",
    "external_router",
    "memory_router",
    "messages_router",
    "observability_router",
    "plugins_router",
    "projects_router",
    "tasks_router",
    "terminal_router",
    "uploads_router",
    "workspace_router",
]
