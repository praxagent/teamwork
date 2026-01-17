# Agent Docker image for isolated Claude Code execution

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
# Note: Replace with actual installation method when available
RUN npm install -g @anthropic/claude-code || true

# Create non-root user
RUN useradd -m -s /bin/bash agent
USER agent

# Set working directory
WORKDIR /workspace

# Default command
CMD ["claude", "-p", "Hello! I'm ready to work."]
