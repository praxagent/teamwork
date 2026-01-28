"""Memory model for long-term persistent memory storage.

Supports:
- Namespace-based organization (user_id, project_id, context)
- Semantic search via embeddings
- Both profile (single doc) and collection (multi-doc) patterns
- Metadata filtering
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.sqlite import JSON

from app.models.base import Base


class Memory(Base):
    """
    A memory entry that can be organized by namespace and retrieved via semantic search.
    
    Inspired by LangGraph's memory store but implemented as a lightweight SQLAlchemy model.
    
    Attributes:
        id: Unique identifier
        namespace: Hierarchical path for organization (e.g., "user:123/project:456/semantic")
        key: Unique key within the namespace (like a filename)
        value: JSON content of the memory
        content_text: Flattened text representation for semantic search
        embedding: Vector embedding for semantic similarity (stored as JSON array)
        metadata: Optional metadata for filtering
        created_at: When the memory was created
        updated_at: When the memory was last updated
    """
    
    __tablename__ = "memories"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    
    # Namespace for hierarchical organization
    # Format: "scope1:value1/scope2:value2/..." 
    # Examples:
    #   - "user:abc123/project:xyz/semantic" (project-specific facts)
    #   - "user:abc123/global" (user-wide preferences)
    #   - "project:xyz/episodic" (project action history)
    namespace = Column(String(512), nullable=False, index=True)
    
    # Key within the namespace (unique per namespace)
    key = Column(String(256), nullable=False)
    
    # The actual memory content as JSON
    value = Column(JSON, nullable=False, default=dict)
    
    # Flattened text for embedding/search (auto-generated from value)
    content_text = Column(Text, nullable=True)
    
    # Embedding vector stored as JSON array of floats
    # Using JSON instead of a vector extension for SQLite compatibility
    # For production with Postgres, this could be migrated to pgvector
    embedding = Column(JSON, nullable=True)
    
    # Optional metadata for filtering (e.g., {"type": "preference", "source": "user"})
    metadata_ = Column("metadata", JSON, nullable=True, default=dict)
    
    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Composite unique constraint: namespace + key
    __table_args__ = (
        Index("ix_memories_namespace_key", "namespace", "key", unique=True),
        Index("ix_memories_updated", "updated_at"),
    )
    
    def __repr__(self) -> str:
        return f"<Memory(namespace='{self.namespace}', key='{self.key}')>"
    
    @classmethod
    def build_namespace(cls, *parts: tuple[str, str]) -> str:
        """
        Build a namespace string from key-value pairs.
        
        Example:
            Memory.build_namespace(("user", "123"), ("project", "abc"))
            # Returns: "user:123/project:abc"
        """
        return "/".join(f"{k}:{v}" for k, v in parts)
    
    @classmethod
    def parse_namespace(cls, namespace: str) -> list[tuple[str, str]]:
        """
        Parse a namespace string into key-value pairs.
        
        Example:
            Memory.parse_namespace("user:123/project:abc")
            # Returns: [("user", "123"), ("project", "abc")]
        """
        parts = []
        for segment in namespace.split("/"):
            if ":" in segment:
                key, value = segment.split(":", 1)
                parts.append((key, value))
        return parts
    
    def set_value(self, value: dict[str, Any]) -> None:
        """Set the value and auto-generate content_text for search."""
        self.value = value
        self.content_text = self._flatten_to_text(value)
    
    @staticmethod
    def _flatten_to_text(value: dict[str, Any]) -> str:
        """Flatten a dict to searchable text."""
        def extract_text(obj: Any, depth: int = 0) -> list[str]:
            if depth > 10:  # Prevent infinite recursion
                return []
            
            texts = []
            if isinstance(obj, str):
                texts.append(obj)
            elif isinstance(obj, (list, tuple)):
                for item in obj:
                    texts.extend(extract_text(item, depth + 1))
            elif isinstance(obj, dict):
                for key, val in obj.items():
                    if isinstance(val, str):
                        texts.append(f"{key}: {val}")
                    else:
                        texts.extend(extract_text(val, depth + 1))
            return texts
        
        return " ".join(extract_text(value))


# Type alias for embedding vectors
EmbeddingVector = list[float]
