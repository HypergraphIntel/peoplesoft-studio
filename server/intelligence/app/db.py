"""Persistence: SQLAlchemy 2 over PostgreSQL (SQLite for quick local tests).

Tables are created from the metadata (create_all) for the MVP; migrations
(Alembic) come with the first schema change that must keep data
(docs/intelligence/DECISIONS.md D10).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

JSONType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ApiToken(Base):
    """A bearer token, stored as its SHA-256 only. The contributor id is pseudonymous."""

    __tablename__ = "api_token"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # contributor | reviewer | admin
    contributor: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Finding(Base):
    __tablename__ = "finding"
    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    subsystem: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    object_type: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[dict] = mapped_column(JSONType, nullable=False)
    assertion: Mapped[dict] = mapped_column(JSONType, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[str] = mapped_column(String(8), nullable=False)
    known_incompatible: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    # observed | reproduced (computed); corroborated | verified | published | rejected | superseded | conflicting | withdrawn | revoked (review, later)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class Observation(Base):
    __tablename__ = "observation"
    __table_args__ = (UniqueConstraint("finding_id", "digest"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    finding_id: Mapped[str] = mapped_column(ForeignKey("finding.id"), nullable=False, index=True)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    release: Mapped[str] = mapped_column(String(16), nullable=False)
    run_key: Mapped[str] = mapped_column(String(300), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    contributor: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Audit(Base):
    """Append-only: who did what to what, and the outcome. Never a token, never payload text."""

    __tablename__ = "audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    actor: Mapped[str] = mapped_column(String(40), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    target: Mapped[str | None] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(300))


def make_engine(url: str) -> Engine:
    kwargs = {"pool_pre_ping": True} if not url.startswith("sqlite") else {"connect_args": {"check_same_thread": False}}
    return create_engine(url, **kwargs)


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False)


def create_schema(engine: Engine) -> None:
    Base.metadata.create_all(engine)
