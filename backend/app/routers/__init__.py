"""API routers for the Virtual Dev Team Simulator."""

from app.routers.agents import router as agents_router
from app.routers.channels import router as channels_router
from app.routers.messages import router as messages_router
from app.routers.onboarding import router as onboarding_router
from app.routers.projects import router as projects_router
from app.routers.tasks import router as tasks_router
from app.routers.workspace import router as workspace_router

__all__ = [
    "agents_router",
    "channels_router",
    "messages_router",
    "onboarding_router",
    "projects_router",
    "tasks_router",
    "workspace_router",
]
