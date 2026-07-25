# The MCP server — letting other agents work in TeamWork

Claude Code, Codex and anything else that speaks the Model Context Protocol can
file Kanban items, write notes and notebooks, and leave comments — **without
becoming a chat participant**. They act on the workspace; they do not converse
in it.

It is **off by default**, keys are **scoped to a space**, and it is reached over
your tailnet rather than the public internet.

## Turning it on

One line in TeamWork's `.env`, then restart:

```bash
MCP_ENABLED=true
```

That is the whole deployment step. It mounts the endpoint and grants **nothing** —
an enabled deployment with no grants answers `/mcp` and refuses every call.

Everything else happens in the UI. Open a space → **Settings** → *Coding agents
(MCP)* → **Enable for this space**. That mints a key scoped to that space, writes
the credential registry for you, and shows the connect command with the token in
it, once.

**Grants take effect immediately** — no restart. The flag decides whether the
route exists; the registry decides who may use it, and that is read per request.

### The credential registry

Lives at `~/.teamwork/agent-clients.json` by default
(`TEAMWORK_AGENT_CLIENTS_PATH` to move it). You should never need to open it, but
if you do:

- It stores **only a SHA-256 of each token**. A backup of this file grants
  nothing, and "show me my token again" cannot be honoured — which is why
  re-enabling **rotates** rather than reveals.
- It is written atomically at mode `0600`. Hand-authored entries are preserved;
  enabling a space adds one client and touches nothing else.
- An unparseable file is **refused, not overwritten** — it may hold working
  grants, and clobbering them silently would be worse than failing.

You can still hand-author entries for anything the UI does not cover (a
workspace-wide key, custom capabilities, Ed25519 signing).

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

**Enable for this space** hands you the exact command, with your token already
in it — copy, paste, done:

```bash
claude mcp add --transport http teamwork \
  https://teamwork.your-tailnet.ts.net/mcp \
  --header "X-API-Key: <issued for you>"
```

Then ask it to `list_spaces` — a scoped key answering with exactly one space is
the confirmation that scoping is live.

## Give the agent the skill too

Connecting a harness gives it the *ability* to write to a space. It gives it no
idea what to write — and an agent left to guess does one of two unhelpful
things: nothing at all, or it dumps its own step-by-step scratch list onto the
board and buries your view of the work under fifty rows of "run the tests".

So each space's settings has a **Get agent skill** button. It generates a
ready-to-paste skill file, already naming that space, and the button next to it
copies the connect command.

What the skill actually teaches is the judgement a harness cannot infer from a
tool schema — **what belongs on your board and what does not**:

- A card is work *you* would recognise and care about the state of, days to
  weeks wide. Add one when the agent discovers real work; move it when the state
  genuinely changes; comment when the shape of the work changes.
- The agent's plan for the next ten minutes is **working memory**, and working
  memory does not go on someone else's wall. It keeps using its own todo
  mechanism for that.
- Notes are for what a card cannot hold: a decision *and the option rejected*,
  how something actually works, a summary written for someone who was not there.
- Honesty: if tests fail the card is not done. One optimistic card costs you
  trust in every other card.

**The skill never contains your token.** It gets pasted into repos and chat
threads, so it carries `<your-key>` and says so — you substitute the real one
where it stays private.

## What this does not do

- **No channel-level scoping.** Space scoping covers Library objects; channels
  have no space, which is why scoped keys are refused `post_comment` rather than
  given a check that does not exist.
- **No per-tool rate limiting.** A granted key can write as fast as it likes.
- **Token-only auth by default.** Ed25519 request signing is supported (set
  `public_key` on the credential, as for REST) but not required.
