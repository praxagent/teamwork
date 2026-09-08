# Agent identity, capability and audit

How TeamWork answers four questions about any action an agent takes:

| Question | Mechanism |
|---|---|
| **Who is this?** | Per-agent credential — identity derived from the token |
| **May they do it?** | Capability set on the credential |
| **Did *they* really send this?** | Ed25519 signed envelope |
| **What happened, in what order?** | Append-only, hash-chained event log |
| **Should they do it *unilaterally*?** | Approval gate |
| **_Where_ may they speak?** | Channel membership |

Each layer is independent and opt-in. A deployment running a single agent can
use only the first and behave exactly as it always has.

**Scope — Known gap (2026-09):** the credential, capability and signing
layers below govern the `/api/external/...` surface. TeamWork's internal API
(`/api/...`, the routes the web UI calls, plus the `/ws`, terminal, browser and
desktop WebSockets) has no per-agent credential or capability check: it can
create and delete messages, tasks, channels and projects in the same tables
(`routers/messages.py`, `routers/tasks.py`, `routers/channels.py`,
`routers/projects.py`). Two layers do reach it: the internal message-post
route applies the same channel-membership rule as the external one (§6), and
internal message, project and agent writes append to the event log (§4 lists
exactly which). Keep the bound port on a trusted network (loopback or
a tailnet); the layers here do not protect it. The `PROXY_AUTH_*` option covers
HTTP requests only — it is a Starlette `BaseHTTPMiddleware`
(`src/teamwork/proxy_auth.py`), which never runs for WebSocket connections.

> **Why this exists.** TeamWork is built for *several* agents governed by an
> orchestrator. With one agent, "which agent did this" is bookkeeping. With
> several, it is the security boundary — and it was previously absent: one shared
> key authenticated every caller, and the `agent_id` was read from the request
> body. Any key holder could act as, and be audit-logged as, **any** agent.

---

## 1. Credentials — identity comes from the token

**The rule: a caller never asserts who they are.** The presented credential
resolves to exactly one identity; a body- or path-supplied `agent_id` is only
ever *checked against* it. It can narrow, never widen.

Configure a registry at `AGENT_CLIENTS_PATH` (default
`~/.teamwork/agent-clients.json`; the variable has no `TEAMWORK_` prefix —
the prefixed spelling that some runtime messages print is not read):

```json
[
  {"name": "prax-research", "token_sha256": "…", "agent_id": "agent-abc",
   "project_id": "proj-1", "allow": ["message.post", "presence"]},
  {"name": "prax-ops", "token_sha256": "…", "agent_id": "agent-def",
   "allow": ["message.*", "task.write"], "gated": ["message.delete"]},
  {"name": "console", "token_sha256": "…", "allow": ["approval.decide"]}
]
```

The `console` entry is not an agent: it has no `agent_id` and its only grant
is the right to rule on approval requests (§5). Keep it a separate token held
by the human — a credential that can both act and approve is not a gate.

- Tokens are **hashed at rest** (`token_sha256`; a plaintext `token` is accepted
  and hashed on load) and compared in **constant time**.
- A credential bound to an `agent_id` acting as a different agent gets **403**.
- **Fails closed**: with no credential configured at all, the external API
  returns **503**. `ALLOW_UNAUTHENTICATED_AGENTS=true` restores the old
  accept-anything behaviour — local development only.

`EXTERNAL_API_KEY` remains supported as a **legacy shared key**. It authenticates
a caller but carries **no agent identity**, so any holder can still speak for
anyone. It exists for single-agent deployments and migration; prefer the registry.

Generate a key with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

The same value goes in TeamWork's `EXTERNAL_API_KEY` and the agent's
`TEAMWORK_API_KEY` (Prax's name for it). Mismatch ⇒ 401; neither set ⇒ 503.

## 2. Capabilities — what the identity may do

Identity answers *who*. Capabilities answer *what they may do*, and the two are
deliberately separate: you would not give a teammate every permission just
because they are on the team.

Grants are `noun.verb`, and `message.*` grants the whole noun:

| Capability | Covers |
|---|---|
| `project.write` | create/update a project, ensure channels |
| `agent.write` | register an agent, set its status |
| `message.post` | send a message |
| `message.delete` | **purge a channel's history** |
| `message.bulk` | **backfill messages with caller-supplied timestamps** |
| `presence` | typing indicators, live output |
| `task.write` | create/update board items |
| `activity.write` | write activity-log entries |
| `approval.decide` | **rule on approval requests** — explicit grant only; neither `*` nor `approval.*` confers it (§5) |

Enforced on every mutating `/api/external` endpoint; the 403 names the missing
capability. `POST /approvals/{id}/decide` is gated by `approval.decide` (§5).
Reads are open — mutation is the boundary worth policing. (The internal API is
outside this — see the scope note above.)

The two destructive ones are separately grantable on purpose: neither should
ride along with "can post a message."

**A credential that declares no `allow` keeps the wildcard**, so adding this
cannot lock out an existing deployment. The wildcard never includes
`approval.decide` — the typical gated entry is `allow: ["*"], gated: [...]`,
and if `*` conferred the right to decide, every gate would be self-approvable.

## 3. Signed envelopes — proof the request came from the key holder

A token proves the caller *held a shared string*. It does not prove **this
request** came from that agent: anyone who has seen the token — a log, a proxy,
a backup, a compromised peer — can forge or replay traffic under it.

Add a `public_key` (Ed25519, base64 or hex) to a registry entry, and that client
must sign every request:

```
X-Agent-Signature: base64(ed25519_sign(canonical))
X-Agent-Timestamp: 1753372800
X-Agent-Nonce:     <unique per request>
```
```
canonical = prax-teamwork-v1\n{METHOD}\n{path}\n{timestamp}\n{nonce}\n{sha256hex(body)}
```

This buys **non-repudiation** (the agent attests, not just the server),
**tamper-evidence** (the body is bound into the signature) and **replay
protection** (300 s skew window + single-use nonce).

Registering a key defaults `require_signature` to true — having published a key,
an unsigned request from that client is more likely a downgrade attempt than
intent. `REQUIRE_SIGNED_REQUESTS=true` enforces it globally.

> **Ed25519, not Schnorr.** Buzz signs with Schnorr/secp256k1 because Nostr
> mandates it (NIP-01 events are BIP-340) — protocol compliance, not a
> cryptographic preference. Ed25519 is the same security level, faster, and
> already available through `cryptography`. secp256k1 would mean a new dependency
> to be compatible with a protocol TeamWork deliberately did not adopt.

> **What signing does NOT buy.** If the orchestrator holds every agent's private
> key in one process, a compromised orchestrator can sign as any of them. Signing
> gives attribution, tamper-evidence and replay protection — resisting a
> *compromised signer* needs key custody in a separate trust domain. That is a
> real next step, not something this layer provides.

## 4. The event log — an ordered record you cannot quietly rewrite

Every other table answers "what is true now" for its own slice. The event log
answers **"what happened, in what order, and who did it"** across all agents.

Each entry stores the hash of the one before it, so its `entry_hash` commits to
the whole prior history. Editing, deleting or reordering any row breaks
verification from that point on. Editing an entry *and* recomputing its own hash
still breaks, because the **next** entry commits to the original.

```http
GET /api/external/projects/{id}/events    # ordered, resumable by seq
GET /api/external/events/verify           # {"ok": true, "checked": 42, ...}
```

`append_event` is the only write — there is no update or delete, because an
audit log you can edit is not an audit log. When the originating request was
signed, the signature is carried onto the entry, so the record shows the agent's
own attestation rather than only the server's word.

**Coverage (2026-09): the log is not yet workspace-complete.** What writes to
it: `message.posted` from both message-post routes (`routers/external.py`,
`routers/messages.py`) and `message.deleted` from the internal delete;
`project.created` (both create routes, plus `channel.created` for the blank
workspace's default channel), `project.deleted` and `agent.deleted` from the
internal routers (`routers/projects.py`, `routers/agents.py`) — internal
entries carry `actor_type: "internal"`, since that API has no per-agent
credential to name; `approval.requested` / `.approved` / `.rejected` /
`.consumed` (`services/approvals.py`); and `channel.member_added` /
`.member_removed` / `.dm_created` (`services/membership.py`). Still not
logged: external channel purges (`message.delete`), bulk backfills, task,
agent and project writes through the external API and activity entries;
internal reactions, cleanup and compactify deletes, and task and channel CRUD.
So `events/verify` can return `ok: true` while unlogged changes happened. The
chain proves that the entries it holds were not rewritten, not that it holds
every change.

> **Limit.** The chain proves **internal consistency, not external
> notarisation**. Someone with database write access could recompute the entire
> chain. Detecting that needs the head hash anchored outside the database.

## 5. Approval gates — may do X, *with permission*

Capabilities answer "may this agent **ever** do X". For irreversible actions
that is the wrong question: you want an agent **able** to purge a channel when a
human says so, and unable to do it on its own initiative.

`gated` is a third state, distinct from allowed and denied:

```json
{"name": "prax-ops", "allow": ["message.*"], "gated": ["message.delete"]}
```

1. Agent attempts the action → **403** with `approval_required` and an
   `approval_id`.
2. A **different** credential, one granted `approval.decide`, decides:
   `POST /api/external/approvals/{id}/decide {"approve": true}`
   (`GET /api/external/approvals` lists what is waiting).
3. Agent retries the **same** action with header `X-Approval-Id`.

**Who may decide is enforced by the server** (`routers/external.py`,
`decide_approval`; `services/approvals.py`, `can_decide` / `decide`):

- The caller's credential must carry `approval.decide` as an **explicit
  grant**. Neither the `*` wildcard nor `approval.*` confers it — a gated
  agent's entry is typically `allow: ["*"], gated: [...]`, and a wildcard that
  included the right to decide would make every gate self-approvable.
- A credential that is itself `gated` for anything cannot decide, even when
  granted. Gating says "this caller needs a second party"; the same caller
  cannot be that party.
- The credential that requested the action cannot decide it, and neither can
  another credential bound to the same `agent_id`.
- The recorded decider is the **credential's name**, taken from the token.
  `decided_by` in the body is optional and survives only as a note
  (`[entered as: …]`) when it differs.

Each refusal is a **403** whose detail names the rule. What this does *not*
establish is that the decider is a person: the server verifies a distinct,
explicitly-trusted credential, and it is the operator's job to hand that
`console` token to a human. There is no approvals UI in the frontend and no
CLI verb for it yet; deciding is an HTTP call with the console credential.

**Approvals are bound to the exact action and are single-use.** An approval is
keyed by `sha256(capability, project_id, canonical_payload)`, so one granted for
"purge #c1" cannot be spent on "purge #c2" or escalated to another capability —
the failure mode a naive "approve this agent" gate has. They expire (1 h,
default), a decision is final, and the full lifecycle (`approval.requested` /
`.approved` / `.rejected` / `.consumed`) lands in the event log.

The server never queues an action for later execution: the decision only
*unlocks* the retry. There is no half-run intention to reconcile.

## 6. Channel membership — where an agent may speak

Capabilities gate *what*; they say nothing about **which channel**. An agent
granted `message.post` can otherwise post into every channel of every project —
invisible with one agent, and the difference between a research agent answering
in `#research` and the same agent injecting itself into `#ops` mid-incident once
there is a team.

Membership is that scope. Agents and humans share one row shape, deliberately:
*"agents have the same surface area as humans."* Modelling membership as
agent-only would make agents second-class occupants and force a parallel
mechanism for agent↔agent DMs.

```http
POST   /api/external/projects/{id}/channels/members
GET    /api/external/projects/{id}/channels/{cid}/members
DELETE /api/external/projects/{id}/channels/{cid}/members/{member_id}
POST   /api/external/projects/{id}/dms          # find-or-create a direct channel
```

Enable enforcement with `ENFORCE_CHANNEL_MEMBERSHIP=true`. **Two rules keep that
safe to switch on:** system/human messages are not scoped, and a channel with
**no** membership list is treated as open — an empty list means *not configured*,
not *nobody*. So enabling the flag cannot silence an existing deployment; you
opt each channel in by giving it members.

`may_post` is consulted by both message-post routes —
`POST /api/external/projects/{id}/messages` and the internal
`POST /api/messages` (what the web UI uses) — so an agent posting through the
internal API into a channel it was never put in gets the same 403. Human
messages (no `agent_id`) are not scoped on either route. Bulk backfills
(`message.bulk`) are not membership-checked.

**Agent↔agent DMs** are the same object as human↔agent ones, and `dm_key` is
order-independent so A→B and B→A resolve to one channel. A team of agents that
can only speak in public channels either floods them with coordination chatter or
coordinates invisibly through the orchestrator — a DM is where two agents settle
something without an audience, still fully in the event log.

## 7. Foreign agents — heterogeneous teams, governed by construction

TeamWork is agent-agnostic in principle, but in practice "agent-agnostic" still
meant *writing an HTTP integration*, which is why a workspace tends to contain
exactly one agent: the one somebody wrote the integration for.

`agent_adapter.py` closes that for the large class of agents that are
**command-line programs** — give it a command that reads a prompt on stdin and
writes a reply on stdout (Goose, Codex and Claude Code all expose such a mode)
and it becomes a channel member.

**This is the governance story, not a convenience.** A foreign agent gets a
TeamWork credential like any other member, so everything above applies to it
unchanged: identity derived from its token, capabilities bounding what it can do,
membership bounding where it can speak, approval gates on destructive actions,
and its actions in the hash-chained log (subject to the §4 coverage list). A heterogeneous team is governed **by
construction** rather than by trusting each vendor's agent to behave — which also
hedges the correlated failure you get when every agent in a workspace is the same
model.

**Scope, stated plainly:** this is a *subprocess bridge*, **not** an
implementation of the Agent Client Protocol. Buzz's `buzz-acp` bridges ACP/MCP
proper. What this provides is the **seam** — intake, addressing, identity and
posting-back are protocol-independent, so an ACP or MCP transport can replace
`ForeignAgent.invoke` without touching anything else.

Two rules keep a shared channel usable: an agent never answers its own messages,
and by default only answers when **named** (`@goose …`) — without that, two
adapters in one channel reply to each other indefinitely. Failures are reported
*into the channel* rather than swallowed, because silence in a shared workspace
reads as "still thinking", and replies are truncated so a runaway agent cannot
fill the channel.

---

## Configuration summary

| Variable | Default | Meaning |
|---|---|---|
| `EXTERNAL_API_KEY` | — | Legacy shared key; authenticates but carries no identity |
| `AGENT_CLIENTS_PATH` | `~/.teamwork/agent-clients.json` | Per-agent credential registry (JSON); created on the first MCP grant |
| `REQUIRE_SIGNED_REQUESTS` | `false` | Require a valid Ed25519 envelope on every request |
| `ENFORCE_CHANNEL_MEMBERSHIP` | `false` | Agents may only post in channels they belong to (external and internal post routes) |
| `ALLOW_UNAUTHENTICATED_AGENTS` | `false` | Dev only — accept anyone when nothing is configured |

## Rollout order

Each layer stands alone; adopt them in the order that matches your risk:

1. **Set a credential** — this is the one that matters, and it is required.
2. **Split per-agent tokens** once a second agent exists.
3. **Narrow capabilities** — start by removing `message.delete` / `message.bulk`
   from agents that never need them.
4. **Gate the destructive ones** behind approval.
5. **Scope channels** — give each channel a membership list, then turn on
   `ENFORCE_CHANNEL_MEMBERSHIP`.
6. **Add signing** when the token alone is no longer a strong enough claim.
