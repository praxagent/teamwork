"""The Prax-proxy failure contract.

Why this file exists: the proxy used to answer an unreachable backend with
**HTTP 200** and a body of `{"error": "Prax backend unavailable"}`. The frontend's
`fetchJson` only throws on `!response.ok`, so React Query landed in *success*
state holding a body with none of its declared fields — every "is the object
there?" guard passed, and the next property access threw. With no error boundary
that unmounted the whole app: a blank page caused by a backend being down.

So: an unreachable backend must be an HTTP *failure*, not a 200 with an apology.
The exception is endpoints that degrade to a usable empty shape — a list view
rendering "nothing here" is better than an error card.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROUTERS = Path(__file__).parent.parent / "src" / "teamwork" / "routers"
UNAVAILABLE = "Prax backend unavailable"

# A body is "usable" if the component can render something from it without
# reaching for a field that isn't there.
_USABLE_DEFAULT = re.compile(
    r'return \{"(?:tasks|spaces|schedules|reminders|raw|outputs|notes|columns|'
    r'backlinks|archive|count|children|content|available)"'
)


def _proxy_router_sources():
    for path in sorted(ROUTERS.glob("*.py")):
        text = path.read_text()
        if UNAVAILABLE in text:
            yield path, text


def test_there_are_proxy_routers_to_check():
    # Guard against this whole file silently passing if the files move.
    assert list(_proxy_router_sources()), "no proxy routers found — did they move?"


@pytest.mark.parametrize("path,text", list(_proxy_router_sources()),
                         ids=lambda v: v.name if isinstance(v, Path) else "")
def test_unavailable_backend_never_returns_a_bare_error_body_with_200(path: Path, text: str):
    """A body carrying ONLY {"error": ...} must never ride on a 200.

    That is the exact shape that made React Query report success and the UI
    crash on the first field access.
    """
    offenders = [
        line.strip()
        for line in text.splitlines()
        if UNAVAILABLE in line
        and line.strip().startswith("return")
        and "status_code" not in line
        and not _USABLE_DEFAULT.search(line.strip())
    ]
    assert not offenders, (
        f"{path.name} returns a bare error body with an implicit 200:\n  "
        + "\n  ".join(offenders)
        + "\nRaise HTTPException(502) instead, or return a usable default shape."
    )


@pytest.mark.parametrize("path,text", list(_proxy_router_sources()),
                         ids=lambda v: v.name if isinstance(v, Path) else "")
def test_failures_are_signalled_as_502(path: Path, text: str):
    """Bad Gateway is the honest status: *we* are fine, our upstream is not."""
    assert "status_code=502" in text, f"{path.name} signals no 502 for an unreachable backend"


@pytest.mark.parametrize("path,text", list(_proxy_router_sources()),
                         ids=lambda v: v.name if isinstance(v, Path) else "")
def test_degraded_defaults_stay_renderable(path: Path, text: str):
    """Where we DO answer 200, the body must carry the field the UI reads.

    A list endpoint answering `{"tasks": [], "error": ...}` is deliberate: the
    board shows "no tasks" instead of an error card. That is only safe while the
    key is actually present, so pin it.
    """
    for line in text.splitlines():
        stripped = line.strip()
        if (UNAVAILABLE in stripped and stripped.startswith("return")
                and "status_code" not in stripped and "raise" not in stripped):
            assert _USABLE_DEFAULT.search(stripped), (
                f"{path.name}: 200 response with neither a usable default nor a "
                f"failure status:\n  {stripped}")
