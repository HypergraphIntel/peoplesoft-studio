# Implementation roadmap

Each phase ends with its acceptance criteria met and evidence recorded in
PROGRESS.md. Phases run in order; later phases may be re-planned when an
earlier one teaches something (record it in DECISIONS.md).

## Phase 0 — Reconnaissance and architecture — DONE (2026-10-12)

- [x] Existing extension, MCP, research storage, database access, tests,
      build and settings conventions inspected (ARCHITECTURE.md, "What
      already exists").
- [x] Trust boundaries and reusable components identified.
- [x] Architecture, decisions, schema, protocol, verification, registry,
      MCP, security, deployment documents written.

## Phase 1 — Local discovery foundation — DONE (2026-10-12)

- [x] Typed, versioned schema (`psft-finding/1`), strict allowlist.
- [x] Local persistent store (files, atomic writes), across restarts.
- [x] Deterministic fingerprints; IDs from them.
- [x] Create (`record`), list (filters), get, remove (withdraw).
- [x] Duplicates (`duplicate`, nothing written) and merges (`merged`).
- [x] Basic privacy classification and the deny-by-default scan.
- [x] Research hook: `tools/intelligence/discovery.mts`; save-capture adapter.
- [x] Extension: the installation's store; *Show Local Discoveries*.
- [x] Unit tests (`src/test/intelligence.test.ts`); offline by construction (tested).
- [x] First research findings recorded from captures with evidence.

## Phase 2 — Intelligence server MVP — DONE (2026-10-13)

- [x] Contract exported (`tools/intelligence/export-contract.mts`), drift-tested in TS; vectors reproduced byte for byte in Python.
- [x] `server/intelligence/`: FastAPI, SQLAlchemy 2 / psycopg 3, PostgreSQL 16 via compose (localhost).
- [x] `POST /findings` (schema + privacy re-checked; created / merged / duplicate as the local store), `GET /findings/{id}`, `GET /discoveries/pending` (reviewer, keyset pages), `GET /health`, OpenAPI at `/docs`.
- [x] Tokens hashed, roles contributor / reviewer / admin, admin CLI; audit table; 256 KB and 120/min limits; problem+json errors without values.
- [x] pytest: 39 on PostgreSQL (incl. 12-way concurrent submission), 38 + 1 skipped on SQLite; CI workflow.
- [x] Run locally: this repository's 4 findings submitted, same IDs and statuses as the local store.
- Deferred: `POST /validation-results`, contributor withdrawal, reviews (phase 4); Alembic (D10); a shared rate limiter; a container image.

Acceptance: `server/intelligence/` runs locally (compose); `POST
/findings` validates against the exported JSON Schema, re-runs the privacy
rules, and answers `created` / `merged` / `duplicate` exactly as the local
store does for the same input (shared test vectors); contributor and
reviewer tokens are separate; every write is audited; API tests pass;
OpenAPI published at `/docs`; no public deployment.

Tasks: export JSON Schema from zod (`z.toJSONSchema`) into
`server/intelligence/schema/`; shared fingerprint test vectors (TS ↔
Python); FastAPI app, PostgreSQL migrations, token auth, audit table;
pytest suite; compose file.

## Phase 3 — VS Code Discovery Center — DONE (2026-10-13), but for a run in a real VS Code window

- [x] *Discoveries* view (PeopleSoft container): submissions status with every reason, this installation's findings, the workspace's research store.
- [x] Finding panel: claim, facts, evidence (deltas, tests, references), submission history.
- [x] Submission review: the exact payloads (one per observation), what was removed and why, what blocks it, where it would go; *Share lab provenance* opt-in.
- [x] Gates (D13): machine policy file (fails closed), VS Code telemetry, `peoplesoft.intelligence.uploadMode` (off | manual), HTTPS `serverUrl`; approval modal per submission; token in SecretStorage (*Set / Clear Discovery Server Token*).
- [x] Upload client (`src/intelligenceClient.ts`): timeout, no redirects, errors without values or tokens; history in `submissions.jsonl` without payloads or tokens.
- [x] *Record Discovery from JSON* (manual creation); *Show Discoveries* quick pick.
- [x] Verified through the bundled extension against the local server: off → review only; declined → nothing sent; approved → 3 requests created/merged/merged; telemetry off → blocked.
- [ ] A run in a real VS Code window.

Acceptance: a Discovery view in the PeopleSoft container (overview,
details, history) built on the existing tree/webview conventions; a
submission review showing the exact payload and redactions; uploads off by
default and impossible without review (or an administrator policy);
token in SecretStorage; offline and failed uploads never block Studio;
VS Code telemetry off disables submission.

## Phase 4 — Verification and knowledge distribution — DONE (2026-10-13), but for a production signing key

- [x] Reviews (`POST /api/v1/reviews`, `app/review.py`, D15): status machine, independence for corroboration, criteria and observed releases for verification, admin publication and revocation, review rows, audit.
- [x] Contributor withdrawal (`DELETE /api/v1/contributors/me`): observations deleted, findings re-statused or withdrawn, tokens revoked.
- [x] Knowledge endpoints: `/knowledge/latest`, `/versions`, `/compatibility?release=`.
- [x] Signed bundles (D16): offline key (`generate-key`, 0600), `build-bundle`, Ed25519 over canonical JSON; cross-language vector.
- [x] Client verification and install (`src/intelligence/knowledge.ts`): schema, trusted key, signature, expiry, rollback; stored apart from findings; re-verified on read.
- [x] Controlled sync (D17): `knowledgeSync` off | manual; *Check for Knowledge Updates*; *Install Knowledge Bundle from File…*; Discoveries view shows the installed knowledge.
- [x] Verified: server lifecycle on a real finding (corroborated → verified → published → bundle 1); the bundled extension downloaded it and refused it (untrusted key), installing nothing.
- [ ] A production signing key (the owner's decision, generated offline) and its release.
- Deferred: `POST /validation-results` (submissions to `POST /findings` carry test results already).

Acceptance: registry review workflow (statuses, criteria, rationale,
audit); signed Ed25519 bundles with expiry, rollback protection and
revocation; the client verifies before use and stores bundles apart from
local findings; bundles are declarative and cannot change gates.

## Phase 5 — MCP knowledge integration

Acceptance: `psft_discovery_*` and `psft_knowledge_*` tools
(MCP_INTEGRATION.md) answering VERIFIED / UNVERIFIED / UNSUPPORTED /
UNKNOWN / CONFLICTING with provenance and the connection's release;
existing write gates unchanged (tests prove a verified finding does not
open a gate); customization planning, Page Designer and App Engine planning
consult it.

## Phase 6 — Development automation

Acceptance: verified findings generate GitHub issues and regression
fixtures through the existing workflow with least privilege; pull requests
are prepared for human review, never merged, published or deployed
automatically.

## Adapters (any phase)

Lab e2e results, the controlled compile lab, writer replay tests, the
corpus harness (derived facts only) — DISCOVERY_PROTOCOL.md "Adapters".
