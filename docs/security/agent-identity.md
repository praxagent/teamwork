# Agent identity, capability and audit

How TeamWork answers four questions about any action an agent takes:

| Question | Mechanism |
|---|---|
| **Who is this?** | Per-agent credential — identity derived from the token |
| **May they do it?** | Capability set on the credential |
| **Did *they* really send this?** | Ed25519 signed envelope |
| **What happened, in what order?** | Append-only, hash-chained event log |
| **Should they do it *unilaterally*?** | Approval gate |

Each layer is independent and opt-in. A deployment running a single agent can
use only the first and behave exactly as it always has.

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

Configure a registry at `AGENT_CLIENTS_PATH`:

```json
[
  {"name": "prax-research", "token_sha256": "…", "agent_id": "agent-abc",
   "project_id": "proj-1", "allow": ["message.post", "presence"]},
  {"name": "prax-ops", "token_sha256": "…", "agent_id": "agent-def",
   "allow": ["message.*", "task.write"], "gated": ["message.delete"]}
]
```

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

Enforced on every mutating endpoint; the 403 names the missing capability. Reads
are open — mutation is the boundary worth policing.

The two destructive ones are separately grantable on purpose: neither should
ride along with "can post a message."

**A credential that declares no `allow` keeps the wildcard**, so adding this
cannot lock out an existing deployment.

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
2. A human decides:
   `POST /api/external/approvals/{id}/decide {"approve": true, "decided_by": "tj"}`
   (`GET /api/external/approvals` lists what is waiting).
3. Agent retries the **same** action with header `X-Approval-Id`.

**Approvals are bound to the exact action and are single-use.** An approval is
keyed by `sha256(capability, project_id, canonical_payload)`, so one granted for
"purge #c1" cannot be spent on "purge #c2" or escalated to another capability —
the failure mode a naive "approve this agent" gate has. They expire (1 h,
default), a decision is final, and the full lifecycle (`approval.requested` /
`.approved` / `.rejected` / `.consumed`) lands in the event log.

The server never queues an action for later execution: the decision only
*unlocks* the retry. There is no half-run intention to reconcile.

---

## Configuration summary

| Variable | Default | Meaning |
|---|---|---|
| `EXTERNAL_API_KEY` | — | Legacy shared key; authenticates but carries no identity |
| `AGENT_CLIENTS_PATH` | — | Per-agent credential registry (JSON) |
| `REQUIRE_SIGNED_REQUESTS` | `false` | Require a valid Ed25519 envelope on every request |
| `ALLOW_UNAUTHENTICATED_AGENTS` | `false` | Dev only — accept anyone when nothing is configured |

## Rollout order

Each layer stands alone; adopt them in the order that matches your risk:

1. **Set a credential** — this is the one that matters, and it is required.
2. **Split per-agent tokens** once a second agent exists.
3. **Narrow capabilities** — start by removing `message.delete` / `message.bulk`
   from agents that never need them.
4. **Gate the destructive ones** behind approval.
5. **Add signing** when the token alone is no longer a strong enough claim.
