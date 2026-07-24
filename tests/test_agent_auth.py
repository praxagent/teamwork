"""Per-agent credential tests — identity comes from the token, not the body.

The bug these pin: TeamWork authenticated every caller with one shared
``EXTERNAL_API_KEY`` and then believed whatever ``agent_id`` the body carried, so
any key holder could post as any agent and the audit trail recorded it as fact.
With several agents governed by an orchestrator that is a missing boundary, not a
cosmetic one.
"""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from teamwork.agent_auth import (
    ALL_CAPABILITIES,
    AgentClient,
    _sha256,
    load_clients,
    resolve_client,
)


def _client(**kw) -> AgentClient:
    kw.setdefault("name", "prax-research")
    kw.setdefault("token_sha256", _sha256("tok-research"))
    return AgentClient(**kw)


# ── Credential resolution ────────────────────────────────────────────────────

def test_token_resolves_to_its_own_identity():
    a = _client(agent_id="agent-research")
    b = AgentClient(name="prax-ops", token_sha256=_sha256("tok-ops"), agent_id="agent-ops")
    assert resolve_client("tok-research", [a, b]) is a
    assert resolve_client("tok-ops", [a, b]) is b


def test_unknown_and_empty_tokens_resolve_to_nothing():
    a = _client(agent_id="agent-research")
    assert resolve_client("wrong", [a]) is None
    assert resolve_client("", [a]) is None
    assert resolve_client(None, [a]) is None


def test_token_is_never_stored_in_plaintext():
    entries = [{"name": "x", "token": "super-secret", "agent_id": "a1"}]
    clients = load_clients_from(entries)
    assert clients[0].token_sha256 == _sha256("super-secret")
    assert "super-secret" not in json.dumps([c.token_sha256 for c in clients])


def load_clients_from(entries, tmp=None, legacy=None):
    import tempfile
    import pathlib
    d = tmp or tempfile.mkdtemp()
    p = pathlib.Path(d) / "clients.json"
    p.write_text(json.dumps(entries))
    return load_clients(str(p), legacy)


# ── The actual boundary: a credential cannot speak for another agent ─────────

def test_bound_credential_may_not_act_as_a_different_agent():
    c = _client(agent_id="agent-research")
    assert c.may_act_as("agent-research") is True
    assert c.may_act_as(None) is True            # falls back to its own identity
    assert c.may_act_as("agent-ops") is False    # ← the impersonation that was possible


def test_unbound_legacy_key_keeps_permissive_behaviour():
    # Explicitly documented, not accidental: the shared key predates per-agent
    # identity. It authenticates, but carries no identity of its own.
    legacy = AgentClient(name="legacy", token_sha256=_sha256("k"), legacy=True)
    assert legacy.agent_id is None
    assert legacy.may_act_as("literally-anyone") is True


def test_require_agent_rejects_impersonation_and_derives_identity():
    from teamwork.routers.external import require_agent
    bound = _client(agent_id="agent-research")
    # Asserting someone else's id is refused outright.
    with pytest.raises(HTTPException) as exc:
        require_agent(bound, "agent-ops")
    assert exc.value.status_code == 403
    # Asserting your own is fine; asserting nothing derives it from the token.
    assert require_agent(bound, "agent-research") == "agent-research"
    assert require_agent(bound, None) == "agent-research"


# ── Fail closed ──────────────────────────────────────────────────────────────

def test_no_credentials_configured_fails_closed(monkeypatch):
    # Previously: no key configured = accept anything, as anyone.
    from teamwork.config import settings
    from teamwork.routers.external import _resolve_client
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", "", raising=False)
    monkeypatch.setattr(settings, "allow_unauthenticated_agents", False, raising=False)
    with pytest.raises(HTTPException) as exc:
        _resolve_client("anything")
    assert exc.value.status_code == 503


def test_dev_mode_is_opt_in_only(monkeypatch):
    from teamwork.config import settings
    from teamwork.routers.external import _resolve_client
    monkeypatch.setattr(settings, "external_api_key", "", raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", "", raising=False)
    monkeypatch.setattr(settings, "allow_unauthenticated_agents", True, raising=False)
    assert _resolve_client(None).name == "anonymous-dev"


def test_wrong_key_is_rejected(monkeypatch):
    from teamwork.config import settings
    from teamwork.routers.external import _resolve_client
    monkeypatch.setattr(settings, "external_api_key", "right", raising=False)
    monkeypatch.setattr(settings, "agent_clients_path", "", raising=False)
    with pytest.raises(HTTPException) as exc:
        _resolve_client("wrong")
    assert exc.value.status_code == 401
    assert _resolve_client("right").legacy is True


# ── Capability set (the seam Buzz #2 builds on) ──────────────────────────────

def test_capabilities_default_open_but_narrow_when_declared():
    assert _client().can("anything")                       # no allow → wildcard
    scoped = _client(allow=frozenset({"message.post"}))
    assert scoped.can("message.post") and not scoped.can("task.update")
    assert _client(allow=frozenset({ALL_CAPABILITIES})).can("task.update")


def test_registry_entry_without_a_token_is_skipped_not_trusted():
    clients = load_clients_from([{"name": "broken", "agent_id": "a1"},
                                 {"name": "ok", "token": "t", "agent_id": "a2"}])
    assert [c.name for c in clients] == ["ok"]


def test_project_scope():
    c = _client(project_id="p1")
    assert c.scoped_to("p1") and not c.scoped_to("p2")
    assert _client().scoped_to("anything")   # unscoped credential
