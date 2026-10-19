# Bounded new Record, AE and project review (0.9.6 development)

Local implementation and fixtures only until installed native acceptance is
recorded in [the workflow tracker](../build-requests/AE_FILE_WORKFLOW.md).

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
A missing parent is absent only if every child/tombstone is absent. Existing,
orphaned and formerly deleted names are not silently re-created by review.

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
reconciliation and fresh reviewed continuation remain required. No new adapter
declares `canDelete`: CREATE reversal is explicitly unsupported. No DDL, data
load, scheduler execution, delivery transmission or general structural edit
reversal is implied.

Transaction fixtures exercise vacant/orphan/deletion gates, rollback, exact
after-image refusal, typed apply and project composition. Service tests verify
transitive proposal isolation, live validation and unversioned prerequisite
drift. Production HTTP/UI fixtures stage all four families without persistence,
refuse absent dependencies, apply through real Record/AE/project writers, and
verify exact readback/membership and unsupported creation reversal. SQL uses the
existing HTTP persistence fixture. These are local fixtures, not native runtime
evidence.

The fully specified synthetic lab inputs live in `tools/lab/request-file/`.
The PeopleCode passes the installed HRDMO validator with import checks; reused
PROCESS_INSTANCE Number(10) and DESCR Character(30) were read live, and proposed
names were absent in definition searches. Creation's stronger full-scope checks
must still run after installation. Runtime acceptance requires an actual native
process result and exact output comparison with `check-output.mts`.
