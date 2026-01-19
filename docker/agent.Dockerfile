# Agent Docker image for isolated Claude Code execution
# This image is used when DEFAULT_AGENT_RUNTIME=docker
#
# Build: docker build -t vteam/agent:latest -f docker/agent.Dockerfile .
# 
# The container runs Claude Code with:
# - Mounted workspace volume (-v /path/to/workspace:/workspace)
# - CLAUDE_CONFIG_BASE64 for authentication
# - Isolated execution environment
# - Non-root user (required for --dangerously-skip-permissions)

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    sudo \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for running Claude Code
# --dangerously-skip-permissions cannot be used with root
ARG USER_ID=1000
ARG GROUP_ID=1000

RUN groupadd -g ${GROUP_ID} agent \
    && useradd -m -u ${USER_ID} -g agent -s /bin/bash agent \
    && mkdir -p /workspace \
    && chown -R agent:agent /workspace

# Set up Claude config directory for agent user
RUN mkdir -p /home/agent/.claude \
    && echo '{"permissions":{"defaultMode":"bypassPermissions"}}' > /home/agent/.claude/settings.json \
    && chown -R agent:agent /home/agent/.claude

# Initialize git config for agent user
RUN su - agent -c 'git config --global user.email "agent@teamwork.local" \
    && git config --global user.name "TeamWork Agent" \
    && git config --global init.defaultBranch main \
    && git config --global --add safe.directory /workspace'

# Entrypoint script that:
# 1. Fixes workspace permissions if needed
# 2. Sets up Claude config from CLAUDE_CONFIG_BASE64
# 3. Runs the command as the agent user
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Fix workspace ownership if mounted as root\n\
if [ -d /workspace ] && [ "$(stat -c %u /workspace)" = "0" ]; then\n\
    chown -R agent:agent /workspace 2>/dev/null || true\n\
fi\n\
\n\
# Set up Claude auth config from base64 if provided\n\
# NOTE: Auth goes to ~/.claude.json (NOT ~/.claude/claude.json)\n\
if [ -n "$CLAUDE_CONFIG_BASE64" ]; then\n\
    echo "$CLAUDE_CONFIG_BASE64" | base64 -d > /home/agent/.claude.json\n\
    chown agent:agent /home/agent/.claude.json\n\
    echo "Claude auth config initialized from CLAUDE_CONFIG_BASE64"\n\
fi\n\
\n\
# Ensure settings directory and bypass mode config exist\n\
mkdir -p /home/agent/.claude\n\
if [ ! -f /home/agent/.claude/settings.json ]; then\n\
    echo "{\"permissions\":{\"defaultMode\":\"bypassPermissions\"}}" > /home/agent/.claude/settings.json\n\
fi\n\
chown -R agent:agent /home/agent/.claude\n\
\n\
# Run command as agent user\n\
exec gosu agent "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD gosu agent which claude || exit 1

# Default command (overridden by agent manager)
CMD ["claude", "--version"]
