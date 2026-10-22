# Bounded new Record, AE and project review

Current development includes native Record/AE creation, reviewed reversal and
recreation evidence in [the recovery tracker](PROGRESS.md). Installed workflow
and runtime acceptance remain separate gates; see
[the workflow tracker](../build-requests/AE_FILE_WORKFLOW.md).

`psft_create_record` stages `record-create` on Oracle for Derived/Work records
using existing fields without subrecords. SQL Table creation retains its legacy
route outside a Change Set. `psft_ae_create` stages `ae-create` using the shared
AE document, compiler, reference/type validators and native writer.
`psft_create_project` stages `project-create`; optional explicit items support
Record, Field, SQL, AE program, section and PeopleCode. Other project operations
remain legacy. Unsupported grouping refuses without writing outside the set.

## Native snapshots and writes

Record creation uses the existing six-table Record scope, with an additional
PSRECDEL absence check. AE creation uses the existing twenty-table scope,
including generated SQL, PeopleCode source/binary/names and deletion markers.
A missing parent is absent only if every child/tombstone is absent. Existing
and orphaned names are not silently re-created by review. A reviewed redo may
explicitly accept the calibrated Record/AE deletion-marker baseline: the full
marker scope and token must match, and the typed writer must reproduce the
approved complete after-image. Ordinary new-definition requests still refuse
formerly deleted names.

Rollback previews execute the shared native writers, verify rows and cache
counters, capture the complete after-image, then roll back. Review retains that
native content with only VERSION/LASTUPDDTTM/LASTUPDOPRID removed. Full raw
scoped hashes bind concurrency. Typed projections reconstruct creation input;
they never replay arbitrary checkpoint rows. Actual writers compare the complete
native content hash with the approved after-image before COMMIT. Independent
readback then supplies the verified snapshot and new token.

Project review captures PSPROJECTDEFN and PSPROJECTITEM with the calibrated
schema. TGTOPRID/TGTOPRACCT are never selected or restored; credential freshness
is not part of the checkpoint. Its typed member projection verifies native key
layouts and every status column. Existing create and membership saves defer
their commits inside one outer transaction. Failed membership, verification or
after-image checks roll back the new project, items and cache counters together.
Native membership existence checks remain mandatory on real application.

## Proposed dependencies

`dependsOn` must identify already-staged objects in this exact Change Set.
Validation receives only their stored, declared transitive after-images; it
cannot see an unrelated proposal or an agent-supplied substitute catalogue.
New Record definitions supply field membership/type, staged SQL supplies bind
count and select width, and staged AE definitions supply section visibility.
Field types are still read from live PSDBFIELD. Duplicate proposed identities
are refused. No proposed records, fields or SQL are persisted for validation.

Project rollback preview may assume existence only for typed definitions derived
from these declared proposals. The native writer refuses these assumptions on
a committing path. During application, dependencies must first reach VERIFIED;
their fresh content/token is checked before each dependent and after validation.
Dependent validation then uses the live database. A final dependency check
prevents declaring completion after prerequisite drift during a later writer.

Set revisions invalidate all approvals. Environment, ownership, operator,
writable configuration, dirty-editor checks and exact-key reviewed authorization
remain enforced. Spec approval and implementation-approach approval are separate
existing product gates; this work does not add an agent approval tool.

## Boundaries and evidence

Record/SQL/AE/project application is ordered per-writer transactions, not an
atomic cross-object transaction. A partial/uncertain outcome stops dependents;
reconciliation and fresh reviewed continuation remain required. Record and AE
creation adapters support calibrated deletion with full native scope guards,
reference checks, rollback preview and readback. Complete Oracle 8.62 SQL checkpoints now also support creation reversal and fresh redo; legacy SQL histories remain text-only. Bounded Oracle 8.62 project creation inverse/redo is also implemented, with
reference/default-metadata/credential refusal and marker-bound recreation. See
[Query/project protocol](QUERY_PROJECT_DELETION.md). See [TEXT_DELETION.md](TEXT_DELETION.md). No DDL, data
load, scheduler execution, delivery transmission or general structural edit
reversal is implied.

Transaction fixtures exercise vacant/orphan/deletion gates, rollback, exact
after-image refusal, typed apply and project composition. Service tests verify
transitive proposal isolation, live validation and unversioned prerequisite
drift. Production HTTP/UI fixtures stage all four families without persistence,
refuse absent dependencies, apply through real Record/AE/project writers, and
verify exact readback/membership. SQL uses the existing HTTP persistence fixture.
These fixture results are separate from native evidence. October 20 HRDMO
trials also verified Record/AE creation, a paused application and continuation,
combined inverse and fresh redo, with exact native checkpoint restoration and
cleanup. Separate actual SIGKILL trials covered before and after HTML commit;
recovery reconciled native state without replaying the writer. See
[native reversal evidence](../../tools/lab/results/recovery-native-2026-10-20.json)
and [crash evidence](../../tools/lab/results/recovery-crash-native-2026-10-20.json).

The fully specified synthetic lab inputs live in `tools/lab/request-file/`.
The PeopleCode passes the installed HRDMO validator with import checks; reused
PROCESS_INSTANCE Number(10) and DESCR Character(30) were read live, and proposed
names were absent in definition searches. Creation's stronger full-scope checks
must still run after installation. Runtime acceptance requires an actual native
process result and exact output comparison with `check-output.mts`.

October 20 separate installed VSIX acceptance also passed rendered approval-only
and pause, fresh AE continuation approval, schema-3 combined destructive inverse
and fresh redo restoring exact full native Record/AE checkpoints. Both source
histories became REVERTED after verified inverse application. Cleanup verified
complete native absence. This used private test history and preserved the original
window: [installed/native report](../../tools/lab/results/priority-installed-native-2026-10-20.json).

## Interrupted inverse continuation

A failed or deliberately paused inverse can now prepare schema-4 remaining
work after live reconciliation. The original forward-source revisions remain
bound to approval. Already verified inverse steps become read-only prerequisites;
only untouched inverse steps are proposed, with fresh destructive approval where
needed. Neither a partial selection nor a changed prerequisite can mark the
forward histories fully reverted. Repeated interruptions retain the full chain,
and redo restores the complete chain through another fresh proposal.

The native Record/AE trial injects a lost reply after the AE deletion actually
commits, confirms that deletion without replay, reviews only the remaining
Record deletion, and restores both complete native checkpoints through redo.
All six checks and cleanup pass: [native results](../../tools/lab/results/recovery-inverse-continuation-2026-10-20.json).

Separate [installed/native acceptance](../../tools/lab/results/inverse-continuation-installed-2026-10-20.json)
also passes six checks, including rendered undo pause, remaining-work preparation,
checkbox retention on an identical render, fresh destructive approval and redo
from the original source history. Complete native Record/AE checkpoints match,
cleanup verified full scoped absence, and the test window was closed.
