# TeamWork vs. Microsoft Loop

Comparison of **TeamWork** with **[Microsoft Loop](https://support.microsoft.com/en-us/loop/get-started-with-microsoft-loop)**.

**Verdict: adjacent-looking, fundamentally different — not a competitor, one
idea worth borrowing.** Both present as "a workspace where a team gets things
done," but they sit on opposite sides of a single axis:

> **Loop is a surface for *humans to co-create content*. TeamWork is a surface
> for *humans to collaborate with AI agents that do work*.**

Loop's actors are people; its AI (Copilot) *assists* them. TeamWork's actors are
**AI agents as first-class teammates** (plus you); the human often *supervises*
them. That difference cascades through every feature below.

## One-line positioning

- **Microsoft Loop** — a real-time co-creation app: flexible **pages** (canvases)
  built from portable **components** (lists/tables/notes) that stay in sync
  wherever they're pasted (Teams, Outlook, OneNote, Whiteboard), grouped into
  **workspaces**. Copilot drafts/summarizes alongside the humans. Closed,
  cloud-only, M365-bound.
- **TeamWork** — an open-source, **agent-agnostic collaboration shell**: a
  Slack-like UI (channels, DMs, Kanban, file browser, **embedded terminal**,
  **live browser screencast**, **desktop**, execution-graph + observability
  views) that is the *body*; an external agent (e.g.
  [Prax](https://github.com/praxagent)) is the *brains*, driving it over
  REST/WebSocket. Self-hostable, single container, zero AI deps of its own.

## Concept mapping

| Concern | Microsoft Loop | TeamWork (+ its agent) |
|---|---|---|
| Top container | Workspace | Project |
| Sub-grouping | Page (canvas) | Channels + the agent's Library (Space → Notebook → Note) |
| Atomic content | **Component** (portable, syncs across host apps) | Note / Kanban card / file / message (not portable across foreign apps) |
| The "team" | People | **AI agents** + people |
| AI's role | Copilot **assists** the authors | The agent **is** a teammate that acts (browses, codes, schedules) |
| Real-time sync | Co-editing (CRDT-style), component sync everywhere | WebSocket message/board/output streaming; **no multi-user co-editing of a doc** |
| Transparency | n/a (it's a doc) | **Execution graph + live agent output + traces/logs/metrics** — watch the agent think/act |
| Hosting | Microsoft cloud only | Self-host (Docker/native), or anywhere |
| Openness | Closed; needs Exchange + SharePoint | Open-source; agent-agnostic API |

## Where Loop is genuinely ahead (don't pretend otherwise)

1. **Real-time collaborative co-editing** — multiple humans editing the same
   canvas live. TeamWork streams messages/board/agent-output over WebSocket but
   has **no operational-transform/CRDT co-authoring** of a shared document.
2. **Portable components** — a Loop list pasted into a Teams chat *and* an
   Outlook email stays one synced object. TeamWork content lives inside TeamWork.
3. **M365 integration + enterprise governance** — sensitivity/retention labels,
   compliance, SSO, the whole Office ecosystem. TeamWork has none of that surface.
4. **Polish & scale of a shipped Microsoft product** across devices.

## Where TeamWork is different / ahead

1. **Agents as teammates, not an assistant.** The unit of work isn't a human
   editing a doc with AI help — it's an agent *doing the task* while you watch
   and can take over. Loop has no equivalent.
2. **You watch the work happen.** Embedded PTY terminal into the agent's
   sandbox, live Chrome screencast (take-over with mouse/keyboard), noVNC
   desktop. Loop shows content; TeamWork shows *action*.
3. **Radical transparency into the agent.** Execution-graph tree of delegation
   chains, per-agent live output, and (when the agent provides it) a full
   traces/logs/metrics observability stack — see *why* it did what it did.
4. **Open, self-hostable, agent-agnostic.** Runs on your own box against your own
   agent and model; no vendor lock-in. Loop is the opposite by design.

## What's worth borrowing — the one real idea

**Loop's "portable, live-syncing component" is a genuinely good primitive
TeamWork lacks.** Today a note or an agent **output** (a generated table, a
chart, a task list) is pinned inside one place. A "TeamWork component" — an
artifact that can be **embedded into a chat message (or another note) and stays
live** as the underlying source changes — would make agent results *portable* the
way Loop components are, without needing M365.

- **Verdict: adopt-candidate (small), not a roadmap commitment.** Tracked in
  [`../BACKLOG.md`](../BACKLOG.md). It's a transclusion-by-reference primitive +
  a live renderer (the WebSocket stream already pushes updates) — **not** a new
  content type, and **not** real-time multi-human co-editing.
- **Explicitly do NOT chase:** Loop's M365/Office integration, sensitivity
  labels, or multi-human CRDT co-editing — wrong audience for an agent-teammate
  harness, and a large surface for little gain here.

## Bottom line

Loop and TeamWork rhyme on the noun ("a workspace for a team") and diverge on
the verb. Loop optimizes **humans co-authoring content**; TeamWork optimizes
**humans directing and watching AI agents do work**, transparently and on your
own infrastructure. They're not substitutes. The single transferable idea is
Loop's **portable live component** — a candidate enhancement, not a pivot.
