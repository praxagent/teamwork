# Memory System Documentation

> A lightweight, LangChain-inspired memory store for long-term agent memory in vteam.

## Table of Contents

1. [Overview](#overview)
2. [Memory Philosophy](#memory-philosophy)
3. [Architecture](#architecture)
4. [Memory Types](#memory-types)
5. [Namespace Organization](#namespace-organization)
6. [Core Components](#core-components)
7. [Usage Guide](#usage-guide)
8. [Integration Patterns](#integration-patterns)
9. [Best Practices](#best-practices)
10. [Migration & Scaling](#migration--scaling)

---

## Overview

The memory system provides **persistent, searchable memory** for AI agents across conversations and sessions. It enables agents to:

- **Remember user preferences** ("User prefers functional React components")
- **Learn from corrections** ("User corrected: always use try/catch with async/await")
- **Recall past experiences** ("Last time we debugged auth, the issue was in middleware")
- **Store project decisions** ("We chose PostgreSQL for the database")

### Why Build Our Own?

We evaluated LangChain/LangGraph's memory stores but chose a custom implementation because:

| Factor | LangChain | Our Implementation |
|--------|-----------|-------------------|
| Dependencies | ~50+ transitive deps | Zero new deps |
| Integration | Requires refactoring to their abstractions | Fits existing patterns |
| Flexibility | Constrained to their APIs | Full control |
| Debugging | Multiple abstraction layers | Direct, simple code |
| Concepts | ✅ Excellent | ✅ We borrow them |

**We use LangChain's concepts, not their SDK.**

---

## Memory Philosophy

### Short-Term vs Long-Term Memory

```
┌─────────────────────────────────────────────────────────────────┐
│                        MEMORY ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SHORT-TERM MEMORY              LONG-TERM MEMORY                │
│  (Thread-Scoped)                (Cross-Session)                  │
│                                                                  │
│  ┌──────────────────┐          ┌──────────────────┐             │
│  │ Last 10 messages │          │   MemoryStore    │             │
│  │ from database    │          │   (SQLite/PG)    │             │
│  └──────────────────┘          └──────────────────┘             │
│           │                             │                        │
│           │                             │                        │
│           ▼                             ▼                        │
│  ┌──────────────────┐          ┌──────────────────┐             │
│  │ Current context  │          │ Semantic search  │             │
│  │ for this chat    │          │ across all       │             │
│  │                  │          │ memories         │             │
│  └──────────────────┘          └──────────────────┘             │
│                                                                  │
│  • Immediate conversation       • User preferences               │
│  • Recent messages              • Learned facts                  │
│  • Current task context         • Past experiences               │
│                                 • Project decisions              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Short-term memory** is what the agent sees in the current conversation (last N messages).

**Long-term memory** persists across sessions and is retrieved via semantic search when relevant.

---

## Memory Types

Inspired by cognitive science, we support three memory types:

### 1. Semantic Memory (Facts & Knowledge)

**What it stores:** Facts about users, projects, and domains.

```python
# Examples of semantic memories
{
    "type": "user_preference",
    "content": "User prefers TypeScript over JavaScript"
}

{
    "type": "project_decision",
    "content": "We're using PostgreSQL with Prisma ORM"
}

{
    "type": "learned_fact",
    "content": "The codebase uses a monorepo structure with Turborepo"
}
```

**When to use:** Personalization, maintaining consistency, avoiding repeated questions.

### 2. Episodic Memory (Experiences & Actions)

**What it stores:** Past experiences, successful patterns, debugging sessions.

```python
# Examples of episodic memories
{
    "type": "task_completion",
    "task": "Add user authentication",
    "approach": "Used JWT with httpOnly cookies for security",
    "outcome": "Success - user approved the implementation",
    "files": ["src/auth/jwt.ts", "src/middleware/auth.ts"]
}

{
    "type": "debug_session",
    "issue": "API returning 500 on login",
    "root_cause": "Missing environment variable for JWT secret",
    "resolution": "Added JWT_SECRET to .env.example and docs"
}

{
    "type": "user_correction",
    "original": "Used class components in React",
    "correction": "User prefers functional components with hooks",
    "context": "When creating the UserProfile component"
}
```

**When to use:** Few-shot learning, avoiding repeated mistakes, improving over time.

### 3. Procedural Memory (Rules & Instructions)

**What it stores:** User-defined rules, workflow patterns, standing instructions.

```python
# Examples of procedural memories
{
    "type": "user_instruction",
    "content": "Always run tests before committing"
}

{
    "type": "workflow_pattern",
    "content": "For API endpoints: create route → add validation → implement handler → add tests"
}
```

**When to use:** Consistent behavior, following user preferences for workflows.

---

## Namespace Organization

Memories are organized hierarchically using **namespaces**—like folders for memories.

### Namespace Format

```
scope1:value1/scope2:value2/scope3:value3
```

### Standard Namespace Hierarchy

```
Namespace Structure:
────────────────────────────────────────────────────────────────

user:{user_id}/
├── global/                          # User-wide preferences
│   ├── preferences                  # Coding style, tools, etc.
│   └── instructions                 # Standing instructions
│
└── project:{project_id}/
    ├── semantic/                    # Facts about this project
    │   ├── architecture_decisions
    │   ├── tech_stack
    │   └── learned_facts
    │
    ├── episodic/                    # Experiences in this project
    │   ├── task_completions
    │   ├── debug_sessions
    │   └── user_corrections
    │
    └── procedural/                  # Project-specific rules
        ├── workflow_patterns
        └── custom_instructions

project:{project_id}/
├── semantic/                        # Project-level facts (shared)
├── episodic/                        # Project history
└── agents/
    └── {agent_id}/                  # Agent-specific memories
        ├── learnings
        └── patterns
```

### Namespace Examples

```python
# User's global preferences
namespace = "user:abc123/global"

# User's preferences for a specific project
namespace = "user:abc123/project:xyz789/semantic"

# Project-wide episodic memory (shared across agents)
namespace = "project:xyz789/episodic"

# Agent-specific learnings
namespace = "project:xyz789/agents:agent456/learnings"
```

### Prefix Matching

When searching, you can match **all nested namespaces**:

```python
# Search ALL memories for user abc123
results = await store.search(
    namespace="user:abc123",
    query="React preferences",
    prefix_match=True  # Matches user:abc123/*, user:abc123/project:*/*, etc.
)
```

---

## Core Components

### 1. Memory Model (`app/models/memory.py`)

The SQLAlchemy model for storing memories:

```python
class Memory(Base):
    __tablename__ = "memories"
    
    id: str              # UUID primary key
    namespace: str       # Hierarchical namespace (indexed)
    key: str            # Unique key within namespace
    value: dict         # JSON content (the actual memory)
    content_text: str   # Flattened text for search
    embedding: list     # Vector embedding (JSON array of floats)
    metadata_: dict     # Filtering metadata
    created_at: datetime
    updated_at: datetime
```

**Key features:**
- Composite unique index on `(namespace, key)`
- Auto-generated `content_text` from `value` for embedding
- JSON-stored embeddings for SQLite compatibility

### 2. MemoryStore (`app/services/memory_store.py`)

The primary interface for memory operations:

```python
class MemoryStore:
    async def put(namespace, key, value, metadata=None) -> Memory
    async def get(namespace, key) -> Memory | None
    async def delete(namespace, key) -> bool
    async def list(namespace, prefix_match=False, limit=100) -> list[Memory]
    async def search(namespace, query, filter=None, limit=5) -> list[(Memory, float)]
    async def clear_namespace(namespace, prefix_match=False) -> int
```

### 3. MemoryExtractor (`app/services/memory_store.py`)

Automatically extracts memories from conversations and events:

```python
class MemoryExtractor:
    async def extract_from_conversation(namespace, messages, context="") -> list[Memory]
    async def extract_from_task_completion(namespace, task_description, approach, outcome, files) -> Memory
```

### 4. MemoryTypes (`app/services/memory_store.py`)

Standard type constants for filtering:

```python
class MemoryTypes:
    # Semantic
    SEMANTIC = "semantic"
    USER_PREFERENCE = "user_preference"
    PROJECT_DECISION = "project_decision"
    LEARNED_FACT = "learned_fact"
    
    # Episodic
    EPISODIC = "episodic"
    TASK_COMPLETION = "task_completion"
    DEBUG_SESSION = "debug_session"
    USER_CORRECTION = "user_correction"
    
    # Procedural
    PROCEDURAL = "procedural"
    USER_INSTRUCTION = "user_instruction"
    WORKFLOW_PATTERN = "workflow_pattern"
```

---

## Usage Guide

### Basic CRUD Operations

```python
from app.services import MemoryStore, MemoryTypes
from app.models import get_db

async def example_usage():
    async for db in get_db():
        store = MemoryStore(db)
        
        # CREATE: Store a memory
        memory = await store.put(
            namespace=("user", "user123", "project", "proj456", "semantic"),
            key="react_preference",
            value={
                "content": "User prefers functional components with hooks",
                "source": "conversation",
                "confidence": 0.9
            },
            metadata={"type": MemoryTypes.USER_PREFERENCE, "importance": 8}
        )
        
        # READ: Get by key
        memory = await store.get(
            namespace=("user", "user123", "project", "proj456", "semantic"),
            key="react_preference"
        )
        print(memory.value)  # {"content": "User prefers...", ...}
        
        # UPDATE: Same key = update
        await store.put(
            namespace=("user", "user123", "project", "proj456", "semantic"),
            key="react_preference",
            value={
                "content": "User prefers functional components with hooks and TypeScript",
                "source": "conversation",
                "confidence": 0.95
            }
        )
        
        # DELETE
        deleted = await store.delete(
            namespace=("user", "user123", "project", "proj456", "semantic"),
            key="react_preference"
        )
        
        await db.commit()
```

### Semantic Search

```python
async def search_memories(db, user_id: str, project_id: str, query: str):
    store = MemoryStore(db)
    
    # Search with semantic similarity
    results = await store.search(
        namespace=("user", user_id, "project", project_id),
        query="What does the user prefer for React components?",
        limit=5,
        prefix_match=True,  # Search all nested namespaces
        similarity_threshold=0.3  # Minimum cosine similarity
    )
    
    for memory, similarity_score in results:
        print(f"[{similarity_score:.2f}] {memory.value.get('content')}")
```

### Filtering by Metadata

```python
# Only search user preferences
results = await store.search(
    namespace=("user", user_id),
    query="coding style",
    filter={"type": MemoryTypes.USER_PREFERENCE},
    limit=10
)

# Only search episodic memories
results = await store.search(
    namespace=("project", project_id),
    query="authentication implementation",
    filter={"type": MemoryTypes.TASK_COMPLETION},
    limit=5
)
```

### Auto-Extracting Memories

```python
from app.services import MemoryStore, MemoryExtractor

async def process_conversation(db, messages: list[dict], project_id: str):
    store = MemoryStore(db)
    extractor = MemoryExtractor(store)
    
    # Extract memories from conversation
    # Uses GPT-4o-mini to identify:
    # - User preferences
    # - Learned facts
    # - User corrections
    # - Successful patterns
    memories = await extractor.extract_from_conversation(
        namespace=("project", project_id, "semantic"),
        messages=messages,
        context="Working on the authentication feature"
    )
    
    print(f"Extracted {len(memories)} memories")
    await db.commit()
```

### Recording Task Completions

```python
async def record_task_completion(db, project_id: str, task):
    store = MemoryStore(db)
    extractor = MemoryExtractor(store)
    
    memory = await extractor.extract_from_task_completion(
        namespace=("project", project_id, "episodic"),
        task_description="Implement user registration with email verification",
        approach_taken="Used SendGrid for emails, JWT for verification tokens",
        outcome="Success - all tests passing",
        files_changed=["src/auth/register.ts", "src/services/email.ts"]
    )
    
    await db.commit()
```

### Getting Memories for Prompts

```python
from app.services import get_relevant_memories

async def build_agent_prompt(db, user_id: str, project_id: str, current_task: str):
    # Get relevant memories formatted for prompt injection
    memory_context = await get_relevant_memories(
        db=db,
        user_id=user_id,
        project_id=project_id,
        query=current_task,
        memory_types=[MemoryTypes.USER_PREFERENCE, MemoryTypes.PROJECT_DECISION],
        limit=10
    )
    
    system_prompt = f"""You are a helpful coding assistant.

{memory_context}

## Current Task
{current_task}
"""
    return system_prompt
```

Output example:
```
You are a helpful coding assistant.

## Relevant Memories

- [user_preference] User prefers functional React components with hooks
- [user_preference] Always use TypeScript strict mode
- [project_decision] Database is PostgreSQL with Prisma ORM
- [user_correction] Don't use any - use proper TypeScript types

## Current Task
Create a user profile component
```

---

## Integration Patterns

### Pattern 1: Extract After Agent Responses

```python
# In message handler after agent responds
async def handle_agent_response(db, project_id, messages):
    # ... send response to user ...
    
    # Background: extract memories
    store = MemoryStore(db)
    extractor = MemoryExtractor(store)
    
    # Only extract occasionally (not every message)
    if len(messages) % 5 == 0:  # Every 5 messages
        await extractor.extract_from_conversation(
            namespace=("project", project_id, "semantic"),
            messages=messages[-10:]  # Last 10 messages
        )
```

### Pattern 2: Record Task Completions

```python
# In task completion handler
async def on_task_complete(db, task, agent):
    store = MemoryStore(db)
    extractor = MemoryExtractor(store)
    
    await extractor.extract_from_task_completion(
        namespace=("project", task.project_id, "episodic"),
        task_description=task.title,
        approach_taken=task.implementation_notes or "Standard implementation",
        outcome="Completed successfully",
        files_changed=task.files_changed or []
    )
```

### Pattern 3: Inject Memories into Prompts

```python
# When building agent system prompt
async def build_agent_context(db, agent, task):
    store = MemoryStore(db)
    
    # Get relevant memories
    results = await store.search(
        namespace=("project", agent.project_id),
        query=task.description,
        limit=10,
        prefix_match=True
    )
    
    memory_lines = []
    for memory, score in results:
        if score > 0.4:  # Only high-relevance
            content = memory.value.get("content", "")
            mem_type = memory.metadata_.get("type", "memory")
            memory_lines.append(f"- [{mem_type}] {content}")
    
    if memory_lines:
        return "## Relevant Context from Memory\n" + "\n".join(memory_lines)
    return ""
```

### Pattern 4: Hot Path + Background Extraction

```python
# Hot path: Extract critical corrections immediately
async def handle_user_message(db, message, project_id):
    # Check for explicit corrections
    if any(phrase in message.lower() for phrase in ["don't do that", "instead of", "i prefer", "always use", "never use"]):
        store = MemoryStore(db)
        
        # Immediately extract and store
        await store.put(
            namespace=("project", project_id, "procedural"),
            key=f"correction_{datetime.utcnow().timestamp()}",
            value={"content": message, "source": "user_correction"},
            metadata={"type": MemoryTypes.USER_CORRECTION, "importance": 9}
        )

# Background: Periodic comprehensive extraction
async def background_memory_extraction(project_id):
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        
        async with get_db() as db:
            # Get recent messages
            messages = await get_recent_messages(db, project_id, limit=50)
            
            if messages:
                store = MemoryStore(db)
                extractor = MemoryExtractor(store)
                await extractor.extract_from_conversation(
                    namespace=("project", project_id),
                    messages=messages
                )
```

---

## Best Practices

### 1. Namespace Design

```python
# ✅ Good: Hierarchical, specific
"user:abc/project:xyz/semantic/preferences"

# ❌ Bad: Flat, ambiguous
"memories"
"user_stuff"
```

### 2. Memory Key Naming

```python
# ✅ Good: Descriptive, unique
key = "react_component_style_preference"
key = f"task_completion_{task_id}"
key = f"debug_session_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

# ❌ Bad: Generic, collision-prone
key = "preference"
key = "memory1"
```

### 3. Value Structure

```python
# ✅ Good: Structured, searchable
value = {
    "content": "User prefers functional React components",
    "source": "conversation",
    "confidence": 0.9,
    "context": "Discussed during UserProfile implementation"
}

# ❌ Bad: Unstructured
value = {"data": "some text here"}
```

### 4. Importance Scoring

Use importance scores (1-10) to prioritize memories:

```python
# High importance (8-10): User corrections, explicit preferences
metadata = {"type": MemoryTypes.USER_CORRECTION, "importance": 9}

# Medium importance (5-7): Learned facts, patterns
metadata = {"type": MemoryTypes.LEARNED_FACT, "importance": 6}

# Low importance (1-4): General observations
metadata = {"type": MemoryTypes.SEMANTIC, "importance": 3}
```

### 5. Don't Over-Extract

```python
# ✅ Good: Extract selectively
if len(messages) % 5 == 0:  # Every 5 messages
    await extract_memories(...)

# ✅ Good: Filter by importance
if extracted_memory.get("importance", 0) >= 5:
    await store.put(...)

# ❌ Bad: Extract every message
for message in messages:
    await extract_memories([message])  # Too frequent, noisy
```

### 6. Clean Up Old Memories

```python
# Periodically clean low-value memories
async def cleanup_old_memories(db, project_id):
    store = MemoryStore(db)
    
    memories = await store.list(
        namespace=("project", project_id),
        prefix_match=True,
        limit=1000
    )
    
    for memory in memories:
        age_days = (datetime.utcnow() - memory.updated_at).days
        importance = memory.metadata_.get("importance", 5)
        
        # Delete old, low-importance memories
        if age_days > 30 and importance < 5:
            await store.delete(memory.namespace, memory.key)
```

---

## Migration & Scaling

### Current Implementation: SQLite with JSON Embeddings

**Pros:**
- Zero additional dependencies
- Portable (single file database)
- Works out of the box

**Cons:**
- In-memory cosine similarity (all candidates loaded)
- No native vector indexing
- Slower at scale (>10k memories)

### Production: PostgreSQL with pgvector

For production with many memories, migrate to PostgreSQL with pgvector:

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Modify the embeddings column
ALTER TABLE memories 
ALTER COLUMN embedding TYPE vector(1536) 
USING embedding::vector(1536);

-- Add vector similarity index
CREATE INDEX ON memories 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

Update the search query:

```python
# PostgreSQL with pgvector
async def search(self, namespace, query, limit=5):
    query_embedding = await self._get_embedding(query)
    
    result = await self.db.execute(
        text("""
            SELECT *, 1 - (embedding <=> :query_embedding) as similarity
            FROM memories
            WHERE namespace LIKE :namespace_prefix
            ORDER BY embedding <=> :query_embedding
            LIMIT :limit
        """),
        {
            "query_embedding": str(query_embedding),
            "namespace_prefix": f"{namespace}%",
            "limit": limit
        }
    )
    return result.fetchall()
```

### Alternative: sqlite-vss

For staying with SQLite but adding vector search:

```bash
pip install sqlite-vss
```

```python
# Enable sqlite-vss extension
await db.execute(text("SELECT load_extension('vss0')"))

# Create virtual table for vector search
await db.execute(text("""
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vss0(
        embedding(1536)
    )
"""))
```

---

## Comparison with Coaching Mode

The existing coaching mode uses **file-based memory** in `.coaching/{coach-name}/`:

| Aspect | Coaching Mode (Files) | New MemoryStore (DB) |
|--------|----------------------|---------------------|
| Storage | Markdown files | SQLite/PostgreSQL |
| Search | File reading | Semantic search |
| Organization | Folder structure | Namespaces |
| Scalability | Limited | Good |
| Querying | Manual parsing | SQL + embeddings |

**Recommendation:** Gradually migrate coaching mode to use MemoryStore for consistency, while keeping the file structure for human-readability.

---

## API Reference

### MemoryStore

| Method | Description |
|--------|-------------|
| `put(namespace, key, value, metadata)` | Create or update a memory |
| `get(namespace, key)` | Get a memory by key |
| `delete(namespace, key)` | Delete a memory |
| `list(namespace, prefix_match, limit)` | List memories in namespace |
| `search(namespace, query, filter, limit)` | Semantic search |
| `clear_namespace(namespace, prefix_match)` | Delete all in namespace |
| `build_namespace(*parts)` | Build namespace string from parts |

### MemoryExtractor

| Method | Description |
|--------|-------------|
| `extract_from_conversation(namespace, messages, context)` | Extract memories from chat |
| `extract_from_task_completion(namespace, task, approach, outcome, files)` | Record task completion |

### Convenience Functions

| Function | Description |
|----------|-------------|
| `get_relevant_memories(db, user_id, project_id, query, types, limit)` | Get formatted memories for prompts |

---

## Files

```
backend/app/
├── models/
│   └── memory.py          # Memory SQLAlchemy model
├── services/
│   └── memory_store.py    # MemoryStore, MemoryExtractor, MemoryTypes
└── MEMORY.md              # This documentation
```

---

## Future Enhancements

1. **Memory consolidation** - Merge similar memories to reduce redundancy
2. **Decay/forgetting** - Reduce importance of unused memories over time
3. **Memory graphs** - Link related memories for richer context
4. **User memory dashboard** - UI for viewing/editing stored memories
5. **Memory export/import** - Backup and transfer memories between projects
