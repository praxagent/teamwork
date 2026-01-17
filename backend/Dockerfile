# Backend Dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
RUN pip install uv

# Create app directory
WORKDIR /app

# Copy dependency files first (for better caching)
COPY pyproject.toml ./

# Install dependencies
RUN uv pip install --system -e .

# Copy application code
COPY app/ ./app/

# Create directories for data and workspace
RUN mkdir -p /app/data /workspace

# Create non-root user and set permissions
RUN useradd -m -s /bin/bash appuser \
    && chown -R appuser:appuser /app /workspace

USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
