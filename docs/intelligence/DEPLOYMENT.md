# Deployment — proposed

**Nothing is deployed.** The server MVP exists for local development (`server/intelligence/README.md`); it has never been exposed beyond localhost.

## Where the server lives

`server/intelligence/` in this repository (DECISIONS D7): its own
`pyproject.toml`, tests, a compose file for local PostgreSQL, and a CI job
that runs only when it changes (a container image comes with the deployment
review). It shares one artifact with the extension: the finding JSON Schema
generated from `src/intelligence/schema.ts`.

## Local development (implemented)

See `server/intelligence/README.md`: a venv with `pip install -e '.[dev]'`,
`docker compose up -d` (PostgreSQL 16 on `127.0.0.1:55432`), a token from
`python -m app.admin issue-token`, `uvicorn` on `127.0.0.1`. Tables are
created on start (DECISIONS D10). CI: `.github/workflows/intelligence-server.yml`
runs the suite on SQLite and PostgreSQL.

## Before anything is reachable from the Internet

A separate deployment and security review, covering at least: TLS
termination and HSTS; authentication and token issuance; rate limiting;
request size limits; backups and restore; secret management for the
database and for bundle signing (signing key offline); log redaction
(no tokens, no payload text); the retention policy (SECURITY_PRIVACY.md);
an incident and revocation runbook. Until then the server runs on
localhost or a private network only.
