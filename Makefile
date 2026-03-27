.PHONY: build-frontend build install dev lint test actions ci clean

build-frontend:
	cd frontend && npm ci && npx vite build

build: build-frontend
	python -m build

install:
	uv pip install -e ".[dev]"

dev:
	uvicorn teamwork.main:app --host 0.0.0.0 --port 8000 --reload

lint:
	uv run ruff check .

test:
	uv run pytest tests/ -x -q

actions:
	actionlint

ci: actions lint test
	@echo "\nAll CI checks passed."

clean:
	rm -rf src/teamwork/static/ dist/ *.egg-info
