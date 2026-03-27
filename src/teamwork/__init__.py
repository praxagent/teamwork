"""TeamWork — agent-agnostic collaboration shell for AI teams."""
__version__ = "0.2.0"

def create_app():
    """Create and return the configured FastAPI application."""
    from teamwork.main import app
    return app
