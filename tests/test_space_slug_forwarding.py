"""The space a message was sent from has to survive the trip to the agent.

A space can pin its own model, and the agent can only honour that if it is told
which space the user is in. Every hop is somewhere the value can be dropped
silently — and two of them were dropping it: the field existed on the request
model and in the forwarder's signature, but the call site between them never
passed it along, so the agent always saw None.

These tests are about the wiring rather than the behaviour, because the wiring
is the part that broke.
"""
from __future__ import annotations

import inspect

from teamwork.routers import messages as m


def test_the_request_model_accepts_a_space():
    assert "space_slug" in m.MessageCreate.model_fields


def test_the_forwarder_accepts_a_space():
    assert "space_slug" in inspect.signature(m._forward_to_external_webhook).parameters


def test_the_call_site_actually_passes_it():
    """The hop that was missing: a parameter nobody supplies is always None."""
    src = inspect.getsource(m.create_message)
    assert "_forward_to_external_webhook" in src
    assert "message.space_slug" in src, (
        "the forwarder takes a space but the call site never gives it one — "
        "the pin would never reach the agent")


def test_an_absent_space_is_omitted_rather_than_sent_as_null():
    """A main-chat message carries no space, and should say nothing about one."""
    body = inspect.getsource(m._forward_to_external_webhook)
    assert "if space_slug:" in body
