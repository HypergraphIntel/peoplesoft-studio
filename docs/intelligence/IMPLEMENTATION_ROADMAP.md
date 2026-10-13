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

## Phase 2 — Intelligence server MVP

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

## Phase 3 — VS Code Discovery Center

Acceptance: a Discovery view in the PeopleSoft container (overview,
details, history) built on the existing tree/webview conventions; a
submission review showing the exact payload and redactions; uploads off by
default and impossible without review (or an administrator policy);
token in SecretStorage; offline and failed uploads never block Studio;
VS Code telemetry off disables submission.

## Phase 4 — Verification and knowledge distribution

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
