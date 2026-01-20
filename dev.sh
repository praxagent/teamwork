#!/usr/bin/env bash
#
# TeamWork Development Server
# Runs both backend and frontend concurrently with proper cleanup
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Process IDs
BACKEND_PID=""
FRONTEND_PID=""

# Script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Log functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_header() { echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"; }

# Stop a process and all its children
stop_process_tree() {
    local pid=$1
    local signal=${2:-TERM}
    
    # Get all child processes
    local children
    children=$(pgrep -P "$pid" 2>/dev/null)
    
    # Stop children first (recursively)
    for child in $children; do
        stop_process_tree "$child" "$signal"
    done
    
    # Stop the process itself
    kill -"$signal" "$pid" 2>/dev/null || true
}

# Cleanup function
cleanup() {
    echo ""
    log_header "Shutting down..."
    
    local exit_code=0
    
    # Stop backend and all its children (uvicorn spawns workers)
    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        log_info "Stopping backend (PID: $BACKEND_PID)..."
        stop_process_tree "$BACKEND_PID" TERM
        
        # Wait for graceful shutdown (max 3 seconds)
        local count=0
        while kill -0 "$BACKEND_PID" 2>/dev/null && [[ $count -lt 30 ]]; do
            sleep 0.1
            ((count++))
        done
        
        # Force stop if still running
        if kill -0 "$BACKEND_PID" 2>/dev/null; then
            log_warn "Backend didn't stop gracefully, forcing..."
            stop_process_tree "$BACKEND_PID" 9
        fi
        log_success "Backend stopped"
    fi
    
    # Stop frontend and all its children (npm/vite spawns workers)
    if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        log_info "Stopping frontend (PID: $FRONTEND_PID)..."
        stop_process_tree "$FRONTEND_PID" TERM
        
        # Wait for graceful shutdown (max 3 seconds)
        local count=0
        while kill -0 "$FRONTEND_PID" 2>/dev/null && [[ $count -lt 30 ]]; do
            sleep 0.1
            ((count++))
        done
        
        # Force stop if still running
        if kill -0 "$FRONTEND_PID" 2>/dev/null; then
            log_warn "Frontend didn't stop gracefully, forcing..."
            stop_process_tree "$FRONTEND_PID" 9
        fi
        log_success "Frontend stopped"
    fi
    
    # Also stop any uvicorn/vite processes that might have escaped
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -f "vite.*5173\|vite.*5174" 2>/dev/null || true
    
    # Note: Claude Code processes spawned by agents are children of uvicorn,
    # so they should be stopped when we stop the backend process tree.
    # We do NOT auto-kill "claude -p" globally as that would kill user's own sessions.
    
    # Stop any orphaned child processes from this script
    jobs -p | xargs -r kill 2>/dev/null || true
    
    log_success "Cleanup complete"
    exit $exit_code
}

# Set up signal traps
trap cleanup EXIT
trap 'exit 130' INT      # Ctrl+C
trap 'exit 143' TERM     # kill
trap 'exit 131' QUIT     # Ctrl+\
trap 'exit 129' HUP      # Terminal closed

# Stop any leftover processes from previous runs
cleanup_stale_processes() {
    local stopped=false
    
    # Check for leftover uvicorn
    if pgrep -f "uvicorn app.main:app" >/dev/null 2>&1; then
        log_warn "Found leftover backend process, stopping..."
        pkill -9 -f "uvicorn app.main:app" 2>/dev/null || true
        stopped=true
    fi
    
    # Check for leftover vite on our ports
    if lsof -ti:5173 >/dev/null 2>&1; then
        log_warn "Found process on port 5173, stopping..."
        lsof -ti:5173 | xargs kill -9 2>/dev/null || true
        stopped=true
    fi
    
    if lsof -ti:8000 >/dev/null 2>&1; then
        log_warn "Found process on port 8000, stopping..."
        lsof -ti:8000 | xargs kill -9 2>/dev/null || true
        stopped=true
    fi
    
    # Check for Claude Code CLI processes (just warn, don't kill - might be user's own sessions)
    if pgrep -f "claude -p" >/dev/null 2>&1; then
        log_warn "Found running Claude Code processes. If these are from a previous dev.sh run, stop them with: pkill -f 'claude -p'"
    fi
    
    if [[ "$stopped" == "true" ]]; then
        sleep 1  # Give processes time to stop
    fi
}

# Check prerequisites
check_prerequisites() {
    log_header "Checking Prerequisites"
    
    # First, clean up any stale processes
    cleanup_stale_processes
    
    local missing=()
    
    # Check Python
    if command -v python3 &>/dev/null; then
        log_success "Python3: $(python3 --version)"
    else
        missing+=("python3")
    fi
    
    # Check uv
    if command -v uv &>/dev/null; then
        log_success "uv: $(uv --version)"
    else
        log_warn "uv not found, will try to install..."
        pip install uv || missing+=("uv")
    fi
    
    # Check Node.js
    if command -v node &>/dev/null; then
        log_success "Node.js: $(node --version)"
    else
        missing+=("node")
    fi
    
    # Check npm
    if command -v npm &>/dev/null; then
        log_success "npm: $(npm --version)"
    else
        missing+=("npm")
    fi
    
    # Check Claude Code CLI
    if command -v claude &>/dev/null; then
        log_success "Claude Code CLI: installed"
    else
        log_warn "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
    fi
    
    # Check .env file
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        log_success ".env file found"
    else
        log_error ".env file not found!"
        log_info "Copy .env.example to .env and add your API keys:"
        log_info "  cp .env.example .env"
        exit 1
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi
}

# Setup backend
setup_backend() {
    log_header "Setting up Backend"
    
    cd "$SCRIPT_DIR/backend"
    
    # Create/update virtual environment
    if [[ ! -d ".venv" ]]; then
        log_info "Creating virtual environment..."
        uv venv
    fi
    
    # Install dependencies
    log_info "Installing Python dependencies..."
    uv pip install -e . --quiet
    
    log_success "Backend ready"
}

# Setup frontend
setup_frontend() {
    log_header "Setting up Frontend"
    
    cd "$SCRIPT_DIR/frontend"
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules" ]]; then
        log_info "Installing Node.js dependencies..."
        npm install --silent
    else
        log_info "Node.js dependencies up to date"
    fi
    
    log_success "Frontend ready"
}

# Create data directories
setup_directories() {
    log_info "Creating data directories..."
    mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/workspace"
    log_success "Directories ready"
}

# Build Docker images for agents and terminal
setup_docker_images() {
    log_header "Setting up Docker Images"
    
    # Check if Docker is available
    if ! command -v docker &>/dev/null; then
        log_warn "Docker not found - skipping image builds"
        log_info "Agent Docker mode will not be available"
        return 0
    fi
    
    # Check if Docker daemon is running
    if ! docker info &>/dev/null 2>&1; then
        log_warn "Docker daemon not running - skipping image builds"
        log_info "Start Docker Desktop to enable Docker mode"
        return 0
    fi
    
    # Build agent image (always rebuild to pick up changes)
    local AGENT_IMAGE="vteam/agent:latest"
    local AGENT_DOCKERFILE="$SCRIPT_DIR/docker/agent.Dockerfile"
    
    if [[ -f "$AGENT_DOCKERFILE" ]]; then
        log_info "Building agent image..."
        if docker build -t "$AGENT_IMAGE" -f "$AGENT_DOCKERFILE" "$SCRIPT_DIR/docker" --quiet >/dev/null 2>&1; then
            log_success "Agent image ready ($AGENT_IMAGE)"
        else
            log_error "Agent image build failed!"
            log_info "Try manually: docker build -t $AGENT_IMAGE -f $AGENT_DOCKERFILE docker/"
        fi
    fi
    
    # Build terminal image (for Executive Access)
    local TERMINAL_IMAGE="vteam-terminal:latest"
    local TERMINAL_DOCKERFILE="$SCRIPT_DIR/docker/terminal.Dockerfile"
    
    if [[ -f "$TERMINAL_DOCKERFILE" ]]; then
        # Check if image already exists
        if docker images -q "$TERMINAL_IMAGE" 2>/dev/null | grep -q .; then
            log_success "Terminal image ready ($TERMINAL_IMAGE)"
        else
            log_info "Building terminal image (first run, may take a few minutes)..."
            if docker build -t "$TERMINAL_IMAGE" -f "$TERMINAL_DOCKERFILE" "$SCRIPT_DIR/docker" 2>&1 | while IFS= read -r line; do
                echo -e "${CYAN}[docker]${NC} $line"
            done; then
                log_success "Terminal image built successfully"
            else
                log_warn "Terminal image build failed - falling back to official image"
            fi
        fi
    fi
}

# Start backend
start_backend() {
    cd "$SCRIPT_DIR/backend"
    
    log_info "Starting backend server..."
    
    # Activate venv and run uvicorn
    # Use sed for coloring to get the actual uvicorn PID
    source .venv/bin/activate
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | sed -u "s/^/$(printf "${BLUE}[backend]${NC} ")/" &
    BACKEND_PID=$!
    
    # Wait a moment and find the actual uvicorn PID
    sleep 1
    UVICORN_PID=$(pgrep -f "uvicorn app.main:app" | head -1)
    if [[ -n "$UVICORN_PID" ]]; then
        BACKEND_PID=$UVICORN_PID
    fi
    
    log_success "Backend started (PID: $BACKEND_PID)"
}

# Start frontend
start_frontend() {
    cd "$SCRIPT_DIR/frontend"
    
    log_info "Starting frontend dev server..."
    
    npm run dev 2>&1 | sed -u "s/^/$(printf "${GREEN}[frontend]${NC} ")/" &
    FRONTEND_PID=$!
    
    # Wait a moment and find the actual vite/node PID
    sleep 1
    VITE_PID=$(lsof -ti:5173 2>/dev/null | head -1)
    if [[ -n "$VITE_PID" ]]; then
        FRONTEND_PID=$VITE_PID
    fi
    
    log_success "Frontend started (PID: $FRONTEND_PID)"
}

# Wait for servers to be ready
wait_for_servers() {
    log_info "Waiting for servers to start..."
    
    # Wait for backend
    local count=0
    while ! curl -s http://localhost:8000/health &>/dev/null && [[ $count -lt 30 ]]; do
        sleep 1
        ((count++))
    done
    
    if curl -s http://localhost:8000/health &>/dev/null; then
        log_success "Backend is ready at http://localhost:8000"
    else
        log_warn "Backend may not be ready yet"
    fi
    
    # Frontend usually starts quickly
    sleep 2
    log_success "Frontend is ready at http://localhost:5173"
}

# Main function
main() {
    log_header "TeamWork Development Server"
    
    echo -e "${CYAN}Starting local development environment...${NC}"
    echo -e "${CYAN}Press Ctrl+C to stop all servers${NC}\n"
    
    # Change to project root
    cd "$SCRIPT_DIR"
    
    # Run setup
    check_prerequisites
    setup_directories
    setup_backend
    setup_frontend
    setup_docker_images
    
    log_header "Starting Servers"
    
    # Start servers
    start_backend
    sleep 2  # Give backend a head start
    start_frontend
    
    # Wait for ready
    wait_for_servers
    
    log_header "Development Environment Ready"
    echo -e "  ${GREEN}Frontend:${NC}  http://localhost:5173"
    echo -e "  ${BLUE}Backend:${NC}   http://localhost:8000"
    echo -e "  ${BLUE}API Docs:${NC}  http://localhost:8000/docs"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all servers${NC}"
    echo ""
    
    # Wait for processes
    wait
}

# Run main
main "$@"
