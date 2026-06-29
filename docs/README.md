# TeamWork docs

How TeamWork works, and how it's positioned — for anyone running TeamWork, with
**any** agent framework (TeamWork is agent-agnostic; you bring the brains).

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
