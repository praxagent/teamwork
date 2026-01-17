# Custom terminal image for Executive Access
# Extends Docker's official claude-code sandbox with additional developer tools

FROM docker/sandbox-templates:claude-code

# Install additional tools as root
USER root

RUN apt-get update && apt-get install -y \
    vim \
    nano \
    python3 \
    python3-pip \
    python3-venv \
    htop \
    jq \
    tree \
    wget \
    ripgrep \
    fd-find \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Make uv available to all users
RUN cp /root/.local/bin/uv /usr/local/bin/ 2>/dev/null || true

# Create symlinks for convenience
RUN ln -sf /usr/bin/python3 /usr/bin/python 2>/dev/null || true
RUN ln -sf $(which fdfind) /usr/local/bin/fd 2>/dev/null || true

# Switch back to agent user
USER agent

# Ensure uv is in PATH for agent
ENV PATH="/home/agent/.local/bin:$PATH"
