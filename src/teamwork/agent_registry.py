"""Granting and revoking MCP access to a space, by writing the credential file.

The registry used to be something a user hand-authored: pick a slug, invent a
token, get the JSON shape right, chmod it, wire an env var. Every one of those is
a step to get wrong, and a workspace that makes you hand-edit a credential file
to use its own feature has not really shipped the feature.

So this module owns the file. Enabling a space mints a key scoped to exactly that
space and writes it here; revoking removes it. The UI is the interface, the file
is an implementation detail the user never has to see.

Three properties it keeps, because writing credentials from a web handler is the
kind of thing that goes wrong quietly:

- **Only the hash is stored.** The plaintext token is returned once, to the
  person who clicked the button, and never again — the file cannot leak what it
  does not hold, and a backup of it grants nothing.
- **The write is atomic and 0600.** A partial write would corrupt every other
  grant in the file, and a world-readable credential file is a credential leak
  whatever else is true.
- **Existing entries are preserved.** The file is shared with any hand-authored
  clients; rewriting it wholesale would silently revoke them.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import tempfile
from pathlib import Path
from typing import Any

from teamwork.agent_auth import _sha256

logger = logging.getLogger(__name__)

# Enough entropy that the token is the boundary, not a formality.
TOKEN_BYTES = 32

# What a space-scoped MCP key may do. Reads need no capability; these two cover
# the board and the notes. Deliberately not message.post — a space-scoped key is
# refused that anyway, since channels do not belong to a space.
DEFAULT_ALLOW = ["task.write", "activity.write"]


class RegistryError(Exception):
    """The registry could not be read or written."""


def registry_path(configured: str | None = None) -> Path:
    """Where the credential file lives, with ``~`` resolved.

    Resolved here rather than at settings-load so a test can point it elsewhere
    by setting the value, and so the default is readable as a path rather than as
    an already-expanded string that differs per machine.
    """
    from teamwork.config import settings

    raw = configured if configured is not None else getattr(
        settings, "agent_clients_path", "") or ""
    return Path(raw).expanduser() if raw else Path()


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001
        # Refuse rather than overwrite. A registry we cannot parse may still hold
        # working grants, and clobbering it would revoke them without saying so.
        raise RegistryError(
            f"{path} exists but is not readable JSON ({exc}). Fix or move it "
            "before granting access, so existing grants are not lost.") from exc
    if not isinstance(data, list):
        raise RegistryError(f"{path} should contain a JSON list of clients.")
    return data


def _write(path: Path, entries: list[dict[str, Any]]) -> None:
    """Replace the file atomically, owner-readable only."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".agent-clients-")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(entries, fh, indent=2)
            fh.write("\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)          # atomic: readers never see a half-file
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def client_name_for_space(space: str) -> str:
    return f"mcp-{space}"


def grant_space(space: str, *, name: str | None = None,
                allow: list[str] | None = None) -> dict[str, Any]:
    """Mint a key scoped to one space and record it.

    Returns the plaintext token exactly once. Re-granting an already-granted
    space **rotates** it: the old token stops working immediately, which is the
    only honest way to answer "I lost it" when the file holds no plaintext to
    recover.
    """
    if not space or "/" in space or space.startswith("."):
        raise RegistryError(f"invalid space slug: {space!r}")

    path = registry_path()
    if not path or str(path) == ".":
        raise RegistryError(
            "No credential registry path is configured, so there is nowhere to "
            "record the grant.")

    entries = _read(path)
    client = name = name or client_name_for_space(space)
    token = secrets.token_urlsafe(TOKEN_BYTES)

    entry = {
        "name": client,
        # The plaintext never lands on disk. Returned once, below.
        "token_sha256": _sha256(token),
        "mcp": True,
        "spaces": [space],
        "allow": list(allow or DEFAULT_ALLOW),
    }

    rotated = False
    for i, existing in enumerate(entries):
        if existing.get("name") == client:
            entries[i] = entry
            rotated = True
            break
    else:
        entries.append(entry)

    _write(path, entries)
    logger.info("MCP %s for space %r (client %r)",
                "rotated" if rotated else "granted", space, client)
    return {
        "space": space,
        "client": client,
        "token": token,          # the only time this value exists outside memory
        "rotated": rotated,
        "allow": entry["allow"],
        "path": str(path),
    }


def revoke_space(space: str) -> dict[str, Any]:
    """Remove the grant for a space. Other clients in the file are untouched."""
    path = registry_path()
    entries = _read(path)
    client = client_name_for_space(space)
    remaining = [e for e in entries if e.get("name") != client]
    removed = len(entries) - len(remaining)
    if removed:
        _write(path, remaining)
        logger.info("MCP revoked for space %r", space)
    return {"space": space, "revoked": bool(removed)}


def granted_spaces() -> set[str]:
    """Spaces that currently hold a UI-issued grant."""
    try:
        entries = _read(registry_path())
    except RegistryError:
        return set()
    out: set[str] = set()
    for entry in entries:
        if not entry.get("mcp"):
            continue
        spaces = entry.get("spaces") or []
        if isinstance(spaces, str):
            spaces = [s.strip() for s in spaces.split(",") if s.strip()]
        out.update(spaces)
    return out
