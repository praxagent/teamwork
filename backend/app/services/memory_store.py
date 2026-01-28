"""Memory Store service for long-term memory management.

Provides a LangChain-inspired memory store with:
- Namespace-based organization
- CRUD operations (put, get, search, delete)
- Semantic search via embeddings
- Profile and collection patterns
- Background memory extraction

Usage:
    store = MemoryStore()
    
    # Store a memory
    await store.put(
        namespace=("user", "123", "project", "abc", "semantic"),
        key="user-preference-1",
        value={"preference": "Uses functional React components", "confidence": 0.9},
    )
    
    # Retrieve by key
    memory = await store.get(("user", "123", "project", "abc", "semantic"), "user-preference-1")
    
    # Semantic search
    results = await store.search(
        namespace=("user", "123", "project", "abc"),  # Can be partial
        query="What does the user prefer for React?",
        limit=5,
    )
    
    # Filter by metadata
    results = await store.search(
        namespace=("user", "123"),
        query="debugging patterns",
        filter={"type": "episodic"},
        limit=10,
    )
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, TypeVar

import openai
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.memory import Memory, EmbeddingVector

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Embedding configuration
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536  # Default for text-embedding-3-small


class MemoryStore:
    """
    A lightweight memory store inspired by LangGraph's BaseStore.
    
    Provides namespace-based organization and semantic search over memories.
    Uses SQLite with JSON-stored embeddings for portability.
    
    For production, consider migrating to PostgreSQL with pgvector for
    native vector similarity search.
    """
    
    def __init__(self, db: AsyncSession) -> None:
        """
        Initialize the memory store.
        
        Args:
            db: SQLAlchemy async session
        """
        self.db = db
        self._openai_client: openai.AsyncOpenAI | None = None
    
    def _get_openai_client(self) -> openai.AsyncOpenAI:
        """Lazy-load OpenAI client."""
        if self._openai_client is None:
            api_key = settings.openai_api_key
            if not api_key:
                raise ValueError("OPENAI_API_KEY is required for embeddings")
            self._openai_client = openai.AsyncOpenAI(api_key=api_key)
        return self._openai_client
    
    @staticmethod
    def build_namespace(*parts: str) -> str:
        """
        Build a namespace string from parts.
        
        Accepts either:
        - Alternating key/value pairs: ("user", "123", "project", "abc")
        - Pre-built tuples: (("user", "123"), ("project", "abc"))
        
        Returns: "user:123/project:abc"
        """
        if not parts:
            return ""
        
        # Check if parts are tuples (already paired)
        if isinstance(parts[0], tuple):
            return "/".join(f"{k}:{v}" for k, v in parts)
        
        # Otherwise, pair them up
        if len(parts) % 2 != 0:
            raise ValueError("Namespace parts must be key-value pairs")
        
        pairs = [(parts[i], parts[i + 1]) for i in range(0, len(parts), 2)]
        return "/".join(f"{k}:{v}" for k, v in pairs)
    
    async def _get_embedding(self, text: str) -> EmbeddingVector:
        """Generate an embedding for the given text."""
        if not text or not text.strip():
            return []
        
        try:
            client = self._get_openai_client()
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text[:8000],  # Truncate to avoid token limits
            )
            return response.data[0].embedding
        except Exception as e:
            logger.warning(f"[MemoryStore] Failed to generate embedding: {e}")
            return []
    
    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        if not a or not b or len(a) != len(b):
            return 0.0
        
        dot_product = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        return dot_product / (norm_a * norm_b)
    
    async def put(
        self,
        namespace: str | tuple,
        key: str,
        value: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        generate_embedding: bool = True,
    ) -> Memory:
        """
        Store or update a memory.
        
        Args:
            namespace: Namespace string or tuple of (key, value) pairs
            key: Unique key within the namespace
            value: The memory content as a dict
            metadata: Optional metadata for filtering
            generate_embedding: Whether to generate an embedding for search
            
        Returns:
            The created or updated Memory object
        """
        # Normalize namespace
        if isinstance(namespace, tuple):
            namespace = self.build_namespace(*namespace)
        
        # Check if memory exists
        existing = await self._get_by_namespace_key(namespace, key)
        
        # Generate content text and embedding
        content_text = Memory._flatten_to_text(value)
        embedding = None
        if generate_embedding and content_text:
            embedding = await self._get_embedding(content_text)
        
        if existing:
            # Update existing memory
            existing.value = value
            existing.content_text = content_text
            existing.embedding = embedding
            existing.metadata_ = metadata or existing.metadata_
            existing.updated_at = datetime.now(timezone.utc)
            await self.db.flush()
            logger.debug(f"[MemoryStore] Updated memory: {namespace}/{key}")
            return existing
        else:
            # Create new memory
            memory = Memory(
                namespace=namespace,
                key=key,
                value=value,
                content_text=content_text,
                embedding=embedding,
                metadata_=metadata or {},
            )
            self.db.add(memory)
            await self.db.flush()
            logger.debug(f"[MemoryStore] Created memory: {namespace}/{key}")
            return memory
    
    async def _get_by_namespace_key(self, namespace: str, key: str) -> Memory | None:
        """Get a memory by namespace and key."""
        result = await self.db.execute(
            select(Memory).where(
                Memory.namespace == namespace,
                Memory.key == key,
            )
        )
        return result.scalar_one_or_none()
    
    async def get(
        self,
        namespace: str | tuple,
        key: str,
    ) -> Memory | None:
        """
        Retrieve a memory by namespace and key.
        
        Args:
            namespace: Namespace string or tuple
            key: The memory key
            
        Returns:
            The Memory object or None if not found
        """
        if isinstance(namespace, tuple):
            namespace = self.build_namespace(*namespace)
        
        return await self._get_by_namespace_key(namespace, key)
    
    async def delete(
        self,
        namespace: str | tuple,
        key: str,
    ) -> bool:
        """
        Delete a memory by namespace and key.
        
        Args:
            namespace: Namespace string or tuple
            key: The memory key
            
        Returns:
            True if deleted, False if not found
        """
        if isinstance(namespace, tuple):
            namespace = self.build_namespace(*namespace)
        
        result = await self.db.execute(
            delete(Memory).where(
                Memory.namespace == namespace,
                Memory.key == key,
            )
        )
        await self.db.flush()
        deleted = result.rowcount > 0
        if deleted:
            logger.debug(f"[MemoryStore] Deleted memory: {namespace}/{key}")
        return deleted
    
    async def list(
        self,
        namespace: str | tuple,
        prefix_match: bool = False,
        limit: int = 100,
    ) -> list[Memory]:
        """
        List all memories in a namespace.
        
        Args:
            namespace: Namespace string or tuple
            prefix_match: If True, match all namespaces starting with this prefix
            limit: Maximum number of results
            
        Returns:
            List of Memory objects
        """
        if isinstance(namespace, tuple):
            namespace = self.build_namespace(*namespace)
        
        if prefix_match:
            query = select(Memory).where(
                Memory.namespace.startswith(namespace)
            ).order_by(Memory.updated_at.desc()).limit(limit)
        else:
            query = select(Memory).where(
                Memory.namespace == namespace
            ).order_by(Memory.updated_at.desc()).limit(limit)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def search(
        self,
        namespace: str | tuple,
        query: str,
        filter: dict[str, Any] | None = None,
        limit: int = 5,
        prefix_match: bool = True,
        similarity_threshold: float = 0.3,
    ) -> list[tuple[Memory, float]]:
        """
        Semantic search for memories.
        
        Args:
            namespace: Namespace to search within (can be partial with prefix_match)
            query: Natural language query
            filter: Optional metadata filter (exact match)
            limit: Maximum number of results
            prefix_match: If True, search all namespaces starting with prefix
            similarity_threshold: Minimum cosine similarity to include
            
        Returns:
            List of (Memory, similarity_score) tuples, sorted by similarity
        """
        if isinstance(namespace, tuple):
            namespace = self.build_namespace(*namespace)
        
        # Get query embedding
        query_embedding = await self._get_embedding(query)
        if not query_embedding:
            logger.warning("[MemoryStore] Failed to get query embedding, falling back to text search")
            return await self._text_search(namespace, query, filter, limit, prefix_match)
        
        # Fetch candidate memories
        if prefix_match:
            query_stmt = select(Memory).where(
                Memory.namespace.startswith(namespace),
                Memory.embedding.isnot(None),
            )
        else:
            query_stmt = select(Memory).where(
                Memory.namespace == namespace,
                Memory.embedding.isnot(None),
            )
        
        result = await self.db.execute(query_stmt)
        candidates = list(result.scalars().all())
        
        # Apply metadata filter
        if filter:
            candidates = [
                m for m in candidates
                if m.metadata_ and all(
                    m.metadata_.get(k) == v for k, v in filter.items()
                )
            ]
        
        # Compute similarities and rank
        scored: list[tuple[Memory, float]] = []
        for memory in candidates:
            if memory.embedding:
                similarity = self._cosine_similarity(query_embedding, memory.embedding)
                if similarity >= similarity_threshold:
                    scored.append((memory, similarity))
        
        # Sort by similarity (highest first)
        scored.sort(key=lambda x: x[1], reverse=True)
        
        return scored[:limit]
    
    async def _text_search(
        self,
        namespace: str,
        query: str,
        filter: dict[str, Any] | None,
        limit: int,
        prefix_match: bool,
    ) -> list[tuple[Memory, float]]:
        """Fallback text-based search when embeddings unavailable."""
        if prefix_match:
            query_stmt = select(Memory).where(
                Memory.namespace.startswith(namespace),
                Memory.content_text.isnot(None),
            )
        else:
            query_stmt = select(Memory).where(
                Memory.namespace == namespace,
                Memory.content_text.isnot(None),
            )
        
        result = await self.db.execute(query_stmt)
        candidates = list(result.scalars().all())
        
        # Apply metadata filter
        if filter:
            candidates = [
                m for m in candidates
                if m.metadata_ and all(
                    m.metadata_.get(k) == v for k, v in filter.items()
                )
            ]
        
        # Simple text matching score
        query_terms = query.lower().split()
        scored: list[tuple[Memory, float]] = []
        for memory in candidates:
            if memory.content_text:
                content_lower = memory.content_text.lower()
                matches = sum(1 for term in query_terms if term in content_lower)
                if matches > 0:
                    score = matches / len(query_terms)
                    scored.append((memory, score))
        
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]
    
    async def clear_namespace(
        self,
        namespace: str | tuple,
        prefix_match: bool = False,
    ) -> int:
        """
        Delete all memories in a namespace.
        
        Args:
            namespace: Namespace to clear
            prefix_match: If True, clear all namespaces starting with prefix
            
        Returns:
            Number of deleted memories
        """
        if isinstance(namespace, tuple):
            namespace = self.build_namespace(*namespace)
        
        if prefix_match:
            result = await self.db.execute(
                delete(Memory).where(Memory.namespace.startswith(namespace))
            )
        else:
            result = await self.db.execute(
                delete(Memory).where(Memory.namespace == namespace)
            )
        
        await self.db.flush()
        count = result.rowcount
        logger.info(f"[MemoryStore] Cleared {count} memories from namespace: {namespace}")
        return count


class MemoryTypes:
    """Standard memory type constants for metadata filtering."""
    
    # Semantic memory - facts and knowledge
    SEMANTIC = "semantic"
    USER_PREFERENCE = "user_preference"
    PROJECT_DECISION = "project_decision"
    LEARNED_FACT = "learned_fact"
    
    # Episodic memory - experiences and actions
    EPISODIC = "episodic"
    TASK_COMPLETION = "task_completion"
    DEBUG_SESSION = "debug_session"
    USER_CORRECTION = "user_correction"
    
    # Procedural memory - rules and instructions
    PROCEDURAL = "procedural"
    USER_INSTRUCTION = "user_instruction"
    WORKFLOW_PATTERN = "workflow_pattern"


class MemoryExtractor:
    """
    Extracts memories from conversations and events.
    
    Runs in the background to analyze interactions and store relevant memories.
    """
    
    def __init__(self, store: MemoryStore) -> None:
        self.store = store
        self._client: openai.AsyncOpenAI | None = None
    
    def _get_client(self) -> openai.AsyncOpenAI:
        """Lazy-load OpenAI client."""
        if self._client is None:
            api_key = settings.openai_api_key
            if not api_key:
                raise ValueError("OPENAI_API_KEY is required for memory extraction")
            self._client = openai.AsyncOpenAI(api_key=api_key)
        return self._client
    
    async def extract_from_conversation(
        self,
        namespace: str | tuple,
        messages: list[dict[str, str]],
        context: str = "",
    ) -> list[Memory]:
        """
        Extract memories from a conversation.
        
        Analyzes the conversation to identify:
        - User preferences (semantic)
        - Learned facts (semantic)
        - Successful patterns (episodic)
        - User corrections (episodic)
        
        Args:
            namespace: Base namespace for storing memories
            messages: List of {"role": ..., "content": ...} dicts
            context: Additional context about the conversation
            
        Returns:
            List of created Memory objects
        """
        if len(messages) < 2:
            return []
        
        # Format conversation for analysis
        conversation = "\n".join(
            f"{m.get('role', 'unknown')}: {m.get('content', '')}"
            for m in messages[-20:]  # Last 20 messages
        )
        
        prompt = f"""Analyze this conversation and extract important memories to store for future reference.

Context: {context}

Conversation:
{conversation}

Extract memories in the following categories:
1. USER_PREFERENCES - Things the user prefers or dislikes
2. LEARNED_FACTS - Facts about the user, project, or domain
3. SUCCESSFUL_PATTERNS - Approaches that worked well
4. USER_CORRECTIONS - When the user corrected a mistake

For each memory, provide:
- category: One of the above
- key: A short unique identifier (snake_case)
- content: The actual memory content
- importance: 1-10 how important this is to remember

Return as JSON array. Only include genuinely useful memories. Return empty array if nothing worth remembering.

Example:
[
  {{"category": "USER_PREFERENCES", "key": "react_style", "content": "User prefers functional components with hooks over class components", "importance": 8}},
  {{"category": "USER_CORRECTIONS", "key": "api_error_handling", "content": "User corrected: always use try/catch with async/await, not .catch()", "importance": 7}}
]

JSON:"""
        
        try:
            client = self._get_client()
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1000,
                temperature=0.3,
            )
            
            content = response.choices[0].message.content
            if not content:
                return []
            
            # Parse JSON
            content = content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            
            memories_data = json.loads(content)
            if not isinstance(memories_data, list):
                return []
            
            # Store memories
            created: list[Memory] = []
            if isinstance(namespace, tuple):
                namespace = self.store.build_namespace(*namespace)
            
            for mem in memories_data:
                if mem.get("importance", 0) < 5:
                    continue  # Skip low-importance memories
                
                category = mem.get("category", "LEARNED_FACTS")
                memory_type = {
                    "USER_PREFERENCES": MemoryTypes.USER_PREFERENCE,
                    "LEARNED_FACTS": MemoryTypes.LEARNED_FACT,
                    "SUCCESSFUL_PATTERNS": MemoryTypes.TASK_COMPLETION,
                    "USER_CORRECTIONS": MemoryTypes.USER_CORRECTION,
                }.get(category, MemoryTypes.SEMANTIC)
                
                memory = await self.store.put(
                    namespace=namespace,
                    key=mem.get("key", f"memory_{datetime.now(timezone.utc).timestamp()}"),
                    value={"content": mem.get("content", "")},
                    metadata={"type": memory_type, "importance": mem.get("importance", 5)},
                )
                created.append(memory)
            
            logger.info(f"[MemoryExtractor] Extracted {len(created)} memories from conversation")
            return created
            
        except Exception as e:
            logger.error(f"[MemoryExtractor] Failed to extract memories: {e}")
            return []
    
    async def extract_from_task_completion(
        self,
        namespace: str | tuple,
        task_description: str,
        approach_taken: str,
        outcome: str,
        files_changed: list[str] | None = None,
    ) -> Memory | None:
        """
        Extract an episodic memory from a completed task.
        
        Args:
            namespace: Namespace for the memory
            task_description: What the task was
            approach_taken: How it was solved
            outcome: Success/failure and details
            files_changed: List of files that were modified
            
        Returns:
            Created Memory object or None
        """
        memory = await self.store.put(
            namespace=namespace,
            key=f"task_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
            value={
                "task": task_description,
                "approach": approach_taken,
                "outcome": outcome,
                "files": files_changed or [],
            },
            metadata={
                "type": MemoryTypes.TASK_COMPLETION,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        logger.info(f"[MemoryExtractor] Stored task completion memory: {task_description[:50]}...")
        return memory


# Convenience function for getting relevant memories for a context
async def get_relevant_memories(
    db: AsyncSession,
    user_id: str | None = None,
    project_id: str | None = None,
    query: str = "",
    memory_types: list[str] | None = None,
    limit: int = 10,
) -> str:
    """
    Get relevant memories formatted as context for prompts.
    
    Args:
        db: Database session
        user_id: Optional user ID to scope
        project_id: Optional project ID to scope
        query: Query to match against
        memory_types: Filter by memory types
        limit: Max memories to return
        
    Returns:
        Formatted string of memories for inclusion in prompts
    """
    store = MemoryStore(db)
    
    # Build namespace prefix
    parts = []
    if user_id:
        parts.extend(["user", user_id])
    if project_id:
        parts.extend(["project", project_id])
    
    namespace = store.build_namespace(*parts) if parts else ""
    
    # Search for relevant memories
    if query:
        filter_dict = {"type": memory_types[0]} if memory_types and len(memory_types) == 1 else None
        results = await store.search(
            namespace=namespace or "user",  # Default to user namespace
            query=query,
            filter=filter_dict,
            limit=limit,
            prefix_match=True,
        )
        memories = [m for m, _ in results]
    else:
        memories = await store.list(namespace or "user", prefix_match=True, limit=limit)
    
    if not memories:
        return ""
    
    # Format memories for prompt
    lines = ["## Relevant Memories", ""]
    for mem in memories:
        content = mem.value.get("content", str(mem.value))
        mem_type = mem.metadata_.get("type", "memory") if mem.metadata_ else "memory"
        lines.append(f"- [{mem_type}] {content}")
    
    return "\n".join(lines)
