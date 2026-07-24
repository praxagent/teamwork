"""Running a foreign command-line agent as a TeamWork member.

The interesting cases are the ones that keep a shared workspace usable: two
adapters must not talk to each other forever, a failing agent must say so rather
than go quiet, and a runaway reply must not fill the channel.
"""
from __future__ import annotations

import json

import pytest

from teamwork.agent_adapter import (
    MAX_REPLY_CHARS,
    AdapterError,
    ForeignAgent,
    load_agents,
)


def _agent(**kw) -> ForeignAgent:
    kw.setdefault("name", "goose")
    kw.setdefault("command", ["cat"])          # echoes stdin — a stand-in agent
    kw.setdefault("project_id", "p1")
    kw.setdefault("channel_id", "c1")
    kw.setdefault("agent_id", "agent-goose")
    return ForeignAgent(**kw)


# ── Addressing: don't talk to yourself, or to each other forever ─────────────

def test_an_agent_never_answers_its_own_message():
    a = _agent()
    assert a.addressed_by({"agent_id": "agent-goose", "content": "@goose hi"}) is False


def test_mention_required_by_default():
    # Without this, two adapters in one channel reply to each other indefinitely.
    a = _agent()
    assert a.addressed_by({"agent_id": "other", "content": "@goose summarise"}) is True
    assert a.addressed_by({"agent_id": "other", "content": "just chatting"}) is False


def test_mention_is_case_insensitive():
    a = _agent()
    assert a.addressed_by({"agent_id": "other", "content": "@GOOSE hello"}) is True


def test_a_sole_responder_can_answer_everything():
    a = _agent(require_mention=False)
    assert a.addressed_by({"agent_id": "other", "content": "no mention"}) is True
    # …but still not itself.
    assert a.addressed_by({"agent_id": "agent-goose", "content": "mine"}) is False


# ── Prompt construction ──────────────────────────────────────────────────────

def test_prompt_strips_the_mention_and_labels_the_speaker():
    a = _agent()
    prompt = a.build_prompt({"agent_name": "TJ", "content": "@goose what is 2+2?"})
    assert "@goose" not in prompt
    assert prompt == "TJ: what is 2+2?"


def test_prompt_falls_back_to_a_generic_speaker():
    assert _agent().build_prompt({"content": "@goose hi"}).startswith("user:")


# ── Invocation ───────────────────────────────────────────────────────────────

def test_a_working_agent_replies():
    a = _agent(command=["cat"])
    assert a.handle({"agent_id": "other", "content": "@goose ping"}) == "user: ping"


def test_a_message_not_addressed_to_us_is_ignored():
    assert _agent().handle({"agent_id": "other", "content": "unrelated"}) is None


def test_a_missing_command_is_reported_into_the_channel_not_swallowed():
    # Silence in a shared workspace reads as "still thinking".
    a = _agent(command=["definitely-not-a-real-binary-xyz"])
    reply = a.handle({"agent_id": "other", "content": "@goose hi"})
    assert reply.startswith("⚠️") and "could not answer" in reply


def test_a_nonzero_exit_is_reported_with_its_stderr():
    a = _agent(command=["sh", "-c", "echo boom >&2; exit 3"])
    reply = a.handle({"agent_id": "other", "content": "@goose hi"})
    assert "exited 3" in reply and "boom" in reply


def test_a_timeout_is_reported_not_hung():
    a = _agent(command=["sleep", "5"], timeout=1)
    reply = a.handle({"agent_id": "other", "content": "@goose hi"})
    assert "no reply within 1s" in reply


def test_an_empty_reply_is_surfaced():
    a = _agent(command=["true"])
    assert "empty reply" in a.handle({"agent_id": "other", "content": "@goose hi"})


def test_a_runaway_reply_is_truncated():
    # A runaway agent must not be able to fill the channel.
    a = _agent(command=["sh", "-c", f"yes x | head -c {MAX_REPLY_CHARS * 2}"])
    reply = a.handle({"agent_id": "other", "content": "@goose hi"})
    assert len(reply) < MAX_REPLY_CHARS + 100
    assert reply.endswith("…(truncated)")


def test_invoke_without_a_command_raises():
    with pytest.raises(AdapterError, match="no command"):
        _agent(command=[]).invoke("hi")


def test_env_overrides_reach_the_subprocess():
    a = _agent(command=["sh", "-c", "printf %s \"$ADAPTER_TEST\""],
               env={"ADAPTER_TEST": "wired"})
    assert a.invoke("ignored") == "wired"


# ── Config loading ───────────────────────────────────────────────────────────

def test_load_agents_accepts_a_string_or_list_command(tmp_path):
    cfg = tmp_path / "agents.json"
    cfg.write_text(json.dumps([
        {"name": "goose", "command": "goose run --quiet",
         "project_id": "p1", "channel_id": "c1", "agent_id": "a1"},
        {"name": "codex", "command": ["codex", "exec"],
         "project_id": "p1", "channel_id": "c1"},
    ]))
    goose, codex = load_agents(str(cfg))
    assert goose.command == ["goose", "run", "--quiet"]
    assert codex.command == ["codex", "exec"]
    assert goose.require_mention is True


def test_load_agents_skips_an_entry_with_no_command(tmp_path):
    cfg = tmp_path / "agents.json"
    cfg.write_text(json.dumps([
        {"name": "broken", "project_id": "p1", "channel_id": "c1"},
        {"name": "ok", "command": ["cat"], "project_id": "p1", "channel_id": "c1"},
    ]))
    assert [a.name for a in load_agents(str(cfg))] == ["ok"]
