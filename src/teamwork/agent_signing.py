"""Ed25519 signed request envelopes — attribution that survives a stolen token.

A bearer token proves the caller *held a secret*. It does not prove **this
specific request** came from that agent: anyone who has seen the token (a log, a
proxy, a backup, a compromised peer) can replay or forge traffic under it, and
the audit trail records the forgery as fact. Signing moves the claim from "knew
a shared string" to "**holds the private key**", per request.

What a signature buys over #33's per-agent token:

- **Non-repudiation** — the agent, not just the server, attests to the action.
  A tampered audit row stops verifying.
- **Tamper-evidence** — the body is bound into the signed payload, so a proxy
  cannot alter a message in flight.
- **Replay protection** — timestamp window plus a single-use nonce.

**Why Ed25519 and not Schnorr/secp256k1.** Buzz signs with Schnorr because Nostr
mandates it (NIP-01 events are BIP-340); it is protocol compliance, not a
cryptographic preference. Ed25519 is the same ~128-bit security level, faster,
has deterministic nonces, and is already available here through ``cryptography``
— secp256k1 Schnorr would mean taking on a dependency to be compatible with a
protocol we deliberately did not adopt.

**What this does NOT buy.** If the orchestrator holds every agent's private key
in one process, a compromised orchestrator can sign as any of them. Signing
gives attribution and tamper-evidence; resisting a compromised signer needs key
custody in a separate trust domain. That is a deliberate next step, not
something this module pretends to deliver.

Wire format — the client sends::

    X-Agent-Signature: base64(ed25519_sign(canonical))
    X-Agent-Timestamp: 1753372800          # unix seconds
    X-Agent-Nonce:     <unique per request>

where ``canonical`` is, with no ambiguity between fields::

    prax-teamwork-v1\\n{METHOD}\\n{path}\\n{timestamp}\\n{nonce}\\n{sha256hex(body)}
"""
from __future__ import annotations

import base64
import hashlib
import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Bumped if the canonical form ever changes, so an old client can never have its
# signature accepted against a new interpretation of the bytes.
ENVELOPE_VERSION = "prax-teamwork-v1"

# How far a request's timestamp may be from ours. Tight enough that a captured
# request is only briefly replayable, loose enough for ordinary clock drift.
MAX_CLOCK_SKEW_SECONDS = 300

# Bound on remembered nonces, so a flood cannot exhaust memory.
_MAX_NONCES = 20_000


class SignatureError(Exception):
    """A signed envelope failed verification. The reason is safe to log, and
    deliberately generic when returned to the caller."""


def canonical_payload(method: str, path: str, timestamp: str | int,
                      nonce: str, body: bytes) -> bytes:
    """The exact bytes both sides sign. Field order and separators are fixed."""
    digest = hashlib.sha256(body or b"").hexdigest()
    return "\n".join(
        (ENVELOPE_VERSION, method.upper(), path, str(timestamp), nonce, digest)
    ).encode("utf-8")


@dataclass
class _NonceCache:
    """Single-use nonces within the skew window (the replay guard).

    Deliberately in-process: it is correct for the single-instance deployment
    TeamWork targets. A multi-instance deployment needs a shared store, and
    should not assume this class provides one.
    """

    seen: dict[str, float]

    def __init__(self) -> None:
        self.seen = {}

    def check_and_add(self, nonce: str, now: float | None = None) -> bool:
        """True if *nonce* is fresh; False if it has been used. Prunes expired."""
        now = now if now is not None else time.time()
        if len(self.seen) > _MAX_NONCES:
            cutoff = now - MAX_CLOCK_SKEW_SECONDS
            self.seen = {k: v for k, v in self.seen.items() if v > cutoff}
        if nonce in self.seen:
            return False
        self.seen[nonce] = now
        return True


_nonces = _NonceCache()


def _decode_key(material: str) -> bytes:
    """Accept a raw 32-byte Ed25519 public key as base64 or hex."""
    material = material.strip()
    try:
        raw = bytes.fromhex(material)
        if len(raw) == 32:
            return raw
    except ValueError:
        pass
    try:
        raw = base64.b64decode(material, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise SignatureError(f"public key is neither hex nor base64: {exc}") from exc
    if len(raw) != 32:
        raise SignatureError(f"Ed25519 public key must be 32 bytes, got {len(raw)}")
    return raw


def verify_envelope(public_key: str, *, method: str, path: str, timestamp: str,
                    nonce: str, body: bytes, signature: str,
                    now: float | None = None) -> None:
    """Verify a signed request, or raise :class:`SignatureError`.

    Checks, in order: the envelope is complete, the timestamp is inside the skew
    window, the nonce is unused, and the signature verifies over the canonical
    payload. Order matters — the cheap replay checks run before the expensive
    curve operation.
    """
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    if not (signature and timestamp and nonce):
        raise SignatureError("incomplete signed envelope "
                             "(need signature, timestamp and nonce)")
    try:
        ts = int(timestamp)
    except (TypeError, ValueError) as exc:
        raise SignatureError("timestamp is not an integer") from exc

    now = now if now is not None else time.time()
    drift = abs(now - ts)
    if drift > MAX_CLOCK_SKEW_SECONDS:
        raise SignatureError(
            f"timestamp is {drift:.0f}s away from now (max {MAX_CLOCK_SKEW_SECONDS}s) "
            "— replayed, or the clocks disagree")

    if not _nonces.check_and_add(nonce, now):
        raise SignatureError("nonce already used — replayed request")

    try:
        sig = base64.b64decode(signature, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise SignatureError("signature is not valid base64") from exc

    key = Ed25519PublicKey.from_public_bytes(_decode_key(public_key))
    try:
        key.verify(sig, canonical_payload(method, path, ts, nonce, body))
    except InvalidSignature as exc:
        raise SignatureError("signature does not verify for this request") from exc


def sign_envelope(private_key_b64: str, *, method: str, path: str,
                  timestamp: str | int, nonce: str, body: bytes) -> str:
    """Produce a signature — the client half.

    Lives here so both sides share one canonical form; the reference
    implementation of a client is also the thing the tests sign with. A real
    agent holds its key elsewhere (see the custody note above).
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.from_private_bytes(_decode_key(private_key_b64))
    sig = key.sign(canonical_payload(method, path, timestamp, nonce, body))
    return base64.b64encode(sig).decode("ascii")


def generate_keypair() -> tuple[str, str]:
    """``(private_b64, public_b64)`` — for provisioning an agent identity."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    raw_priv = priv.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption())
    raw_pub = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw)
    return (base64.b64encode(raw_priv).decode("ascii"),
            base64.b64encode(raw_pub).decode("ascii"))
