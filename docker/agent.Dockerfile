# Agent Docker image for isolated Claude Code execution
# ALL agents run in Docker containers - no local execution allowed
#
# Build: docker build -t vteam/agent:latest -f docker/agent.Dockerfile .
# 
# The container runs Claude Code with:
# - Mounted workspace volume (-v /path/to/workspace:/workspace)
# - Mounted Claude auth config (-v ~/.claude.json:/home/agent/.claude.json:ro)
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

# Set up Claude config directory for agent user with ALL bypass settings
# NOTE: Use "Bash" not "Bash(*)" - Claude Code doesn't accept parentheses for "allow all"
RUN mkdir -p /home/agent/.claude \
    && echo '{"permissions":{"defaultMode":"bypassPermissions","allow":["Bash","Read","Write","Edit"]},"hasCompletedOnboarding":true,"hasAcknowledgedCostThreshold":true,"bypassPermissionsModeAccepted":true}' > /home/agent/.claude/settings.json \
    && chown -R agent:agent /home/agent/.claude

# IS_SANDBOX=1 tells Claude Code we're in a sandbox, suppressing the bypass permissions warning
# See: https://github.com/anthropics/claude-code/issues/927
ENV IS_SANDBOX=1

# Initialize git config for agent user
RUN su - agent -c 'git config --global user.email "agent@teamwork.local" \
    && git config --global user.name "TeamWork Agent" \
    && git config --global init.defaultBranch main \
    && git config --global --add safe.directory /workspace'

# Entrypoint script that:
# 1. Fixes workspace permissions if needed
# 2. Copies mounted Claude auth config from temp mount to writable location
# 3. Runs the command as the agent user
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Fix workspace ownership if mounted as root\n\
if [ -d /workspace ] && [ "$(stat -c %u /workspace)" = "0" ]; then\n\
    chown -R agent:agent /workspace 2>/dev/null || true\n\
fi\n\
\n\
# Claude auth config is mounted read-only at /tmp/claude_config_mount.json\n\
# Copy to ~/.claude.json where Claude Code expects it (needs write access)\n\
if [ -f /tmp/claude_config_mount.json ]; then\n\
    cp /tmp/claude_config_mount.json /home/agent/.claude.json\n\
    chown agent:agent /home/agent/.claude.json\n\
    chmod 600 /home/agent/.claude.json\n\
    echo ">>> Claude auth config ready ($(wc -c < /home/agent/.claude.json) bytes)"\n\
else\n\
    echo ">>> WARNING: Claude config not mounted - will prompt for login"\n\
fi\n\
\n\
# Ensure settings directory and bypass mode config exist with ALL flags\n\
mkdir -p /home/agent/.claude\n\
echo "{\"permissions\":{\"defaultMode\":\"bypassPermissions\",\"allow\":[\"Bash\",\"Read\",\"Write\",\"Edit\"]},\"hasCompletedOnboarding\":true,\"hasAcknowledgedCostThreshold\":true,\"bypassPermissionsModeAccepted\":true}" > /home/agent/.claude/settings.json\n\
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
