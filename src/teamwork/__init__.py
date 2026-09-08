"""TeamWork — agent-agnostic collaboration shell for AI teams."""
__version__ = "0.22.2"

def create_app():
    """Create and return the configured FastAPI application."""
    from teamwork.main import app
    return app
