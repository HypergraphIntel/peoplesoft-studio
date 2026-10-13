"""The Discovery & Intelligence Network server, MVP (docs/intelligence/KNOWLEDGE_REGISTRY.md).

Local development only: no public deployment without the review in DEPLOYMENT.md.

  POST /api/v1/findings            contributor  submit one finding + one observation: created | merged | duplicate
  GET  /api/v1/findings/{id}       contributor  a finding; others' evidence summarized, the caller's in full
  GET  /api/v1/discoveries/pending reviewer     findings awaiting review (observed, reproduced), keyset-paginated
  GET  /api/v1/health              public
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import auth, contract
from .canonical import finding_fingerprint, finding_id, observation_digest
from .db import Audit, Finding, Observation, create_schema, make_engine, make_sessionmaker, utcnow
from .privacy import classify, scan_finding

API = "/api/v1"
CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}
COMPUTED_STATUSES = ("observed", "reproduced")


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("PSFT_INTEL_DATABASE_URL", "sqlite:///./psft-intel.db"))
    max_body_bytes: int = 256 * 1024
    rate_per_minute: int = 120


def problem(status: int, title: str, detail: str | None = None, **extra: Any) -> JSONResponse:
    body = {"type": "about:blank", "title": title, "status": status, **({"detail": detail} if detail else {}), **extra}
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


class RateLimiter:
    """Per-actor sliding window, in memory (one process; a shared limiter comes with scaling out)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, actor: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[actor]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            return True


def _iso(d: datetime) -> str:
    return d.isoformat().replace("+00:00", "Z")


def finding_view(session: Session, f: Finding, viewer: auth.ApiToken) -> dict:
    observations = session.execute(select(Observation).where(Observation.finding_id == f.id).order_by(Observation.id)).scalars().all()
    full = auth.allows(viewer, "reviewer")
    views = []
    for o in observations:
        mine = o.contributor == viewer.contributor
        if full or mine:
            views.append({**o.payload, "digest": o.digest, "receivedAt": _iso(o.received_at), "yours": mine})
        else:
            # Another contributor's evidence: what it is, not where it came from.
            views.append({"method": o.method, "release": o.release, "digest": o.digest, "receivedAt": _iso(o.received_at), "yours": False})
    return {
        "schema": contract.SCHEMA_ID, "id": f.id, "fingerprint": f.fingerprint, "type": f.type, "subject": f.subject, "assertion": f.assertion,
        "title": f.title, "statement": f.statement, "confidence": f.confidence, "status": f.status,
        "compatibility": {"observedReleases": sorted({o.release for o in observations}), "knownIncompatible": f.known_incompatible},
        "privacy": {"classification": classify([o.payload for o in observations])},
        "observations": views, "createdAt": _iso(f.created_at), "updatedAt": _iso(f.updated_at),
    }


def record(session: Session, value: dict, token: auth.ApiToken) -> tuple[str, Finding]:
    """created | merged | duplicate, as the local store decides (src/intelligence/store.ts)."""
    fingerprint = finding_fingerprint(value)
    fid = finding_id(fingerprint)
    obs = value["observation"]
    digest = observation_digest(obs)
    run_key = f"{obs.get('experimentId', '')}|{obs['runId']}" if obs.get("runId") else digest
    now = utcnow()
    for attempt in (1, 2):
        f = session.execute(select(Finding).where(Finding.id == fid).with_for_update()).scalar_one_or_none()
        if f is None:
            f = Finding(id=fid, fingerprint=fingerprint, type=value["type"], subsystem=value["subject"]["subsystem"],
                        object_type=value["subject"]["objectType"], subject=value["subject"], assertion=value["assertion"],
                        title=value["title"], statement=value["statement"], confidence=value["confidence"],
                        known_incompatible=sorted(set(value.get("knownIncompatible", []))), status="observed", created_at=now, updated_at=now)
            session.add(f)
            session.add(Observation(finding_id=fid, digest=digest, method=obs["method"], release=obs["environment"]["peopleToolsRelease"],
                                    run_key=run_key, payload=obs, source=value["source"], contributor=token.contributor, received_at=now))
            try:
                session.commit()
                return "created", f
            except IntegrityError:
                session.rollback()  # created by a concurrent request: merge into it
                if attempt == 2:
                    raise
                continue
        if f.fingerprint != fingerprint:
            raise RuntimeError(f"{fid} holds another finding")
        dup = session.execute(select(Observation.id).where(and_(Observation.finding_id == fid, Observation.digest == digest))).first()
        if dup:
            session.rollback()
            return "duplicate", f
        session.add(Observation(finding_id=fid, digest=digest, method=obs["method"], release=obs["environment"]["peopleToolsRelease"],
                                run_key=run_key, payload=obs, source=value["source"], contributor=token.contributor, received_at=now))
        session.flush()
        runs = session.execute(select(func.count(func.distinct(Observation.run_key))).where(Observation.finding_id == fid)).scalar_one()
        if f.status in COMPUTED_STATUSES:
            f.status = "reproduced" if runs >= 2 else "observed"
        if CONFIDENCE_RANK[value["confidence"]] > CONFIDENCE_RANK[f.confidence]:
            f.confidence = value["confidence"]
        f.known_incompatible = sorted(set(f.known_incompatible) | set(value.get("knownIncompatible", [])))
        f.updated_at = now
        session.commit()
        return "merged", f
    raise RuntimeError("unreachable")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    create_schema(engine)
    Sessions = make_sessionmaker(engine)
    limiter = RateLimiter(settings.rate_per_minute)
    app = FastAPI(title="PeopleSoft Studio Intelligence Server", version="0.1.0", docs_url="/docs", redoc_url=None)
    app.state.sessions = Sessions
    app.state.engine = engine

    def audit(session: Session, actor: str, action: str, target: str | None, outcome: str, detail: str | None = None) -> None:
        session.add(Audit(actor=actor, action=action, target=target, outcome=outcome, detail=detail))
        session.commit()

    @app.middleware("http")
    async def limits(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_body_bytes:
            return problem(413, "Request too large", f"At most {settings.max_body_bytes} bytes.")
        if request.method in ("POST", "PUT", "PATCH"):
            body = await request.body()
            if len(body) > settings.max_body_bytes:
                return problem(413, "Request too large", f"At most {settings.max_body_bytes} bytes.")
        return await call_next(request)

    def authorize(request: Request, session: Session, role: str) -> tuple[auth.ApiToken | None, JSONResponse | None]:
        token = auth.authenticate(session, request.headers.get("authorization"))
        if token is None:
            return None, problem(401, "Unauthorized", "A valid bearer token is required.")
        if not auth.allows(token, role):
            audit(session, token.contributor, f"{request.method} {request.url.path}", None, "forbidden")
            return None, problem(403, "Forbidden", f"This needs the {role} role.")
        if not limiter.allow(token.contributor):
            return None, problem(429, "Too many requests", headers=None)
        return token, None

    @app.get(f"{API}/health")
    def health() -> dict:
        return {"status": "ok", "schema": contract.SCHEMA_ID}

    @app.post(f"{API}/findings")
    async def submit(request: Request):
        with Sessions() as session:
            token, refusal = authorize(request, session, "contributor")
            if refusal:
                return refusal
            assert token is not None
            schema_header = request.headers.get("psft-finding-schema")
            if schema_header and schema_header != contract.SCHEMA_ID:
                audit(session, token.contributor, "submit", None, "unsupported-schema")
                return problem(415, "Unsupported finding schema", f"This server accepts {contract.SCHEMA_ID}.")
            try:
                raw = await request.json()
            except Exception:
                audit(session, token.contributor, "submit", None, "malformed")
                return problem(400, "Malformed JSON")
            value, issues = contract.validate(raw)
            if issues:
                audit(session, token.contributor, "submit", None, "invalid", f"{len(issues)} issue(s)")
                return problem(422, "The finding does not match the schema", issues=issues[:50])
            assert value is not None
            violations = scan_finding(value)
            if violations:
                audit(session, token.contributor, "submit", None, "privacy-refused", ", ".join(sorted({v["rule"] for v in violations}))[:300])
                return problem(422, "The finding was refused by the privacy rules", violations=violations[:50])
            outcome, f = record(session, value, token)
            audit(session, token.contributor, "submit", f.id, outcome)
            return JSONResponse({"outcome": outcome, "finding": finding_view(session, f, token)}, status_code=201 if outcome == "created" else 200)

    @app.get(f"{API}/findings/{{fid}}")
    def get_finding(fid: str, request: Request):
        with Sessions() as session:
            token, refusal = authorize(request, session, "contributor")
            if refusal:
                return refusal
            f = session.get(Finding, fid) if len(fid) == 26 and fid.startswith("f-") else None
            if f is None:
                return problem(404, "Not found")
            return finding_view(session, f, token)

    @app.get(f"{API}/discoveries/pending")
    def pending(request: Request, limit: int = 50, cursor: str | None = None):
        with Sessions() as session:
            token, refusal = authorize(request, session, "reviewer")
            if refusal:
                return refusal
            limit = max(1, min(limit, 100))
            q = select(Finding).where(Finding.status.in_(COMPUTED_STATUSES))
            if cursor:
                try:
                    at, _, last = cursor.partition("|")
                    after = datetime.fromisoformat(at.replace("Z", "+00:00"))
                except ValueError:
                    return problem(400, "Bad cursor")
                q = q.where(or_(Finding.updated_at > after, and_(Finding.updated_at == after, Finding.id > last)))
            rows = session.execute(q.order_by(Finding.updated_at, Finding.id).limit(limit + 1)).scalars().all()
            page = rows[:limit]
            nxt = f"{_iso(page[-1].updated_at)}|{page[-1].id}" if len(rows) > limit else None
            audit(session, token.contributor, "list-pending", None, "ok", f"{len(page)} finding(s)")
            return {"items": [{"id": f.id, "type": f.type, "subsystem": f.subsystem, "title": f.title, "status": f.status, "confidence": f.confidence,
                               "updatedAt": _iso(f.updated_at)} for f in page], "next": nxt}

    return app


app = create_app() if os.environ.get("PSFT_INTEL_AUTOSTART") == "1" else None
