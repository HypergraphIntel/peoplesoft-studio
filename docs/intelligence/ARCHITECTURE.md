# Architecture

Status words used throughout: **existing** (in PeopleSoft Studio before this
initiative), **implemented** (built for it, with tests), **verified**
(implemented and proven beyond unit tests), **proposed** (designed, not
built).

## What already exists (phase 0 reconnaissance, 2026-10-12)

| Component | Where | Relevance |
|---|---|---|
| Extension | `src/extension.ts`, VS Code API ^1.90, esbuild bundle `dist/extension.js` | Hosts the Discovery Center (phase 3) |
| Providers | `src/providers/` — `DatabaseProvider` (Oracle, SQL Server, DB2 via `src/db/`), project-export provider | Version detection: `readRelease()` (PSRELEASE label, PSSTATUS TOOLSREL) in `ownershipReader.ts` |
| Pure models | `src/model/` — no `vscode`, tested with `node:test` (`src/test/*.test.ts` → `dist-test/`) | The engine follows the same pattern |
| Local state | `context.globalStorageUri` files: customization audit log (JSONL), delivered baselines (gzip JSON) | The local store follows suit (D1) |
| MCP server | `src/mcp/` — `@modelcontextprotocol/server`, tools `psft_*`, zod v4 schemas, write gates (`writeTools.ts`: Writable connection, Operator ID, write scope, per-write approval), agent origin tagging (`agentOrigin.ts`) | Knowledge tools (phase 5) register here, read only |
| Save captures | `tools/corpus/save-protocol/snapshot.ts` → `results/<case>/{before,after,delta}.json` (978 cases), format `save-protocol-delta/1` with the PeopleTools release | The first adapter (implemented) |
| Lab end-to-end proofs | `tools/lab/*-e2e.mts` (channel, menu, CI, AE, customization, event mapping) | Candidate adapters: their PASS/FAIL checks are test results |
| Controlled compile lab | `tools/corpus/controlled-compile/`, `docs/CONTROLLED_COMPILE_LAB.md` | Candidate adapter: compile differences |
| PeopleCode corpus harness | `tools/corpus/` (`npm run corpus:harness`), `hcdev-snapshot.sqlite`, `corpus-results.sqlite` | Candidate adapter: encoder/decoder findings — institutional data, so only derived technical facts may leave |
| Research ledgers | `docs/*.md` (rules with capture IDs in brackets), memory files, `.claude/corpus-progress.md` | Historical findings, imported only with evidence |
| Settings | `peoplesoft.*` (connections, mcp, customization, build) | `peoplesoft.intelligence.*` when features need them (D9) |

Not found: any existing finding schema, central server, signing
infrastructure or "PeopleSoft Hypergraph Intelligence" code in this
workspace.

## The five subsystems

```
 research tools          extension (VS Code)              MCP (agents)
 (tools/, e2e, captures)  Discovery Center (ph. 3)         knowledge tools (ph. 5)
        │ record()              │ record()/list()/get()          │ read only
        ▼                       ▼                                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ A. Local Discovery Engine — src/intelligence/  (IMPLEMENTED, phase 1)  │
 │  schema.ts  fingerprint.ts  privacy.ts  store.ts  adapters/            │
 │  store: tools/intelligence/store (research, committed)                 │
 │         <globalStorage>/intelligence (each installation)               │
 └───────────────┬────────────────────────────────────▲───────────────────┘
                 │ submission (opt-in, reviewed,       │ signed knowledge bundles
                 │ allowlisted payload) — phase 3      │ (verified before use) — phase 4
                 ▼                                     │
 ┌───────────────────────────────────────────┐         │
 │ B. Central Intelligence Server (phase 2)  │─────────┤
 │  FastAPI + PostgreSQL, server/intelligence│         │
 ├───────────────────────────────────────────┤         │
 │ C. Verification & Knowledge Registry      │         │
 │  observed→reproduced→corroborated→        │         │
 │  verified→published; review, audit        │         │
 ├───────────────────────────────────────────┤         │
 │ D. Knowledge Distribution (phase 4)       │─────────┘
 │  signed, versioned, revocable bundles     │
 ├───────────────────────────────────────────┤
 │ E. GitHub / development integration (6)   │──► issues, fixtures, PRs (human-reviewed)
 └───────────────────────────────────────────┘
```

### A. Local Discovery Engine — implemented (phase 1)

`src/intelligence/` (no `vscode`, no network):

- `schema.ts` — the finding schema `psft-finding/1` (FINDING_SCHEMA.md),
  zod strict objects: the allowlist.
- `fingerprint.ts` — canonical JSON, the finding fingerprint (identity = the
  assertion, D3), observation digests (D4).
- `privacy.ts` — the deny-by-default text scan and the basic classification (D6).
- `store.ts` — `DiscoveryStore`: `open`, `record` (created / merged /
  duplicate), `get`, `list` (filters: subsystem, type, release, text),
  `remove`. Atomic file writes, per-finding serialization (D1).
- `adapters/saveCapture.ts` — a save capture's `delta.json` as an
  observation: changed tables and counter moves as counts; background
  tables (Integration Broker, sign-on bookkeeping) left out.

Callers: `tools/intelligence/discovery.mts` (record / capture / list / get
for research harnesses); `src/intelligenceCommands.ts` (the installation's
store, *PeopleSoft: Show Local Discoveries*).

### B–E — proposed

See KNOWLEDGE_REGISTRY.md (server, registry, API, bundles),
VERIFICATION_MODEL.md, MCP_INTEGRATION.md, DEPLOYMENT.md and the roadmap.

## Trust boundaries

1. **Research database → finding.** Captures hold institutional rows; the
   adapter keeps counts only, the schema has no field for rows, the privacy
   scan refuses identifying text. Boundary enforced by code (implemented).
2. **Installation → server.** Nothing crosses it in phase 1. In phase 3 a
   submission is an allowlisted projection of a finding, shown to the user
   before it leaves (SECURITY_PRIVACY.md). Proposed.
3. **Server → installation.** Knowledge arrives as signed declarative data,
   verified before use, never executed, never widening a write gate (D8).
   Proposed.
4. **Knowledge → agent.** The MCP reports knowledge with its status,
   applicability and provenance; it is information, never an instruction
   and never a permission. Existing write gates stay authoritative. Proposed.
5. **Server → GitHub.** Generated issues and fixtures carry no contributor
   code that runs; pull requests are human-reviewed, never auto-merged.
   Proposed.

## Data flow of a finding (phase 1, as implemented)

1. A researcher runs a capture (`snapshot.ts before/after`) or a lab proof.
2. They state the claim — the assertion — and record it:
   `npx tsx tools/intelligence/discovery.mts capture <case> --kind … --fact …`.
3. The engine validates (strict schema), scans (privacy), fingerprints, and
   creates the finding or merges the observation.
4. The finding file is committed with the work it supports.
