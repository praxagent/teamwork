"""
Integration tests for the Memory system.

Tests cover:
- End-to-end workflows
- Multiple components working together
- Real-world usage scenarios
- Performance considerations
- Convenience functions
"""

import asyncio
import json
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from app.models.memory import Memory
from app.services.memory_store import (
    MemoryStore,
    MemoryExtractor,
    MemoryTypes,
    get_relevant_memories,
)


# =============================================================================
# End-to-End Workflow Tests
# =============================================================================

class TestEndToEndWorkflows:
    """Tests for complete end-to-end memory workflows."""
    
    @pytest.mark.integration
    async def test_full_conversation_memory_lifecycle(self, db):
        """Test complete lifecycle: extract -> store -> search -> retrieve."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # Step 1: Extract memories from conversation
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_PREFERENCES",
                    "key": "framework_preference",
                    "content": "User strongly prefers React with TypeScript",
                    "importance": 9,
                },
                {
                    "category": "LEARNED_FACTS",
                    "key": "project_structure",
                    "content": "Project uses monorepo with Turborepo",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding') as mock_embed:
                # Different embeddings for different content
                mock_embed.side_effect = [
                    [0.9, 0.1] + [0.0] * 1534,  # React TypeScript
                    [0.1, 0.9] + [0.0] * 1534,  # Monorepo
                ]
                
                extracted = await extractor.extract_from_conversation(
                    namespace="user:user1/project:proj1/semantic",
                    messages=[
                        {"role": "user", "content": "I prefer React with TypeScript"},
                        {"role": "assistant", "content": "I'll use React with TypeScript"},
                    ],
                )
        
        assert len(extracted) == 2
        await db.flush()
        
        # Step 2: Search for relevant memories
        with patch.object(store, '_get_embedding', return_value=[0.85, 0.15] + [0.0] * 1534):
            search_results = await store.search(
                namespace="user:user1/project:proj1",
                query="What framework should I use?",
                prefix_match=True,
                similarity_threshold=0.0,
            )
        
        assert len(search_results) >= 1
        # Most relevant should be React preference (similar embedding)
        top_result = search_results[0][0]
        assert "React" in top_result.value["content"]
        
        # Step 3: Retrieve specific memory by key
        memory = await store.get(
            namespace="user:user1/project:proj1/semantic",
            key="framework_preference",
        )
        assert memory is not None
        assert memory.value["content"] == "User strongly prefers React with TypeScript"
    
    @pytest.mark.integration
    async def test_multi_project_memory_isolation(self, db):
        """Test that memories are properly isolated between projects."""
        store = MemoryStore(db)
        
        # Create memories for project 1
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            await store.put(
                namespace="user:user1/project:proj1/semantic",
                key="db_choice",
                value={"content": "Project 1 uses PostgreSQL"},
            )
        
        # Create memories for project 2
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            await store.put(
                namespace="user:user1/project:proj2/semantic",
                key="db_choice",
                value={"content": "Project 2 uses MongoDB"},
            )
        
        await db.flush()
        
        # Search in project 1 only
        proj1_memories = await store.list(
            namespace="user:user1/project:proj1",
            prefix_match=True,
        )
        assert len(proj1_memories) == 1
        assert "PostgreSQL" in proj1_memories[0].value["content"]
        
        # Search in project 2 only
        proj2_memories = await store.list(
            namespace="user:user1/project:proj2",
            prefix_match=True,
        )
        assert len(proj2_memories) == 1
        assert "MongoDB" in proj2_memories[0].value["content"]
        
        # Search across all user memories
        all_user_memories = await store.list(
            namespace="user:user1",
            prefix_match=True,
        )
        assert len(all_user_memories) == 2
    
    @pytest.mark.integration
    async def test_memory_update_workflow(self, db):
        """Test updating memories as user preferences evolve."""
        store = MemoryStore(db)
        namespace = "user:user1/preferences"
        
        # Initial preference
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            await store.put(
                namespace=namespace,
                key="code_style",
                value={
                    "content": "User prefers 2-space indentation",
                    "version": 1,
                },
            )
        
        await db.flush()
        
        # User changes preference
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            await store.put(
                namespace=namespace,
                key="code_style",
                value={
                    "content": "User now prefers 4-space indentation",
                    "version": 2,
                },
            )
        
        await db.flush()
        
        # Should only have one memory (updated)
        memories = await store.list(namespace=namespace)
        assert len(memories) == 1
        assert memories[0].value["version"] == 2
        assert "4-space" in memories[0].value["content"]
    
    @pytest.mark.integration
    async def test_episodic_memory_accumulation(self, db):
        """Test accumulating episodic memories over time."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        namespace = "project:proj1/type:episodic"
        
        # Record multiple task completions with unique keys
        tasks = [
            ("setup", "Set up project structure", "Used create-next-app", "Success"),
            ("auth", "Add authentication", "Implemented NextAuth.js", "Success"),
            ("db", "Create database schema", "Used Prisma with PostgreSQL", "Success"),
        ]
        
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            for key_suffix, task, approach, outcome in tasks:
                # Use store.put directly with explicit unique keys
                await store.put(
                    namespace=namespace,
                    key=f"task_{key_suffix}",
                    value={
                        "task": task,
                        "approach": approach,
                        "outcome": outcome,
                        "files": [],
                    },
                    metadata={"type": MemoryTypes.TASK_COMPLETION},
                )
        
        await db.flush()
        
        # Should have all task memories
        memories = await store.list(namespace=namespace, limit=100)
        assert len(memories) == 3
        
        # Verify content (check if substring is in any approach)
        approaches = [m.value["approach"] for m in memories]
        assert any("create-next-app" in a for a in approaches)
        assert any("NextAuth.js" in a for a in approaches)
        assert any("Prisma" in a for a in approaches)


# =============================================================================
# Real-World Scenario Tests
# =============================================================================

class TestRealWorldScenarios:
    """Tests simulating real-world usage scenarios."""
    
    @pytest.mark.integration
    async def test_agent_prompt_context_injection(self, db):
        """Test injecting memories into agent prompt context."""
        store = MemoryStore(db)
        
        # Create various memories with content_text for text search fallback
        memories_to_create = [
            {
                "namespace": "user:user1/project:proj1/type:semantic",
                "key": "code_style",
                "value": {"content": "Use ESLint with Airbnb config"},
                "content_text": "Use ESLint with Airbnb config",
                "metadata": {"type": MemoryTypes.USER_PREFERENCE, "importance": 8},
            },
            {
                "namespace": "user:user1/project:proj1/type:semantic",
                "key": "testing_pref",
                "value": {"content": "Write tests using Jest and React Testing Library"},
                "content_text": "Write tests using Jest and React Testing Library",
                "metadata": {"type": MemoryTypes.USER_PREFERENCE, "importance": 9},
            },
        ]
        
        # Insert directly to avoid embedding issues
        for mem_data in memories_to_create:
            memory = Memory(
                namespace=mem_data["namespace"],
                key=mem_data["key"],
                value=mem_data["value"],
                content_text=mem_data["content_text"],
                embedding=[0.1] * 1536,
                metadata_=mem_data["metadata"],
            )
            db.add(memory)
        
        await db.flush()
        
        # Patch at module level for get_relevant_memories
        with patch('app.services.memory_store.MemoryStore._get_embedding', return_value=[0.1] * 1536):
            context = await get_relevant_memories(
                db=db,
                user_id="user1",
                project_id="proj1",
                query="How should I write tests?",
                memory_types=[MemoryTypes.USER_PREFERENCE],
                limit=5,
            )
        
        assert "Relevant Memories" in context
        assert "Jest" in context or "Testing Library" in context
    
    @pytest.mark.integration
    async def test_learning_from_corrections(self, db):
        """Test learning from user corrections over multiple conversations."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # First conversation: user corrects async/await style
        mock_response1 = MagicMock()
        mock_response1.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_CORRECTIONS",
                    "key": "async_style",
                    "content": "Always use async/await, never .then()",
                    "importance": 9,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response1)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.5] * 1536):
                await extractor.extract_from_conversation(
                    namespace="user:user1/corrections",
                    messages=[
                        {"role": "user", "content": "Don't use .then(), use async/await"},
                        {"role": "assistant", "content": "Got it!"},
                    ],
                )
        
        # Second conversation: user corrects error handling
        mock_response2 = MagicMock()
        mock_response2.choices = [
            MagicMock(message=MagicMock(content=json.dumps([
                {
                    "category": "USER_CORRECTIONS",
                    "key": "error_handling",
                    "content": "Always include specific error types in catch blocks",
                    "importance": 8,
                },
            ])))
        ]
        
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response2)
            mock_get_client.return_value = mock_client
            
            with patch.object(store, '_get_embedding', return_value=[0.6] * 1536):
                await extractor.extract_from_conversation(
                    namespace="user:user1/corrections",
                    messages=[
                        {"role": "user", "content": "Use specific error types in catch"},
                        {"role": "assistant", "content": "Will do!"},
                    ],
                )
        
        await db.flush()
        
        # Later: retrieve all corrections
        corrections = await store.list(
            namespace="user:user1/corrections",
            prefix_match=False,
        )
        
        assert len(corrections) == 2
        
        # Verify both corrections are stored
        contents = [c.value["content"] for c in corrections]
        assert any("async/await" in c for c in contents)
        assert any("error types" in c for c in contents)
    
    @pytest.mark.integration
    async def test_project_knowledge_base(self, db):
        """Test building up project knowledge over time."""
        store = MemoryStore(db)
        
        # Simulate learning project facts over multiple sessions
        project_facts = [
            ("tech_stack", "Frontend uses Next.js 14 with App Router"),
            ("database", "PostgreSQL 15 on AWS RDS"),
            ("auth", "NextAuth.js with GitHub OAuth"),
            ("deployment", "Vercel for frontend, Railway for backend"),
            ("ci_cd", "GitHub Actions for CI/CD"),
        ]
        
        with patch.object(store, '_get_embedding') as mock_embed:
            embeddings = [[0.1 * i] * 1536 for i in range(len(project_facts))]
            mock_embed.side_effect = embeddings
            
            for key, content in project_facts:
                await store.put(
                    namespace="project:proj1/knowledge",
                    key=key,
                    value={"content": content, "source": "user"},
                    metadata={"type": MemoryTypes.LEARNED_FACT},
                )
        
        await db.flush()
        
        # Query: "What database are we using?"
        with patch.object(store, '_get_embedding', return_value=[0.2] * 1536):
            results = await store.search(
                namespace="project:proj1/knowledge",
                query="What database are we using?",
                limit=3,
                similarity_threshold=0.0,
            )
        
        # Should find database-related memory
        assert len(results) > 0


# =============================================================================
# Convenience Function Tests
# =============================================================================

class TestGetRelevantMemories:
    """Tests for the get_relevant_memories convenience function."""
    
    @pytest.mark.integration
    async def test_get_memories_with_user_and_project(self, db):
        """Test getting memories scoped to user and project."""
        # Create memories directly with all fields
        memories_data = [
            ("user:user1/project:proj1/type:semantic", "pref1", "User 1 Project 1 preference"),
            ("user:user1/project:proj2/type:semantic", "pref2", "User 1 Project 2 preference"),
            ("user:user2/project:proj1/type:semantic", "pref3", "User 2 Project 1 preference"),
        ]
        
        for namespace, key, content in memories_data:
            memory = Memory(
                namespace=namespace,
                key=key,
                value={"content": content},
                content_text=content,
                embedding=[0.1] * 1536,
            )
            db.add(memory)
        
        await db.flush()
        
        # Get memories for user1/proj1
        with patch('app.services.memory_store.MemoryStore._get_embedding', return_value=[0.1] * 1536):
            context = await get_relevant_memories(
                db=db,
                user_id="user1",
                project_id="proj1",
                query="preferences",
                limit=10,
            )
        
        assert "User 1 Project 1" in context
        assert "User 1 Project 2" not in context
        assert "User 2" not in context
    
    @pytest.mark.integration
    async def test_get_memories_with_type_filter(self, db):
        """Test filtering memories by type."""
        # Create memories directly
        pref_memory = Memory(
            namespace="user:user1/project:proj1/type:semantic",
            key="pref",
            value={"content": "A user preference"},
            content_text="A user preference",
            embedding=[0.1] * 1536,
            metadata_={"type": MemoryTypes.USER_PREFERENCE},
        )
        fact_memory = Memory(
            namespace="user:user1/project:proj1/type:semantic",
            key="fact",
            value={"content": "A learned fact"},
            content_text="A learned fact",
            embedding=[0.2] * 1536,
            metadata_={"type": MemoryTypes.LEARNED_FACT},
        )
        db.add(pref_memory)
        db.add(fact_memory)
        await db.flush()
        
        # Get only preferences
        with patch('app.services.memory_store.MemoryStore._get_embedding', return_value=[0.1] * 1536):
            context = await get_relevant_memories(
                db=db,
                user_id="user1",
                project_id="proj1",
                query="anything",
                memory_types=[MemoryTypes.USER_PREFERENCE],
                limit=10,
            )
        
        assert "preference" in context.lower()
    
    @pytest.mark.integration
    async def test_get_memories_empty_result(self, db):
        """Test getting memories when none exist."""
        context = await get_relevant_memories(
            db=db,
            user_id="nonexistent",
            project_id="nonexistent",
            query="anything",
            limit=10,
        )
        
        assert context == ""
    
    @pytest.mark.integration
    async def test_get_memories_formatting(self, db):
        """Test that returned context is properly formatted."""
        # Create memory directly
        memory = Memory(
            namespace="user:user1/type:semantic",
            key="pref",
            value={"content": "Test preference content"},
            content_text="Test preference content",
            embedding=[0.1] * 1536,
            metadata_={"type": MemoryTypes.USER_PREFERENCE},
        )
        db.add(memory)
        await db.flush()
        
        with patch('app.services.memory_store.MemoryStore._get_embedding', return_value=[0.1] * 1536):
            context = await get_relevant_memories(
                db=db,
                user_id="user1",
                query="test",
                limit=10,
            )
        
        # Should have header
        assert "## Relevant Memories" in context
        # Should have formatted memory
        assert "[user_preference]" in context
        assert "Test preference content" in context


# =============================================================================
# Performance Considerations Tests
# =============================================================================

class TestPerformanceConsiderations:
    """Tests for performance-related behavior."""
    
    @pytest.mark.integration
    async def test_search_with_many_memories(self, db):
        """Test search performance with many memories."""
        store = MemoryStore(db)
        
        # Create 100 memories
        with patch.object(store, '_get_embedding', return_value=[0.1] * 1536):
            for i in range(100):
                await store.put(
                    namespace="test/performance",
                    key=f"memory_{i}",
                    value={"content": f"Memory content {i}", "index": i},
                    generate_embedding=False,  # Skip embedding for speed
                )
        
        await db.flush()
        
        # List should respect limit
        memories = await store.list(
            namespace="test/performance",
            limit=10,
        )
        assert len(memories) == 10
    
    @pytest.mark.integration
    async def test_sequential_memory_operations(self, db):
        """Test sequential memory operations with unique keys."""
        store = MemoryStore(db)
        
        results = []
        for i in range(20):
            memory = await store.put(
                namespace="test/sequential",
                key=f"mem_{i}",
                value={"index": i},
                generate_embedding=False,
            )
            results.append(memory)
        
        await db.flush()
        
        assert len(results) == 20
        
        # All should be retrievable
        memories = await store.list(namespace="test/sequential", limit=50)
        assert len(memories) == 20
    
    @pytest.mark.integration
    async def test_namespace_prefix_efficiency(self, db):
        """Test that prefix matching is efficient."""
        store = MemoryStore(db)
        
        # Create memories in nested namespaces
        namespaces = [
            "user:1/project:a/semantic",
            "user:1/project:a/episodic",
            "user:1/project:b/semantic",
            "user:2/project:a/semantic",
        ]
        
        for ns in namespaces:
            await store.put(
                namespace=ns,
                key="test",
                value={"ns": ns},
                generate_embedding=False,
            )
        
        await db.flush()
        
        # Prefix search should only return matching
        user1_memories = await store.list(
            namespace="user:1",
            prefix_match=True,
        )
        assert len(user1_memories) == 3  # All user:1/* memories
        
        user1_proj_a = await store.list(
            namespace="user:1/project:a",
            prefix_match=True,
        )
        assert len(user1_proj_a) == 2  # semantic and episodic


# =============================================================================
# Error Recovery Tests
# =============================================================================

class TestErrorRecovery:
    """Tests for error recovery and graceful degradation."""
    
    @pytest.mark.integration
    async def test_embedding_failure_fallback(self, db):
        """Test fallback when embedding generation fails."""
        store = MemoryStore(db)
        
        # Create memories with embeddings
        memories_data = [
            ("mem1", "Apple banana cherry", [0.1, 0.2, 0.3] + [0.0] * 1533),
            ("mem2", "Dog cat elephant", [0.4, 0.5, 0.6] + [0.0] * 1533),
        ]
        
        for key, content, embedding in memories_data:
            mem = Memory(
                namespace="test/fallback",
                key=key,
                value={"content": content},
                content_text=content,
                embedding=embedding,
            )
            db.add(mem)
        await db.flush()
        
        # Search with embedding failure
        with patch.object(store, '_get_embedding', return_value=[]):  # Empty = failure
            results = await store.search(
                namespace="test/fallback",
                query="apple banana",  # Should match via text
                prefix_match=False,
            )
        
        # Should fall back to text search
        assert len(results) >= 1
        assert "Apple" in results[0][0].content_text
    
    @pytest.mark.integration
    async def test_extraction_error_isolation(self, db):
        """Test that extraction errors don't affect other operations."""
        store = MemoryStore(db)
        extractor = MemoryExtractor(store)
        
        # First: failed extraction
        with patch.object(extractor, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(
                side_effect=Exception("API Error")
            )
            mock_get_client.return_value = mock_client
            
            result = await extractor.extract_from_conversation(
                namespace="test/error",
                messages=[{"role": "user", "content": "A"}, {"role": "assistant", "content": "B"}],
            )
            assert result == []  # Empty, but no exception
        
        # Second: normal operation should still work
        await store.put(
            namespace="test/error",
            key="normal",
            value={"content": "Normal operation"},
            generate_embedding=False,
        )
        
        memory = await store.get(namespace="test/error", key="normal")
        assert memory is not None


# =============================================================================
# Data Integrity Tests
# =============================================================================

class TestDataIntegrity:
    """Tests for data integrity and consistency."""
    
    @pytest.mark.integration
    async def test_memory_update_preserves_id(self, db):
        """Test that updating a memory preserves its ID."""
        store = MemoryStore(db)
        
        # Create
        memory1 = await store.put(
            namespace="test/integrity",
            key="preserve_id",
            value={"version": 1},
            generate_embedding=False,
        )
        original_id = memory1.id
        
        # Update
        memory2 = await store.put(
            namespace="test/integrity",
            key="preserve_id",
            value={"version": 2},
            generate_embedding=False,
        )
        
        assert memory2.id == original_id
    
    @pytest.mark.integration
    async def test_namespace_case_sensitivity(self, db):
        """Test that namespaces are case-sensitive."""
        store = MemoryStore(db)
        
        await store.put(
            namespace="User:123",
            key="upper",
            value={"case": "upper"},
            generate_embedding=False,
        )
        await store.put(
            namespace="user:123",
            key="lower",
            value={"case": "lower"},
            generate_embedding=False,
        )
        await db.flush()
        
        upper = await store.list(namespace="User:123")
        lower = await store.list(namespace="user:123")
        
        assert len(upper) == 1
        assert len(lower) == 1
        assert upper[0].value["case"] == "upper"
        assert lower[0].value["case"] == "lower"
    
    @pytest.mark.integration
    async def test_metadata_preserved_on_update(self, db):
        """Test that metadata is preserved when not explicitly updated."""
        store = MemoryStore(db)
        
        # Create with metadata
        await store.put(
            namespace="test/metadata",
            key="preserve",
            value={"v": 1},
            metadata={"type": "original", "importance": 8},
            generate_embedding=False,
        )
        await db.flush()
        
        # Update value only (no metadata)
        await store.put(
            namespace="test/metadata",
            key="preserve",
            value={"v": 2},
            generate_embedding=False,
        )
        
        memory = await store.get(namespace="test/metadata", key="preserve")
        
        assert memory.value["v"] == 2
        assert memory.metadata_["type"] == "original"
        assert memory.metadata_["importance"] == 8
