# Change Review, transactions and history — progress

## Status

**Development implementation in progress; not a completed or released initiative.**
The first end-to-end slice now includes durable Change Sets, a persistent
review/history workspace, separate optional plan approval, exact-revision
object approval, staged MCP compatibility paths, verified application,
checkpoints, reconciliation and reviewed reversal/redo for supported adapters.

The full user requirements are preserved verbatim in [PROPOSAL.md](PROPOSAL.md).
Preferred directions are in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md).
Implementation details and boundaries are documented in:

- [Architecture and affected files](ARCHITECTURE.md).
- [Mutation/commit inventory](INVENTORY.md): 49 baseline registrations; the
  regenerated development inventory also includes local Change Set tools.
- [Schemas, state, MCP, authorization, storage and recovery contracts](CONTRACTS.md).
- [Object capability/risk matrix and local blockers](COVERAGE.md).
- [Required test scenarios and evidence](TESTING.md).

The 0.9.0 live writer checks do not certify the new staged review workflow.
Native developer approval/reload tests and broader object adapters remain open.

## Objective

Replace repeated per-object modal approvals with durable Change Sets reviewed
in a persistent VS Code workspace. Separate planning, staging and approved
application; provide object-aware comparisons, verified persistence, durable
history, reviewed undo/redo and explicit failure/recovery behavior.

Existing policy, read-only enforcement and authorization must remain enforced
at the mutation boundary as supported pathways migrate. Approval binds to the
exact staged revision. Multi-object atomicity must be investigated, not assumed.

## Preferred architectural directions

The user's additional direction is recorded in
[DESIGN_DECISIONS.md](DESIGN_DECISIONS.md):

1. Checkpoint-based, dependency-aware reversal with live database verification;
   Undo must not be a blind row restoration.
2. An eventual workspace Change Set/object revision timeline with current,
   applied and baseline context, backed by durable verified history.

Design revision/checkpoint contracts early to support later environment
comparison, promotion and deployment packages. These extensions remain future
scope; the illustrative timeline is not repository or database history.

## Development verification — October 14, 2026

- `npm run package` passed: typecheck, bundle, 1,835 tests (1,834 passed,
  one skipped), extension activation smoke check and VSIX packaging.
- `npm run test:mcp-workflows` passed all 15 fixture-backed production HTTP/UI
  checks. These do not certify a native database workflow.
- Development VSIX installed successfully with `code --install-extension
  /tmp/peoplesoft-studio-change-review-dev.vsix --force`. Activation requires
  **Developer: Reload Window**; the existing host still runs its loaded build.
- `git diff --check` passed. This development work has not been committed,
  tagged, pushed or published as a new release.

## Next task: installed review acceptance, then structured adapters

Installed validation after reload (October 14, 2026, local date): the running
MCP advertises all six adapters and reads HRDMO. Native Query
`ZZ_QRY_MCP_MV8YENO1` has a description-only proposal in Change Set
`8cd54e34-9e5e-4322-9da5-f84a997053f4`, status `READY_FOR_REVIEW`.
Staging returned `persisted: false`; the live token and description were
unchanged afterward, and the semantic diff contains only `$.query.DESCR`.
Developer approval/application remains pending; no native apply or reversal
success is claimed. Evidence: `tools/lab/results/change-review-native-validation.json`.

This check exposed a real display-name resolution defect: Change Set creation
accepted `oracle:HRDMO` but rejected `HRDMO`. The environment factory now uses
the existing shared MCP connection resolver. The fixture workspace now rejects
noncanonical IDs, and an additional HTTP check covers name/ID equivalence and
automatic staging without a supplied Change Set. All 16 fixture checks and
`npm run package` passed (1,834 tests passed, one skipped). The corrected VSIX
is installed and requires a reload to activate the fix. The current review
can still be completed before that reload.

1. Finish regression and production HTTP/UI fixture checks on the development
   build, package it, and activate it with a developer-controlled reload.
2. Stage a controlled lab proposal through the installed MCP; have the developer
   review/approve the actual approach and object definitions in the persistent
   page. Verify native apply/readback, history, checkpoint reversal of an update,
   redo, stale drift and restart behavior. Do not impersonate human approval in
   the native harness.
3. Implement the next complete metadata adapter (Page/Record/AE) using the
   existing designer/writer, after resolving its exact snapshot/identity and
   staged-dependency blockers in COVERAGE.md. Expand family by family; legacy
   paths must remain explicit until migrated and verified.

Current implementation source: `src/changeReview/`,
`src/mcp/changeReviewTools.ts`, `src/mcp/reviewRouting.ts`, provider/manual-history
hooks in `database.ts`, and extension/controller wiring. No encoder/decoder
calibration rules have been changed.

## Milestone tracker

| Milestone | Status | Required completion evidence |
|---|---|---|
| 1. Architecture and inventory | Documented; baseline verified | Source inventory, current/target architecture, contracts, affected files, UX plan, risks and baseline tests recorded; adapter-specific native research remains explicit |
| 2. Change Set foundation | Implemented; fixture verified | Durable schema-1 store, snapshots, lifecycle, plans, approval hashes, dependency ordering and retry identity; future migrations/retention/shared storage remain open |
| 3. Change Review interface | Initial slice implemented | Persistent page, status indicator, before/after/native diffs, approvals, report/history and supported reversal; native Page/AE visual comparison and full timeline UX remain open |
| 4. MCP integration | Partial by explicit adapter | Text/PeopleCode, Process and Query tools route to staging on Oracle; six adapter families; other tools/platforms retain legacy gates |
| 5. Safe application | Core implemented; native acceptance pending | Preflight, authorization drift, checkpoints, journal, verified readback, cancellation and reconciliation tested with fixtures; no global atomicity or automatic remaining-work replay |
| 6. History and reversal | Partial by adapter | Supported manual saves, immutable snapshots, revision comparison, reviewed inverse/redo and drift blocks; unsupported CREATE inverses disabled; native review tests pending |
| 7. Full object coverage | Not complete | Page/Record/AE comparator models exist, but their mutation adapters and remaining families need the evidence listed in COVERAGE.md |

The proposal's 12 phases provide detailed requirements; its seven milestones
above define incremental delivery. Lifecycle states and conceptual MCP tool
names in the proposal remain design candidates until contracts are reviewed.

## Decisions requiring investigation

- Actual per-writer transaction/commit boundaries and supported recovery models.
- Durable storage, immutable blob integrity, schema migration, retention and
  environment isolation; local storage first with a future shared abstraction.
- Exact environment identity and concurrency/content-hash contracts.
- Stable semantic identities for page controls, AE order and other object types;
  ambiguous matches must remain explicit.
- Staging validation of objects/dependencies that do not yet exist in PeopleSoft.
- Compatibility behavior of existing mutation tools and the manual-edit path.
- Approval revocation, dependency-complete subsets, destructive-operation gates,
  cancellation, idempotent retries and restart reconciliation.
- Secret exclusion and fidelity limits of snapshots/decompiled source.
- Separate plan approval from concrete-definition approval.

These technical choices remain open. The preferred architectural directions above
are user guidance; their implementation details still require investigation.

## Verification tracker

The scenario-by-scenario fixture/native matrix is maintained in
[TESTING.md](TESTING.md). Core scenarios have automated evidence, but all 15
acceptance criteria still need complete installed/native coverage. Track scenario-specific evidence
as milestones advance; UI presence alone does not establish correctness.
Retain the existing regression gates and add unit, integration and controlled
lab verification appropriate to each changed pathway.

## Session handoff convention

After each implementation session, update this file with completed work,
changed modules, commands/results, verified scope, unresolved risks/blockers and
one concrete next task. Link detailed inventories, ADRs, schemas, capability
matrices and validation reports from here as they are created. Mark a milestone
complete only when its required behavior and evidence are present.

## Activity log

- 2026-10-14: Preserved the full user proposal and created this tracker. No
  architecture investigation or implementation claimed; next is Milestone 1.
- 2026-10-14: Recorded user preference for dependency-aware checkpoint reversal
  and an eventual workspace revision timeline; clarified illustrative history
  and future environment-comparison/promotion/deployment extension points.
- Development implementation: added model/store/service, review UI, MCP tools,
  compatibility staging, exact policy proof, manual-history hooks and supported
  adapters for SQL/HTML/style/Query/Process/PeopleCode. Added dependency, stale
  approval/plan, corruption, cancellation, restart, duplicate request, manual
  history, reversal/redo and production HTTP/UI fixture checks. No full coverage
  or native review certification claimed.
- 2026-10-15: Reviewed and committed the development slice (it had been left
  uncommitted). Fixed a defect in manual-save history: a failure to start the
  history record blocked the developer's own save, and a failed readback after
  a successful save was reported as a failed save. History is now a record of
  the save, never a gate on it: the save runs once and its own result or error
  stands; the record is left UNCERTAIN (`MANUAL_SAVE_READBACK_FAILED`) when the
  readback fails. New test in `src/test/changeReview.test.ts`. Verified: full
  unit suite, 16/16 `npm run test:mcp-workflows`, lint, smoke. Corrected the
  stale ROADMAP/AGENTS statements that implementation had not started. Next
  task unchanged: installed review acceptance (Next task, step 2).

