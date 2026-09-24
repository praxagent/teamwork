"""Who is driving the shared browser right now — the person or the agent.

When the user takes over the sandbox browser from the TeamWork panel, the agent
must not act in it at the same time: a click from each is how a form gets
submitted half-filled, and it means the agent could act on a page the user is
in the middle of (a login, a checkout). TeamWork sees the user's input, so it
keeps the answer; the agent asks before each browser action.

Two signals, either is enough:

* an explicit hold — the panel's "Take control" toggle, until handed back;
* recent input — any mouse, key, scroll, navigation or paste through the panel
  in the last ``ACTIVE_SECONDS``, so taking over needs no extra click.

One process, one sandbox browser: the state is module-level on purpose.
"""
from __future__ import annotations

import threading
import time

ACTIVE_SECONDS = 30.0

_lock = threading.Lock()
_held = False
_held_since: float | None = None
_last_input: float | None = None


def mark_input() -> None:
    global _last_input
    with _lock:
        _last_input = time.monotonic()


def set_held(held: bool) -> None:
    global _held, _held_since, _last_input
    with _lock:
        _held = held
        _held_since = time.monotonic() if held else None
        if not held:
            _last_input = None  # handing back ends the implicit hold too


def status() -> dict:
    with _lock:
        now = time.monotonic()
        age = None if _last_input is None else round(now - _last_input, 1)
        recent = age is not None and age < ACTIVE_SECONDS
        return {
            "user_in_control": _held or recent,
            "held": _held,
            "held_for_seconds": None if _held_since is None else round(now - _held_since, 1),
            "seconds_since_user_input": age,
            "active_window_seconds": ACTIVE_SECONDS,
        }


def reset() -> None:
    """Tests only."""
    global _held, _held_since, _last_input
    with _lock:
        _held, _held_since, _last_input = False, None, None
