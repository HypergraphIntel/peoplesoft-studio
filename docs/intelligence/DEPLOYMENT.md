# Deployment — proposed

**Nothing is deployed.** No server code exists yet (phase 2).

## Where the server lives

`server/intelligence/` in this repository (DECISIONS D7): its own
`pyproject.toml`, `Dockerfile`, tests, and a CI job that runs only when it
changes. It shares one artifact with the extension: the finding JSON Schema
generated from `src/intelligence/schema.ts`.

## Local development (phase 2 target)

```bash
cd server/intelligence
docker compose up -d postgres           # PostgreSQL 16, local only
uv run alembic upgrade head             # schema migrations
uv run uvicorn app.main:app --reload    # http://127.0.0.1:8000, /docs for OpenAPI
uv run pytest
```

Docker and PostgreSQL client tools are present on the development machine
(checked 2026-10-12); FastAPI is not installed system-wide — the server
pins its own environment.

## Before anything is reachable from the Internet

A separate deployment and security review, covering at least: TLS
termination and HSTS; authentication and token issuance; rate limiting;
request size limits; backups and restore; secret management for the
database and for bundle signing (signing key offline); log redaction
(no tokens, no payload text); the retention policy (SECURITY_PRIVACY.md);
an incident and revocation runbook. Until then the server runs on
localhost or a private network only.
