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
