# TeamWork Makefile
# Convenience commands for development and deployment

.PHONY: help dev docker-up docker-down docker-build docker-logs clean clean-docker clean-all reset-db reset-all install

help:
	@echo "TeamWork - Available Commands"
	@echo ""
	@echo "Docker Commands:"
	@echo "  make docker-up      Start all services with Docker Compose"
	@echo "  make docker-down    Stop all services"
	@echo "  make docker-build   Rebuild Docker images"
	@echo "  make docker-logs    View logs from all services"
	@echo ""
	@echo "Local Development:"
	@echo "  make dev            Start backend and frontend for development"
	@echo "  make backend        Start backend only"
	@echo "  make frontend       Start frontend only"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean          Remove generated files and caches"
	@echo "  make clean-docker   Stop and remove all vteam Docker containers"
	@echo "  make clean-all      Clean files, caches, and Docker containers"
	@echo "  make reset-db       Delete the database only"
	@echo "  make reset-all      Full reset: database, workspace, and containers"
	@echo ""

# Docker commands
docker-up:
	@mkdir -p workspace data
	docker-compose up -d
	@echo ""
	@echo "TeamWork is running!"
	@echo "  Frontend: http://localhost:3000"
	@echo "  Backend:  http://localhost:8000"
	@echo ""

docker-down:
	docker-compose down

docker-build:
	docker-compose build

docker-logs:
	docker-compose logs -f

docker-restart:
	docker-compose restart

# Local development
dev:
	@./dev.sh

backend:
	@mkdir -p data workspace
	cd backend && source .venv/bin/activate 2>/dev/null || true && uvicorn app.main:app --reload

frontend:
	cd frontend && npm run dev

# Utilities
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .ruff_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .mypy_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name dist -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/.vite 2>/dev/null || true
	@echo "Cleaned up generated files and caches"

clean-docker:
	@echo "Stopping and removing vteam containers..."
	@docker ps -a --filter "name=vteam-" --format "{{.Names}}" | xargs -r docker rm -f 2>/dev/null || true
	@echo "Removing temporary config files..."
	@rm -f /tmp/claude_config_*.json 2>/dev/null || true
	@echo "Docker cleanup complete!"
	@echo ""
	@echo "Remaining vteam images (use 'docker rmi' to remove):"
	@docker images --filter "reference=vteam*" --format "  {{.Repository}}:{{.Tag}} ({{.Size}})"

clean-all: clean clean-docker
	@echo "Full cleanup complete!"

reset-db:
	rm -f data/vteam.db* backend/data/vteam.db*
	@echo "Database deleted. It will be recreated on next startup."

reset-all: clean-docker
	rm -f data/vteam.db* backend/data/vteam.db*
	rm -rf workspace/*
	@echo "Database, workspace, and Docker containers deleted."
	@echo "Everything will be recreated on next startup."

# Install dependencies
install:
	@mkdir -p data workspace
	cd backend && pip install uv && uv venv && uv pip install -e .
	cd frontend && npm install
	@echo "Dependencies installed!"
	@echo "Now copy .env.example to .env and add your API keys"
