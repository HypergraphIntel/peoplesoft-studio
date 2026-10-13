"""Bearer-token authentication and roles. Tokens are stored as SHA-256 hashes and never logged."""

from __future__ import annotations

import hashlib
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import ApiToken

ROLES = ("contributor", "reviewer", "admin")
_RANK = {r: i for i, r in enumerate(ROLES)}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(session: Session, role: str, contributor: str | None = None) -> str:
    """A new token for a role; the plain token is returned once and never stored."""
    if role not in ROLES:
        raise ValueError(f"role must be one of {', '.join(ROLES)}")
    token = "psfti_" + secrets.token_urlsafe(32)
    session.add(ApiToken(token_hash=hash_token(token), role=role, contributor=contributor or f"c-{uuid.uuid4().hex[:20]}"))
    session.commit()
    return token


def authenticate(session: Session, authorization: str | None) -> ApiToken | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    row = session.execute(select(ApiToken).where(ApiToken.token_hash == hash_token(token))).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    return row


def allows(token: ApiToken, role: str) -> bool:
    return _RANK[token.role] >= _RANK[role]
