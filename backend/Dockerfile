# Backend Dockerfile for the Virtual Dev Team Simulator

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

# Create app user
RUN useradd -m -s /bin/bash app
USER app

# Set working directory
WORKDIR /app

# Copy dependency files
COPY --chown=app:app pyproject.toml ./

# Install dependencies
RUN uv venv && uv pip install -e .

# Copy application code
COPY --chown=app:app app/ ./app/

# Create workspace directory
RUN mkdir -p /app/workspace

# Expose port
EXPOSE 8000

# Set environment variables
ENV PYTHONPATH=/app
ENV WORKSPACE_PATH=/app/workspace

# Run the application
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
