"""
Unit tests for the Memory model.

Tests cover:
- Model instantiation and defaults
- Namespace building and parsing
- Content text flattening
- Value setting with auto-generated content_text
- Database persistence and retrieval
- Unique constraints
"""

import pytest
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.memory import Memory, EmbeddingVector


# =============================================================================
# Model Instantiation Tests
# =============================================================================

class TestMemoryModelCreation:
    """Tests for Memory model instantiation."""
    
    @pytest.mark.unit
    async def test_create_memory_with_required_fields(self, db):
        """Test creating a memory with only required fields."""
        memory = Memory(
            namespace="test/namespace",
            key="test_key",
            value={"content": "test value"},
        )
        db.add(memory)
        await db.flush()
        
        assert memory.id is not None
        assert memory.namespace == "test/namespace"
        assert memory.key == "test_key"
        assert memory.value == {"content": "test value"}
        assert memory.created_at is not None
        assert memory.updated_at is not None
    
    @pytest.mark.unit
    async def test_create_memory_with_all_fields(self, db):
        """Test creating a memory with all fields populated."""
        embedding = [0.1] * 1536
        metadata = {"type": "test", "importance": 5}
        
        memory = Memory(
            namespace="user:123/project:456",
            key="full_memory",
            value={"content": "Full memory content", "extra": "data"},
            content_text="Full memory content data",
            embedding=embedding,
            metadata_=metadata,
        )
        db.add(memory)
        await db.flush()
        
        assert memory.embedding == embedding
        assert memory.metadata_ == metadata
        assert memory.content_text == "Full memory content data"
    
    @pytest.mark.unit
    async def test_memory_default_values(self, db):
        """Test that default values are set correctly."""
        memory = Memory(
            namespace="test",
            key="defaults",
            value={},
        )
        db.add(memory)
        await db.flush()
        
        # Check defaults
        assert memory.value == {}
        assert memory.embedding is None
        assert memory.content_text is None
        assert memory.metadata_ is None or memory.metadata_ == {}
    
    @pytest.mark.unit
    async def test_memory_uuid_generation(self, db):
        """Test that UUIDs are generated automatically."""
        memory1 = Memory(namespace="test", key="key1", value={})
        memory2 = Memory(namespace="test", key="key2", value={})
        
        db.add(memory1)
        db.add(memory2)
        await db.flush()
        
        assert memory1.id is not None
        assert memory2.id is not None
        assert memory1.id != memory2.id
        # Verify UUID format (36 chars with hyphens)
        assert len(memory1.id) == 36
        assert memory1.id.count("-") == 4
    
    @pytest.mark.unit
    async def test_memory_timestamps(self, db):
        """Test that timestamps are set correctly."""
        before = datetime.now(timezone.utc)
        
        memory = Memory(namespace="test", key="timestamps", value={})
        db.add(memory)
        await db.flush()
        
        after = datetime.now(timezone.utc)
        
        assert before <= memory.created_at <= after
        assert before <= memory.updated_at <= after


# =============================================================================
# Namespace Tests
# =============================================================================

class TestNamespaceOperations:
    """Tests for namespace building and parsing."""
    
    @pytest.mark.unit
    def test_build_namespace_single_pair(self):
        """Test building namespace with a single key-value pair."""
        result = Memory.build_namespace(("user", "123"))
        assert result == "user:123"
    
    @pytest.mark.unit
    def test_build_namespace_multiple_pairs(self):
        """Test building namespace with multiple key-value pairs."""
        result = Memory.build_namespace(
            ("user", "123"),
            ("project", "abc"),
            ("type", "semantic"),
        )
        assert result == "user:123/project:abc/type:semantic"
    
    @pytest.mark.unit
    def test_build_namespace_empty(self):
        """Test building namespace with no pairs."""
        result = Memory.build_namespace()
        assert result == ""
    
    @pytest.mark.unit
    def test_parse_namespace_single_segment(self):
        """Test parsing namespace with single segment."""
        result = Memory.parse_namespace("user:123")
        assert result == [("user", "123")]
    
    @pytest.mark.unit
    def test_parse_namespace_multiple_segments(self):
        """Test parsing namespace with multiple segments."""
        result = Memory.parse_namespace("user:123/project:abc/type:semantic")
        assert result == [("user", "123"), ("project", "abc"), ("type", "semantic")]
    
    @pytest.mark.unit
    def test_parse_namespace_empty(self):
        """Test parsing empty namespace."""
        result = Memory.parse_namespace("")
        assert result == []
    
    @pytest.mark.unit
    def test_parse_namespace_with_special_chars_in_value(self):
        """Test parsing namespace with special characters in value."""
        result = Memory.parse_namespace("user:user@example.com/project:my-project-123")
        assert result == [("user", "user@example.com"), ("project", "my-project-123")]
    
    @pytest.mark.unit
    def test_namespace_roundtrip(self):
        """Test that build and parse are inverse operations."""
        original = [("user", "123"), ("project", "abc")]
        namespace_str = Memory.build_namespace(*original)
        parsed = Memory.parse_namespace(namespace_str)
        assert parsed == original


# =============================================================================
# Content Text Flattening Tests
# =============================================================================

class TestContentTextFlattening:
    """Tests for flattening dictionary values to searchable text."""
    
    @pytest.mark.unit
    def test_flatten_simple_dict(self):
        """Test flattening a simple dictionary."""
        value = {"content": "Hello world", "type": "greeting"}
        result = Memory._flatten_to_text(value)
        assert "content: Hello world" in result
        assert "type: greeting" in result
    
    @pytest.mark.unit
    def test_flatten_nested_dict(self):
        """Test flattening a nested dictionary."""
        value = {
            "outer": {
                "inner": "nested value"
            }
        }
        result = Memory._flatten_to_text(value)
        assert "inner: nested value" in result
    
    @pytest.mark.unit
    def test_flatten_list_values(self):
        """Test flattening with list values."""
        value = {
            "items": ["apple", "banana", "cherry"]
        }
        result = Memory._flatten_to_text(value)
        assert "apple" in result
        assert "banana" in result
        assert "cherry" in result
    
    @pytest.mark.unit
    def test_flatten_mixed_types(self):
        """Test flattening with mixed types."""
        value = {
            "text": "Hello",
            "number": 42,
            "boolean": True,
            "null": None,
            "list": ["a", "b"],
            "nested": {"key": "value"}
        }
        result = Memory._flatten_to_text(value)
        assert "Hello" in result
        assert "a" in result
        assert "value" in result
    
    @pytest.mark.unit
    def test_flatten_empty_dict(self):
        """Test flattening an empty dictionary."""
        result = Memory._flatten_to_text({})
        assert result == ""
    
    @pytest.mark.unit
    def test_flatten_deep_nesting_limit(self):
        """Test that deeply nested structures don't cause issues."""
        # Create deeply nested structure (> 10 levels)
        value = {"level0": {}}
        current = value["level0"]
        for i in range(1, 15):
            current[f"level{i}"] = {}
            current = current[f"level{i}"]
        current["deep"] = "value"
        
        # Should not raise, but may not include deepest values
        result = Memory._flatten_to_text(value)
        assert isinstance(result, str)
    
    @pytest.mark.unit
    def test_set_value_auto_generates_content_text(self):
        """Test that set_value auto-generates content_text."""
        memory = Memory(namespace="test", key="test", value={})
        memory.set_value({"content": "Auto-generated text", "category": "test"})
        
        assert memory.content_text is not None
        assert "Auto-generated text" in memory.content_text
        assert "category: test" in memory.content_text


# =============================================================================
# Database Persistence Tests
# =============================================================================

class TestMemoryPersistence:
    """Tests for database persistence and retrieval."""
    
    @pytest.mark.unit
    async def test_save_and_retrieve_memory(self, db):
        """Test saving and retrieving a memory."""
        original = Memory(
            namespace="test/persist",
            key="retrieve_test",
            value={"data": "test data"},
            content_text="test data",
        )
        db.add(original)
        await db.commit()
        
        # Retrieve
        result = await db.execute(
            select(Memory).where(Memory.key == "retrieve_test")
        )
        retrieved = result.scalar_one()
        
        assert retrieved.namespace == original.namespace
        assert retrieved.key == original.key
        assert retrieved.value == original.value
    
    @pytest.mark.unit
    async def test_update_memory(self, db):
        """Test updating an existing memory."""
        memory = Memory(
            namespace="test/update",
            key="update_test",
            value={"version": 1},
        )
        db.add(memory)
        await db.flush()
        
        original_created = memory.created_at
        original_updated = memory.updated_at
        
        # Update
        memory.value = {"version": 2}
        await db.flush()
        
        assert memory.value == {"version": 2}
        assert memory.created_at == original_created
        # Note: updated_at auto-update may not trigger in same transaction
    
    @pytest.mark.unit
    async def test_delete_memory(self, db):
        """Test deleting a memory."""
        memory = Memory(
            namespace="test/delete",
            key="delete_test",
            value={},
        )
        db.add(memory)
        await db.flush()
        
        memory_id = memory.id
        
        await db.delete(memory)
        await db.flush()
        
        result = await db.execute(
            select(Memory).where(Memory.id == memory_id)
        )
        assert result.scalar_one_or_none() is None
    
    @pytest.mark.unit
    async def test_unique_constraint_namespace_key(self, db):
        """Test that namespace+key must be unique."""
        memory1 = Memory(
            namespace="test/unique",
            key="same_key",
            value={"first": True},
        )
        db.add(memory1)
        await db.flush()
        
        memory2 = Memory(
            namespace="test/unique",
            key="same_key",  # Same key in same namespace
            value={"second": True},
        )
        db.add(memory2)
        
        with pytest.raises(IntegrityError):
            await db.flush()
    
    @pytest.mark.unit
    async def test_same_key_different_namespace(self, db):
        """Test that same key in different namespaces is allowed."""
        memory1 = Memory(
            namespace="namespace1",
            key="shared_key",
            value={"from": "namespace1"},
        )
        memory2 = Memory(
            namespace="namespace2",
            key="shared_key",  # Same key, different namespace
            value={"from": "namespace2"},
        )
        
        db.add(memory1)
        db.add(memory2)
        await db.flush()
        
        assert memory1.id != memory2.id


# =============================================================================
# Embedding Tests
# =============================================================================

class TestMemoryEmbeddings:
    """Tests for embedding storage and retrieval."""
    
    @pytest.mark.unit
    async def test_store_embedding_as_json(self, db):
        """Test that embeddings are stored as JSON arrays."""
        embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
        memory = Memory(
            namespace="test/embedding",
            key="with_embedding",
            value={"test": True},
            embedding=embedding,
        )
        db.add(memory)
        await db.commit()
        
        # Retrieve and verify
        result = await db.execute(
            select(Memory).where(Memory.key == "with_embedding")
        )
        retrieved = result.scalar_one()
        
        assert retrieved.embedding == embedding
        assert isinstance(retrieved.embedding, list)
    
    @pytest.mark.unit
    async def test_store_large_embedding(self, db):
        """Test storing a full-size embedding (1536 dimensions)."""
        embedding = [0.001 * i for i in range(1536)]
        memory = Memory(
            namespace="test/large_embedding",
            key="large",
            value={},
            embedding=embedding,
        )
        db.add(memory)
        await db.commit()
        
        result = await db.execute(
            select(Memory).where(Memory.key == "large")
        )
        retrieved = result.scalar_one()
        
        assert len(retrieved.embedding) == 1536
        assert retrieved.embedding == embedding
    
    @pytest.mark.unit
    async def test_null_embedding(self, db):
        """Test that embeddings can be null."""
        memory = Memory(
            namespace="test/null_embedding",
            key="no_embedding",
            value={},
            embedding=None,
        )
        db.add(memory)
        await db.flush()
        
        assert memory.embedding is None


# =============================================================================
# Metadata Tests
# =============================================================================

class TestMemoryMetadata:
    """Tests for metadata storage and filtering."""
    
    @pytest.mark.unit
    async def test_store_complex_metadata(self, db):
        """Test storing complex metadata."""
        metadata = {
            "type": "user_preference",
            "importance": 8,
            "tags": ["react", "frontend"],
            "source": {
                "conversation_id": "conv123",
                "turn": 5,
            },
        }
        memory = Memory(
            namespace="test/metadata",
            key="complex_metadata",
            value={},
            metadata_=metadata,
        )
        db.add(memory)
        await db.commit()
        
        result = await db.execute(
            select(Memory).where(Memory.key == "complex_metadata")
        )
        retrieved = result.scalar_one()
        
        assert retrieved.metadata_ == metadata
        assert retrieved.metadata_["tags"] == ["react", "frontend"]
    
    @pytest.mark.unit
    async def test_update_metadata(self, db):
        """Test updating metadata."""
        memory = Memory(
            namespace="test/update_meta",
            key="meta_update",
            value={},
            metadata_={"importance": 5},
        )
        db.add(memory)
        await db.flush()
        
        memory.metadata_ = {"importance": 10, "updated": True}
        await db.flush()
        
        assert memory.metadata_["importance"] == 10
        assert memory.metadata_["updated"] is True


# =============================================================================
# Edge Cases
# =============================================================================

class TestMemoryEdgeCases:
    """Tests for edge cases and boundary conditions."""
    
    @pytest.mark.unit
    async def test_empty_string_namespace(self, db):
        """Test handling empty string namespace."""
        memory = Memory(
            namespace="",
            key="empty_namespace",
            value={},
        )
        db.add(memory)
        await db.flush()
        
        assert memory.namespace == ""
    
    @pytest.mark.unit
    async def test_unicode_content(self, db):
        """Test storing unicode content."""
        memory = Memory(
            namespace="test/unicode",
            key="unicode_test",
            value={"content": "Hello 世界 🌍 مرحبا"},
            content_text="Hello 世界 🌍 مرحبا",
        )
        db.add(memory)
        await db.commit()
        
        result = await db.execute(
            select(Memory).where(Memory.key == "unicode_test")
        )
        retrieved = result.scalar_one()
        
        assert "世界" in retrieved.value["content"]
        assert "🌍" in retrieved.value["content"]
    
    @pytest.mark.unit
    async def test_very_long_content(self, db):
        """Test storing very long content."""
        long_text = "x" * 100000  # 100KB of text
        memory = Memory(
            namespace="test/long",
            key="long_content",
            value={"content": long_text},
            content_text=long_text,
        )
        db.add(memory)
        await db.flush()
        
        assert len(memory.content_text) == 100000
    
    @pytest.mark.unit
    async def test_special_characters_in_key(self, db):
        """Test keys with special characters."""
        memory = Memory(
            namespace="test/special",
            key="key-with_special.chars:v1",
            value={},
        )
        db.add(memory)
        await db.flush()
        
        result = await db.execute(
            select(Memory).where(Memory.key == "key-with_special.chars:v1")
        )
        assert result.scalar_one() is not None
    
    @pytest.mark.unit
    def test_repr(self):
        """Test the string representation of Memory."""
        memory = Memory(
            namespace="user:123/project:abc",
            key="test_key",
            value={},
        )
        repr_str = repr(memory)
        
        assert "Memory" in repr_str
        assert "user:123/project:abc" in repr_str
        assert "test_key" in repr_str
