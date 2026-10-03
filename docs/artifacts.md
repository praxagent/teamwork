# Artifacts — the viewer

An agent can make pages for you and keep them updated: a plan, a table, a
chart, a small tool. Prax's `artifact_publish` is one example. The agent owns
them (writing, storing, versioning). **TeamWork only shows them.**

- **In chat and notes.** A line that is exactly `[artifact:<id>]` becomes a
  live card. It reloads when the agent publishes a new version (polled every
  5 s), and can be opened full screen.
- **Where the page comes from.** `GET /api/artifacts/<id>` proxies to the
  agent (`{PRAX_URL}/teamwork/artifacts/<id>`) behind TeamWork's login, like
  the other agent panels. Unreachable → 503; unknown → 404.
- **How it is rendered, and why.** An artifact was written by an agent,
  possibly while it was reading untrusted content, and TeamWork's origin holds
  your session. So a page never runs on TeamWork's origin:
  - it is loaded as `srcdoc` in an iframe with `sandbox="allow-scripts"` and
    **no** `allow-same-origin`, so its scripts run in an opaque origin;
  - a Content-Security-Policy injected first in its `<head>` allows **no
    network**, forms or base changes; the page's own tags can't loosen it,
    because every policy applies;
  - the frame sizes itself from a height message, accepted only from that
    frame's own window.

  Verified in headless Chromium (2026-10-03). From inside the frame:
  `parent.document`, `document.cookie` and `localStorage` all throw
  `SecurityError`, `self.origin` is `"null"`, and `fetch` is refused by
  `connect-src 'none'`.
- **Public links are the agent's business**, and need a person's decision.
  Inside TeamWork an artifact is private only as long as TeamWork is: keep its
  login on and reach it privately (see
  [security/exposure.md](security/exposure.md)).

Idea credit: Telepath's Television
([comparison](comparisons/television.md)).
