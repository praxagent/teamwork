"""
Tests for the MemoryExtractor service.

Tests cover:
- Conversation memory extraction
- Task completion memory extraction
- Different memory type categorization
- Error handling and edge cases
- Integration with MemoryStore
"""

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.memory import Memory
from app.services.memory_store import (
    MemoryExtractor,
    MemoryStore,
    MemoryTypes,
)


# =============================================================================
# MemoryExtractor Initialization Tests
# =============================================================================

class TestMemoryExtractorInit:
    """Tests for MemoryExtractor initialization."""
    
    @pytest.mark.unit
    async def test_init_with_store(self, db):
        """Test initializing MemoryExtractor with a MemoryStore."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        assert extractor.store == store
        assert extractor._client is None  # Lazy loaded


# =============================================================================
# Conversation Extraction Tests
# =============================================================================

class TestConversationExtraction:
    """Tests for extracting memories from conversations."""
    
    @pytest.mark.unit
    async def test_extract_user_preferences(self, db, sample_conversation):
        """Test extracting user preferences from conversation."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # Mock OpenAI response with extracted memories
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    "key": "react_style",
                    "content": "User prefers functional components with hooks",
                    "importance": 8,
                },
                {
                    "category": "USER_PREFERENCES",
                    "key": "language_preference",
                    "content": "User wants TypeScript instead of JavaScript",
                    "importance": 9,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            # Also patch the embedding
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="project:test123",
                    messages=sample_conversation,
                    context="Working on React components",
                )
        
        assert len(memories) == 2
        
        # Check first memory
        assert memories[0].value["content"] == "User prefers functional components with hooks"
        assert memories[0].metadata_["type"] == MemoryTypes.USER_PREFERENCE
        
        # Check second memory
        assert memories[1].value["content"] == "User wants TypeScript instead of JavaScript"
    
    @pytest.mark.unit
    async def test_extract_user_corrections(self, db, conversation_with_correction):
        """Test extracting user corrections from conversation."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_CORRECTIONS",
                    "key": "async_await_style",
                    "content": "User corrected: always use async/await with try/catch instead of .then()",
                    "importance": 9,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="project:test123",
                    messages=conversation_with_correction,
                )
        
        assert len(memories) == 1
        assert memories[0].metadata_["type"] == MemoryTypes.USER_CORRECTION
    
    @pytest.mark.unit
    async def test_extract_learned_facts(self, db):
        """Test extracting learned facts from conversation."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        messages = [
            {"role": "user", "content": "Our database is PostgreSQL 15 running on AWS RDS"},
            {"role": "assistant", "content": "Got it, I'll use PostgreSQL-specific features."},
        ]
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "LEARNED_FACTS",
                    "key": "database_info",
                    "content": "Database is PostgreSQL 15 on AWS RDS",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="project:test123",
                    messages=messages,
                )
        
        assert len(memories) == 1
        assert memories[0].metadata_["type"] == MemoryTypes.LEARNED_FACT
    
    @pytest.mark.unit
    async def test_extract_successful_patterns(self, db):
        """Test extracting successful patterns from conversation."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        messages = [
            {"role": "user", "content": "That caching approach worked perfectly!"},
            {"role": "assistant", "content": "Great! The Redis caching with 5-minute TTL was a good fit."},
        ]
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "SUCCESSFUL_PATTERNS",
                    "key": "caching_pattern",
                    "content": "Redis caching with 5-minute TTL worked well for this use case",
                    "importance": 7,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="project:test123",
                    messages=messages,
                )
        
        assert len(memories) == 1
        assert memories[0].metadata_["type"] == MemoryTypes.TASK_COMPLETION
    
    @pytest.mark.unit
    async def test_filter_low_importance_memories(self, db):
        """Test that low importance memories are filtered out."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    "key": "high_importance",
                    "content": "Important preference",
                    "importance": 8,
                },
                {
                    "category": "LEARNED_FACTS",
                    "key": "low_importance",
                    "content": "Minor fact",
                    "importance": 3,  # Below threshold of 5
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="project:test123",
                    messages=[
                        {"role": "user", "content": "test message"},
                        {"role": "assistant", "content": "response"},
                    ],  # Need at least 2 messages
                )
        
        # Should only have the high importance memory
        assert len(memories) == 1
        assert memories[0].value["content"] == "Important preference"
    
    @pytest.mark.unit
    async def test_empty_conversation(self, db):
        """Test extraction with too few messages."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # Less than 2 messages
        memories = await extractor.extract_from_conversation(
            namespace="project:test123",
            messages=[{"role": "user", "content": "Hello"}],
        )
        
        assert len(memories) == 0
    
    @pytest.mark.unit
    async def test_no_memories_extracted(self, db):
        """Test when LLM returns no memories."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="[]"))  # Empty array
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            memories = await extractor.extract_from_conversation(
                namespace="project:test123",
                messages=[
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello!"},
                ],
            )
        
        assert len(memories) == 0
    
    @pytest.mark.unit
    async def test_json_with_markdown_code_block(self, db):
        """Test handling JSON wrapped in markdown code blocks."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # LLM sometimes wraps JSON in markdown
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="""```json
[
    {
        "category": "USER_PREFERENCES",
        "key": "test_pref",
        "content": "Test preference",
        "importance": 8
    }
]
```"""))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="project:test123",
                    messages=[
                        {"role": "user", "content": "Test"},
                        {"role": "assistant", "content": "Response"},
                    ],
                )
        
        assert len(memories) == 1
    
    @pytest.mark.unit
    async def test_api_error_handling(self, db):
        """Test handling of API errors."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(
                side_effect=Exception("API Error")
            )
            mock_get_client.return_value = mock_client
            
            memories = await extractor.extract_from_conversation(
                namespace="project:test123",
                messages=[
                    {"role": "user", "content": "Test"},
                    {"role": "assistant", "content": "Response"},
                ],
            )
        
        # Should return empty list on error, not raise
        assert len(memories) == 0
    
    @pytest.mark.unit
    async def test_invalid_json_response(self, db):
        """Test handling of invalid JSON from LLM."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="This is not JSON"))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            memories = await extractor.extract_from_conversation(
                namespace="project:test123",
                messages=[
                    {"role": "user", "content": "Test"},
                    {"role": "assistant", "content": "Response"},
                ],
            )
        
        # Should return empty list on parse error
        assert len(memories) == 0
    
    @pytest.mark.unit
    async def test_namespace_tuple_conversion(self, db):
        """Test that tuple namespaces are converted properly."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    "key": "test_key",
                    "content": "Test content",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace=("user", "123", "project", "abc"),  # Tuple format
                    messages=[
                        {"role": "user", "content": "Test"},
                        {"role": "assistant", "content": "Response"},
                    ],
                )
        
        assert len(memories) == 1
        assert memories[0].namespace == "user:123/project:abc"
    
    @pytest.mark.unit
    async def test_long_conversation_truncation(self, db):
        """Test that long conversations are truncated to last 20 messages."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # Create 30 messages
        messages = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"Message {i}"}
            for i in range(30)
        ]
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="[]"))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            await extractor.extract_from_conversation(
                namespace="project:test123",
                messages=messages,
            )
            
            # Verify the prompt was called
            call_args = mock_client.chat.completions.create.call_args
            prompt = call_args.kwargs["messages"][0]["content"]
            
            # Should contain later messages, not earlier ones
            assert "Message 29" in prompt  # Last message
            assert "Message 10" in prompt  # Still in last 20


# =============================================================================
# Task Completion Extraction Tests
# =============================================================================

class TestTaskCompletionExtraction:
    """Tests for extracting memories from task completions."""
    
    @pytest.mark.unit
    async def test_extract_task_completion(self, db):
        """Test extracting memory from task completion."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await extractor.extract_from_task_completion(
                namespace="project:test123/episodic",
                task_description="Implement user authentication",
                approach_taken="Used JWT with httpOnly cookies",
                outcome="Success - all tests passing",
                files_changed=["src/auth/jwt.ts", "src/middleware/auth.ts"],
            )
        
        assert memory is not None
        assert memory.value["task"] == "Implement user authentication"
        assert memory.value["approach"] == "Used JWT with httpOnly cookies"
        assert memory.value["outcome"] == "Success - all tests passing"
        assert memory.value["files"] == ["src/auth/jwt.ts", "src/middleware/auth.ts"]
        assert memory.metadata_["type"] == MemoryTypes.TASK_COMPLETION
    
    @pytest.mark.unit
    async def test_task_completion_without_files(self, db):
        """Test task completion without file changes."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await extractor.extract_from_task_completion(
                namespace="project:test123/episodic",
                task_description="Research API options",
                approach_taken="Compared REST vs GraphQL",
                outcome="Decided on REST for simplicity",
                files_changed=None,
            )
        
        assert memory is not None
        assert memory.value["files"] == []
    
    @pytest.mark.unit
    async def test_task_completion_key_format(self, db):
        """Test that task completion keys have correct format."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await extractor.extract_from_task_completion(
                namespace="project:test123/episodic",
                task_description="Test task",
                approach_taken="Test approach",
                outcome="Test outcome",
            )
        
        assert memory.key.startswith("task_")
        # Key should contain timestamp-like format
        assert len(memory.key) > 5
    
    @pytest.mark.unit
    async def test_task_completion_timestamp_metadata(self, db):
        """Test that task completion has timestamp in metadata."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        before = datetime.now(timezone.utc).isoformat()
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await extractor.extract_from_task_completion(
                namespace="project:test123/episodic",
                task_description="Test task",
                approach_taken="Test approach",
                outcome="Test outcome",
            )
        
        after = datetime.now(timezone.utc).isoformat()
        
        assert "timestamp" in memory.metadata_
        assert before <= memory.metadata_["timestamp"] <= after
    
    @pytest.mark.unit
    async def test_task_completion_with_tuple_namespace(self, db):
        """Test task completion with tuple namespace."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            memory = await extractor.extract_from_task_completion(
                namespace=("project", "test123", "type", "episodic"),  # Even number of elements
                task_description="Test task",
                approach_taken="Test approach",
                outcome="Test outcome",
            )
        
        assert memory.namespace == "project:test123/type:episodic"


# =============================================================================
# Memory Category Mapping Tests
# =============================================================================

class TestMemoryCategoryMapping:
    """Tests for mapping extracted categories to MemoryTypes."""
    
    @pytest.mark.unit
    async def test_category_mappings(self, db):
        """Test all category to MemoryType mappings."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        categories_and_types = [
            ("USER_PREFERENCES", MemoryTypes.USER_PREFERENCE),
            ("LEARNED_FACTS", MemoryTypes.LEARNED_FACT),
            ("SUCCESSFUL_PATTERNS", MemoryTypes.TASK_COMPLETION),
            ("USER_CORRECTIONS", MemoryTypes.USER_CORRECTION),
        ]
        
        for category, expected_type in categories_and_types:
            mock_response = MagicMock()
            mock_response.choices = [
                MagicMock(message=MagicMock(content=json.dumps([
                    {
                        "category": category,
                        "key": f"test_{category.lower()}",
                        "content": f"Test {category}",
                        "importance": 8,
                    },
                ])))
            ]
            
            with patch.object(extractor, '_get_client') as mock_get_client:
                mock_client = AsyncMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_get_client.return_value = mock_client
                
                with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                    memories = await extractor.extract_from_conversation(
                        namespace="test",
                        messages=[
                            {"role": "user", "content": "Test"},
                            {"role": "assistant", "content": "Response"},
                        ],
                    )
            
            assert len(memories) == 1, f"Failed for category {category}"
            assert memories[0].metadata_["type"] == expected_type, f"Failed for category {category}"
    
    @pytest.mark.unit
    async def test_unknown_category_defaults_to_semantic(self, db):
        """Test that unknown categories default to SEMANTIC type."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "UNKNOWN_CATEGORY",
                    "key": "test_unknown",
                    "content": "Test content",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="test",
                    messages=[
                        {"role": "user", "content": "Test"},
                        {"role": "assistant", "content": "Response"},
                    ],
                )
        
        assert len(memories) == 1
        assert memories[0].metadata_["type"] == MemoryTypes.SEMANTIC


# =============================================================================
# Integration with MemoryStore Tests
# =============================================================================

class TestExtractorStoreIntegration:
    """Tests for integration between MemoryExtractor and MemoryStore."""
    
    @pytest.mark.unit
    async def test_extracted_memories_are_searchable(self, db):
        """Test that extracted memories can be found via search."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    "key": "react_preference",
                    "content": "User prefers React functional components",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                await extractor.extract_from_conversation(
                    namespace="project:searchable",
                    messages=[
                        {"role": "user", "content": "Test"},
                        {"role": "assistant", "content": "Response"},
                    ],
                )
                await db.flush()
        
        # Should be findable via list
        memories = await store.list(namespace="project:searchable", prefix_match=False)
        assert len(memories) == 1
        assert "React" in memories[0].value["content"]
    
    @pytest.mark.unit
    async def test_multiple_extractions_accumulate(self, db):
        """Test that multiple extractions accumulate memories."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        def create_mock_response(key, content):
            mock = MagicMock()
            mock.choices = [
                MagicMock(message=MagicMock(content=json.dumps([
                    {
                        "category": "USER_PREFERENCES",
                        "key": key,
                        "content": content,
                        "importance": 8,
                    },
                ])))
            ]
            return mock
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            
            # First extraction
            mock_client.chat.completions.create = AsyncMock(
                return_value=create_mock_response("pref1", "Preference 1")
            )
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                await extractor.extract_from_conversation(
                    namespace="project:accumulate",
                    messages=[{"role": "user", "content": "A"}, {"role": "assistant", "content": "B"}],
                )
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            
            # Second extraction
            mock_client.chat.completions.create = AsyncMock(
                return_value=create_mock_response("pref2", "Preference 2")
            )
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                await extractor.extract_from_conversation(
                    namespace="project:accumulate",
                    messages=[{"role": "user", "content": "C"}, {"role": "assistant", "content": "D"}],
                )
        
        await db.flush()
        
        memories = await store.list(namespace="project:accumulate", prefix_match=False)
        assert len(memories) == 2


# =============================================================================
# Edge Cases
# =============================================================================

class TestExtractorEdgeCases:
    """Tests for edge cases in memory extraction."""
    
    @pytest.mark.unit
    async def test_missing_key_generates_timestamp_key(self, db):
        """Test that missing key generates a timestamp-based key."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    # No "key" field
                    "content": "Test content",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="test",
                    messages=[
                        {"role": "user", "content": "Test"},
                        {"role": "assistant", "content": "Response"},
                    ],
                )
        
        assert len(memories) == 1
        assert memories[0].key.startswith("memory_")
    
    @pytest.mark.unit
    async def test_missing_content_uses_empty_string(self, db):
        """Test handling of missing content field."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    "key": "test_key",
                    # No "content" field
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
                memories = await extractor.extract_from_conversation(
                    namespace="test",
                    messages=[
                        {"role": "user", "content": "Test"},
                        {"role": "assistant", "content": "Response"},
                    ],
                )
        
        assert len(memories) == 1
        assert memories[0].value["content"] == ""
    
    @pytest.mark.unit
    async def test_non_list_response(self, db):
        """Test handling of non-list JSON response."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content='{"not": "a list"}'))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            memories = await extractor.extract_from_conversation(
                namespace="test",
                messages=[
                    {"role": "user", "content": "Test"},
                    {"role": "assistant", "content": "Response"},
                ],
            )
        
        # Should return empty list for non-list response
        assert len(memories) == 0
    
    @pytest.mark.unit
    async def test_empty_message_content(self, db):
        """Test handling messages with empty content."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=None))  # Empty content
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            memories = await extractor.extract_from_conversation(
                namespace="test",
                messages=[
                    {"role": "user", "content": "Test"},
                    {"role": "assistant", "content": "Response"},
                ],
            )
        
        assert len(memories) == 0
