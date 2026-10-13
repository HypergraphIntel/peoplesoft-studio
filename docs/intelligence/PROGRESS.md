# Progress and handoff

**Read this first when resuming the Discovery & Intelligence Network.**
Last updated 2026-10-13 (phase 5). The founding directive: `CUSTOMIZATION_INTEL_SERVER.md`
(repository root).

## Current state

- **Phase 0 (reconnaissance, architecture): done.** ARCHITECTURE.md; DECISIONS.md D1–D12.
- **Phase 1 (local discovery foundation): done.** Evidence below.
- **Phase 2 (server MVP): done, local only.** Evidence below.
- **Phase 3 (Discovery Center): done** but for a run in a real VS Code
  window. Evidence below.
- **Phase 4 (verification, distribution): done** but for a production
  signing key (none is trusted: every bundle is refused). Evidence below.
- **Phase 5 (MCP): done** — six tools; the Customization Strategy view's
  Event Mapping row and `psft_customization_discover` show the knowledge
  answer for the connection's release (live on HRDMO: UNVERIFIED on 8.62,
  three local findings). Page Designer and App Engine planning: not yet.
- **Phase 6 (development automation): started, dry run only** —
  `tools/intelligence/engineering-task.mts` writes an issue body and a
  regression fixture from a finding and prints the `gh` command; it files
  nothing. First fixture: `src/test/discovery-f-e3a3f17f095c20582322485d.test.ts`.
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

## Phase 4 evidence

| Criterion | Evidence |
|---|---|
| Verification workflow | `app/review.py` (pure tests: independence, criteria, releases, roles, illegal moves); `POST /reviews` (workflow test) |
| Evidence provenance | Reviews stored with reviewer, criteria, rationale, releases; audit |
| Version-specific compatibility | `verifiedReleases` ⊆ observed releases; `GET /knowledge/compatibility?release=` |
| Reviewed publication | admin-only publish / revoke (403 for a reviewer, tested) |
| Signed bundles | `app/bundle.py`, `generate-key` (0600), `build-bundle`; tampered bundle fails (Python and TS tests) |
| Client verification | `src/intelligence/knowledge.ts`: verifies the Python-signed `contract/bundle-vector.json`; refuses tampering, untrusted keys, expiry, rollback, unknown fields |
| Controlled synchronization | `knowledgeSync` off/manual; live: server published bundle 1 for a real finding, the bundled extension downloaded and refused it (untrusted key), nothing installed |
| Revocation and rollback | Revoked ids carried in the next bundle (test); versions must increase |
| Withdrawal | `DELETE /contributors/me` (test: observations gone, finding withdrawn, token revoked) |
| Tests | pytest 44 on PostgreSQL, 43 + 1 skipped on SQLite; `npm test` intelligence 12 |

## Phase 5 evidence

| Criterion | Evidence |
|---|---|
| Verified knowledge lookup | `psft_knowledge_capability` over the installed verified bundle + local findings |
| Capability confidence reporting | Five answers, D18; test with the server-signed bundle: VERIFIED on 8.62.09 and 8.62, UNVERIFIED on 8.60 and with local findings only, CONFLICTING, UNSUPPORTED, UNKNOWN, revocation |
| Version-scoped | The connection's PSSTATUS.TOOLSREL (`releaseFrom`), or a given release |
| Evidence and provenance | `psft_knowledge_evidence`, `psft_knowledge_compatibility` |
| Gates unchanged | Answers carry no permission (tested); no tool touches a writer; recording needs MCP writes on and the user's approval |

**Not verified:** the MCP tools from a real MCP client; the Discovery Center and *Show Discoveries* in a real VS Code window; the
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
| `src/intelligence/{knowledge,trustedKeys}.ts` | Bundle verification, `KnowledgeStore`; trusted keys (none yet) |
| `server/intelligence/app/{review,bundle}.py` | Review rules; bundle build, sign, verify |
| `src/intelligence/capability.ts`, `src/mcp/discoveryTools.ts` | Capability answers; the six MCP tools |
| `server/intelligence/contract/bundle-vector.json` | A server-signed bundle the extension must verify (test key, private half discarded) |
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
| f-ad18a114ff35fcdc4d8920ef | Studio's Event Mapping writer writes what the page writes (roundtrip, live e2e) | observed |

## Resume: next tasks, in order

1. **Open the Discovery Center in a real VS Code window** (install the
   built VSIX): the view, a panel, the review; with the local server, one
   submission.
2. **Page Designer and App Engine planning consult knowledge** (as the
   customization view does): record the page-save and App Engine rules
   already proven in `docs/PAGE_SAVE.md` / `docs/APP_ENGINE*.md` as findings
   with their capture evidence first — only where the evidence is in hand.
3. Adapters for the controlled compile lab and writer replay tests.
4. Filing issues / preparing pull requests from CI: the owner's decision
   and a least-privilege token.
5. Owner decisions: the production signing key (generate offline, add to
   `trustedKeys.ts` in a release); the retention policy (SECURITY_PRIVACY.md)
   before uploads are used outside this project.

Phase 6 commands: `npx tsx tools/intelligence/engineering-task.mts <id> [--write-fixture]`.

**Do not repeat:** reconnaissance; recording the 4 findings; the contract
export (regenerate only after a schema change); the phase 3 bundle-driven
verification (scripted in this session, not kept: redo it in a real window).

**Blockers:** none. Exposure beyond localhost needs the DEPLOYMENT.md review.
