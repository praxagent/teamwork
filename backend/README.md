# vteam-backend

Virtual Dev Team Simulator - Backend

## Overview

This is the backend service for the Virtual Dev Team Simulator, built with FastAPI.

## Installation

```bash
uv venv && source .venv/bin/activate
uv pip install -e .
```

For development dependencies:

```bash
uv pip install -e ".[dev]"
```

## Running the Server

```bash
uvicorn app.main:app --reload
```

## Project Structure

- `app/` - Main application package
  - `agents/` - Agent personas, prompts, and runtime execution
  - `models/` - SQLAlchemy database models
  - `routers/` - FastAPI route handlers
  - `services/` - Business logic services
  - `websocket/` - WebSocket connection management
