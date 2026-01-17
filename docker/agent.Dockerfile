# Agent Docker image for isolated Claude Code execution
# This image is used when DEFAULT_AGENT_RUNTIME=docker

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for security
RUN useradd -m -s /bin/bash agent \
    && mkdir -p /workspace \
    && chown -R agent:agent /workspace

USER agent

# Set working directory
WORKDIR /workspace

# Initialize git for the workspace
RUN git config --global user.email "agent@teamwork.local" \
    && git config --global user.name "TeamWork Agent" \
    && git config --global init.defaultBranch main

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD which claude || exit 1

# Default command (overridden by agent manager)
CMD ["claude", "--version"]
