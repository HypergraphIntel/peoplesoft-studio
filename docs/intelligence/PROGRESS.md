# Progress and handoff

**Read this first when resuming the Discovery & Intelligence Network.**
Last updated 2026-10-12. The founding directive: `CUSTOMIZATION_INTEL_SERVER.md`
(repository root).

## Current state

- **Phase 0 (reconnaissance, architecture): done.** ARCHITECTURE.md records
  what exists; DECISIONS.md D1–D9.
- **Phase 1 (local discovery foundation): done.** Definition of done below,
  each with its evidence.
- **Phases 2–6: not started.** Everything in KNOWLEDGE_REGISTRY.md,
  MCP_INTEGRATION.md, DEPLOYMENT.md and the server parts of
  SECURITY_PRIVACY.md is design only.
- **Nothing is uploaded, synchronized or networked.** No settings exist for it.

## Phase 1 definition of done

| Criterion | Evidence |
|---|---|
| A discovery can be created through a supported local API | `DiscoveryStore.record()`; `tools/intelligence/discovery.mts record/capture` — used to record the 4 findings in `tools/intelligence/store` |
| Its schema is validated | `src/intelligence/schema.ts` (strict zod); test "the schema is an allowlist…" |
| It receives a deterministic fingerprint | `fingerprint.ts`; test "the fingerprint is the claim…" |
| It persists across extension restarts | File store; test "…persisted across a restart" (new store instance on the same directory); the bundled extension's command read a store in its global storage (stub `vscode`, 2026-10-12) |
| Duplicates are handled predictably | `created` / `merged` / `duplicate`; tests; the CLI reported `duplicate` re-recording em04 |
| Findings can be listed and retrieved | `list()` with filters, `get()`; tests; CLI `list`, `get` |
| Private or unsupported fields are rejected | Strict schema + privacy scan; tests (unknown keys at each level, URLs, e-mail, paths, IPs, connect strings, hosts, credentials, tokens; values never echoed) |
| Findings retain PeopleTools version and evidence metadata | `environment.peopleToolsRelease` required; `compatibility.observedReleases`; evidence refs; adapter test on em04 (8.62.09) |
| Works without network connectivity | No network module (test enforces); files only |
| Automated tests cover the core | `src/test/intelligence.test.ts` — 8 tests, all pass |
| Documentation reflects implementation | This directory; README.md status table |
| Existing functionality operational | `npm test` 1636 tests, 1635 pass, 0 fail, 1 skipped (a pre-existing encoder TODO); `npm run smoke` activates 59 commands |

**Not verified:** *Show Local Discoveries* inside a real VS Code window
(only against the bundled extension with the smoke stub); concurrent
writers on one store across processes (documented limit, D1).

## Architecture in one paragraph

`src/intelligence/` (no `vscode`, no network) holds the schema
`psft-finding/1`, fingerprints (identity = the structured assertion), the
privacy scan, the file store and the save-capture adapter. Research
harnesses record into `tools/intelligence/store` (committed) through
`tools/intelligence/discovery.mts`; each installation has its own store in
`<globalStorage>/intelligence` (`src/intelligenceCommands.ts`). The server,
registry, Discovery Center, bundles and MCP tools are proposed.

## Key files

| File | Role |
|---|---|
| `src/intelligence/schema.ts` | Schema, enums, `Finding` type |
| `src/intelligence/fingerprint.ts` | `canonicalJson`, `findingFingerprint`, `findingId`, `observationDigest` |
| `src/intelligence/privacy.ts` | `scanFinding`, `classify`, `PrivacyRejectedError` |
| `src/intelligence/store.ts` | `DiscoveryStore` (`open`, `record`, `get`, `list`, `remove`) |
| `src/intelligence/adapters/saveCapture.ts` | `sanitizedDeltaOf`, `observationFromCapture`, `BACKGROUND_TABLES` |
| `src/intelligence/index.ts` | Public exports |
| `src/intelligenceCommands.ts` | Extension store; `psft.intelligence.showDiscoveries` |
| `tools/intelligence/discovery.mts` | CLI: `record`, `capture`, `list`, `get` |
| `tools/intelligence/store/` | The repository's research findings (commit them) |
| `src/test/intelligence.test.ts` | Tests |

Commands: `npm run typecheck`; `npx tsc -p . && node --test dist-test/test/intelligence.test.js`;
`npm test`; `npm run compile && npm run smoke`.
Dependencies: none new (zod v4 was already a runtime dependency).

## Recorded findings (tools/intelligence/store)

| ID | Claim | Status |
|---|---|---|
| f-e3a3f17f095c20582322485d | Fluid Configure Event Mapping re-saves every row (em04, em05, em06) | reproduced |
| f-76b320392022a312cd7d7562 | PSADSTRACKING.PTKEYHASH algorithm | observed |
| f-5731b0851774a312b6aa05af | PTCS_ISCOMPSERVICE level codes vs PSXLATITEM labels | observed |
| f-7e8ece79e395dbb863bc93e5 | Defining a service: RCSDM +1 PSVERSION, +2 PSLOCK (em01) | observed |

## Resume: next tasks, in order

1. **Phase 2 start**: export the finding JSON Schema from zod
   (`z.toJSONSchema(findingInput)`) to `server/intelligence/schema/` with a
   test that fails when it drifts; write shared fingerprint test vectors
   (input → fingerprint, observation → digest) that the Python server must
   reproduce.
2. Scaffold `server/intelligence/` (FastAPI, PostgreSQL via compose,
   Alembic, pytest) per DEPLOYMENT.md; implement `POST /findings` with the
   same outcomes as the local store, `GET /findings/{id}`, contributor and
   reviewer tokens, audit table. Localhost only.
3. A lab-e2e adapter (`testResults` from `tools/lab/*-e2e.mts` PASS/FAIL
   lines) — the next research source after save captures.
4. Settle the retention policy (SECURITY_PRIVACY.md) with the owner before
   any submission feature.

**Do not repeat:** the reconnaissance (ARCHITECTURE.md has it); recording
the four findings above (re-recording reports `duplicate`, harmless).

**Blockers:** none for phase 2. A public deployment needs the separate
review in DEPLOYMENT.md.
