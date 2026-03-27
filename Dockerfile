# TeamWork — single-container deployment (API + bundled React frontend).
# Installs the teamwork pip package and serves both API and static files.
# Build context must be the teamwork repo root.
FROM python:3.11-slim

# System deps: git, curl, Docker CLI (for terminal sessions)
RUN apt-get update && apt-get install -y \
    git curl ca-certificates gnupg gosu \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Node.js for building the React frontend
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Build frontend → src/teamwork/static/
COPY frontend/package.json frontend/package-lock.json* frontend/
RUN cd frontend && npm ci

COPY frontend/ frontend/
COPY src/ src/
COPY pyproject.toml README.md ./
RUN cd frontend && npx vite build

# Install the Python package (with bundled static files)
RUN pip install --no-cache-dir .

# Clean up build artifacts
WORKDIR /app
RUN rm -rf /build

RUN mkdir -p /app/data /workspace
RUN useradd -m -s /bin/bash appuser && chown -R appuser:appuser /app /workspace

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
    CMD curl -f http://localhost:8000/health || exit 1

USER appuser
CMD ["python", "-m", "teamwork.cli"]
