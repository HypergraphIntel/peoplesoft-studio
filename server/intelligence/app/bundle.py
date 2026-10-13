"""Signed knowledge bundles (docs/intelligence/KNOWLEDGE_REGISTRY.md "Knowledge bundles").

A bundle is declarative data -- published findings and revoked ids -- signed with
Ed25519 over its canonical JSON (the same canonical form the fingerprints use, so
the extension verifies the exact bytes). The private key is never on the server:
the admin CLI signs with a key file given to it and stores only the envelope.
Nothing in a bundle is executable, and nothing in it can change what a client
may write.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, load_pem_private_key

from .canonical import canonical_json

BUNDLE_FORMAT = "psft-knowledge/1"
ENVELOPE_FORMAT = "psft-knowledge-envelope/1"


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def key_id(public: Ed25519PublicKey) -> str:
    """The first 16 hex digits of SHA-256 over the raw public key."""
    return hashlib.sha256(public.public_bytes(Encoding.Raw, PublicFormat.Raw)).hexdigest()[:16]


def load_private_key(pem: bytes) -> Ed25519PrivateKey:
    key = load_pem_private_key(pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("the signing key must be an Ed25519 private key")
    return key


def build_bundle(version: int, findings: list[dict], revoked: list[str], issued: datetime, days: int) -> dict:
    return {
        "format": BUNDLE_FORMAT,
        "version": version,
        "issuedAt": _iso(issued),
        "expiresAt": _iso(issued + timedelta(days=days)),
        "findings": findings,
        "revoked": sorted(revoked),
    }


def sign(bundle: dict, key: Ed25519PrivateKey) -> dict:
    signature = key.sign(canonical_json(bundle).encode("utf-8"))
    return {"format": ENVELOPE_FORMAT, "keyId": key_id(key.public_key()), "signature": base64.b64encode(signature).decode("ascii"), "bundle": bundle}


def verify(envelope: dict, public: Ed25519PublicKey) -> bool:
    try:
        public.verify(base64.b64decode(envelope["signature"]), canonical_json(envelope["bundle"]).encode("utf-8"))
        return True
    except Exception:
        return False


def finding_entry(f) -> dict:
    """A published finding as a bundle carries it: the claim and where it holds, no evidence payloads."""
    return {
        "id": f.id, "fingerprint": f.fingerprint, "type": f.type, "subject": f.subject, "assertion": f.assertion,
        "title": f.title, "statement": f.statement, "verifiedReleases": sorted(f.verified_releases),
        "knownIncompatible": sorted(f.known_incompatible), "publishedAt": _iso(f.published_at),
    }
