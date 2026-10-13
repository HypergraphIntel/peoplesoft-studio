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
- **Phase 5 (MCP and planning): done** — six tools; the Customization
  Strategy view shows *Studio Knowledge* for the active designer's subsystem
  and the Event Mapping answer; `psft_customization_discover` includes it.
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

35 findings, 207 observations, each checked against its capture rows before recording (2026-10-13; `--expect-counters` refuses a capture whose counter steps differ). Tests re-derive every capture-backed observation and check every counter-step observation against its claim.

| Subsystem | ID | Claim | Status | Obs. |
|---|---|---|---|---|
| app-engine | f-1c1a9d9f3727c2c253ef70c9 | Changing only an App Engine program's properties moves AEM and SYS by 1, not AES | reproduced | 18 |
| app-engine | f-1df2296199d258b85b90f32f | Editing only an App Engine action's SQL text moves SRM and SYS by 1, not AEM | reproduced | 9 |
| app-engine | f-345656b01a15e8c89db1e4c5 | PeopleSoft Studio's App Engine writer reproduces App Designer's rows for 85 of 88 captured saves; the 3 others differ only in PSSQLHASH.MARKET | observed | 1 |
| app-engine | f-40babbc79f39efd83f68859c | After an App Engine section's market is re-keyed, App Designer leaves PSSQLHASH.MARKET unchanged until a later save | reproduced | 3 |
| app-engine | f-7813ad82caab6c1204716fa1 | Renaming an App Engine program tombstones the old name in PSAEAPPLDEL at the new AEM | observed | 1 |
| app-engine | f-9f82873fd798d79a6f5df946 | Editing only an App Engine action's PeopleCode moves PCM and SYS by 1 | observed | 1 |
| app-engine | f-aca484c980b5bbc3045596c1 | Changing an App Engine section, step or action moves AEM, AES and SYS by 1 | reproduced | 48 |
| app-engine | f-d3a388ee70c25792a50ca764 | Deleting an App Engine program moves AEM, AES, SRM and PCM by 2 and SYS by 1, and leaves tombstones at the final counters | observed | 1 |
| app-engine | f-d477c0ab70e48a7736224355 | Saving a new App Engine program moves AEM by 1 and stamps PSAEAPPLDEFN.VERSION with it | reproduced | 2 |
| component-interface | f-05f121f074b6a7576e29a858 | File > Rename of a Component Interface moves BCM, CLM, MPM, PCM, PJM and SYS by 1 each | observed | 1 |
| component-interface | f-7ad3b8980b1c7ae6b464ca59 | File > Delete of a Component Interface moves BCM, CLM and SYS by 1 (PCM too with PeopleCode) | observed | 1 |
| component-interface | f-cac4dc5f446f39d9dbbb8026 | Taking a standard method away from a Component Interface also moves CLM | observed | 1 |
| component-interface | f-e914dad1753456f91f7828a2 | Editing only a Component Interface's methods PeopleCode moves PCM and SYS by 1 | observed | 1 |
| component-interface | f-fedefefdb30a40a90ea77a36 | Creating a Component Interface or changing its properties, items or synchronization moves BCM and SYS by 1 | reproduced | 22 |
| event-mapping | f-5731b0851774a312b6aa05af | PTCS_ISCOMPSERVICE level codes: C Component, R Page, P Record, F Record Field (PSXLATITEM's labels mislead) | observed | 1 |
| event-mapping | f-7e8ece79e395dbb863bc93e5 | Defining a related content service moves RCSDM by 1 in PSVERSION but by 2 in PSLOCK | observed | 1 |
| event-mapping | f-ad18a114ff35fcdc4d8920ef | PeopleSoft Studio's Event Mapping writer writes what the Configure Event Mapping page writes | observed | 1 |
| event-mapping | f-e3a3f17f095c20582322485d | The fluid Configure Event Mapping page re-saves every row on Save | reproduced | 3 |
| menu | f-2485f61a61fab9e7ed10364d | File > Delete of a menu moves CLM, MDM and SYS by 1 | observed | 1 |
| menu | f-6be47b7e2ae3c56a70dc07c4 | File > Rename of a menu moves TSTM, ACM, CLM, MDM, PCM, PJM, SYS and TSM by 1 each | reproduced | 2 |
| menu | f-747bf896569263b485e2c14c | Deleting or cutting a menu item (not a separator) or bar moves CLM by 1, with MDM and SYS | reproduced | 4 |
| menu | f-e67b210fbd5513c963df1387 | A menu definition save moves MDM and SYS by 1 | reproduced | 32 |
| menu | f-ee56e64b0456e64d337abd06 | Renaming a menu item or bar moves CLM and MDM by 2, PCM by 1, SYS by 2 | reproduced | 3 |
| menu | f-fafae98d016ada8a134677e2 | Editing only a menu item's ItemSelected PeopleCode moves PCM and SYS by 1; the menu row is not touched | reproduced | 3 |
| message-channel | f-13baaf5f7d94524fb24f7c28 | A message channel save moves CHDM by 1 and SYS by 1; PSCHNLDEFN.VERSION is the new CHDM | reproduced | 14 |
| message-channel | f-63084706f407d6e694a0b917 | Deleting a message channel writes PSCHNLDEL at the new CHDM and removes its partition rows | observed | 1 |
| message-channel | f-e652e5d38577cf3f511c6456 | Renaming a message channel re-keys its rows in place and moves CHDM, MSDM, PJM and SYS by 1, references or not | reproduced | 2 |
| other | f-76b320392022a312cd7d7562 | PSADSTRACKING.PTKEYHASH is SHA-1 over UTF-16LE '( NAME = value )' text, keys sorted by name, base64 | observed | 1 |
| page-designer | f-0a2b843879abf6c142e63b3b | PSPNLFIELD.FIELDNUM stays a contiguous 1..N order: App Designer renumbers existing controls when controls are added or deleted | reproduced | 3 |
| page-designer | f-6bbfd2ebcb24e3aa8d8a3bee | An App Designer page save moves PDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSPNLDEFN.VERSION is the new PDM | reproduced | 8 |
| page-designer | f-6f34cd13c903c9cd40a06bfa | Page control Display Only is PSPNLFIELD.FIELDUSE bit 1; Invisible is bit 2 and sets SECUREINVISIBLE | observed | 1 |
| page-designer | f-a59884249af2192134fa87ee | Every page control has a PSPNLFIELDEXT row beside its PSPNLFIELD row | reproduced | 5 |
| page-designer | f-bb18f22a884a893c5c6a9e15 | A new page control takes PNLFLDID = MAXPNLFLDID + 1; MAXPNLFLDID never goes down, deleted ids are not reused | reproduced | 4 |
| page-designer | f-cd81a5c55bdbf553224e0f62 | An App Designer page save deletes and re-inserts every row of the page, changed or not | reproduced | 6 |
| project | f-74c70228d2ea52f7a76b0219 | A message channel in a project is PSPROJECTITEM OBJECTTYPE 36, OBJECTID1 61 (CHNLNAME) | observed | 1 |

## Resume: next tasks, in order

1. **Open the Discovery Center in a real VS Code window** (install the
   built VSIX): the view, a panel, the review; with the local server, one
   submission.
2. **More findings**: menus, Component Interfaces and channel properties are
   recorded. Remaining capture families: records (r*), fields, components
   (c*), page controls (eb*, cbx*, gb*, fr*, f*...) -- check each family's
   format with the adapter, select cases by operation, record with
   `--expect-counters` (DISCOVERY_PROTOCOL.md rules 7-9).
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
