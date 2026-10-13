# Finding schema — `psft-finding/1`

Implemented in `src/intelligence/schema.ts` (zod v4, strict objects). This
page describes it; the code is authoritative.

## Input (what a caller records)

| Field | Type | Notes |
|---|---|---|
| `type` | `metadata-mapping` · `save-protocol` · `serialization` · `bytecode-pattern` · `version-difference` · `object-relationship` · `roundtrip-comparison` · `compile-difference` · `behavior` | The kind of claim |
| `subject.subsystem` | `page-designer` · `component` · `record` · `field` · `menu` · `app-engine` · `peoplecode` · `application-class` · `component-interface` · `message-channel` · `integration-broker` · `project` · `sql` · `html` · `style-sheet` · `customization` · `event-mapping` · `portal-registry` · `security` · `build` · `other` | The Studio subsystem it informs |
| `subject.objectType` | text ≤ 64 | The PeopleSoft object type |
| `subject.tables`, `subject.properties` | identifiers, ≤ 64 each | Names only, never data |
| `assertion.kind` | identifier | The claim's shape: `column-mapping`, `row-resave`, `counter-step`, `hash-algorithm`, `code-labels`… |
| `assertion.facts` | 1–64 pairs: identifier → string ≤ 256 · number · boolean · null | The claim, structured |
| `title` | ≤ 200 | |
| `statement` | ≤ 4000 | The claim in words |
| `confidence` | `low` · `medium` · `high` | The author's evidence confidence |
| `knownIncompatible` | PeopleTools releases | Releases it is known not to hold on |
| `source` | `research-harness` · `manual` · `extension` · `mcp-agent` | Who recorded it |
| `observation` | see below | Exactly one per record |

### Observation

| Field | Notes |
|---|---|
| `observedAt` | ISO date-time |
| `method` | `save-capture` · `controlled-compile` · `corpus-harness` · `live-e2e` · `pia-capture` · `unit-replay` · `source-inspection` · `manual-inspection` |
| `experimentId`, `runId` | The experiment (capture case, test, lab case) and one run of it |
| `environment.peopleToolsRelease` | Required: `8.62` or `8.62.09` |
| `environment.appRelease`, `appFamily`, `platform`, `tool` | Optional. No database name, host or connection: the schema has no field for them |
| `observation` (required), `expected`, `actual`, `reproduction[]` | Bounded text |
| `delta` | `{ tables: [{ table, inserted, deleted, updated }], counters: { NAME: step } }` — counts only |
| `testResults[]` | `{ name, outcome: pass · fail · skip }` |
| `evidence[]` | `{ kind: repo-path · capture-case · test · doc · commit, ref }` — repository paths relative and inside the repository |

Every object is strict: an unknown key anywhere is refused, as is a value
outside its bounds. This is the allowlist (SECURITY_PRIVACY.md).

## Stored finding

The store adds:

| Field | Meaning |
|---|---|
| `schema` | `psft-finding/1` |
| `fingerprint` | SHA-256 (hex) of the identity, below |
| `id` | `f-` + the fingerprint's first 24 hex digits |
| `compatibility.observedReleases` | The releases of its observations, sorted |
| `compatibility.knownIncompatible` | Union of what records declared |
| `localStatus` | `observed`, or `reproduced` (≥ 2 distinct runs) |
| `observations[]` | Each with its `digest` |
| `privacy.classification` | `internal` (lab provenance present) or `public-technical` |
| `privacy.approvedForSubmission` | Always `false` in phase 1 |
| `provenance` | `source`, `createdAt`, `updatedAt`, `schemaVersion` |

## Identity

- **Fingerprint** = SHA-256 of canonical JSON `{ v: 1, type, subsystem,
  objectType (lower-cased), assertion: { kind, facts } }`. Canonical JSON
  sorts object keys at every level, trims strings, drops undefined. So the
  order of facts, the wording of the title and statement, the release and
  the evidence do not change it; any fact value does.
- **Observation digest** = SHA-256 of the canonical observation without
  `observedAt`.

## Recording outcomes

| Outcome | When | Effect |
|---|---|---|
| `created` | No finding with the fingerprint | Written |
| `merged` | Same fingerprint, new observation digest | Observation appended; releases widen; status recomputed; first title and statement kept; confidence never drops |
| `duplicate` | Same fingerprint and digest | Nothing written |
| refused | Schema or privacy | `DiscoveryInputError` / `PrivacyRejectedError` naming fields and rules; nothing written |

## Versioning

`psft-finding/1` changes only compatibly (new optional fields, new enum
values) — readers ignore nothing silently because objects are strict, so a
reader must be updated before a writer uses a new field. An incompatible
change is `psft-finding/2`, with a migration in the store; the fingerprint's
`v` changes only if identity changes.

## Contract with the server

`server/intelligence/contract/finding-input.schema.json` (JSON Schema
2020-12) and `fingerprint-vectors.json` are generated from this schema and
`fingerprint.ts` (`npx tsx tools/intelligence/export-contract.mts`); a test
fails when they drift. Canonical JSON is precisely: object keys sorted by
UTF-16 code unit; strings trimmed with ECMAScript's `trim()` whitespace set
and written as `JSON.stringify` writes them (only `"`, `\\` and control
characters escaped; non-ASCII literal); numbers as ECMA-262
`Number::toString` (`2`, `0.1`, `1e+21`, `1.5e-7`, `-0` as `0`); no spaces.
Hashes are SHA-256 over the UTF-8 text.
