"""API routers for TeamWork."""

from teamwork.routers.agents import router as agents_router
from teamwork.routers.browser import router as browser_router
from teamwork.routers.channels import router as channels_router
from teamwork.routers.messages import router as messages_router
from teamwork.routers.projects import router as projects_router
from teamwork.routers.tasks import router as tasks_router
from teamwork.routers.external import router as external_router
from teamwork.routers.workspace import router as workspace_router

__all__ = [
    "agents_router",
    "browser_router",
    "channels_router",
    "external_router",
    "messages_router",
    "projects_router",
    "tasks_router",
    "workspace_router",
]
