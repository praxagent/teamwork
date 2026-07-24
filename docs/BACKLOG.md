# TeamWork — ideas backlog

TeamWork-facing feature ideas. Harness-specific behavior (agent logic, model
control, memory, scheduling) is the consuming agent's concern, not TeamWork's —
those ideas live with the agent (e.g. Prax's own backlog).

---

### 1. Portable, live-syncing "components" — embeddable notes/outputs

- **Source**: [`comparisons/microsoft-loop.md`](comparisons/microsoft-loop.md).
  Loop's one genuinely transferable primitive is the **portable component**: a
  piece of content (list/table/note) that can be embedded in many places and
  **stays in sync** as the source changes.
- **Why it matters**: today a note or an agent **output** (a generated table,
  chart, task list) is **pinned in one place**. There's no way to drop a *live
  reference* to it into a chat message or another note that re-renders when the
  source updates — so agent results aren't portable the way Loop components are.
  This is a real gap for a workspace whose whole point is *producing* artifacts,
  and it needs **none** of Loop's M365/cloud machinery.
- **Mapping**: a **transclusion-by-reference** primitive — embed an artifact by
  id into a message or note; TeamWork renders it live and re-renders on change
  (the WebSocket stream already pushes updates). A reference + a renderer, **not**
  a new content type.
- **Cross-cutting note**: the *embed rendering* is TeamWork-side; the *artifact /
  reference model* (e.g. Prax's Library notes + outputs store) is **agent-side**.
  For the Prax pairing this is tracked from the Prax backlog too (Prax
  `docs/IDEAS_BACKLOG.md` #21) — the two halves need to agree on the reference
  shape.
- **Guardrail / explicitly NOT in scope**: do **not** chase Loop's M365
  integration, sensitivity/retention labels, or **multi-human CRDT co-editing** —
  wrong audience for an agent-teammate harness. The value is *portability of
  agent output*, not real-time human co-authoring.
- **Status**: not started — documented in the Loop comparison as the single
  adopt-candidate; tracked here so it isn't lost.

---

### 2. Signed, per-agent identity → a non-repudiable audit trail

- **Source**: [`comparisons/buzz.md`](comparisons/buzz.md). Buzz's strongest idea:
  every actor (human or agent) holds a cryptographic keypair and **signs every
  event**, so the workspace is scoped "by identity, not by permission flags" and
  the audit trail is **author-attested**, not server-attested.
- **Why it matters**: today an agent authenticates to TeamWork with a shared
  `X-API-Key`. A leaked key means silent impersonation, and the audit record is
  only as trustworthy as the server writing it. A **per-identity signing key** +
  a signed request/message envelope would make the record **tamper-evident and
  attributable** — "agent `prax-research` posted this, provably" — which is
  exactly the property a trust-tiered, governed harness wants.
- **Mapping**: **no Nostr required.** A per-identity keypair + a signed envelope
  (or, minimally, signed audit entries) is a self-contained feature. The split:
  **key custody + signing** belong to the *agent* (Prax's identity/governance
  layer); TeamWork's job is to **verify and display** the signature. Cross-linked
  to Prax's governance / MCP per-caller-identity work so the envelope shape agrees
  (same agent-side/UI-side split as #1's component idea).
- **Guardrail / explicitly NOT in scope**: do **not** rebuild TeamWork on Nostr,
  and do **not** add Postgres/Redis/S3. Borrow the *signed-identity property*, not
  the substrate — the single-container / SQLite / zero-infra footprint is a
  feature, not a gap.
- **Status**: not started — adopt-candidate from the Buzz comparison; a larger,
  partly agent-side lift, tracked here so it isn't lost.

---

### 3. Branch → channel, with patches / CI / reviews co-located

- **Source**: [`comparisons/buzz.md`](comparisons/buzz.md). Buzz auto-creates a
  channel per feature branch where "patches land as NIP-34 events, CI posts
  results, an agent runs a first-pass review" — all in one place.
- **Why it matters**: a cheap, nice dev-workflow primitive for teams whose agent
  writes code — the branch's conversation, patches, and CI live together.
- **Mapping**: the git orchestration is the **agent's** concern (it already does
  git in its sandbox); TeamWork only **hosts the channel and renders the
  artifacts**. A channel-auto-provision hook + artifact rendering, not a git
  engine.
- **Status**: not started — small adopt-candidate from the Buzz comparison,
  mostly agent-side.
