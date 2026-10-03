# TeamWork vs. Television (telepath-computer/television)

Comparison of **TeamWork** with **[Television](https://television.run)**
([repo](https://github.com/telepath-computer/television)), from Telepath
(Unternet PBC): "the missing GUI for personal agents" (MIT, TypeScript; public
2026-10-01, about 70 stars when read, commit `e81bfc7`).

**Verdict: a new peer from the other direction. Document it, and borrow two things.**
Both TeamWork and Television are an agent-agnostic, self-hosted visual surface
that sits next to an agent harness. They split on what the surface is *for*:

> **Television is an artifact canvas: the agent makes things and pins them
> there. TeamWork is a workspace: you watch the agent work, and you and it share
> the same tools.** Television has no chat, terminal, browser, desktop, task
> board or approvals. TeamWork has no agent-authored interactive artifacts.

Borrow:
1. **Agent-authored interactive artifacts, sandboxed the way Television does
   it.** This sharpens backlog #1 (portable live components): it is the second
   independent sighting, and it adds the *interactive* half.
2. **An install guide written for agents.** "Paste this prompt into your agent
   and it sets everything up" is how Television installs. Prax and TeamWork have
   a README and a Makefile.

## One-line positioning

- **Television.** Three parts:
  - a small **server** on the agent's machine, on loopback by default;
  - a **skills bundle** that teaches the agent to write artifacts: Television's
    house-style HTML, a component kit, and templates for tasks, tables,
    calendars and sidebars;
  - a **client**: an Electron app for macOS, or any browser.

  The agent writes self-contained HTML files and registers them with the `tv`
  CLI. People view them in persistent **channels**. It works with "any harness
  that supports skills and file access" (Hermes, OpenClaw, Pi, Claude Code,
  Codex). You keep chatting in your usual interface; Television is a sidecar.
- **TeamWork.** A collaboration shell: chat and DMs, Kanban, file browser,
  shared PTY terminal, browser screencast, noVNC desktop, observability, and
  out-of-band approvals. It is the agent's *body*, which an external agent
  (e.g. Prax) drives over REST, WebSocket and webhooks. Other harnesses (Claude
  Code, Codex) can file Kanban items and notes through its MCP server
  ([security/mcp-server.md](../security/mcp-server.md)).

## Concept mapping

| Concern | Television | TeamWork (+ its agent) |
|---|---|---|
| Where the human talks to the agent | Elsewhere (the harness's own chat) | In TeamWork (channels, DMs, threads) |
| What the agent produces for people | **Interactive HTML artifacts** pinned to channels, updated over time | Messages, files, Library notes, Kanban tasks, the agent's live terminal/browser/desktop |
| Live, re-rendering outputs | Native: an artifact is a file the agent rewrites | Not yet: backlog #1 (portable live components) |
| Structured views | Tasks, table and calendar *skills*: templates the agent fills in | Built-in Kanban and Library, backed by Prax's store |
| Running agent-written code in the viewer | `srcdoc` iframes with `sandbox="allow-scripts"` and **no** `allow-same-origin`: an opaque origin, so an artifact cannot read the client's DOM, storage or token. External pages load only in the Electron app | **Deliberately never.** Workspace HTML, XHTML, SVG and XML are served as downloads (`routers/uploads.py` `ATTACHMENT_MEDIA_TYPES`); every response carries `nosniff`; only PDFs are framed; Mermaid runs at its default `strict` level. Checked 2026-10-03. An artifact canvas would have to cross this line on purpose, so it needs Television's sandbox, not a relaxed download rule |
| Watching the agent work | No | Yes: terminal, browser, desktop, execution graph |
| Approvals, governance | No | Out-of-band approvals, egress-gate relay, human-only decisions |
| Auth | One access token on every request, localhost included, carried in a **connect link** (`http://host:32848/?token=…`) | Login session plus `INTERNAL_API_KEY` for the agent API |
| Exposure | Plain HTTP; "designed for local or private networks"; prefer **Tailscale** over a LAN listener; never public | The same stance ([security/exposure.md](../security/exposure.md)) |
| Telemetry | **On by default**, anonymous and content-free, opt-out (`tv telemetry disable`, `DO_NOT_TRACK`) | None |
| Install | An **agent-run admin guide** (`television.run/install.md`), plus a macOS app | README and Makefile |
| Development process | Human-owned **specs**; agent-written and agent-reviewed **proofs** (each spec's test design, with what every mock gives up); a skill-eval tool (`skillbench`) | CI, plus agentic review |

## What is genuinely better there

1. **Agent output that stays useful.**
   - A plan, a table or a dashboard lives as a pinned artifact the agent keeps
     updating, rather than scrolling away in chat.
   - TeamWork's Library is the structured version of this; Television's is the
     free-form, visual version.
   - This is the gap backlog #1 already names, from the Microsoft Loop
     comparison. Television is a second, independent sighting, and it shows the
     interactive form: checkboxes, tables and calendars as small apps, not
     static text.
2. **A safe way to render agent-written code.** Their isolation is the right
   default and cheap to copy:
   - `srcdoc` with `sandbox="allow-scripts"` and no `allow-same-origin`;
   - no network unless the artifact's own CSP allows it;
   - external sites only in the desktop shell.

   TeamWork must not render agent HTML on its own origin, and today it doesn't
   (see the table). The origin holds the session and can call `/api/*`, so an
   artifact written while the agent was reading untrusted content would run
   with the user's session.
3. **Install by agent.** The admin guide is written to be *executed* by an agent:
   - it tells the agent never to work from a summary;
   - it makes the agent verify the connect link character by character, and
     with a real authenticated request, before handing it over;
   - it covers sandboxed harnesses and Docker/Tailscale/SSH-tunnel layouts.

   For a suite whose setup is "run several services and wire them together",
   that beats a README.

## What not to copy

- **A token in the URL.** Connect links carry the bearer token in the query
  string, where it lands in browser history, server and proxy logs, and
  `Referer` headers. They warn agents not to paste it elsewhere, but the URL is
  the leak. TeamWork's login session is better. If TeamWork adds share links, use
  short-lived, single-use exchange codes instead.
- **Telemetry on by default.** Prax and TeamWork send nothing home. Keep it that
  way.
- **"Fetch these instructions and follow them" as the only install path.** An
  agent-run guide should be **pinned** (a versioned file in the repo, or a hash),
  not whatever a URL serves today. A guide that agents execute is a
  supply-chain surface.

## Adopt (tracked)

- **Backlog #1, extended**: portable live components *and* agent-authored
  interactive artifacts. Render them in `srcdoc` / `sandbox="allow-scripts"`
  iframes with no `allow-same-origin` and a restrictive CSP, never on TeamWork's
  origin. The artifact model (files in the workspace, versioned by its git)
  stays agent-side.
- **Backlog #4 (new)**: an agent-executable install guide for the Prax suite,
  versioned in the repo, with verification steps the agent must run before
  reporting success.

## Bank

- **Specs and proofs.** People own the specs. Agents write and review
  "proofs": for each spec, which tests exist, what each mock forfeits, and a
  plain-English coverage model. One rule worth keeping: *"a proof never decides
  what an ambiguous spec means"*. It records the ambiguity against the spec
  instead. This is the same lesson as Prax's "the spec is the un-verified
  surface" (its ProofAtlas and AxiomProver assessments).
- **Skill evals.** `skillbench` runs eval configs against the skills and serves
  a read-only page for reviewing what agents produced. That is the honest way to
  know whether a skills bundle teaches what it claims to.

Read 2026-10-03 from the repository (README, admin guide, `specs/`, the skills
bundle, artifact-frame tests). Not run.
