# Progress and handoff

**Read this first when resuming the Discovery & Intelligence Network.**
Last updated 2026-10-13 (phase 3). The founding directive: `CUSTOMIZATION_INTEL_SERVER.md`
(repository root).

## Current state

- **Phase 0 (reconnaissance, architecture): done.** ARCHITECTURE.md; DECISIONS.md D1–D12.
- **Phase 1 (local discovery foundation): done.** Evidence below.
- **Phase 2 (server MVP): done, local only.** Evidence below.
- **Phase 3 (Discovery Center): done** but for a run in a real VS Code
  window. Evidence below.
- **Phases 4–6: not started.** Verification workflow, signed bundles, MCP
  tools, GitHub automation are design only.
- **Nothing leaves by default.** Submissions need four gates (D13) and the
  user's approval of the exact payloads. The server has run only on localhost.

## Phase 1 evidence

| Criterion | Evidence |
|---|---|
| Created through a supported local API | `DiscoveryStore.record()`; `tools/intelligence/discovery.mts` — 4 findings in `tools/intelligence/store` |
| Schema validated | Strict zod schema; tests |
| Deterministic fingerprint | `fingerprint.ts`; tests; the Python server computes the same (vectors) |
| Persists across restarts | File store; restart test; the bundled extension's command read a store (stub `vscode`) |
| Duplicates predictable | `created` / `merged` / `duplicate`; tests; CLI |
| Listed and retrieved | `list()` / `get()`; tests; CLI |
| Private / unsupported fields rejected | Strict schema + privacy scan; tests (values never echoed) |
| PeopleTools version and evidence kept | Required release; compatibility; evidence refs; adapter test on em04 |
| Offline | No network module (tested) |
| Tests | `src/test/intelligence.test.ts` — 11 tests (incl. contract drift, submission preview, upload gates) |
| Existing functionality | `npm test`: 1639 tests, 1638 pass, 0 fail, 1 pre-existing skip; smoke 64 commands, 8 views |

## Phase 2 evidence

| Criterion | Evidence |
|---|---|
| Standalone FastAPI service | `server/intelligence/app/` (FastAPI 0.143, SQLAlchemy 2.1, psycopg 3.3, jsonschema 4.26) |
| PostgreSQL persistence | `compose.yaml` (PostgreSQL 16, 127.0.0.1:55432); JSONB columns |
| Authenticated submissions | Bearer tokens (hashed), roles; 401/403 tests |
| Retrieval | `GET /findings/{id}`; evidence visibility per D12 |
| Duplicate detection | Same outcomes as the local store; vector IDs; concurrency test (1 created, 11 merged) |
| Basic verification states | observed / reproduced computed; others reserved for review |
| API tests | `pytest`: 39 pass on PostgreSQL; 38 pass + 1 skipped (concurrency) on SQLite |
| Local deployment configuration | compose + README; run with uvicorn on localhost: the 4 repository findings got the local IDs and statuses |
| Security / deployment docs | DEPLOYMENT.md (review required before exposure), SECURITY_PRIVACY.md |

## Phase 3 evidence

| Criterion | Evidence |
|---|---|
| Discovery navigation | *Discoveries* view: status row, This Installation, Workspace Research (tree read through the bundle: 4 + 4 findings) |
| Finding details | Panel: claim, facts, evidence (deltas, tests, refs), history |
| Submission preview / privacy review | `previewSubmission()` (test); panel shows exact payloads (3 for f-e3a3…), 6 removals with reasons, blocking problems |
| Opt-in controls, policy enforced | `decideUpload()` (test: every gate, every reason); settings application-scoped; machine policy file fails closed |
| Server connectivity, upload results | `src/intelligenceClient.ts`; bundled extension → local server: declined = nothing sent; approved = created, merged, merged; server shows reproduced, no experiment IDs |
| Graceful offline / failures | Failures reported and recorded, never thrown out of the panel; nothing retries silently |
| Secrets | Token in SecretStorage; history and audit never contain it (checked) |

**Not verified:** the Discovery Center and *Show Discoveries* in a real VS Code window; the
CI workflow has not run on GitHub (nothing pushed); concurrent writers on
one *local* store across processes (documented limit, D1); the server under
load or behind TLS.

## Key files

| File | Role |
|---|---|
| `src/intelligence/{schema,fingerprint,privacy,store,contract,index}.ts`, `adapters/saveCapture.ts` | Local engine |
| `src/intelligenceCommands.ts` | Extension store; commands (open, show, record from JSON, token) |
| `src/views/discoveryView.ts` | *Discoveries* tree, finding panel, submission review, `currentUploadDecision()` |
| `src/intelligenceClient.ts` | Upload client (fetch; no tokens in errors) |
| `src/intelligence/{submission,policy}.ts` | `previewSubmission()`, `decideUpload()` (pure) |
| `tools/intelligence/discovery.mts` | CLI: record, capture, list, get |
| `tools/intelligence/export-contract.mts` | Writes `server/intelligence/contract/` |
| `tools/intelligence/store/` | The repository's research findings (commit them) |
| `server/intelligence/app/{main,canonical,privacy,contract,db,auth,admin}.py` | Server |
| `server/intelligence/tests/` | Contract, privacy, API tests |
| `.github/workflows/intelligence-server.yml` | Server CI (SQLite + PostgreSQL) |

Commands: `npm run typecheck`; `npm test`; `npm run compile && npm run smoke`;
`npx tsx tools/intelligence/export-contract.mts` after changing the schema or
fingerprint; server: see `server/intelligence/README.md`.

## Recorded findings (tools/intelligence/store)

| ID | Claim | Status |
|---|---|---|
| f-e3a3f17f095c20582322485d | Fluid Configure Event Mapping re-saves every row (em04, em05, em06) | reproduced |
| f-76b320392022a312cd7d7562 | PSADSTRACKING.PTKEYHASH algorithm | observed |
| f-5731b0851774a312b6aa05af | PTCS_ISCOMPSERVICE level codes vs PSXLATITEM labels | observed |
| f-7e8ece79e395dbb863bc93e5 | Defining a service: RCSDM +1 PSVERSION, +2 PSLOCK (em01) | observed |

## Resume: next tasks, in order

1. **Open the Discovery Center in a real VS Code window** (install the
   built VSIX): the view, a panel, the review; with the local server, one
   submission.
2. **Phase 4 start — reviews on the server**: `POST /reviews` (reviewer):
   status changes with criteria and rationale, independence check for
   *corroborated* (different method, experiment or contributor — never a
   re-run), audit; `POST /validation-results`; contributor withdrawal.
3. **Signed bundles** (Ed25519): bundle format, offline signing tool,
   client verification (signature, expiry, rollback), stored apart from
   local findings.
4. A lab-e2e adapter (`testResults` from `tools/lab/*-e2e.mts`).
5. Settle the retention policy (SECURITY_PRIVACY.md) with the owner before
   uploads are used by anyone outside this project.

**Do not repeat:** reconnaissance; recording the 4 findings; the contract
export (regenerate only after a schema change); the phase 3 bundle-driven
verification (scripted in this session, not kept: redo it in a real window).

**Blockers:** none. Exposure beyond localhost needs the DEPLOYMENT.md review.
