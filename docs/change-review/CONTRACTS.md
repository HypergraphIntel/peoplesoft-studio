# Change Review contracts (development implementation)

These contracts describe the current bounded implementation, not released
0.9.0 behavior or complete object coverage. See [COVERAGE.md](COVERAGE.md).

## Durable records and snapshot storage

`src/changeReview/model.ts` defines schema 1 ordinary Change Sets, schema 2
ordinary continuations, schema 3 combined reversals, and schema 4 continuations
of interrupted reversals, with objects, checkpoints and journal entries. Store
records under extension global storage at
`change-review/sets/<uuid>.json`; immutable snapshots are content-addressed
JSON in `change-review/blobs/<sha256>.json`. Canonical object keys are sorted;
array semantics belong to adapters. Stored records have a checksum; referenced
snapshots are integrity-checked on read. No large payloads use globalState or
workspaceState. Snapshots are limited to 8 MiB and sets to 1,000 objects/32 MiB,
with at most 1,000 verified external prerequisites.

Files use private permissions, fsync and atomic replacement. An exclusive lock
serializes application across windows/processes. Only an established dead PID's
lock is reclaimed, under a separate recovery lock; live/unknown owners fail
closed. Crash-leftover recovery locks need manual investigation. Schema versions
other than 1/2/3/4 are refused. Ordinary continuation metadata requires schema 2;
combined reversal lineage requires schema 3; an inverse continuation requires
both contracts under schema 4. Older builds reject these records instead of
treating prerequisites or source coverage as optional. Existing schema-1 approval hashes remain unchanged. No destructive
migration or pruning is performed; downgrades cannot read continuation records.
This local file store is not a shared service or a tested Windows durability
implementation. Retention, indexed large-history performance and synchronization
remain open work.

Privacy scanning rejects credential-related fields and recognizable embedded
secrets before storage. This is a conservative heuristic, not a guarantee that
arbitrary source contains no secrets. Unsupported sensitive snapshots are
excluded from history; failure to capture manual history does not block the
developer's save. No
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

The primary **Approve and apply** action combines concrete object approval and
application under one exclusive store lock. It binds the displayed eligible
object IDs, set revision and complete rendered durable state; same-revision
review/validation changes invalidate the old page too. It persists normal
per-object approval hashes and a combined-action journal entry before entering
the unchanged application preflight/checkpoint/writer path. Rejected objects
and their transitive dependent objects remain excluded. Separate approach
approval, approval without application, individual object review and explicit
destructive approval remain. See [design and verification](APPROVE_AND_APPLY.md).

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
partial. A partially applied set never resumes automatically.

`Prepare remaining work` / `psft_prepare_remaining_work` creates a new local
proposal from only previously approved, untouched PENDING objects in a partial
application. APPLYING/UNCERTAIN or unknown manual results block preparation;
reconciliation must first establish actual committed results. Confirmed writes
are excluded from the new write list and pinned as read-only prerequisite
references (environment/source object, snapshot and native token). Untouched
objects must still match their original before-state and token. Internal
dependency IDs are remapped; verified external dependencies remain explicit
prerequisites. No new-object dependency overlay is inferred.

Continuation records use schema 2, link their source revision and object IDs,
and include every inherited and newly verified prerequisite in each object
approval hash. They have fresh object IDs/review state; an original approach
plan, if present, also needs fresh plan approval. Prerequisite/history integrity
and live hash/token checks run during staging, validation, before every writer,
at completion and during reconciliation. A verified prerequisite cannot also
be staged as a writable object in the continuation. Dropping a prerequisite or
changing the source mapping is refused. Ordinary current authorization checks
still apply to every remaining write.

Repeated preparation returns the existing noncancelled/nonrejected follow-up,
including an already applied or itself-partial follow-up; it never creates a
second writer replay. Continue a partial follow-up through its own record.
Cancellation of an unstarted follow-up permits a fresh proposal. The original
partial outcome is retained, linked from the page, and never relabelled APPLIED
because a separate proposal succeeded. The review page shows both directions
of the follow-up link and all pinned prerequisites.

Applied continuations can now prepare one combined inverse across the confirmed source checkpoints. Schema 3 binds every source revision, object hash and native token to the new approval; inverse dependencies run in reverse order. Every inverse object must be approved before application. Only fully verified application marks the source records REVERTED, and reconciliation can finish interrupted history publication without replay. Redo is another fresh reviewed proposal. Interrupted inverse application can prepare a fresh schema-4 continuation after reconciliation. The complete forward-source lineage is retained; confirmed inverse steps become checked prerequisites and are never replayed. All remaining inverse objects require fresh approval. Repeated interruptions retain all earlier checkpoints, and only completion of the whole inverse marks its forward histories REVERTED. Unknown manual-save failures remain unsupported. Unknown outcomes,
changed prerequisites or changed untouched objects require explicit inspection
and restaging; this feature does not guess whether a failed writer was safe to
retry, restore database rows, or claim atomicity across native writers.

Cancellation allows an already running writer to finish, then stops later
writes. Native writers are not assumed to support mid-transaction cancellation.

The trusted UI can deliberately apply one object and pause. It still preflights
all approved objects, records verified readback, then stops before the next
writer with PARTIALLY_APPLIED and PAUSED_BETWEEN_WRITERS journal entries. It is
not a failed/uncertain result. Remaining work requires a fresh continuation and
approval. Undo can also pause at this verified boundary after every inverse
object has been approved; it resumes through the same fresh continuation path. No MCP approval/apply option
or agent-callable pacing bypass is exposed. An identical page refresh preserves
the current DOM, including explicit deletion consent; changed rendered review
state rebuilds the form. Redo can start from any source history bound into the
verified combined inverse.

## History and reversal

Applied snapshots/journals form environment-scoped history. SQL, HTML, freeform
style sheet, Query, Process, Page, Record/AE scoped metadata and supported PeopleCode manual saves use the same
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

The selected object's timeline (`timeline.ts`, `ReviewService.objectTimeline`)
is scoped by connection ID, environment identity, adapter and canonical JSON
key. It lists the first retained proposal's before-state as a local baseline,
then objects with verified readback hashes/tokens, including manual saves,
reversals and verified objects in partially applied sets. Pending, rejected,
cancelled and uncertain outcomes are separate proposals, never applied revisions.
Times come from recorded readback/reconciliation events, with set update time
as a fallback for older history. The baseline date is proposal creation, not
proof of the exact snapshot capture time or original delivered ownership.
History gaps are reported when an entry's before hash/native token differs
from the preceding retained result; a complete native audit trail is not claimed.

`Check live revision` is explicit and read-only. It verifies the environment
before reading the adapter and returns `MATCHES_RECORDED` only when both hash
and native token match a retained result (or the local baseline). Identical
content with another token is `TOKEN_CHANGED`; unmatched content is `DIVERGED`;
connection, adapter or identity failures are `UNAVAILABLE`. No check happens
merely by opening history. The page shows the observation time, invalidates
its displayed result when retained history changes, and does not persist it
as approval, reconciliation, a current-state guarantee or restoration permission.
Timeline comparisons resolve snapshot IDs from the selected object's retained
history on the host; webview messages cannot supply arbitrary file paths or
another object's revision. There is no new restore/apply shortcut.

`semanticDiff.ts` supplies extensible providers. SQL/PeopleCode use exact text
snapshots/native text diffs. Query comparisons match native row identities while
ignoring incidental row order. Page controls use positive persisted PNLFLDID
rather than FIELDNUM; unresolved temporary identities are AMBIGUOUS. Record
fields use names/order; AE specs use section+variant, step names and action
types. Record/AE header edits and bounded creation now use staged native
preservation/creation adapters; general structural edits remain outside scope.
The Page adapter now stages a bounded existing-control subset using full native
scoped snapshots and exact rollback-preview equivalence; see
[PAGE_ADAPTER.md](PAGE_ADAPTER.md) for the eleven-table scope, limits, locked
content/version guard and typed inverse/manual-history behavior. Page staging
has fixture and bounded installed/native acceptance, including corrected Static
Text / Edit Box apply/inverse and Windows Designer inspection. Broader controls
and operations remain outside that acceptance; see [COVERAGE.md](COVERAGE.md).

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
- `psft_get_object_timeline`: Change Set/object IDs and optional `checkLive`;
  read-only retained baseline/revisions/proposals and a timestamped observation.
- `psft_request_change_review`: REVIEW_REQUIRED or current status plus the open
  command; no modal wait, focus stealing, approval or application.
- `psft_get_change_history`: optional connection/environment/adapter/key filter.
- `psft_prepare_revert` / `psft_prepare_redo`: prepare only; no persistence to
  PeopleSoft, approval or application.
- `psft_prepare_remaining_work`: new schema-2 proposal for untouched approved
  objects; pins verified prerequisites, never retries uncertain operations or
  grants approval. Duplicate requests return the existing follow-up.

Legacy-compatible tool names migrated in this build: `psft_save_text_definition`,
`psft_save_peoplecode`, `psft_process_save`, `psft_query_create`,
`psft_query_save`, `psft_query_copy`, bounded `psft_edit_page`, Record/AE header
edits, new Derived/Work/AE/project creation and bounded service/operation
`psft_ib_save` operations. Optional changeSetId/dependsOn groups
requests. They return REVIEW_REQUIRED and persisted=false instead of pretending
an immediate save. Existing dryRun requests keep their existing preview path.
Identical staged retries do not invalidate approval; duplicate apply is refused.
Other tools/platforms retain explicit legacy gates. The catalog reports which
adapters/tools use the new flow. No agent-facing approve/apply tool exists.

Record and AE adapters stage existing-definition description/comments only.
See [STRUCTURED_HEADERS.md](STRUCTURED_HEADERS.md) for their six/twenty-table
preservation scopes, exact writer rollback equivalence, full locked native token
checks, typed inverse and excluded structural/dependency operations. Snapshots
are preservation evidence, never a general raw-row replay format.

New Derived/Work records, AE programs and projects use dedicated creation
adapters with declared proposed dependencies and exact native rollback-preview
checks. Record/AE creation reversal is now calibrated; project creation reversal remains unsupported. See
[STRUCTURED_CREATION.md](STRUCTURED_CREATION.md). IB services/operations use
fixed noncredential checkpoints for headers and bounded structural edits,
with typed inverse for supported existing-row edits; handler-addition reversal
is refused. See [IB_STRUCTURE.md](IB_STRUCTURE.md).

## Native recovery acceptance — October 20

Controlled HRDMO child processes were actually killed with SIGKILL after a committed HTML writer but before ReviewService recorded its response, and before the writer committed. The first reconciled to APPLIED from exact native readback; the second retained the exact native baseline and required fresh continuation approval. Native cache counters and complete content tokens did not move during reconciliation. This verifies the tested Linux/Oracle boundaries, not every crash location or Windows durability.

Derived/Work Record and AE creation adapters now support calibrated deletion/recreation. A complete locked snapshot token is required for reviewed deletion, known references can block it, and deletion previews roll back. Record deletion previews may account only for explicitly staged AE deletions; committed writes always recheck actual native references. Tombstones are part of the vacant-scope token; recreation uses the existing calibrated writers and must exactly reproduce the retained semantic checkpoint before commit. Empty-scope and existing-definition tokens remain compatible with prior recorded histories. Complete Oracle 8.62 SQL/HTML/freeform stylesheet adapters now also support typed deletion/recreation and full metadata checkpoints; legacy partial histories retain their original reversal limits. Query and project deletion remain unsupported. See [TEXT_DELETION.md](TEXT_DELETION.md).
