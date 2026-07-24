"""Ed25519 signed envelopes — attribution that survives a stolen token.

A bearer token proves the caller held a shared string. These pin the stronger
claim: that *this specific request* came from the key holder, unmodified, once.
"""
from __future__ import annotations

import base64
import time

import pytest

from teamwork.agent_signing import (
    MAX_CLOCK_SKEW_SECONDS,
    SignatureError,
    _NonceCache,
    canonical_payload,
    generate_keypair,
    sign_envelope,
    verify_envelope,
)

BODY = b'{"content":"hello"}'


@pytest.fixture(autouse=True)
def _fresh_nonce_cache():
    """Replay state is module-global by design; tests must not share it."""
    from teamwork import agent_signing
    agent_signing._nonces.seen.clear()
    yield
    agent_signing._nonces.seen.clear()


def _signed(priv, *, method="POST", path="/api/external/projects/p1/messages",
            ts=None, nonce="nonce-1", body=BODY):
    ts = ts if ts is not None else int(time.time())
    return sign_envelope(priv, method=method, path=path, timestamp=ts,
                         nonce=nonce, body=body), ts, nonce


def test_a_valid_envelope_verifies():
    priv, pub = generate_keypair()
    sig, ts, nonce = _signed(priv)
    verify_envelope(pub, method="POST",
                    path="/api/external/projects/p1/messages",
                    timestamp=str(ts), nonce=nonce, body=BODY, signature=sig)


def test_a_tampered_body_does_not_verify():
    # The whole point: a proxy cannot alter the message in flight.
    priv, pub = generate_keypair()
    sig, ts, nonce = _signed(priv)
    with pytest.raises(SignatureError, match="does not verify"):
        verify_envelope(pub, method="POST",
                        path="/api/external/projects/p1/messages",
                        timestamp=str(ts), nonce=nonce,
                        body=b'{"content":"goodbye"}', signature=sig)


def test_another_agents_key_does_not_verify():
    priv_a, _ = generate_keypair()
    _, pub_b = generate_keypair()
    sig, ts, nonce = _signed(priv_a)
    with pytest.raises(SignatureError):
        verify_envelope(pub_b, method="POST",
                        path="/api/external/projects/p1/messages",
                        timestamp=str(ts), nonce=nonce, body=BODY, signature=sig)


def test_replaying_the_same_request_is_refused():
    priv, pub = generate_keypair()
    sig, ts, nonce = _signed(priv, nonce="replay-me")
    kw = dict(method="POST", path="/api/external/projects/p1/messages",
              timestamp=str(ts), nonce=nonce, body=BODY, signature=sig)
    verify_envelope(pub, **kw)                       # first use: fine
    with pytest.raises(SignatureError, match="replayed"):
        verify_envelope(pub, **kw)                   # second: refused


def test_a_stale_or_future_timestamp_is_refused():
    priv, pub = generate_keypair()
    old = int(time.time()) - (MAX_CLOCK_SKEW_SECONDS + 60)
    sig, ts, nonce = _signed(priv, ts=old, nonce="stale")
    with pytest.raises(SignatureError, match="away from now"):
        verify_envelope(pub, method="POST",
                        path="/api/external/projects/p1/messages",
                        timestamp=str(ts), nonce=nonce, body=BODY, signature=sig)


def test_signature_is_bound_to_method_and_path():
    # A signature captured on a read must not be reusable on a destructive route.
    priv, pub = generate_keypair()
    sig, ts, nonce = _signed(priv, method="GET", path="/api/external/projects")
    with pytest.raises(SignatureError, match="does not verify"):
        verify_envelope(pub, method="DELETE",
                        path="/api/external/projects/p1/channels/c1/messages",
                        timestamp=str(ts), nonce=nonce, body=BODY, signature=sig)


def test_incomplete_envelopes_are_refused():
    _, pub = generate_keypair()
    for kw in ({"signature": "", "nonce": "n", "timestamp": "1"},
               {"signature": "x", "nonce": "", "timestamp": "1"},
               {"signature": "x", "nonce": "n", "timestamp": ""}):
        with pytest.raises(SignatureError, match="incomplete"):
            verify_envelope(pub, method="POST", path="/p", body=b"", **kw)


def test_malformed_signature_and_timestamp_are_refused():
    _, pub = generate_keypair()
    now = int(time.time())
    with pytest.raises(SignatureError, match="not an integer"):
        verify_envelope(pub, method="POST", path="/p", timestamp="soon",
                        nonce="n1", body=b"", signature="AAAA")
    with pytest.raises(SignatureError, match="valid base64"):
        verify_envelope(pub, method="POST", path="/p", timestamp=str(now),
                        nonce="n2", body=b"", signature="!!!not-base64!!!")


def test_canonical_payload_is_unambiguous_between_fields():
    # Field-shifting must not produce the same bytes, or a signature could be
    # replayed across different requests.
    a = canonical_payload("POST", "/a/b", 1, "n", b"")
    b = canonical_payload("POST", "/a", "b/1", "n", b"")
    assert a != b
    assert canonical_payload("POST", "/p", 1, "n", b"x") != \
           canonical_payload("POST", "/p", 1, "n", b"y")
    assert a.startswith(b"prax-teamwork-v1\n")


def test_public_key_accepts_hex_or_base64():
    priv, pub_b64 = generate_keypair()
    pub_hex = base64.b64decode(pub_b64).hex()
    for i, pub in enumerate((pub_b64, pub_hex)):
        # A fresh nonce per attempt — the signature is bound to it.
        sig, ts, nonce = _signed(priv, nonce=f"fmt-{i}")
        verify_envelope(pub, method="POST",
                        path="/api/external/projects/p1/messages",
                        timestamp=str(ts), nonce=nonce,
                        body=BODY, signature=sig)


def test_bad_public_key_material_is_rejected_clearly():
    now = int(time.time())
    with pytest.raises(SignatureError, match="32 bytes|hex nor base64"):
        verify_envelope(base64.b64encode(b"tooshort").decode(), method="POST",
                        path="/p", timestamp=str(now), nonce="bk", body=b"",
                        signature=base64.b64encode(b"x" * 64).decode())


def test_nonce_cache_prunes_and_stays_bounded():
    cache = _NonceCache()
    assert cache.check_and_add("a", now=1000.0)
    assert not cache.check_and_add("a", now=1000.0)
    # An old nonce outside the window is pruned once the cache grows.
    cache.seen = {f"n{i}": 1000.0 for i in range(20_001)}
    assert cache.check_and_add("fresh", now=1000.0 + MAX_CLOCK_SKEW_SECONDS + 1)
    assert len(cache.seen) < 20_001


# ── Registry wiring: a client that publishes a key requires signing ──────────

def test_registering_a_public_key_defaults_to_requiring_signatures():
    from tests.test_agent_auth import load_clients_from
    _, pub = generate_keypair()
    signed, unsigned = load_clients_from([
        {"name": "signed", "token": "t1", "agent_id": "a1", "public_key": pub},
        {"name": "unsigned", "token": "t2", "agent_id": "a2"},
    ])
    # Having registered a key, an unsigned request is a downgrade attempt.
    assert signed.public_key == pub and signed.require_signature is True
    assert unsigned.public_key is None and unsigned.require_signature is False


def test_require_signature_can_be_declared_off_explicitly():
    from tests.test_agent_auth import load_clients_from
    _, pub = generate_keypair()
    (c,) = load_clients_from([{"name": "migrating", "token": "t", "agent_id": "a",
                               "public_key": pub, "require_signature": False}])
    assert c.public_key == pub and c.require_signature is False
