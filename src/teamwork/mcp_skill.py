"""The instructions a coding agent needs to be a good citizen of a space.

Connecting a harness to the MCP server gives it the *ability* to write to a
space. It does not give it any idea what to write, and an agent left to guess
does one of two unhelpful things: nothing at all, or it dumps its internal
step-by-step scratch list onto the board and buries the human's view of the work
under fifty rows of "run the tests".

So the skill's real job is not "here are the tools" — the tool list is already
in the protocol. It is **what belongs on the board and what does not**, which is
a judgement the harness cannot infer from a schema.

The rule it teaches is the one Prax holds itself to: a Kanban card is a unit of
work a *human* would recognise and care about the state of, days to weeks wide.
An agent's own plan for the next ten minutes is working memory, and working
memory does not go on someone else's wall. Prax keeps these apart deliberately
(`agent_plan` vs. the Library Kanban); a foreign agent that ignores the same
line makes the board useless just as fast.

Generated per space and per key so it can be pasted without editing — a step
someone will skip, and a skill that names the wrong space silently writes into
the wrong one.
"""
from __future__ import annotations

SKILL_NAME = "teamwork-space"


def skill_markdown(*, space: str, space_name: str | None = None,
                   server_url: str = "https://teamwork.example.ts.net/mcp",
                   token_hint: str = "<your-key>") -> str:
    """The skill file, ready to paste.

    ``token_hint`` is a placeholder by default. The real token is shown only
    where the user already has it — the skill text itself gets copied into
    repos and chat windows, and a document that carries a live credential will
    eventually be pasted somewhere it should not be.
    """
    label = space_name or space
    return f"""---
name: {SKILL_NAME}
description: Keep the TeamWork space "{label}" reflecting the real state of this work — board items a human would care about, plus notes for decisions and context.
---

# Working in the TeamWork space `{space}`

You have MCP access to one space: **{label}**. Everything below is about that
space; you cannot reach any other, and you should not try.

Connect with:

```bash
claude mcp add --transport http teamwork {server_url} \\
  --header "X-API-Key: {token_hint}"
```

## Why you are writing to it

A human is using this space to keep the big picture of this work. They are not
reading your transcript. What they see is the board and the notes — so those
have to be true on their own, without your session to explain them.

That makes this a **reporting** job, not a logging one.

## What belongs on the board

A card is a unit of work someone would recognise and care about the state of.
Days to weeks wide, not minutes.

Do this:

- **Add a card when you discover real work** that was not already on the board —
  a bug worth fixing, a piece of the feature nobody had scoped, a follow-up you
  are deliberately not doing now. Discovered work that lives only in your head
  is work the human cannot plan around.
- **Move a card when its state actually changes.** Starting it, finishing it,
  or getting blocked. A board that lags is worse than no board, because it is
  believed.
- **Comment when the *shape* of a card changes** — it turned out bigger, the
  approach changed, you hit something that alters what "done" means. Not to
  narrate progress.

## What does not belong on the board

**Your own plan for the next ten minutes.** "Read the config", "run the tests",
"fix the import" — that is working memory, and working memory does not go on
someone else's wall. Keep using whatever internal todo mechanism your harness
gives you; it is the right tool and it costs the human nothing.

The test: *would this card still make sense to someone who joins in three days
and knows nothing about how you are working?* If not, it is not a card.

Also not on the board: one card per commit, status pings, or a card you create
just to immediately close.

## Notes are for what the board cannot hold

Use `create_note` when there is something worth keeping that is not a work item:

- **A decision and why** — especially the option you rejected. The reasoning is
  the part that gets lost, and it is the part that gets re-litigated.
- **How something actually works** once you have figured it out the hard way.
- **A summary at the end of a substantial piece of work** — what changed, what
  to watch, what is still open.

Write them for someone who was not there. Prose, not a transcript. Say "I don't
know" or "unverified" where that is the truth — a note that overstates its
confidence is worse than a missing one, because it will be trusted.

## Order of operations

1. **`list_tasks` before you add anything.** The item is often already there,
   and a duplicate board is a board people stop reading.
2. Move the card you are working on into progress **when you start**, not when
   you finish and remember.
3. When you finish: move it, and add a note if the work produced anything worth
   knowing later.

## Honesty

Report what happened, not what you hoped. If tests fail, the card is not done.
If you skipped something, say so on the card. If you are unsure whether it
works, the card says that too.

The whole point of this space is that the human can trust it without checking.
One optimistic card destroys that for every other card.
"""


def connection_snippet(*, server_url: str, token_hint: str = "<your-key>") -> str:
    """The one-liner for wiring Claude Code up, without the surrounding skill."""
    return (f'claude mcp add --transport http teamwork {server_url} '
            f'--header "X-API-Key: {token_hint}"')


def codex_snippet(*, server_url: str, token_hint: str = "<your-key>") -> str:
    """The equivalent for Codex, which is configured by file rather than CLI.

    We were naming Codex in the UI and then handing over a `claude mcp add`
    command, which is only useful to one of the two harnesses we claimed to
    support. Telling someone their tool works and then not saying how is worse
    than not mentioning it.

    Codex reads ``~/.codex/config.toml``. It speaks MCP over stdio, so an HTTP
    server is reached through the `mcp-remote` bridge rather than directly.
    """
    return (
        "# ~/.codex/config.toml\n"
        "[mcp_servers.teamwork]\n"
        'command = "npx"\n'
        f'args = ["-y", "mcp-remote", "{server_url}", '
        f'"--header", "X-API-Key:{token_hint}"]'
    )
