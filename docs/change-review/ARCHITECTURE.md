# Change Review architecture and implementation plan

## Baseline — published 0.9.0

`src/mcp/server.ts` registers per-domain tools; `agentOrigin.ts` tags their
callbacks through AsyncLocalStorage. `writeTools.ts` checks writable access,
operator, scope and dirty editors, then `approve()` opens a modal with a 60s
MCP timeout. Domain tools delegate to shared `DatabaseProvider` methods.
`customizationGuard.ts` installs a separate ownership-policy guard, modal and
session approvals. Configuration writers can change configuration without
changing a delivered definition, and do not all use that definition guard.

Manual saves enter through text/custom editors and designer sessions. They
share provider writers, but do not share the MCP confirmation function. Undo
in a designer is an unsaved in-memory edit operation, not database history.
`compareContent.ts` retains temporary read-only texts in memory. Migration
packages implement ordering, preflight and verified per-object writes with
receipts; writers commit independently. Creation receipts and the append-style
customization audit are provenance evidence, not reversible complete history.
No durable Change Set or revision-bound approval system exists in 0.9.0.

## Current implementation — 0.9.7 release

The extension wires a durable ReviewStore/ReviewService to the MCP controller,
manual-save observers, review workspace and sidebar. Fourteen Oracle adapters handle
SQL, HTML, freeform style sheets, PeopleCode, Process, Query, bounded existing
Page edits, existing Record/AE headers, new Derived/Work records, AE programs
and projects, and existing IB service/operation headers and bounded structure.
Migrated normal MCP saves stage exact
snapshots; the trusted workspace binds approval and applies through the same
native writers with private exact-key authorization, checkpoints and independent
readback. Other tool families keep their legacy gates.

Schema-2 continuations pin verified prerequisites and require fresh review.
Partial/uncertain outcomes never replay automatically. Page comparisons reuse
the designer drawing model; contextual menus navigate to the exact object while
approval/application remain in the workspace. The complete current contracts
are in [CONTRACTS.md](CONTRACTS.md); bounded native evidence and release gates are
in [PROGRESS.md](PROGRESS.md) and [COVERAGE.md](COVERAGE.md).
[0.9.1 readiness](../RELEASE_0_9_1.md) retains the historical release gates.

See [INVENTORY.md](INVENTORY.md) for every statically registered write tool and
writer commit/rollback modules. Static discovery is not runtime proof. Existing
unit/native capture tests and `tools/lab` cover writer behavior; do not infer
new reversible semantics from their presence.

## Target and decisions

1. Use an extension-owned service shared by MCP and persistent review UI.
   Agents create/stage/read/validate/request review, never approve. Application
   is an explicit trusted UI action; no indefinitely blocked MCP call.
2. Store schema-versioned Change Sets and execution journals in extension local
   storage, with content-addressed immutable snapshots. Atomic file replacement,
   fsync, integrity hashes and an exclusive process lock provide an initial
   durable abstraction without a new native SQLite extension dependency. This
   is a local indexed-file implementation, not shared-server history. Retention
   and server synchronization remain future work; do not prune live references.
3. Adapters own snapshot fidelity, normalization, semantic diffs, validation,
   dependency evidence and existing-writer invocation. A missing adapter is
   explicitly unsupported; generic JSON does not establish PeopleSoft fidelity.
4. Bind review to exact object revision/content hashes and dependency sets.
   Revisions invalidate approvals. Preflight rereads targets and ownership policy;
   writers still enforce their native concurrency tokens. Existing `block`
   policies remain blocks. Approval of one target cannot authorize another.
5. Before writes, persist checkpoints and APPLYING journal records. Verify live
   post-state before APPLIED. Writer failures may follow commits: preserve an
   uncertain outcome and require reconciliation, rather than blindly retrying.
   No multi-object atomicity is claimed. Never automatically restore rows.
6. History is environment-scoped. Undo/redo prepares new reviewed Change Sets,
   with checkpoint/dependency checks and explicit unsupported inverse operations.
   Reversing CREATE requires a verified deletion adapter, not invented deletes.
7. Compatibility migration is explicit by tool adapter. Unsupported paths retain
   documented legacy behavior until audited; do not silently stage an opaque
   request and call it an exact proposed definition. Production must disclose
   which paths use staged review and which still use legacy confirmation.

## Contracts and states

A Change Set has schema, UUID, title, origin/session, verified environment,
revision, status, objects, checkpoint references and journal. Each object has
stable adapter/key identity, operation, before/after snapshot hashes, baseline
concurrency token, dependencies, diff, validation, review and application status.
New objects have null before; deletes have null after. No fabricated baseline.

DRAFT -> VALIDATING -> READY_FOR_REVIEW -> APPROVED -> APPLYING -> APPLIED.
REJECTED/CANCELLED terminate a proposal; revisions return to DRAFT and clear
approval. CONFLICTED/FAILED/PARTIALLY_APPLIED require explicit recovery. Pending
or uncertain writes cannot be restaged or cancelled as if nothing happened.
An approved subset must contain all staged dependencies; rejected dependencies
block dependents. A revision hash also covers dependencies and environment.

## Files and rollout

- `src/changeReview/model.ts`: contracts, canonical hashing, lifecycle,
  dependency eligibility, semantic diff, snapshot privacy rules.
- `src/changeReview/store.ts`: durable records, immutable blobs and lock.
- `src/changeReview/service.ts`: staging/review/preflight/checkpoints/journaling,
  application verification, reconciliation and reviewed reversal preparation.
- `src/changeReview/adapters.ts`: bounded existing-writer integrations.
- `src/changeReview/workspace.ts`: persistent review/history page, trusted
  approval and apply controls, read-only diff documents, commands.
- `src/mcp/changeReviewTools.ts`: resumable proposal/status/diff/history tools.
- `server.ts`, `controller.ts`, `extension.ts`, `writeTools.ts`,
  `customizationGuard.ts`: service lifecycle, staged compatibility routing and
  exact reviewed-write context; no agent-controlled bypass flag.
- Tests: pure service/store/state tests, crash/corruption/concurrency tests,
  fixture HTTP/UI integration and controlled live adapters before readiness.

## UX

The review page opens on command, stays open, and refreshes without stealing
focus when agents stage work. It lists sets/statuses/objects, shows exact
before/after snapshots and semantic changes, dependencies, validation and
policy warnings. Native text diffs remain available. Approval, rejection,
revalidation, apply and history actions use current server-side state; webview
payloads cannot mint approval hashes or replacement snapshots. History shows
actual journals and checkpoints only, never the illustrative user timeline.

## Risks and evidence still needed

- Complete object snapshots are not available for every writer; source may be
  reconstructed, and metadata writers may have implicit side effects.
- DDL/application data cannot be reversed merely from record metadata.
- Unstaged external dependencies and dynamic references are not a complete graph.
- A crash can occur after commit before journal update: reconciliation must read
  live state, and unsupported/ambiguous cases require manual investigation.
- Manual editor history requires a post-write verified observer per pathway;
  the existing pre-write guard alone cannot prove persistence.
- Environment identity needs live database/schema evidence, not only a friendly
  connection label. Unsupported platforms must fail closed for reviewed apply.

## Acceptance tracking

The user proposal remains authoritative. Core unit tests are not native lab
certification. Record implementation and each of the 20 required scenarios in
PROGRESS.md; scope adapters and reversibility honestly. Do not declare full
object coverage from the generic framework or UI alone.
