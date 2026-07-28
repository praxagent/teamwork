# Mobile audit — TeamWork

**Written 2026-07-28** after a run of mobile bug reports that were all symptoms
of the same thing: TeamWork was designed at desktop width and made to *fit* a
phone, rather than designed for one.

The bugs are worth fixing and mostly are. This document is about the layer under
them — what a phone is actually good for, and what the app currently offers
instead.

> **Verification status: none of this is tested on a real device.** There is no
> touch hardware on the build machine. Every layout fix shipped so far is
> correct-by-construction and several were wrong in ways only a phone revealed —
> including one where suppressing a scroll gesture to fix chat broke Kanban
> scrolling entirely. Treat the recommendations as reasoned, not validated.

---

## 1. The navigation spends its scarcest resource badly

Five bottom-bar slots is all a phone gets. Today:

| Slot | Surface | Honest assessment on a phone |
|---|---|---|
| 1 | Spaces | Right. The overview you land on. |
| 2 | Chat | Right. The primary thing you do. |
| 3 | **Browser** | **Wrong.** A CDP screencast of a 1920×1080 desktop Chrome, scaled onto 390px. You can see that something is happening; you cannot read it or use it. |
| 4 | **Scheduler** | **Wrong.** Low-frequency admin — you set a schedule once and rarely look again. Also duplicated inside More. |
| 5 | More | Right, as a spillover. |

Meanwhile **Tasks (the Kanban board)** and **Library (notes)** are buried in
More — and those are the two most thumb-native surfaces in the product. Checking
a board and moving a card is exactly what phones are for. Reading a note is
exactly what phones are for.

**Recommendation — reorder to: Chat · Spaces · Tasks · Library · More.**
Browser, Terminal, Desktop, Traces, Observability, Progress, Scheduler and
Settings all live in More, where a surface you visit occasionally belongs.

## 2. Three panels are desktop-only in substance, not just in layout

Terminal, Desktop (noVNC) and Browser are "watch the agent work" surfaces built
around a large viewport. On a phone they are, at best, read-only reassurance.

That is not automatically wrong — glancing at what the agent is doing has real
value, and the terminal is genuinely usable in short bursts. But they should be
**framed** as glance surfaces rather than presented as equals to Chat.

**The browser is fixable, and worth fixing.** The sandbox drives Chrome over
CDP, so `Emulation.setDeviceMetricsOverride` can render the page at phone
dimensions instead of scaling a desktop screencast down. The agent would then
browse *as a phone*, which is both more readable on mobile AND more
representative of what most of the web now serves. That is a prax-sandbox +
BrowserPanel change, not a CSS one.

**The desktop (noVNC) is not fixable** in the same way — a Linux desktop is a
Linux desktop. Keep it in More and expect it to be used rarely from a phone.

## 3. The recurring layout traps (now guarded)

Every mobile bug so far has been one of a small number of patterns. Two are now
enforced by tests that fail the build:

| Pattern | Symptom | Status |
|---|---|---|
| `flex-1 flex-col overflow-hidden` without `min-h-0` | content clipped, unscrollable | **guarded** — 7 panels fixed |
| inline pixel width | column wider than the screen, dead band beside it | **guarded** |
| fixed-width sidebar in a row | content squeezed to a sliver | fixed in 3 panels, ungarded |
| popover with a fixed width | pushes the page wide | fixed in 5, ungarded |
| `vh` where `svh` is meant | pane pushed past the bottom edge on iOS | fixed in 1, **ungarded** |
| `window.resize` for keyboard changes | pane keeps a height that no longer fits | fixed in 2, **ungarded** |

The unguarded rows are the next thing to encode. A guard is worth more than a
fix, because the fix is one panel and the guard is every future panel.

## 4. The keyboard is a first-class layout state, and was treated as an edge case

The mobile tab bar is `fixed bottom-0`, so it anchors to the bottom of the
visible area and sits over the composer while you type. Two attempts:

1. **Viewport arithmetic** — `window.innerHeight - visualViewport.height > 150`.
   Failed on iOS, where the layout viewport can shrink too, leaving the
   difference near zero and the rule silently never applying.
2. **Focus** — a `focusin`/`focusout` listener on text fields. Deterministic,
   no threshold to tune, works everywhere.

The lesson generalises: **ask the question directly rather than inferring it
from a measurement.** The same mistake produced the terminal bug — panels
listened to `window.resize`, which never fires for a keyboard, instead of
`visualViewport`.

## 5. What a phone-first version would look like

Not a proposal to build today, but the shape worth aiming at:

- **Chat is the app.** Everything else is somewhere you go and come back from.
- **The board is one tap away**, because "what is the agent doing / what is
  left" is the most common mobile question.
- **Agent-work surfaces are glances** — a screenshot-and-status view of the
  browser/desktop rather than a live interactive canvas, with the live version
  reserved for desktop.
- **Long text is read, not authored.** Note *reading* is mobile-native; note
  editing mostly is not, and the editor should degrade gracefully rather than
  pretend.
- **Nothing is `fixed` except the tab bar**, and the tab bar knows about the
  keyboard.

## Priorities

1. **Reorder the tab bar** — cheap, high impact, no risk. *(Doing now.)*
2. **Guard the remaining layout patterns** — `svh`, `visualViewport` listeners.
3. **Mobile-emulated browser** via CDP device metrics — turns a dead tab into a
   useful one.
4. **Get a real device into the loop.** Everything above is reasoning. The three
   bugs that reached the user today were all found by looking at a phone, and
   none would have been caught by any test written here.
