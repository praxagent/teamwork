"""Who is driving the shared browser right now — the person or the agent.

When the user takes over the sandbox browser from the TeamWork panel, the agent
must not act in it at the same time: a click from each is how a form gets
submitted half-filled, and it means the agent could act on a page the user is
in the middle of (a login, a checkout). TeamWork sees the user's input, so it
keeps the answer; the agent asks before each browser action.

Two signals, either is enough:

* an explicit hold — the panel's "Take control" toggle. The open panel renews
  it; a hold nobody renews within ``HOLD_SECONDS`` (the tab was closed, the
  laptop slept) lapses, so the agent is never locked out indefinitely;
* recent input — a click, key, navigation or paste through the panel in the
  last ``ACTIVE_SECONDS`` (not pointer movement or scrolling).

One process, one sandbox browser: the state is module-level on purpose.
"""
from __future__ import annotations

import threading
import time

ACTIVE_SECONDS = 30.0
HOLD_SECONDS = 90.0

_lock = threading.Lock()
_held_until: float | None = None
_held_since: float | None = None
_last_input: float | None = None


def mark_input() -> None:
    global _last_input
    with _lock:
        _last_input = time.monotonic()


def set_held(held: bool) -> None:
    """Take (or renew) the hold, or hand the browser back."""
    global _held_until, _held_since, _last_input
    with _lock:
        now = time.monotonic()
        if held:
            if _held_until is None or now >= _held_until:
                _held_since = now
            _held_until = now + HOLD_SECONDS
        else:
            _held_until, _held_since = None, None
            _last_input = None  # handing back ends the implicit hold too


def status() -> dict:
    with _lock:
        now = time.monotonic()
        age = None if _last_input is None else round(now - _last_input, 1)
        recent = age is not None and age < ACTIVE_SECONDS
        held = _held_until is not None and now < _held_until
        return {
            "user_in_control": held or recent,
            "held": held,
            "held_for_seconds": None if not held or _held_since is None else round(now - _held_since, 1),
            "seconds_since_user_input": age,
            "active_window_seconds": ACTIVE_SECONDS,
        }


def reset() -> None:
    """Tests only."""
    global _held_until, _held_since, _last_input
    with _lock:
        _held_until, _held_since, _last_input = None, None, None
