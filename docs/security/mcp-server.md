# The MCP server — letting other agents work in TeamWork

Claude Code, Codex and anything else that speaks the Model Context Protocol can
file Kanban items, write notes and notebooks, and leave comments — **without
becoming a chat participant**. They act on the workspace; they do not converse
in it.

It is **off by default**, keys are **scoped to a space**, and it is reached over
your tailnet rather than the public internet.

## Turning it on

Three things must all be true. Any one of them missing and the endpoint does not
exist — a deployment that has not enabled MCP returns 404 for `/mcp`, like any
server that does not speak it.

```bash
# 1. the deployment flag
MCP_ENABLED=true

# 2. a credential registry containing at least one key granted MCP
TEAMWORK_AGENT_CLIENTS_PATH=/home/you/.teamwork/agent-clients.json
```

```json
[
  {
    "name": "codex-on-project-a",
    "token": "generate-a-long-random-string",
    "mcp": true,
    "spaces": ["project-a"],
    "allow": ["task.write", "activity.write"]
  }
]
```

**3.** That key's `mcp: true`. Enabling the flag while granting nothing changes
nothing — there is a test for exactly that, because "enabled" alone should never
open a door.

Restart TeamWork; the log line `MCP endpoint mounted at POST /mcp` confirms it.

## Why MCP needs its own grant

An agent already trusted with the REST API does not automatically get MCP.
Letting a credential file tasks over HTTP is a different decision from letting
an arbitrary MCP client on someone's laptop connect *as* that credential — so
it is a separate field rather than something inferred from the capability set.

## Per-space keys

`"spaces": ["project-a"]` restricts a key to that space. Give a coding agent the
project it is working on, not your whole workspace.

Three properties worth knowing, because they are the parts that are easy to get
wrong:

| Situation | What happens | Why |
|---|---|---|
| Scoped key names another space | refused | the obvious case |
| Scoped key names **no** space | **refused** | an omission must never silently widen a narrow key |
| Scoped key calls `post_comment` | **refused** | channels do not belong to a space, so the key cannot be *shown* to be staying inside its scope |
| Key has no `spaces` at all | unrestricted | scoping is opt-in; a key with no scope is a workspace-wide key |

`list_spaces` shows a scoped key only its own spaces, so an agent does not even
learn the names of spaces it cannot reach.

## The tools

| Tool | Needs |
|---|---|
| `list_spaces`, `list_tasks`, `list_notebooks`, `read_note` | read (no capability) |
| `create_task`, `update_task`, `comment_on_task` | `task.write` |
| `create_notebook`, `create_note`, `update_note` | `activity.write` |
| `post_comment` | `message.post` |

Capabilities are checked exactly as they are over REST, `gated` capabilities
still route through a human approval, and every action still lands in the
hash-chained event log. **MCP adds a protocol, not a bypass.**

`post_comment` is one-way by design: it leaves a comment, it does not join a
conversation or read replies.

## Writes are git-backed

Tasks, notebooks and notes are files in Prax's git-tracked workspace, so a bad
write is recoverable by reverting a commit rather than by hoping someone kept a
copy. That is why these tools target the **Library** rather than TeamWork's own
SQLite tables — rollback was a requirement, and only one of those two can honour
it.

The consequence: MCP needs `PRAX_URL` set and Prax running. If it is not, tools
**fail loudly**. They do not return an empty list, which is the failure mode
hardest to notice — it reads as "there is nothing there", and an agent will act
on that.

## Connecting

Reach it over the tailnet, never the public internet — the token is the entire
boundary.

```bash
tailscale serve --bg 8000     # if it isn't already served
```

Claude Code:

```bash
claude mcp add --transport http teamwork \
  https://teamwork.your-tailnet.ts.net/mcp \
  --header "X-API-Key: the-token-from-the-registry"
```

Then ask it to `list_spaces` — a scoped key answering with exactly one space is
the confirmation that scoping is live.

## What this does not do

- **No channel-level scoping.** Space scoping covers Library objects; channels
  have no space, which is why scoped keys are refused `post_comment` rather than
  given a check that does not exist.
- **No per-tool rate limiting.** A granted key can write as fast as it likes.
- **Token-only auth by default.** Ed25519 request signing is supported (set
  `public_key` on the credential, as for REST) but not required.
