# Change Review contracts (development implementation)

These contracts describe the current bounded implementation, not released
0.9.0 behavior or complete object coverage. See [COVERAGE.md](COVERAGE.md).

## Durable records and snapshot storage

`src/changeReview/model.ts` defines schema 1 Change Sets, objects, checkpoints
and journal entries. Store records under extension global storage at
`change-review/sets/<uuid>.json`; immutable snapshots are content-addressed
JSON in `change-review/blobs/<sha256>.json`. Canonical object keys are sorted;
array semantics belong to adapters. Stored records have a checksum; referenced
snapshots are integrity-checked on read. No large payloads use globalState or
workspaceState. Snapshots are limited to 8 MiB and sets to 1,000 objects/32 MiB.

Files use private permissions, fsync and atomic replacement. An exclusive lock
serializes application across windows/processes. Only an established dead PID's
lock is reclaimed, under a separate recovery lock; live/unknown owners fail
closed. Crash-leftover recovery locks need manual investigation. Schema versions
other than 1 are refused; no future schema migration or pruning is invented.
This local file store is not a shared service or a tested Windows durability
implementation. Retention, indexed large-history performance and synchronization
remain open work.

Privacy scanning rejects credential-related fields and recognizable embedded
secrets before storage. This is a conservative heuristic, not a guarantee that
arbitrary source contains no secrets. Unsupported sensitive snapshots are
refused, including manual history capture before the writer is invoked. No
connection passwords, raw connect strings or encrypted credentials are stored.

## Identity and concurrency

Environment identity hashes connection address, Oracle DB_UNIQUE_NAME,
container, current schema and PeopleTools release/patch. Friendly name and
provider ID are recorded separately. Identity is reread at staging, preflight
and before each application. Other database platforms retain legacy mutation
paths until their review identity/snapshot contracts are calibrated.

Each object stores adapter/key, CREATE/UPDATE/DELETE, before/after hashes,
baseline native token, dependencies, revision, validation/warnings, review
status and application status. The exact native writer token is still passed to
the existing writer; hashes do not replace its lock/concurrency checks.

## Lifecycle and approvals

Normal sequence: DRAFT -> VALIDATING -> READY_FOR_REVIEW -> APPROVED ->
APPLYING -> APPLIED. Rejected/cancelled proposals cannot apply. Explicit
revision invalidates approvals and returns to DRAFT. Validation drift becomes
CONFLICTED. Failures can become FAILED or PARTIALLY_APPLIED; interrupted writer
calls are UNCERTAIN. VALIDATING can be explicitly restarted because validation
contracts do not persist target changes.

Optional approach plans have separate review and hashes. An unapproved/revised
plan blocks staging and validation. Approving an approach never approves the
concrete definitions. Simple compatibility calls can create a proposal without
an approach plan; a multi-object agent workflow should supply one explicitly.

Only trusted review UI handlers approve/reject/apply. Approval binds environment,
set revision, object revision, key, before/after, baseline token, dependencies
and the current ownership/operator/policy stamp. A stale review page cannot
approve a newer revision. Approval of dependencies is required for the selected
subset; rejected dependencies revoke dependent approvals transitively.
Deletion requires an additional destructive-operation checkbox. Unsupported
inverse controls are disabled, with the missing capability explained.

Apply repeats target, drift, validation, writability, scope, dirty-editor,
operator and ownership-policy checks. A block policy remains a block. Reviewed
writers receive a private exact-key policy proof through AsyncLocalStorage;
the existing provider guard checks current classification/policy against it.
There is no MCP argument that grants this proof. Changed authorization requires
revalidation/review instead of silently reusing an old approval.

## Application, checkpoints and recovery

Before a write starts, persist the approved selection's checkpoint and APPLYING
journal. Execute in dependency order. Native writers retain their own commit
and rollback boundaries. Re-read persisted state and compare to the exact
normalized reviewed result before marking each object VERIFIED, then APPLIED.
No global transaction/automatic rollback is claimed.

A failure stops remaining operations. A writer may commit before its response
or subsequent verification fails: retain UNCERTAIN, not an optimistic success.
Reconciliation reads live state without replaying a write. Only a result matching
the reviewed after-state becomes verified. Drift/unresolved results remain
partial. A partially applied set does not currently resume automatically;
preparing an explicit remaining-work proposal with verified external checkpoint
prerequisites is additional work.

Cancellation allows an already running writer to finish, then stops later
writes. Native writers are not assumed to support mid-transaction cancellation.

## History and reversal

Applied snapshots/journals form environment-scoped history. SQL, HTML, freeform
style sheet, Query, Process and supported PeopleCode manual saves use the same
checkpoint/history storage, with origin `manual`. A manual save is an existing
trusted editor action, not fabricated MCP approval. Unknown interrupted manual
results remain unknown and cannot be auto-reconciled to a guessed after-state.

Revert prepares a new Change Set from verified checkpoints. Live state and
native token must match the recorded result. Dependencies reverse direction;
unsupported inverse operations block proposal creation. The developer validates,
reviews and applies it normally. Only verified complete reversal marks the
original REVERTED. Redo builds a new forward proposal from the applied reversal;
it never reuses approval and still requires current-state checks. Snapshotting
record metadata is not a physical table/data restore capability.

## Diff and UI contracts

The persistent webview lists actual sets/history, objects, statuses, ownership
warnings, checkpoints and journal; it has before/after panes, native read-only
diffs, approvals, validation, apply, cancellation, export and reconciliation.
Staging refreshes it without opening/revealing a window. A status-bar indicator
links pending work. Historical comparison selects retained revisions for the
same environment/object; history is not proof that live state remains current.

`semanticDiff.ts` supplies extensible providers. SQL/PeopleCode use exact text
snapshots/native text diffs. Query comparisons match native row identities while
ignoring incidental row order. Page controls use positive persisted PNLFLDID
rather than FIELDNUM; unresolved temporary identities are AMBIGUOUS. Record
fields use names/order; AE specs use section+variant, step names and action
types. Page/Record/AE providers currently have model tests, not integrated
staging or visual-designer/native-lab certification. They must not be presented
as full object coverage.

## MCP protocol

- `psft_create_change_set`: title, connection, optional session/requestKey/plan.
  Repeated requestKey returns the same logical proposal; different request
  content with that key is refused.
- `psft_set_change_plan`: revise the approach and invalidate affected approval.
- `psft_stage_object_change`: exact adapter/key/after, optional dependency IDs
  and objectId. Native normalization happens before snapshots/review.
- `psft_get_change_set` / `psft_list_change_sets`: durable resumable state.
- `psft_validate_change_set`: preflight; does not authorize a write.
- `psft_get_object_diff`: exact snapshots and structured differences.
- `psft_request_change_review`: REVIEW_REQUIRED or current status plus the open
  command; no modal wait, focus stealing, approval or application.
- `psft_get_change_history`: optional connection/environment/adapter/key filter.
- `psft_prepare_revert` / `psft_prepare_redo`: prepare only; no persistence to
  PeopleSoft, approval or application.

Legacy-compatible tool names migrated in this build: `psft_save_text_definition`,
`psft_save_peoplecode`, `psft_process_save`, `psft_query_create`,
`psft_query_save`, `psft_query_copy`. Optional changeSetId/dependsOn groups
requests. They return REVIEW_REQUIRED and persisted=false instead of pretending
an immediate save. Existing dryRun requests keep their existing preview path.
Identical staged retries do not invalidate approval; duplicate apply is refused.
Other tools/platforms retain explicit legacy gates. The catalog reports which
adapters/tools use the new flow. No agent-facing approve/apply tool exists.
