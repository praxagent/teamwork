# TeamWork docs

How TeamWork works, and how it's positioned — for anyone running TeamWork, with
**any** agent framework (TeamWork is agent-agnostic; you bring the brains).

- [**Agent identity, capability & audit**](security/agent-identity.md) — how
  TeamWork answers *who is this agent, may they do it, did they really send it,
  and what happened*: per-agent credentials, capabilities, Ed25519 signed
  envelopes, the hash-chained event log, and approval gates.
- [**MCP server**](security/mcp-server.md) — letting Claude Code, Codex and other
  MCP clients file Kanban items and write notes in TeamWork. Off by default,
  keys scoped to a single space, writes git-backed so a bad one can be reverted.
- [**Buzz (block/buzz) — comparison**](comparisons/buzz.md) — the closest head-on
  peer: same "humans + agents in one self-hosted workspace" thesis, opposite
  architecture (Nostr signed-event relay vs. display shell). Where each wins, and
  the one idea worth borrowing (signed per-agent identity).
- [**Microsoft Loop — comparison**](comparisons/microsoft-loop.md) — how TeamWork
  differs from Microsoft Loop (human co-creation vs. human↔agent collaboration),
  and the one idea worth borrowing.
- [**Backlog**](BACKLOG.md) — TeamWork-facing feature ideas.

The agent that supplies the intelligence (e.g. [Prax](https://github.com/praxagent))
documents the *integration* — how it drives TeamWork over the REST/WebSocket API,
the observability stack behind the Observability tab, deployment — on its own
side. TeamWork docs cover TeamWork itself; harness-specific behavior lives with
the harness. (This mirrors how `prax-sandbox` documents the sandbox while the
consuming harness documents how it *uses* the sandbox.)
