# Decisions

Architecture decisions for the Discovery & Intelligence Network, newest last.
Each records what was decided, why, and what was not chosen. A decision is
changed by adding a new one that supersedes it, not by editing history.

## D1 — The local engine is files, not a database (2026-10-12)

**Decided.** The local discovery store is a directory of JSON files, one per
finding (`findings/<id>.json`), plus a `STORE.json` marker. Writes go to a
temporary file and are renamed. The extension's store lives in its global
storage (`<globalStorage>/intelligence`); the research store used by
`tools/` scripts is `tools/intelligence/store`, committed to the repository.

**Why.** The directive forbids a mandatory new database dependency in the
extension; the extension already keeps local state as files in global storage
(the customization audit log, delivered baselines). Thousands of findings
are well within a directory listing. One file per finding diffs cleanly in
git, so the repository's own research findings are reviewable in pull
requests and survive any machine.

**Not chosen.** SQLite (a native dependency the extension does not carry;
the corpus harness's SQLite is a tool-side artifact), a single JSON file
(every write rewrites everything; merge conflicts), VS Code `globalState`
(not inspectable, not usable from `tools/`).

**Limit.** One writer per store: two processes recording into the same
finding at the same moment can lose an observation. The extension and the
research tools use different stores.

## D2 — The engine is in `src/intelligence/`, free of `vscode` and the network (2026-10-12)

**Decided.** Schema, fingerprints, privacy scan, store and adapters are
plain TypeScript under `src/intelligence/` with no `vscode` import and no
network module (a test enforces both). The extension wires it in
`src/intelligenceCommands.ts`; the MCP (phase 5) and `tools/` import it
directly.

**Why.** The same pattern as `src/model/` and the providers: testable with
`node:test`, usable from the MCP and command-line tools, and offline by
construction.

**Name.** `tools/corpus/discovery.ts` already exists (corpus definition
capture). The subsystem is called *intelligence* in code and settings; a
*discovery* is a finding.

## D3 — A finding's identity is its structured assertion (2026-10-12)

**Decided.** A finding is one claim. Its fingerprint is SHA-256 over the
canonical JSON of its type, subsystem, object type and *assertion* (`kind` +
`facts`). Title, statement, release and evidence are not part of it. Its ID
is `f-` and the first 24 hex digits.

**Why.** Prose gets reworded; a fingerprint over text would split one claim
into many. The release is not identity either: the same claim observed on
8.61 and 8.62 is one finding whose compatibility lists both. A claim that
*is* release-specific says so in its assertion (`version-difference`
findings).

**Not chosen.** Hashing the whole submission (every observation a new
finding — no deduplication); server-assigned IDs (the engine must work
offline, and two installations must agree on identity without talking).

## D4 — Evidence is a list of observations; duplicates are identical evidence (2026-10-12)

**Decided.** Each record carries one observation. Its digest is SHA-256 over
its canonical content except the time it was recorded. Recording a finding
whose fingerprint exists adds the observation (`merged`) — unless an
observation with the same digest is already there (`duplicate`, nothing
written). The first record's title and statement stand; confidence never
drops.

**Why.** The directive's "ten reports from the same faulty test must not
establish a fact": re-running a recorder over the same capture adds nothing.
A different run (`runId`) or a different experiment is new evidence.

## D5 — Locally a finding is only *observed* or *reproduced* (2026-10-12)

**Decided.** The local engine assigns `observed`, or `reproduced` once two
distinct runs support it. *Corroborated*, *verified* and *published* are
registry decisions (VERIFICATION_MODEL.md) and are never assigned locally.

**Why.** Verification needs independence and review that one installation
cannot give itself. Keeping the local states few prevents a local claim from
looking authoritative.

## D6 — Deny by default: an allowlisted schema plus a text scan (2026-10-12)

**Decided.** Every schema object is strict (unknown keys refused), text is
bounded, deltas are counts only, and there is no field for definitions,
source, SQL, rows, connections, hosts or credentials. A privacy scan refuses
findings whose text carries URLs, e-mail addresses, absolute paths, IP
addresses, connect strings, host names, credentials or long opaque tokens;
it reports the field and rule, never the value. Findings carrying lab
provenance (experiment and run IDs, capture cases, repository paths, the
application release) are classified `internal`, others `public-technical`.
`approvedForSubmission` is always `false` in phase 1.

**Not chosen.** Redacting and keeping (a redaction that misses leaks;
refusing makes the author rewrite the claim technically).

## D7 — The server: a separate deployable in this repository, later (2026-10-12)

**Decided (for phase 2, not built).** The Central Intelligence Server will
be a Python/FastAPI/PostgreSQL service in its own top-level directory
(`server/intelligence/`), with its own `pyproject.toml`, container image,
tests and CI job, sharing only the finding schema (exported from
`src/intelligence/schema.ts` as JSON Schema). It may move to its own
repository once it has users other than this project.

**Why.** The schema is the contract; keeping client and server in one
repository keeps them in step while both change weekly. An independent
directory, image and deployment keep its lifecycle and security boundary
separate from the extension. It is not part of any other application
(the "PeopleSoft Hypergraph Intelligence" application is not in this
workspace and is not a dependency).

**Not chosen.** A separate repository now (schema drift while the protocol
is young); embedding the server in the extension (wrong trust boundary).

## D8 — Knowledge is data; software ships as releases (2026-10-12)

**Decided.** Knowledge bundles (phase 4) carry declarative records only:
mappings, compatibility, verified statements, constraints. They are signed,
versioned and can be revoked; a client verifies before use. Nothing in a
bundle is executed, and no bundle changes a write gate, an approval policy
or a writer. Code changes — writers, parsers, the MCP — go through source
control, tests and an extension release.

**Why.** The directive: no remote code execution disguised as knowledge
sync. Remote findings are untrusted data, never instructions to an agent.

## D9 — Phase 1 adds one command, no settings (2026-10-12; superseded in part by D13)

**Decided.** Phase 1 registers *PeopleSoft: Show Local Discoveries* and
adds no settings. The proposed `peoplesoft.intelligence.*` settings
(enabled, serverUrl, uploadMode, knowledgeSync, captureLocalDiscoveries)
arrive with the features they control (phases 2–4), named under the
existing `peoplesoft.*` namespace.

**Why.** A setting with nothing behind it misdescribes the product.

## D10 — Server MVP: tables from the metadata, SQLite for quick tests (2026-10-12)

**Decided.** The MVP creates its tables from the SQLAlchemy metadata
(`create_all`); Alembic arrives with the first schema change that must keep
data. The test suite runs on SQLite by default and on PostgreSQL when
`PSFT_INTEL_TEST_DATABASE_URL` is set (CI runs both; the concurrency test
needs PostgreSQL's row locks). JSON columns are JSONB on PostgreSQL.

**Why.** No production data exists to migrate; a migration framework with
nothing to migrate is ceremony. SQLite keeps the inner loop instant.

## D11 — The contract is exported from the client and pinned by vectors (2026-10-12)

**Decided.** `tools/intelligence/export-contract.mts` writes
`server/intelligence/contract/`: the finding input JSON Schema (zod's export,
with the facts 1–64 refinement written out) and fingerprint vectors
(canonical identity text, fingerprint, ID, observation text and digest). A
TypeScript test fails when the files drift from the code; a Python test
proves the server reproduces every vector byte for byte. The server
implements JavaScript's number-to-text (ECMA-262 Number::toString) and
`trim()` whitespace set, because canonical JSON is what is hashed.

**Not chosen.** Hand-maintaining a Python schema (drifts); hashing
something language-neutral like a sorted key list (loses the facts' values
and types).

## D12 — Contributors see each other's evidence only as summaries (2026-10-12)

**Decided.** `GET /findings/{id}` shows a contributor their own
observations in full and other contributors' as method, release, digest and
receipt time; reviewers see everything.

**Why.** Observations may carry lab provenance (experiment and run IDs,
capture cases) classified `internal`; sharing a claim must not disclose
another installation's research context.

## D13 — Submissions: four gates, a machine policy file, approval per submission (2026-10-13)

**Decided.** `decideUpload()` (pure, `src/intelligence/policy.ts`) allows a
submission only when: no machine policy disables it; VS Code telemetry is not
`off`; `peoplesoft.intelligence.uploadMode` is `manual` (default `off`); a
server is set and uses HTTPS (plain HTTP only to this machine) without
credentials in the URL. Every reason is reported, not the first. The machine
policy is a JSON file in a system location an administrator owns
(`/etc/peoplesoft-studio/policy.json`, `/Library/Application Support/PeopleSoftStudio/policy.json`,
`%ProgramData%\PeopleSoftStudio\policy.json`); an unreadable policy file
fails closed; a policy `serverUrl` pins the only server. Both settings are
application-scoped (a workspace cannot turn submissions on). Even when
allowed, each submission needs the user's approval in a modal naming the
destination and the number of requests. The token is in SecretStorage.

**Why.** "Institution-level policy must be enforced, not merely
documented": a user setting can be changed by the user; a root-owned file
cannot. VS Code's own telemetry switch is the user's clearest statement
that nothing should leave.

**Not chosen.** VS Code's enterprise `policy` setting metadata (only for
built-in settings today); environment variables (user-controlled).

## D14 — A submission strips lab provenance unless the user keeps it (2026-10-13)

**Decided.** `previewSubmission()` builds one payload per observation —
the allowlisted finding input, nothing of the store's bookkeeping (digest,
local status, privacy, provenance) — and, unless the user ticks *Share lab
provenance*, removes experiment and run IDs, capture-case and repository
references and the application release, listing each removal with its
reason. The payload's fingerprint is the finding's (identity does not
depend on provenance); its observation digest differs from the local one,
so the server counts it as its own evidence.

**Why.** A lab's experiment names and paths are its business; the claim and
the technical evidence are what others can use.

## D15 — Reviews: independence, named releases, admins publish (2026-10-13)

**Decided.** `server/intelligence/app/review.py` allows these moves:
observed / reproduced → corroborated, rejected, conflicting, superseded;
corroborated → verified, rejected, conflicting, superseded; conflicting →
corroborated, rejected, superseded; verified → published (**admin**),
rejected, conflicting, superseded; published → revoked, superseded
(**admin**). Every review states a rationale. *Corroborated* needs evidence
from at least two research methods or two contributors — never more runs
of one experiment. *Verified* names its acceptance criteria and the
releases it holds on, which must be observed releases. Each review is a
`review` row and an audit entry.

**Why.** The directive: verification is not a count of submissions; a
verified claim is scoped to releases; publication is an administrative act.

## D16 — Bundles are signed over canonical JSON; keys ship in releases (2026-10-13)

**Decided.** A bundle (`psft-knowledge/1`: version, issued, expires,
published findings — claim, scope, no evidence payloads — and revoked ids)
is signed with Ed25519 over its canonical JSON, the same canonical form the
fingerprints use, so both sides sign and verify the same bytes (proven by
`contract/bundle-vector.json`, signed by the server code and verified by the
extension's tests). The signing key is generated and kept offline
(`python -m app.admin generate-key`); `build-bundle` reads it from a file
and the server stores only envelopes. The extension trusts the keys in
`src/intelligence/trustedKeys.ts` — changed only in a release. **No key is
trusted yet**: no production key exists, so every bundle is refused.

The client refuses a bundle on a schema mismatch (strict: unknown fields
refused), an untrusted key, a bad signature, expiry, a future issue time, or
a version not newer than the installed one; the installed bundle is
re-verified whenever it is read.

## D17 — Knowledge download has its own switch (2026-10-13)

**Decided.** `peoplesoft.intelligence.knowledgeSync` (`off` default |
`manual`) gates *Check for Knowledge Updates*, separately from submissions.
A download sends nothing but the request; it needs an HTTPS server (plain
HTTP only to this machine) and installs only what verifies.
