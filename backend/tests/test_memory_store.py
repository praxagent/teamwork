"""
Tests for the MemoryStore service.

Tests cover:
- CRUD operations (put, get, delete, list)
- Namespace handling and prefix matching
- Semantic search with embeddings
- Metadata filtering
- Text fallback search
- Edge cases and error handling
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from app.models.memory import Memory
from app.services.memory_store import (
    MemoryStore,
    MemoryTypes,
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
)


# =============================================================================
# MemoryStore Initialization Tests
# =============================================================================

class TestMemoryStoreInit:
    """Tests for MemoryStore initialization."""
    
    @pytest.mark.unit
    def test_init_with_db_session(self, db):
        """Test initializing MemoryStore with a database session."""
        store = MemoryStore(db)
        assert store.db == db
        assert store._openai_client is None  # Lazy loaded
    
    @pytest.mark.unit
    def test_build_namespace_from_alternating_strings(self):
        """Test building namespace from alternating key-value strings."""
        result = MemoryStore.build_namespace("user", "123", "project", "abc")
        assert result == "user:123/project:abc"
    
    @pytest.mark.unit
    def test_build_namespace_from_tuples(self):
        """Test building namespace from tuple pairs."""
        result = MemoryStore.build_namespace(("user", "123"), ("project", "abc"))
        assert result == "user:123/project:abc"
    
    @pytest.mark.unit
    def test_build_namespace_empty(self):
        """Test building empty namespace."""
        result = MemoryStore.build_namespace()
        assert result == ""
    
    @pytest.mark.unit
    def test_build_namespace_odd_args_raises(self):
        """Test that odd number of string args raises error."""
        with pytest.raises(ValueError, match="key-value pairs"):
            MemoryStore.build_namespace("user", "123", "project")


# =============================================================================
# CRUD Operations Tests
# =============================================================================

class TestMemoryStoreCRUD:
    """Tests for CRUD operations."""
    
    @pytest.mark.unit
    async def test_put_creates_new_memory(self, db):
        """Test that put creates a new memory when key doesn't exist."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await store.put(
                namespace="user:123/project:abc",
                key="new_memory",
                value={"content": "New memory content"},
                metadata={"type": "test"},
            )
        
        assert memory.id is not None
        assert memory.namespace == "user:123/project:abc"
        assert memory.key == "new_memory"
        assert memory.value == {"content": "New memory content"}
        assert memory.metadata_ == {"type": "test"}
    
    @pytest.mark.unit
    async def test_put_updates_existing_memory(self, db):
        """Test that put updates an existing memory with same namespace/key."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            # Create initial
            memory1 = await store.put(
                namespace="user:123",
                key="update_test",
                value={"version": 1},
            )
            original_id = memory1.id
            
            # Update with same key
            memory2 = await store.put(
                namespace="user:123",
                key="update_test",
                value={"version": 2},
            )
        
        assert memory2.id == original_id  # Same record
        assert memory2.value == {"version": 2}
    
    @pytest.mark.unit
    async def test_put_with_tuple_namespace(self, db):
        """Test put with tuple namespace."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await store.put(
                namespace=("user", "123", "project", "abc"),
                key="tuple_ns",
                value={"test": True},
            )
        
        assert memory.namespace == "user:123/project:abc"
    
    @pytest.mark.unit
    async def test_put_without_embedding(self, db):
        """Test put with generate_embedding=False."""
        store = MemoryStore(db)
        
        memory = await store.put(
            namespace="test",
            key="no_embedding",
            value={"content": "No embedding"},
            generate_embedding=False,
        )
        
        assert memory.embedding is None
    
    @pytest.mark.unit
    async def test_get_existing_memory(self, db, sample_memory):
        """Test getting an existing memory."""
        store = MemoryStore(db)
        
        memory = await store.get(
            namespace="user:test123/project:proj456/type:semantic",
            key="react_preference",
        )
        
        assert memory is not None
        assert memory.id == sample_memory.id
    
    @pytest.mark.unit
    async def test_get_nonexistent_memory(self, db):
        """Test getting a memory that doesn't exist."""
        store = MemoryStore(db)
        
        memory = await store.get(
            namespace="nonexistent",
            key="doesnt_exist",
        )
        
        assert memory is None
    
    @pytest.mark.unit
    async def test_get_with_tuple_namespace(self, db, sample_memory):
        """Test get with tuple namespace."""
        store = MemoryStore(db)
        
        # Use pre-built tuple pairs format
        memory = await store.get(
            namespace=(("user", "test123"), ("project", "proj456"), ("type", "semantic")),
            key="react_preference",
        )
        
        assert memory is not None
    
    @pytest.mark.unit
    async def test_delete_existing_memory(self, db, sample_memory):
        """Test deleting an existing memory."""
        store = MemoryStore(db)
        
        result = await store.delete(
            namespace="user:test123/project:proj456/type:semantic",
            key="react_preference",
        )
        
        assert result is True
        
        # Verify deleted
        memory = await store.get(
            namespace="user:test123/project:proj456/type:semantic",
            key="react_preference",
        )
        assert memory is None
    
    @pytest.mark.unit
    async def test_delete_nonexistent_memory(self, db):
        """Test deleting a memory that doesn't exist."""
        store = MemoryStore(db)
        
        result = await store.delete(
            namespace="nonexistent",
            key="doesnt_exist",
        )
        
        assert result is False
    
    @pytest.mark.unit
    async def test_delete_with_tuple_namespace(self, db, sample_memory):
        """Test delete with tuple namespace."""
        store = MemoryStore(db)
        
        # Use pre-built tuple pairs format
        result = await store.delete(
            namespace=(("user", "test123"), ("project", "proj456"), ("type", "semantic")),
            key="react_preference",
        )
        
        assert result is True


# =============================================================================
# List Operations Tests
# =============================================================================

class TestMemoryStoreList:
    """Tests for list operations."""
    
    @pytest.mark.unit
    async def test_list_exact_namespace(self, db, multiple_memories):
        """Test listing memories in exact namespace."""
        store = MemoryStore(db)
        
        memories = await store.list(
            namespace="user:user1/project:proj1/semantic",
            prefix_match=False,
        )
        
        assert len(memories) == 2  # pref_react and pref_typescript
        keys = {m.key for m in memories}
        assert "pref_react" in keys
        assert "pref_typescript" in keys
    
    @pytest.mark.unit
    async def test_list_prefix_match(self, db, multiple_memories):
        """Test listing memories with prefix matching."""
        store = MemoryStore(db)
        
        memories = await store.list(
            namespace="user:user1/project:proj1",
            prefix_match=True,
        )
        
        # Should include semantic and episodic
        assert len(memories) == 3
        keys = {m.key for m in memories}
        assert "pref_react" in keys
        assert "pref_typescript" in keys
        assert "task_auth" in keys
    
    @pytest.mark.unit
    async def test_list_with_limit(self, db, multiple_memories):
        """Test listing with limit."""
        store = MemoryStore(db)
        
        memories = await store.list(
            namespace="user:user1",
            prefix_match=True,
            limit=2,
        )
        
        assert len(memories) == 2
    
    @pytest.mark.unit
    async def test_list_empty_namespace(self, db, multiple_memories):
        """Test listing an empty namespace."""
        store = MemoryStore(db)
        
        memories = await store.list(
            namespace="nonexistent/namespace",
            prefix_match=False,
        )
        
        assert len(memories) == 0
    
    @pytest.mark.unit
    async def test_list_ordered_by_updated_at(self, db):
        """Test that list returns memories ordered by updated_at desc."""
        store = MemoryStore(db)
        
        # Create memories with known order
        for i in range(3):
            await store.put(
                namespace="test/order",
                key=f"key_{i}",
                value={"order": i},
                generate_embedding=False,
            )
            await db.flush()
        
        memories = await store.list(namespace="test/order", prefix_match=False)
        
        # Should be in reverse order (most recent first)
        assert memories[0].value["order"] == 2
        assert memories[1].value["order"] == 1
        assert memories[2].value["order"] == 0


# =============================================================================
# Semantic Search Tests
# =============================================================================

class TestMemoryStoreSearch:
    """Tests for semantic search."""
    
    @pytest.mark.unit
    async def test_search_returns_scored_results(self, db, multiple_memories):
        """Test that search returns (memory, score) tuples."""
        store = MemoryStore(db)
        
        # Use a query embedding that's similar to existing embeddings
        with patch.object(store, '_get_embedding', return_value=[0.1, 0.2, 0.3] + [0.0] * 1533):
            results = await store.search(
                namespace="user:user1",
                query="React preferences",
                prefix_match=True,
                limit=5,
                similarity_threshold=0.0,
            )
        
        assert len(results) > 0
        for memory, score in results:
            assert isinstance(memory, Memory)
            assert isinstance(score, float)
            assert 0 <= score <= 1
    
    @pytest.mark.unit
    async def test_search_respects_similarity_threshold(self, db, multiple_memories):
        """Test that search respects similarity threshold."""
        store = MemoryStore(db)
        
        # Use embedding that won't match well
        with patch.object(store, '_get_embedding', return_value=[1.0] + [0.0] * 1535):
            results = await store.search(
                namespace="user:user1",
                query="something unrelated",
                prefix_match=True,
                similarity_threshold=0.99,  # Very high threshold
            )
        
        # Should filter out low-similarity results
        assert len(results) == 0
    
    @pytest.mark.unit
    async def test_search_respects_limit(self, db, multiple_memories):
        """Test that search respects limit."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            results = await store.search(
                namespace="user:user1",
                query="preferences",
                prefix_match=True,
                limit=1,
                similarity_threshold=0.0,
            )
        
        assert len(results) <= 1
    
    @pytest.mark.unit
    async def test_search_with_metadata_filter(self, db, multiple_memories):
        """Test search with metadata filtering."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[0.1, 0.2, 0.3] + [0.0] * 1533):
            results = await store.search(
                namespace="user:user1",
                query="preferences",
                filter={"type": "user_preference"},
                prefix_match=True,
                similarity_threshold=0.0,
            )
        
        # Should only return user_preference type
        for memory, _ in results:
            assert memory.metadata_.get("type") == "user_preference"
    
    @pytest.mark.unit
    async def test_search_exact_namespace(self, db, multiple_memories):
        """Test search with exact namespace match."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            results = await store.search(
                namespace="user:user1/project:proj1/semantic",
                query="preferences",
                prefix_match=False,  # Exact match only
                similarity_threshold=0.0,
            )
        
        # Should only return from exact namespace
        for memory, _ in results:
            assert memory.namespace == "user:user1/project:proj1/semantic"
    
    @pytest.mark.unit
    async def test_search_sorted_by_similarity(self, db):
        """Test that search results are sorted by similarity."""
        store = MemoryStore(db)
        
        # Create memories with known embeddings
        embeddings = [
            [0.9, 0.1, 0.0] + [0.0] * 1533,  # Most similar
            [0.5, 0.5, 0.0] + [0.0] * 1533,  # Medium similar
            [0.1, 0.9, 0.0] + [0.0] * 1533,  # Least similar
        ]
        
        for i, emb in enumerate(embeddings):
            mem = Memory(
                namespace="test/sort",
                key=f"mem_{i}",
                value={"order": i},
                content_text=f"memory {i}",
                embedding=emb,
            )
            db.add(mem)
        await db.flush()
        
        # Query with embedding similar to first one
        with patch.object(store, '_get_embedding', return_value=[1.0, 0.0, 0.0] + [0.0] * 1533):
            results = await store.search(
                namespace="test/sort",
                query="test",
                similarity_threshold=0.0,
            )
        
        # Should be sorted by similarity (highest first)
        scores = [score for _, score in results]
        assert scores == sorted(scores, reverse=True)
    
    @pytest.mark.unit
    async def test_search_fallback_to_text_search(self, db, multiple_memories):
        """Test that search falls back to text search when embeddings fail."""
        store = MemoryStore(db)
        
        # Mock embedding to return empty (failure)
        with patch.object(store, '_get_embedding', return_value=[]):
            results = await store.search(
                namespace="user:user1",
                query="React",
                prefix_match=True,
            )
        
        # Should still find results via text search
        assert len(results) > 0
        # Results should contain "React"
        found_react = any("React" in m.content_text for m, _ in results)
        assert found_react


# =============================================================================
# Text Search Fallback Tests
# =============================================================================

class TestTextSearchFallback:
    """Tests for text-based search fallback."""
    
    @pytest.mark.unit
    async def test_text_search_matches_terms(self, db, multiple_memories):
        """Test that text search matches query terms."""
        store = MemoryStore(db)
        
        results = await store._text_search(
            namespace="user:user1",
            query="TypeScript strict",
            filter=None,
            limit=10,
            prefix_match=True,
        )
        
        assert len(results) > 0
        # Should find the TypeScript memory
        found = any("TypeScript" in m.content_text for m, _ in results)
        assert found
    
    @pytest.mark.unit
    async def test_text_search_with_filter(self, db, multiple_memories):
        """Test text search with metadata filter."""
        store = MemoryStore(db)
        
        results = await store._text_search(
            namespace="user:user1",
            query="authentication",
            filter={"type": "task_completion"},
            limit=10,
            prefix_match=True,
        )
        
        for memory, _ in results:
            assert memory.metadata_.get("type") == "task_completion"
    
    @pytest.mark.unit
    async def test_text_search_scoring(self, db):
        """Test that text search scores based on term matches."""
        store = MemoryStore(db)
        
        # Create memories with varying matches
        mem1 = Memory(
            namespace="test/text",
            key="all_match",
            value={},
            content_text="apple banana cherry",  # 3/3 match
        )
        mem2 = Memory(
            namespace="test/text",
            key="partial_match",
            value={},
            content_text="apple banana orange",  # 2/3 match
        )
        mem3 = Memory(
            namespace="test/text",
            key="one_match",
            value={},
            content_text="apple orange grape",  # 1/3 match
        )
        db.add_all([mem1, mem2, mem3])
        await db.flush()
        
        results = await store._text_search(
            namespace="test/text",
            query="apple banana cherry",
            filter=None,
            limit=10,
            prefix_match=False,
        )
        
        # Should be sorted by match score
        assert len(results) == 3
        assert results[0][0].key == "all_match"
        assert results[1][0].key == "partial_match"
        assert results[2][0].key == "one_match"


# =============================================================================
# Clear Namespace Tests
# =============================================================================

class TestMemoryStoreClearNamespace:
    """Tests for clearing namespaces."""
    
    @pytest.mark.unit
    async def test_clear_exact_namespace(self, db, multiple_memories):
        """Test clearing an exact namespace."""
        store = MemoryStore(db)
        
        count = await store.clear_namespace(
            namespace="user:user1/project:proj1/semantic",
            prefix_match=False,
        )
        
        assert count == 2  # pref_react and pref_typescript
        
        # Verify cleared
        remaining = await store.list(
            namespace="user:user1/project:proj1/semantic",
            prefix_match=False,
        )
        assert len(remaining) == 0
    
    @pytest.mark.unit
    async def test_clear_namespace_with_prefix(self, db, multiple_memories):
        """Test clearing all namespaces with prefix."""
        store = MemoryStore(db)
        
        count = await store.clear_namespace(
            namespace="user:user1/project:proj1",
            prefix_match=True,
        )
        
        assert count == 3  # semantic (2) + episodic (1)
        
        # Verify cleared
        remaining = await store.list(
            namespace="user:user1/project:proj1",
            prefix_match=True,
        )
        assert len(remaining) == 0
    
    @pytest.mark.unit
    async def test_clear_empty_namespace(self, db):
        """Test clearing an empty namespace."""
        store = MemoryStore(db)
        
        count = await store.clear_namespace(
            namespace="nonexistent",
            prefix_match=False,
        )
        
        assert count == 0


# =============================================================================
# Cosine Similarity Tests
# =============================================================================

class TestCosineSimilarity:
    """Tests for cosine similarity calculation."""
    
    @pytest.mark.unit
    def test_identical_vectors(self):
        """Test similarity of identical vectors."""
        a = [1.0, 0.0, 0.0]
        b = [1.0, 0.0, 0.0]
        
        similarity = MemoryStore._cosine_similarity(a, b)
        
        assert abs(similarity - 1.0) < 0.0001
    
    @pytest.mark.unit
    def test_orthogonal_vectors(self):
        """Test similarity of orthogonal vectors."""
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        
        similarity = MemoryStore._cosine_similarity(a, b)
        
        assert abs(similarity) < 0.0001
    
    @pytest.mark.unit
    def test_opposite_vectors(self):
        """Test similarity of opposite vectors."""
        a = [1.0, 0.0, 0.0]
        b = [-1.0, 0.0, 0.0]
        
        similarity = MemoryStore._cosine_similarity(a, b)
        
        assert abs(similarity - (-1.0)) < 0.0001
    
    @pytest.mark.unit
    def test_empty_vectors(self):
        """Test similarity with empty vectors."""
        a = []
        b = []
        
        similarity = MemoryStore._cosine_similarity(a, b)
        
        assert similarity == 0.0
    
    @pytest.mark.unit
    def test_different_length_vectors(self):
        """Test similarity with different length vectors."""
        a = [1.0, 0.0]
        b = [1.0, 0.0, 0.0]
        
        similarity = MemoryStore._cosine_similarity(a, b)
        
        assert similarity == 0.0
    
    @pytest.mark.unit
    def test_zero_vector(self):
        """Test similarity with zero vector."""
        a = [0.0, 0.0, 0.0]
        b = [1.0, 0.0, 0.0]
        
        similarity = MemoryStore._cosine_similarity(a, b)
        
        assert similarity == 0.0


# =============================================================================
# Memory Types Tests
# =============================================================================

class TestMemoryTypes:
    """Tests for MemoryTypes constants."""
    
    @pytest.mark.unit
    def test_semantic_types(self):
        """Test semantic memory type constants."""
        assert MemoryTypes.SEMANTIC == "semantic"
        assert MemoryTypes.USER_PREFERENCE == "user_preference"
        assert MemoryTypes.PROJECT_DECISION == "project_decision"
        assert MemoryTypes.LEARNED_FACT == "learned_fact"
    
    @pytest.mark.unit
    def test_episodic_types(self):
        """Test episodic memory type constants."""
        assert MemoryTypes.EPISODIC == "episodic"
        assert MemoryTypes.TASK_COMPLETION == "task_completion"
        assert MemoryTypes.DEBUG_SESSION == "debug_session"
        assert MemoryTypes.USER_CORRECTION == "user_correction"
    
    @pytest.mark.unit
    def test_procedural_types(self):
        """Test procedural memory type constants."""
        assert MemoryTypes.PROCEDURAL == "procedural"
        assert MemoryTypes.USER_INSTRUCTION == "user_instruction"
        assert MemoryTypes.WORKFLOW_PATTERN == "workflow_pattern"


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================

class TestMemoryStoreEdgeCases:
    """Tests for edge cases and error handling."""
    
    @pytest.mark.unit
    async def test_put_with_empty_value(self, db):
        """Test storing a memory with empty value."""
        store = MemoryStore(db)
        
        memory = await store.put(
            namespace="test",
            key="empty_value",
            value={},
            generate_embedding=False,
        )
        
        assert memory.value == {}
    
    @pytest.mark.unit
    async def test_put_with_none_metadata(self, db):
        """Test storing a memory with None metadata."""
        store = MemoryStore(db)
        
        memory = await store.put(
            namespace="test",
            key="none_metadata",
            value={"test": True},
            metadata=None,
            generate_embedding=False,
        )
        
        assert memory.metadata_ is None or memory.metadata_ == {}
    
    @pytest.mark.unit
    async def test_search_with_empty_query(self, db, multiple_memories):
        """Test searching with empty query."""
        store = MemoryStore(db)
        
        with patch.object(store, '_get_embedding', return_value=[]):
            results = await store.search(
                namespace="user:user1",
                query="",
                prefix_match=True,
            )
        
        # Should fall back to text search and find nothing (empty query)
        assert isinstance(results, list)
    
    @pytest.mark.unit
    async def test_sequential_puts(self, db):
        """Test sequential put operations with unique keys."""
        store = MemoryStore(db)
        
        results = []
        for i in range(10):
            memory = await store.put(
                namespace="test/sequential",
                key=f"memory_{i}",
                value={"index": i},
                generate_embedding=False,
            )
            results.append(memory)
        
        assert len(results) == 10
        assert len(set(m.id for m in results)) == 10  # All unique IDs
    
    @pytest.mark.unit
    async def test_unicode_in_search(self, db):
        """Test searching with unicode characters."""
        store = MemoryStore(db)
        
        # Create memory with unicode
        await store.put(
            namespace="test/unicode",
            key="unicode_mem",
            value={"content": "Привет мир 世界"},
            generate_embedding=False,
        )
        
        results = await store._text_search(
            namespace="test/unicode",
            query="Привет",
            filter=None,
            limit=10,
            prefix_match=False,
        )
        
        assert len(results) == 1
    
    @pytest.mark.unit
    async def test_very_long_content_text(self, db):
        """Test handling very long content text."""
        store = MemoryStore(db)
        
        long_content = "word " * 10000  # ~50KB of text
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await store.put(
                namespace="test/long",
                key="long_content",
                value={"content": long_content},
            )
        
        assert memory is not None
        # Content should be truncated for embedding
    
    @pytest.mark.unit
    async def test_special_chars_in_namespace(self, db):
        """Test special characters in namespace."""
        store = MemoryStore(db)
        
        memory = await store.put(
            namespace="user:user@example.com/project:my-project-123",
            key="special_ns",
            value={"test": True},
            generate_embedding=False,
        )
        
        retrieved = await store.get(
            namespace="user:user@example.com/project:my-project-123",
            key="special_ns",
        )
        
        assert retrieved is not None
        assert retrieved.value == {"test": True}
