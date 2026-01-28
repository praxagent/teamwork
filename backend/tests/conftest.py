"""
Pytest configuration and shared fixtures for vteam tests.

This module provides:
- Async database session fixtures (in-memory SQLite)
- Mock API clients (OpenAI, Anthropic)
- Common test data factories
- Utility fixtures for memory testing
"""

import asyncio
import os
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.memory import Memory


# =============================================================================
# Database Fixtures
# =============================================================================

@pytest.fixture(scope="function")
async def async_engine():
    """Create an async engine with in-memory SQLite for testing."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    yield engine
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    
    await engine.dispose()


@pytest.fixture(scope="function")
async def db_session(async_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional database session for tests.
    
    Each test gets a fresh session that's rolled back after the test.
    """
    async_session_factory = async_sessionmaker(
        async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    async with async_session_factory() as session:
        yield session
        await session.rollback()


@pytest.fixture(scope="function")
async def db(db_session: AsyncSession) -> AsyncSession:
    """Alias for db_session for convenience."""
    return db_session


# =============================================================================
# Mock API Clients
# =============================================================================

@pytest.fixture
def mock_openai_client():
    """Mock OpenAI client for testing embeddings."""
    mock_client = AsyncMock()
    
    # Mock embedding response
    mock_embedding_response = MagicMock()
    mock_embedding_response.data = [
        MagicMock(embedding=[0.1] * 1536)  # Standard embedding dimension
    ]
    mock_client.embeddings.create = AsyncMock(return_value=mock_embedding_response)
    
    # Mock chat completion response
    mock_chat_response = MagicMock()
    mock_chat_response.choices = [
        MagicMock(message=MagicMock(content='[]'))
    ]
    mock_client.chat.completions.create = AsyncMock(return_value=mock_chat_response)
    
    return mock_client


@pytest.fixture
def mock_openai_embeddings():
    """Fixture that patches OpenAI embeddings with deterministic values."""
    def create_embedding(text: str) -> list[float]:
        """Create a deterministic embedding based on text hash."""
        import hashlib
        hash_val = int(hashlib.md5(text.encode()).hexdigest(), 16)
        # Create a normalized vector
        base = [(hash_val >> i) & 0xFF for i in range(0, 1536 * 8, 8)]
        magnitude = sum(x * x for x in base) ** 0.5
        if magnitude == 0:
            return [0.0] * 1536
        return [x / magnitude for x in base[:1536]]
    
    async def mock_create_embedding(**kwargs):
        text = kwargs.get("input", "")
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=create_embedding(text))]
        return mock_response
    
    with patch("openai.AsyncOpenAI") as mock_class:
        mock_instance = AsyncMock()
        mock_instance.embeddings.create = mock_create_embedding
        mock_class.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_anthropic_client():
    """Mock Anthropic client for testing."""
    mock_client = AsyncMock()
    
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="Mock response")]
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    
    return mock_client


# =============================================================================
# Memory Test Fixtures
# =============================================================================

@pytest.fixture
def sample_memory_value() -> dict[str, Any]:
    """Sample memory value for testing."""
    return {
        "content": "User prefers functional React components with hooks",
        "source": "conversation",
        "confidence": 0.9,
    }


@pytest.fixture
def sample_memory_metadata() -> dict[str, Any]:
    """Sample memory metadata for testing."""
    return {
        "type": "user_preference",
        "importance": 8,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@pytest.fixture
async def sample_memory(db: AsyncSession, sample_memory_value, sample_memory_metadata) -> Memory:
    """Create a sample memory in the database."""
    memory = Memory(
        namespace="user:test123/project:proj456/type:semantic",
        key="react_preference",
        value=sample_memory_value,
        content_text="User prefers functional React components with hooks",
        embedding=[0.1] * 1536,
        metadata_=sample_memory_metadata,
    )
    db.add(memory)
    await db.flush()
    return memory


@pytest.fixture
async def multiple_memories(db: AsyncSession) -> list[Memory]:
    """Create multiple memories for testing search and list operations."""
    memories_data = [
        {
            "namespace": "user:user1/project:proj1/semantic",
            "key": "pref_react",
            "value": {"content": "User prefers React over Vue"},
            "content_text": "User prefers React over Vue",
            "embedding": [0.1, 0.2, 0.3] + [0.0] * 1533,
            "metadata_": {"type": "user_preference", "importance": 8},
        },
        {
            "namespace": "user:user1/project:proj1/semantic",
            "key": "pref_typescript",
            "value": {"content": "User likes TypeScript strict mode"},
            "content_text": "User likes TypeScript strict mode",
            "embedding": [0.2, 0.3, 0.4] + [0.0] * 1533,
            "metadata_": {"type": "user_preference", "importance": 7},
        },
        {
            "namespace": "user:user1/project:proj1/episodic",
            "key": "task_auth",
            "value": {"content": "Implemented JWT authentication successfully"},
            "content_text": "Implemented JWT authentication successfully",
            "embedding": [0.3, 0.4, 0.5] + [0.0] * 1533,
            "metadata_": {"type": "task_completion", "importance": 6},
        },
        {
            "namespace": "user:user1/project:proj2/semantic",
            "key": "pref_database",
            "value": {"content": "Project uses PostgreSQL"},
            "content_text": "Project uses PostgreSQL",
            "embedding": [0.4, 0.5, 0.6] + [0.0] * 1533,
            "metadata_": {"type": "project_decision", "importance": 9},
        },
        {
            "namespace": "user:user2/global",
            "key": "coding_style",
            "value": {"content": "User prefers 2-space indentation"},
            "content_text": "User prefers 2-space indentation",
            "embedding": [0.5, 0.6, 0.7] + [0.0] * 1533,
            "metadata_": {"type": "user_preference", "importance": 5},
        },
    ]
    
    memories = []
    for data in memories_data:
        memory = Memory(**data)
        db.add(memory)
        memories.append(memory)
    
    await db.flush()
    return memories


# =============================================================================
# Conversation Fixtures
# =============================================================================

@pytest.fixture
def sample_conversation() -> list[dict[str, str]]:
    """Sample conversation for testing memory extraction."""
    return [
        {"role": "user", "content": "Can you help me create a React component?"},
        {"role": "assistant", "content": "Sure! Do you want a class or functional component?"},
        {"role": "user", "content": "I prefer functional components with hooks, please."},
        {"role": "assistant", "content": "Got it! Here's a functional component with useState..."},
        {"role": "user", "content": "Perfect! But please always use TypeScript instead of JavaScript."},
        {"role": "assistant", "content": "Of course! I'll use TypeScript from now on."},
    ]


@pytest.fixture
def conversation_with_correction() -> list[dict[str, str]]:
    """Conversation containing a user correction."""
    return [
        {"role": "user", "content": "Create an API endpoint for user registration"},
        {"role": "assistant", "content": "Here's the endpoint using .then() for promises..."},
        {"role": "user", "content": "Don't use .then(), always use async/await with try/catch instead"},
        {"role": "assistant", "content": "You're right, here's the corrected version with async/await..."},
    ]


# =============================================================================
# Utility Fixtures
# =============================================================================

@pytest.fixture
def mock_settings():
    """Mock settings for testing."""
    with patch("app.config.settings") as mock:
        mock.openai_api_key = "test-openai-key"
        mock.anthropic_api_key = "test-anthropic-key"
        yield mock


@pytest.fixture
def deterministic_embeddings():
    """
    Fixture providing deterministic embedding generation for reproducible tests.
    
    Returns a function that generates embeddings based on text content,
    ensuring similar texts produce similar vectors.
    """
    def generate(text: str) -> list[float]:
        """Generate a deterministic embedding for text."""
        import hashlib
        
        # Normalize text
        text = text.lower().strip()
        
        # Create base hash
        hash_bytes = hashlib.sha256(text.encode()).digest()
        
        # Expand to 1536 dimensions using hash chaining
        embedding = []
        current_hash = hash_bytes
        while len(embedding) < 1536:
            for byte in current_hash:
                if len(embedding) >= 1536:
                    break
                # Normalize to [-1, 1] range
                embedding.append((byte - 128) / 128)
            current_hash = hashlib.sha256(current_hash).digest()
        
        # Normalize vector
        magnitude = sum(x * x for x in embedding) ** 0.5
        if magnitude > 0:
            embedding = [x / magnitude for x in embedding]
        
        return embedding
    
    return generate


# =============================================================================
# Environment Setup
# =============================================================================

@pytest.fixture(autouse=True)
def setup_test_environment():
    """Set up test environment variables."""
    original_env = os.environ.copy()
    
    # Set test environment variables
    os.environ["OPENAI_API_KEY"] = "test-key-for-testing"
    os.environ["ANTHROPIC_API_KEY"] = "test-key-for-testing"
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    
    yield
    
    # Restore original environment
    os.environ.clear()
    os.environ.update(original_env)
