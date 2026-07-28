"""The terminal runs in the sandbox or it does not run.

This closes a real escape. `_spawn_terminal_session` used to end with a "local
fallback (dev mode without docker)" branch that spawned `$SHELL` on the machine
hosting TeamWork, inheriting the service's entire `os.environ` — every
credential it holds — reachable by anyone who could open the panel.

It triggered on the ordinary case of `SANDBOX_CONTAINER` being unset, so a
deployment that had simply not configured a sandbox handed out a host shell
instead of a sandboxed one, announcing it as "Connecting to sandbox...".

Worse, `mode` was a client-supplied query parameter that selected between
docker-exec and that local shell — making *where code runs* something the caller
could choose.

A terminal outside the sandbox is not a degraded terminal. It is a different and
much more dangerous thing, so the correct behaviour when the sandbox is missing
is to refuse.
"""
from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

from teamwork.routers import terminal


class FakeWS:
    def __init__(self):
        self.sent: list[str] = []

    async def send_text(self, text: str):
        self.sent.append(text)


@pytest.mark.asyncio
async def test_no_sandbox_configured_means_no_terminal(monkeypatch):
    monkeypatch.setattr("teamwork.config.settings.sandbox_container", "", raising=False)
    ws = FakeWS()

    session = await terminal._spawn_terminal_session(ws, "sub", False)

    assert session is None, "a host shell was spawned instead of refusing"
    assert any("No sandbox" in m for m in ws.sent)


@pytest.mark.asyncio
async def test_a_missing_container_means_no_terminal(monkeypatch):
    """Configured but not running is the same answer: refuse."""
    import subprocess

    monkeypatch.setattr("teamwork.config.settings.sandbox_container",
                        "prax-sandbox-sandbox-1", raising=False)
    monkeypatch.setattr(terminal.shutil if hasattr(terminal, "shutil") else terminal,
                        "__name__", terminal.__name__, raising=False)
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, 0, "", ""))
    ws = FakeWS()

    session = await terminal._spawn_terminal_session(ws, "sub", False)

    assert session is None
    assert any("not running" in m for m in ws.sent)


def test_the_caller_cannot_choose_where_code_runs():
    """`mode` must not reach the spawn path at all."""
    assert "mode" not in inspect.signature(terminal._spawn_terminal_session).parameters


def test_no_shell_is_ever_spawned_outside_docker():
    """Structural: no Popen in this module may run a bare shell.

    Asserted against the source rather than by calling it, because the dangerous
    path was one branch of a long function — a behavioural test only covers the
    branch you thought to exercise, and this bug lived in the branch nobody did.
    """
    src = pathlib.Path(terminal.__file__).read_text()
    tree = ast.parse(src)

    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr != "Popen":
            continue
        cmd = node.args[0] if node.args else None
        # Every surviving Popen builds its command from a `cmd` variable that is
        # assembled from a docker-exec string; none may name a shell directly.
        rendered = ast.dump(cmd) if cmd is not None else ""
        for shell in ("'/bin/bash'", "'bash'", "'sh'", "SHELL"):
            assert shell not in rendered, (
                f"a Popen in terminal.py names {shell} directly — the only "
                "terminal is a sandboxed one")

    assert "os.environ.get(\"SHELL\"" not in src, (
        "terminal.py still reads $SHELL, which only the host-shell path needed")
    assert "**os.environ" not in src, (
        "terminal.py still passes TeamWork's whole environment to a child; "
        "that is how the host shell inherited every credential the service holds")
