"""Granting MCP access to a space by writing the credential file.

The registry used to be something a user hand-authored: pick a slug, invent a
token, get the JSON shape right, chmod it, wire an env var. A workspace that
makes you hand-edit a credential file to use its own feature has not shipped the
feature. So the UI writes it — and writing credentials from a web handler is
exactly the kind of thing that goes wrong quietly, which is what these cover.
"""
from __future__ import annotations

import json
import stat

import pytest

from teamwork import agent_registry as reg
from teamwork.agent_auth import _sha256, load_clients, resolve_client


@pytest.fixture
def registry(monkeypatch, tmp_path):
    path = tmp_path / "nested" / "agent-clients.json"
    monkeypatch.setattr("teamwork.config.settings.agent_clients_path",
                        str(path), raising=False)
    return path


# ── The token ────────────────────────────────────────────────────────────────

def test_the_file_never_holds_the_plaintext_token(registry):
    """A backup of the registry must not grant anything."""
    result = reg.grant_space("project-a")
    body = registry.read_text()
    assert result["token"] not in body
    assert _sha256(result["token"]) in body


def test_the_minted_token_actually_authenticates(registry):
    # A hash nobody can present is not a credential.
    result = reg.grant_space("project-a")
    client = resolve_client(result["token"], load_clients(str(registry)))
    assert client is not None
    assert client.mcp is True
    assert client.spaces == frozenset({"project-a"})


def test_re_enabling_rotates_rather_than_returning_the_old_token(registry):
    """The file holds no plaintext, so "show me my token again" cannot be
    honoured. Rotating is the honest answer; pretending would not be."""
    first = reg.grant_space("project-a")
    second = reg.grant_space("project-a")

    assert second["rotated"] is True
    assert second["token"] != first["token"]
    clients = load_clients(str(registry))
    assert resolve_client(first["token"], clients) is None, "the old key must die"
    assert resolve_client(second["token"], clients) is not None


def test_two_spaces_get_two_independent_keys(registry):
    a = reg.grant_space("project-a")
    b = reg.grant_space("project-b")
    clients = load_clients(str(registry))

    ca = resolve_client(a["token"], clients)
    cb = resolve_client(b["token"], clients)
    assert ca.spaces == frozenset({"project-a"})
    assert cb.spaces == frozenset({"project-b"})
    assert not ca.may_touch_space("project-b")


# ── The file ─────────────────────────────────────────────────────────────────

def test_the_file_is_owner_only(registry):
    reg.grant_space("project-a")
    mode = stat.S_IMODE(registry.stat().st_mode)
    assert mode == 0o600, f"credential file is {oct(mode)} — readable by others"


def test_granting_preserves_clients_someone_else_wrote(registry):
    """The file is shared. Rewriting it wholesale would silently revoke them."""
    registry.parent.mkdir(parents=True)
    registry.write_text(json.dumps([
        {"name": "hand-authored", "token": "keep-me", "allow": ["task.write"]}]))

    reg.grant_space("project-a")
    names = {e["name"] for e in json.loads(registry.read_text())}
    assert "hand-authored" in names
    assert resolve_client("keep-me", load_clients(str(registry))) is not None


def test_an_unparseable_registry_is_refused_not_overwritten(registry):
    """It may still hold working grants. Clobbering revokes them silently."""
    registry.parent.mkdir(parents=True)
    registry.write_text("{ this is not json")

    with pytest.raises(reg.RegistryError, match="not readable JSON"):
        reg.grant_space("project-a")
    assert registry.read_text() == "{ this is not json", "the file was modified"


def test_the_directory_is_created_on_first_grant(registry):
    # Until the first grant nothing exists and nothing is granted — the same
    # fail-closed state an unset path gave us.
    assert not registry.parent.exists()
    reg.grant_space("project-a")
    assert registry.exists()


# ── Revoking ─────────────────────────────────────────────────────────────────

def test_revoking_kills_the_key(registry):
    result = reg.grant_space("project-a")
    reg.revoke_space("project-a")
    assert resolve_client(result["token"], load_clients(str(registry))) is None


def test_revoking_one_space_leaves_the_others(registry):
    a = reg.grant_space("project-a")
    b = reg.grant_space("project-b")
    reg.revoke_space("project-a")

    clients = load_clients(str(registry))
    assert resolve_client(a["token"], clients) is None
    assert resolve_client(b["token"], clients) is not None


def test_revoking_something_never_granted_is_not_an_error(registry):
    assert reg.revoke_space("never-existed")["revoked"] is False


# ── Slugs ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["", "../etc", "a/b", ".hidden"])
def test_a_slug_that_could_escape_is_refused(registry, bad):
    # It names a client and reaches the filesystem via the space root elsewhere;
    # neither should accept a path.
    with pytest.raises(reg.RegistryError):
        reg.grant_space(bad)


def test_granted_spaces_reports_what_is_live(registry):
    reg.grant_space("project-a")
    reg.grant_space("project-b")
    assert reg.granted_spaces() == {"project-a", "project-b"}
    reg.revoke_space("project-a")
    assert reg.granted_spaces() == {"project-b"}


# ── The writer and the reader must agree on where the file is ────────────────

def test_a_tilde_path_is_loaded_not_just_written(monkeypatch, tmp_path):
    """The bug that made a correctly-issued key 401 on every call.

    `registry_path` expanded `~`; `load_clients` did not. So a grant was written
    to /home/you/.teamwork/... while the reader looked for a directory literally
    named "~", found nothing, and loaded no clients. The failure is the worst
    shape available: the file exists, holds a valid credential, the UI says the
    space is enabled — and every request is rejected.
    """
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr("teamwork.config.settings.agent_clients_path",
                        "~/.teamwork/agent-clients.json", raising=False)

    result = reg.grant_space("project-a")
    assert (home / ".teamwork" / "agent-clients.json").exists(), "writer expanded ~"

    clients = load_clients("~/.teamwork/agent-clients.json")
    assert resolve_client(result["token"], clients) is not None, (
        "the reader did not expand ~, so a valid key is invisible")


def test_the_writer_and_reader_resolve_to_the_same_file(monkeypatch, tmp_path):
    """Stated as a property, so any future path handling keeps them in step."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr("teamwork.config.settings.agent_clients_path",
                        "~/.teamwork/agent-clients.json", raising=False)

    reg.grant_space("project-a")
    assert reg.registry_path().exists()
    assert reg.granted_spaces() == {"project-a"}


# ── What the board shows ─────────────────────────────────────────────────────

def test_a_grant_carries_a_human_readable_label(registry):
    """The registry name identifies the key; the label is what a person reads.

    A card filed by an agent used to be credited to "human", so you could not
    tell your own work from an agent's — which is most of what a shared board is
    for.
    """
    from teamwork.agent_auth import load_clients, resolve_client

    result = reg.grant_space("project-a")
    assert result["label"] == "Claude Code"

    client = resolve_client(result["token"], load_clients(str(registry)))
    assert client.display_name == "Claude Code"
    assert client.name == "mcp-project-a", "the identifier is unchanged"


def test_the_label_can_name_a_different_agent(registry):
    # Codex users should not see "Claude Code" on their cards.
    from teamwork.agent_auth import load_clients, resolve_client

    result = reg.grant_space("project-a", label="Codex")
    client = resolve_client(result["token"], load_clients(str(registry)))
    assert client.display_name == "Codex"


def test_display_name_falls_back_to_the_key_name(registry):
    """A hand-authored entry without a label still shows something."""
    import json

    from teamwork.agent_auth import load_clients, resolve_client

    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(json.dumps([{"name": "hand-rolled", "token": "t", "mcp": True}]))
    client = resolve_client("t", load_clients(str(registry)))
    assert client.display_name == "hand-rolled"
