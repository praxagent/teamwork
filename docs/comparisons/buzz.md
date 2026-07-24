# TeamWork vs. Buzz (block/buzz)

Comparison of **TeamWork** with **[Buzz](https://github.com/block/buzz)** — Block,
Inc.'s open-source "workspace where humans and agents build together, on a relay
you own" (Apache-2.0, Rust).

**Verdict: the closest thing to a head-on TeamWork analogue that exists — same
thesis, opposite architecture. Not a threat to copy, but one genuinely strong
idea to borrow.** Both are self-hosted workspaces where **AI agents are
first-class members alongside humans** (not background bots), with channels,
threads, DMs, and an agent-agnostic way to plug in a brain. They then split hard
on *how*:

> **Buzz bets on an open, decentralized, cryptographically-signed protocol
> (Nostr). TeamWork bets on a thin display shell you watch the agent work
> inside.** Buzz's differentiator is *verifiable, federated identity and one
> signed event log*; TeamWork's is *seeing the agent act* (terminal, browser,
> desktop, execution graph).

## One-line positioning

- **Buzz** — a **Nostr relay written in Rust** (Axum) that turns a workspace into
  one searchable log of **signed events**: "every message, reaction, workflow
  step, review approval, and git event is a signed event in one log." Humans,
  agents, and CLI tools all connect over the same protocol (NIP-01), authenticate
  with the same kind of **Schnorr keypair** (NIP-42/98), and land in the same
  Postgres-backed search index. Agents plug in via `buzz-acp` (an ACP harness for
  Goose / Codex / Claude Code) and `buzz-cli` (JSON-in/JSON-out). Desktop (Tauri)
  + mobile (Flutter). Needs Postgres + Redis + S3/MinIO.
- **TeamWork** — an open-source, **agent-agnostic collaboration shell**: a
  Slack-like UI (channels, DMs, Kanban, file browser, **embedded PTY terminal**,
  **live browser screencast**, **noVNC desktop**, execution-graph + observability
  views) that is the *body*; an external agent (e.g.
  [Prax](https://github.com/praxagent)) is the *brains*, driving it over a bespoke
  **REST + WebSocket** API. Self-hostable, **single container, SQLite, zero AI
  deps and zero external infra**.

## Concept mapping

| Concern | Buzz | TeamWork (+ its agent) |
|---|---|---|
| Core substrate | **Nostr relay** — one log of signed events | Display shell over a REST/WS API |
| Backend | Rust / Axum | Python / FastAPI |
| Storage | Postgres + Redis + S3/MinIO | **SQLite, single container** |
| Agent identity | **Cryptographic keypair** (Schnorr); scoped by identity, not permission flags | `X-API-Key` shared secret + webhook pushes |
| Auth | NIP-42 / NIP-98 signed requests | API key header |
| Audit trail | **Every event signed by its author's key** — non-repudiable | Server-side app log (trust-by-shared-secret) |
| Agent plug-in | `buzz-acp` (ACP↔MCP for Goose/Codex/Claude Code), `buzz-cli` | `/api/external` REST + WebSocket + webhooks |
| Git | **Native**: NIP-34 signed patches, branch→channel, CI/reviews as events | None (the agent's sandbox does git out-of-band) |
| Watch the agent *act* | Not a focus — you see **events**, not the live process | **Core**: PTY terminal, Chrome screencast + take-over, desktop, exec-graph, live output |
| Federation | **Multi-tenant / "a relay you own"**, protocol interop | Single-tenant, one operator, one agent |
| Clients | Desktop (Tauri) + mobile (Flutter) | Web (React/Vite), mobile-responsive |
| Maturity of the collab bits | Much is **"being wired up"** (workflows, git, approval gates, agent orchestration) | Shipping today |

## Where Buzz is genuinely ahead (don't pretend otherwise)

1. **Cryptographic agent identity + a non-repudiable audit trail.** This is
   Buzz's strongest idea. Every actor — human or agent — holds a Schnorr keypair
   and **signs every event**; the workspace is scoped "by identity, not by
   permission flags — the same way you'd scope a teammate." You get a
   tamper-evident, attributable record of *which specific agent identity* said or
   did what, verifiable after the fact by anyone. TeamWork's `/api/external`
   authenticates with a **shared `X-API-Key`** — any holder can impersonate the
   agent, and the audit trail is only as trustworthy as the server writing it.
2. **Open protocol / interoperability.** Any Nostr client can talk to a Buzz
   relay; identities and events are portable across relays. TeamWork's API is
   bespoke — powerful for one agent, but not an open standard.
3. **Git as first-class signed events (NIP-34).** Feature branches spawn channels
   where "patches land as NIP-34 events, CI posts results, an agent runs a
   first-pass review" — all co-located and signed. TeamWork has no native
   git-collaboration surface; the agent does git inside its sandbox.
4. **Federation / multi-community by construction.** "A relay you own," multiple
   communities over shared infra. TeamWork is deliberately single-tenant.

## Where TeamWork is different / ahead

1. **You watch the agent *act*, not just read what it emitted.** TeamWork's whole
   thesis: embedded PTY terminal into the sandbox, **live Chrome screencast with
   take-over** (mouse/keyboard), noVNC desktop, an **execution-graph** of
   delegation chains, per-agent live output, and (when the agent provides it) a
   full traces/logs/metrics stack. Buzz shows you a stream of *events*; TeamWork
   shows you the *work happening*. This is the single biggest capability Buzz
   lacks and TeamWork leads on.
2. **Radically lighter to run.** One Docker image, SQLite, no external services,
   zero AI dependencies. Buzz needs a Rust relay **plus Postgres, Redis, and
   S3/MinIO** before it does anything. For a solo operator running one agent,
   TeamWork's footprint is a real advantage.
3. **Shipping vs. "being wired up."** TeamWork's collaboration surface works
   today. Several of Buzz's headline pieces — YAML workflows, git integration,
   approval gates, the agent-orchestration framework — are explicitly still
   "being wired up" / "glue still drying" in its own README.
4. **Simpler mental model.** Driving TeamWork is "use it like Slack over REST/WS."
   Buzz asks you to adopt Nostr, keypairs, NIPs, and a relay — more power, more
   ceremony.

## What's worth borrowing — the one real idea (and one small one)

**1. Signed, per-agent identity → a non-repudiable audit trail. (adopt-candidate,
partly agent-side.)** This is the borrow worth taking seriously, and it lands
squarely on the Prax pairing's **safety/governance thesis**. Today an agent
authenticates to TeamWork with a shared `X-API-Key`; a leaked key means silent
impersonation, and the audit trail is server-attested rather than
author-attested. Giving each agent identity its **own signing key** and having
messages/actions carry a signature would make the record **tamper-evident and
attributable** — "agent `prax-research` posted this, provably" — which is exactly
the property a trust-tiered, governed harness wants. You do **not** need Nostr to
get it: a per-identity keypair + signed request envelope (or even just signed
audit entries) is a self-contained feature. Note the split: the **key custody and
signing** belong to the *agent* (Prax's identity/governance layer), while
TeamWork's job is to **verify and display** the signature. Track on both sides so
the envelope shape agrees — mirrors the split already used for the Loop
"component" idea.

**2. Branch → channel, with patches/CI/reviews co-located. (small, mostly
agent-side.)** Buzz auto-creates a channel per feature branch where patches, CI
results, and review sit together. A cheap, nice dev-workflow primitive — but the
git orchestration is the *agent's* concern; TeamWork would only host the channel
and render the artifacts. Worth a backlog line, not a roadmap slot.

## What explicitly NOT to chase

- **Do not rebuild TeamWork on Nostr.** Federation, protocol interop, and
  decentralized identity are a large architectural bet that trades away TeamWork's
  deliberate **single-container / SQLite / zero-infra** simplicity. TeamWork's
  audience is *one operator watching one agent work* — the decentralization thesis
  is orthogonal to that. Borrow the **signed-identity property**, not the
  substrate.
- **Do not add Postgres / Redis / S3.** The lightweight footprint is a feature,
  not a gap to close.
- **Do not reframe TeamWork around "one signed event log."** TeamWork already has
  FTS5/BM25 search over messages; the win it has that Buzz doesn't is *watching
  the agent act* — keep investing there.

## Bottom line

Buzz is the most direct "humans + agents in one self-hosted workspace" peer
TeamWork has, and it's a serious, well-architected project from Block. It wins on
**verifiable identity, open protocol, and native git-as-events**; TeamWork wins on
**watching the agent work, operational simplicity, and being shipped today**. The
two bets barely overlap in practice. Take exactly one idea across the line:
**cryptographically-signed, per-agent identity for a non-repudiable audit trail**
— tracked in [`../BACKLOG.md`](../BACKLOG.md), cross-linked to Prax's governance /
per-caller-identity work. Leave the Nostr substrate where it is.
