#!/usr/bin/env bash
#
# TeamWork Development Server
# Runs backend (FastAPI + hot reload) and frontend (Vite dev server) concurrently.
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

BACKEND_PID=""
FRONTEND_PID=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_header() { echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}\n"; }

stop_process_tree() {
    local pid=$1
    local signal=${2:-TERM}
    local children
    children=$(pgrep -P "$pid" 2>/dev/null) || true
    for child in $children; do
        stop_process_tree "$child" "$signal"
    done
    kill -"$signal" "$pid" 2>/dev/null || true
}

cleanup() {
    echo ""
    log_header "Shutting down..."

    for label_pid in "backend:$BACKEND_PID" "frontend:$FRONTEND_PID"; do
        local label="${label_pid%%:*}"
        local pid="${label_pid##*:}"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            log_info "Stopping $label (PID: $pid)..."
            stop_process_tree "$pid" TERM
            local count=0
            while kill -0 "$pid" 2>/dev/null && [[ $count -lt 30 ]]; do
                sleep 0.1; ((count++))
            done
            if kill -0 "$pid" 2>/dev/null; then
                stop_process_tree "$pid" 9
            fi
            log_success "$label stopped"
        fi
    done

    pkill -f "uvicorn teamwork.main:app" 2>/dev/null || true
    pkill -f "vite.*5173\|vite.*5174" 2>/dev/null || true
    jobs -p | xargs -r kill 2>/dev/null || true
    log_success "Cleanup complete"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

check_prerequisites() {
    log_header "Checking Prerequisites"

    # Kill stale processes
    if pgrep -f "uvicorn teamwork.main:app" >/dev/null 2>&1; then
        log_warn "Found leftover backend, stopping..."
        pkill -9 -f "uvicorn teamwork.main:app" 2>/dev/null || true
        sleep 1
    fi
    for port in 5173 8000; do
        if lsof -ti:$port >/dev/null 2>&1; then
            log_warn "Port $port in use, killing..."
            lsof -ti:$port | xargs kill -9 2>/dev/null || true
            sleep 1
        fi
    done

    local missing=()
    command -v python3 &>/dev/null && log_success "Python3: $(python3 --version)" || missing+=("python3")
    command -v node &>/dev/null    && log_success "Node.js: $(node --version)"     || missing+=("node")
    command -v npm &>/dev/null     && log_success "npm: $(npm --version)"           || missing+=("npm")

    if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
        log_error ".env file not found! Copy .env.example to .env and configure it."
        exit 1
    fi
    log_success ".env file found"

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi
}

setup() {
    log_header "Installing Dependencies"
    cd "$SCRIPT_DIR"
    pip install -e ".[dev]" --quiet 2>&1 | tail -1
    log_success "Python package installed (editable)"

    cd "$SCRIPT_DIR/frontend"
    if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules" ]]; then
        npm install --silent
    fi
    log_success "Frontend dependencies ready"

    mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/workspace"
}

start_backend() {
    cd "$SCRIPT_DIR"
    log_info "Starting backend server..."
    uvicorn teamwork.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | sed -u "s/^/$(printf "${BLUE}[backend]${NC} ")/" &
    BACKEND_PID=$!
    sleep 1
    local real_pid
    real_pid=$(pgrep -f "uvicorn teamwork.main:app" | head -1) || true
    [[ -n "$real_pid" ]] && BACKEND_PID=$real_pid
    log_success "Backend started (PID: $BACKEND_PID)"
}

start_frontend() {
    cd "$SCRIPT_DIR/frontend"
    log_info "Starting frontend dev server..."
    npm run dev 2>&1 | sed -u "s/^/$(printf "${GREEN}[frontend]${NC} ")/" &
    FRONTEND_PID=$!
    sleep 1
    local real_pid
    real_pid=$(lsof -ti:5173 2>/dev/null | head -1) || true
    [[ -n "$real_pid" ]] && FRONTEND_PID=$real_pid
    log_success "Frontend started (PID: $FRONTEND_PID)"
}

main() {
    log_header "TeamWork Development Server"
    echo -e "${CYAN}Press Ctrl+C to stop all servers${NC}\n"

    cd "$SCRIPT_DIR"
    check_prerequisites
    setup

    log_header "Starting Servers"
    start_backend
    sleep 2
    start_frontend

    # Wait for backend health
    local count=0
    while ! curl -s http://localhost:8000/health &>/dev/null && [[ $count -lt 30 ]]; do
        sleep 1; ((count++))
    done

    log_header "Development Environment Ready"
    echo -e "  ${GREEN}Frontend:${NC}  http://localhost:5173"
    echo -e "  ${BLUE}Backend:${NC}   http://localhost:8000"
    echo -e "  ${BLUE}API Docs:${NC}  http://localhost:8000/docs"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all servers${NC}"
    echo ""
    wait
}

main "$@"
