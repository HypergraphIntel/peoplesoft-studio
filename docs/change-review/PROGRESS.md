# Change Review, transactions and history — progress

## Current state — 0.9.7 released

Reconciled October 20, 2026 against the source and recorded native acceptance.
The 0.9.6 release includes fourteen bounded Oracle adapters: SQL, HTML,
freeform style sheets, event/application-class PeopleCode, Process, Query,
Page, Record/AE headers, new Derived/Work records, new AE programs, new
projects, and IB services/operations. The two IB adapters cover both headers
and the bounded structure in [IB_STRUCTURE.md](IB_STRUCTURE.md).

Native acceptance now includes text/PeopleCode apply/inverse/redo trials,
Query structural and criteria/order edits, Page controls/redo, Record/AE
headers and deliberate pause/continuation, four-object creation, standard IB
header/structural cycles and a REST provider handler addition. The synthetic
AE/file request also completed native runtime instance 607175 with exact CSV
output. These are bounded trials, not certification of every adapter operation.
See [COVERAGE.md](COVERAGE.md) and the [AE/file workflow](../build-requests/AE_FILE_WORKFLOW.md).

October 21 development now adds calibrated 8.62.09 added-handler undo/redo and
standard definition lifecycle review, with installed developer-approved trials.
The 8.61 existing-version structural apply/inverse passed and its temporary
fixtures are removed. REST consumer backend apply/inverse/redo and installed
forward/inverse application pass with the original complete checkpoint restored.
Broader adapters, Query/project deletion and production/Windows Build Request acceptance
remain separate work.

October 20 installed build handoff acceptance passed for both Codex and Claude:
each request produced one four-object APPLIED/VERIFIED creation set, followed
by a separately confirmed Process Definition and a native exact-CSV run
(607265 / 607266). Report delivery subsequently passed after the targeted agent recycle and exact transfer-location gzip exclusion; both original runs are Posted with usable native View Log/Trace and exact CSV downloads. This
also corrects earlier claims that DISTSTATUS 4 meant Posted; native HRDMO
labels it Unable to Post. See [actual session/runtime evidence](../build-requests/BUILD_HANDOFF.md).

October 20: the developer selected **Approve and apply** as the primary action,
keeping approach approval separate and **Approve only** available. Implemented
one-lock approval/application with exact rendered-state and revision checks,
explicit eligible object IDs, rejected/dependency-blocked exclusions and the
existing checkpoint, guarded writer, precommit and readback path. Individual
object review, destructive approval, partial recovery and cancellation remain.
No MCP approval/apply tool or automatic approach-to-application path was added.
See [implementation and verification](APPROVE_AND_APPLY.md). Agent batching and
any future approach approval covering an inverse/redo remain separate proposals.

Local verification: 2,095 tests passed / one skipped, compile/bundle and
108-command activation smoke, 17 editor fixture checks and 56 production
HTTP/UI workflow checks. The actual rendered combined-action click script is
exercised, and the production page preview was visually inspected. These are
fixture-backed approval/application checks; no new live PeopleSoft application
was performed for this UI change.

## October 21 installed Query lifecycle acceptance (complete)

[Ten installed VSIX checks](../../tools/lab/results/query-installed-2026-10-21.json)
pass in an isolated normal VS Code 1.143.0 window with private history on HRDMO
8.62.09. MCP Query rename stages an absent-target copy and old-key deletion;
delete stages one deletion. Neither writes before rendered approval. Applying
without destructive consent is refused with unchanged native snapshots and
pending object reviews. Rendered explicit consent and Approve and apply execute
the guarded writers; fresh reviewed inverses restore complete snapshots and
mark the forward histories REVERTED after verification. All temporary query
rows and PSQRYDEL markers are absent after cleanup. Manifest, bundle and worker
integrity pass; the original running window and installation were untouched.
The same trial verifies the Query designer and result values; see
[acceptance and reproduction](../PS_QUERY_WINDOWS.md#installed-acceptance-october-21-2026).
No broader deletion or platform acceptance is implied. This Query work is
included in the unreleased 0.9.8 checkpoint on `query-criteria`.

## October 21 REST lifecycle calibration (complete)

The developer approved one HRDMO batch: owned REST fixtures
`ZZ_PCODE_LAB_IBRP` (provider), `ZZ_PCODE_LAB_IBRC` (consumer) and
`ZZ_PCODE_LAB_IBRE` (empty provider), seeded with the calibrated REST writer
(`tools/lab/ib-rest-lifecycle-fixture.mts`; manifest
`/tmp/psft-ib-rest-lifecycle-fixture.json`), then native PIA deletion and
recreation. The snapshot tool gained `--routings` (also `PSLAB_ROUTINGS` in
`ib-lifecycle-capture.sh`): routing-keyed tables are watched for the named
routings plus any routing a lab operation owns, so a routing generated inside
the window is captured as an insertion.

Eight native captures, all on 8.62.09 in PIA (Service Administration delete,
Services/Service Operations add):

| Case | Native result |
| --- | --- |
| ib09 empty REST service delete | Same as standard ib03: PSSERVICE row out, PSSERVICEDEL at SRVM; SRVM/SYS +1 |
| ib10 empty REST service recreate | Same as ib04: marker cleared; SRVM/SYS +1 |
| ib11 Studio-made REST provider GET delete (handler) | Standard ib05 rows plus URI template, PSOPRGENRTGPARM and the generated routing (PSIBRTNGDEFN, PSIBRTNGSUBDEFN, 2 PSRTNGDFNPARM) removed; PSIBRTNGDEFNDEL written at RTDM; OPRM +3, OPRVM/OPRHM/SRVM/RTDM +1, SYS +5 |
| ib12 native REST provider GET create | OPRM/OPRVM/SRVM/RTDM +1, SYS +4; new generated routing with sub-definition and two parameters |
| ib13 native REST provider delete (no handler) | OPRM +2, OPRVM/SRVM/RTDM +1, SYS +4; operation marker at ending OPRM, version at OPRVM, routing at RTDM |
| ib14 same-name native recreate | Clears operation/version markers; generates a new routing name; the old routing tombstone stays |
| ib15 Studio-made REST consumer delete | Identical protocol to ib13 (role-independent) |
| ib16 native REST consumer create | Same counters as ib12; routing PSFT_HR to WADL_NODE over HTTPTARGET |

PIA names a new REST operation `<typed name>_<METHOD>` and keeps the typed
name as IB_ALIASNAME (routing aliases `<alias>.v1`). Studio's REST creation
stores the typed name for both; otherwise its rows match native creation column
for column (provider and consumer).

Implemented (uncommitted): `ibLifecycle.ts` accepts REST services and
single-version REST operations with URI templates and exactly their
writer-generated routing. The logical checkpoint carries the routing's content
(`routing` key, name normalized to `~GENERATED~`); the token binds the real
name. DELETE removes the routing rows and writes PSIBRTNGDEFNDEL at RTDM
(RTDM +1, SYS +1); CREATE lets the writer generate a new routing (RTDM +1,
SYS 4) and leaves old routing tombstones. Credentials in routing parameters,
manual or extra routing rows refuse. `tools/lab/ib-lifecycle-fixture-build.mts`
builds `rest-lifecycle.json`; `ibRestLifecycle.test.ts` replays all eight
captures exactly (11 tests). Full suite 2,199 pass / 1 skipped; 69 HTTP/UI
checks pass. The private-review native trial
(`tools/lab/ib-rest-definition-review-native.mts`, run by the developer because
the auto-mode classifier blocks direct HRDMO writes) passed 11 checks:
reviewed typed recreation of the natively deleted provider GET with its handler,
plus inverse/redo; delete/inverse/redo/restore of the native provider GET and
of the empty REST service. Report
`tools/lab/results/ib-rest-definition-review-native-2026-10-21.json`. A first
run was refused at validation (CONFLICTED, nothing written): the fixture held
capture-format DATE text, not the reader's FF9 projection; the builder now
emits the reader format, verified read-only against three live checkpoints.
Installed acceptance passed with the developer-built, reloaded candidate
(version unchanged; no release): plan-approved set
`1d6cdb6d-d45c-474e-8013-72ae0d2418fb` deleted the provider GET with handler and
routing, the consumer GET and the empty REST service, all VERIFIED; fresh
inverse `0a08a356-084a-4a19-a16d-bc1bfe3a4aef` recreated all three, VERIFIED,
live logical checkpoints equal to the originals. Report
`tools/lab/results/ib-rest-lifecycle-installed-2026-10-21.json`; findings
f-9ed38b55…, f-97f609e2…, f-0a71e38b…, f-81208e0a…. The developer chose to
keep the owned REST fixtures on HRDMO (services `ZZ_PCODE_LAB_IBRP`,
`ZZ_PCODE_LAB_IBRC`, `ZZ_PCODE_LAB_IBRE`; operations `ZZ_PCODE_LAB_IBRPG`,
`ZZ_PCODE_LAB_IBRPG_GET`, `ZZ_PCODE_LAB_IBRCG_GET`, all inactive), superseding the
plan's PIA removal step. Studio's REST creation
now applies PIA's `<name>_<METHOD>` naming (other names warn). Open: 8.61 REST lifecycle;
URI message bindings, credentials and manual routings.

## October 21 IB structural continuation (complete)

Added reviewed editing of existing REST URI template text, with preservation of
ordered URI variable dependencies, sequence/transaction/root identity, complete
URI mapping/content/routing checkpoints, exact rollback after-images and typed
inverse/redo. Eleven structural tests and two native-capture replay tests pass, including
consumer/provider fixtures on 8.61.15 and 8.62.09. The expanded production
HTTP/UI workflow suite passes all 69 checks. Fixture coverage remains separate
from the exact native edits recorded below.

HRDMO connectivity was restored and six existing header rollback previews passed
(standard service/operation, provider/consumer service and operation). Created
three isolated inactive/native calibration fixtures and captured the baseline.
The developer explicitly approved their native PIA deletion/recreation batch.
Native PIA handler deletion/recreation captures now establish the tombstone
and counter protocol. The typed writer replays both captures exactly. Its
five-check native provider/private-review addition/inverse/redo trial passes
and restores the native checkpoint. Handler markers bind freshness tokens,
and marker readback is checked before commit. Deletion is limited to the
paired ApplicationClass REQUESTHDLR/RQST on 8.62.09; 8.61, translated handlers,
other implementation rows and routing handler references are refused.
Eight native PIA captures now include service and operation deletion/recreation,
a repeated handler-present deletion, and a separately verified zero-handler
operation deletion. The latter preserves existing handler history and moves
OPRM +2, OPRVM +1, SRVM +1 and SYS +3. Discovery record
`f-b47631699372535af0cbd1ee` records that observation.

Implemented `ib-service-definition` and `ib-operation-definition` lifecycle
adapters on exact Oracle 8.62.09: complete checkpoints/tombstones, typed creation/
deletion, inverse/redo, dynamically discovered reference checks, credential presence
refusal, exact cache/parent verification, rollback and postcommit token checks.
Operation approval separately binds parent policy/dirty state and reserves both
physical scopes. The parent must already exist; overlapping scopes need separate
Change Sets. REST lifecycle and broader shapes remain refused. Bounded creation
routes from `psft_ib_create`; `psft_ib_definition_get` exposes the complete token;
`psft_ib_delete` stages review-only deletion with destructive review consent.

Nine lifecycle tests include five native capture replays. All 69 production
HTTP/UI fixture checks pass. Native provider/private-review lifecycle acceptance
passes seven checks and restores both service and full original operation
checkpoints; report `tools/lab/results/ib-definition-review-native-2026-10-21.json`.
Private history `/tmp/psft-ib-definition-review-X7CwqI` records exact creation,
deletion, inverse and redo results. This used trusted service test approval,
not installed developer-UI approval. Handler private-review acceptance remains
five checks. Full local verify passes (256 test files, 111-command smoke,
18 editor checks and nine package checks), including the closing capability-
description gate. All 69 HTTP/UI checks also pass after those reference edits.

Installed candidate VSIX SHA-256
`062c39f31a5d34f2a295f50ec9c6683095edef2d612aaef27d1eafd7650ac35b`
was installed and developer-reloaded. The new lifecycle tools/adapters are live.
Installed acceptance now verifies:

- HCDEV 8.61 version-description structural apply/inverse, exact original
  checkpoint restored; both approved temporary fixtures removed through native
  PIA with installed MCP absence checks. Report `ib-861-installed-2026-10-21.json`.
- The historical REST provider handler addition `0cb5ff8b…` now reverses through
  `f47931e1…` and fresh redo `5e1ce757…` restores its exact original applied
  checkpoint. Both VERIFIED with final live MATCHES_RECORDED.
- Standard empty-service/complete-operation deletion `b3cababd…` and typed
  recreation inverse `4d0de13a…`, all objects VERIFIED with live MATCHES_RECORDED.
  An agent cross-connection read closed HRDMO during postcommit readback; the
  operation was correctly marked UNCERTAIN. Developer Reconcile live state
  matched the complete approved after-image and recovered VERIFIED without any
  writer retry. Report `ib-lifecycle-installed-2026-10-21.json`.
- REST consumer backend native rollback/apply/inverse/redo: four checks pass,
  original restored (`ib-rest-consumer-native-2026-10-21.json`). Installed
  version-description structural apply `192d4fa0-2793-4daf-afff-a9722780d15d`
  and fresh inverse `51d362a2-6b34-4704-a3f3-8975433d7ace` are VERIFIED;
  original source REVERTED, complete original checkpoint restored and live
  MATCHES_RECORDED. Report `ib-rest-consumer-installed-2026-10-21.json`.

Priority 1 bounded IB structural review is complete: operation-specific
checkpoints/dependency/validation/inverse rules, 8.61 and REST consumer structural
apply/inverse, standard definition CREATE/DELETE through review, and undo/redo of
the originally refused added handler all have recorded installed evidence. No
commit, tag, push or release publication was performed. Keep one database selected
while an application is running (Workspace.connect disposes the prior provider).
Broader writable cells, 8.61 child deletion, REST lifecycle and other IB definition
families require their own calibration; these trials make no runtime invocation
claim. See [scope and evidence](IB_STRUCTURE.md#installed-acceptance-october-21).

## October 20 recovery development

Combined continuation inverse/redo is implemented with schema-3 source lineage, checkpoint/live-state checks, reverse dependency ordering and fresh approval. Partial inverse approval cannot write or relabel an original fully reverted. Record/AE creation adapters now use calibrated delete/recreate writers with complete native tokens and tombstones. Actual HRDMO trials passed a deliberate Record-only pause, freshly reviewed AE continuation, combined AE-then-Record deletion, and redo restoring both full native checkpoints including compiled PeopleCode. Separately, actual SIGKILL before/after a native HTML commit recovered without replay; native counters/tokens stayed stable during reconciliation and uncommitted work needed fresh approval. All disposable artifacts were cleaned up.

Evidence: [Record/AE inverse and redo](../../tools/lab/results/recovery-native-2026-10-20.json), [real crash/lost response](../../tools/lab/results/recovery-crash-native-2026-10-20.json). Those standalone native trials used trusted service test approval. Separate [installed/native acceptance](../../tools/lab/results/priority-installed-native-2026-10-20.json) now passes actual rendered approval-only/pause, fresh continuation approval, schema-3 combined destructive inverse and fresh redo through the unmodified packaged extension. Native full Record/AE checkpoints including compiled PeopleCode match after restoration, both source histories become REVERTED only after inverse verification, and all temporary rows were cleaned up. The test used a separate real VS Code window with private history, preserving the original running window. Broader deletion remains explicitly unsupported. Interrupted inverse continuation is implemented and separately verified below. The review page exposes source revisions for combined inverses. Migration now has separate full portable-payload adapters and reviewed target membership; see [migration scope and evidence](../PROJECT_MIGRATION.md).

## October 20 interrupted inverse continuation

Schema 4 retains both complete forward-source lineage and continuation
prerequisites. A reconciled failed undo or a deliberate verified pause can
prepare only untouched inverse steps. Approval is fresh and covers every
remaining inverse. Confirmed deletions are checked without replay, repeated
interruptions retain earlier checkpoints, and forward history becomes REVERTED
only after the complete undo is verified. Redo restores all confirmed inverse
steps across the chain. Completed follow-ups, including multiple interruptions,
move the retained partial records out of Pending without rewriting them.

All six [native Record/AE checks](../../tools/lab/results/recovery-inverse-continuation-2026-10-20.json)
pass with cleanup. The test injects a lost reply after actual AE deletion commit,
reconciles without another deletion, applies a freshly approved Record-only
inverse continuation, and redoes both exact native checkpoints. This is separate
from the existing actual HTML SIGKILL evidence. Three service regression tests
cover repeated failures, legacy inverse records, lineage/schema/coverage
tampering, prerequisite drift, and interrupted history publication. Local full
verification: 2,136 pass / one skipped, activation smoke, 18 editor checks and
9 package checks. Production HTTP/UI workflow checks: 61 pass. Identical review refreshes keep
the existing form; changed review state rebuilds it and clears deletion consent.
Redo can be prepared from any original source history covered by the combined
verified inverse, including the original partial application.

Separate installed/native acceptance now passes all six checks through the
unmodified packaged bundle, including the rendered remaining-work action,
exact-state checkbox retention, fresh destructive approval, full native
readback and redo from the original source history. All temporary definitions
were removed, full scoped absence verified, and the private window closed.
The original window was never reloaded.
[Installed results](../../tools/lab/results/inverse-continuation-installed-2026-10-20.json),
[verified inverse](../../tools/lab/results/recovery-installed-inverse-resumed-2026-10-20.png),
[redo](../../tools/lab/results/recovery-installed-redo-resumed-2026-10-20.png).
Candidate SHA: `e468c0a3fef05120bd2ad839996dea19651a345f0703877d60fb34500b32859d`.

## October 20 SQL/content creation reversal calibration

Six actual Windows App Designer cases now establish deletion and recreation
for standalone SQL, HTML and freeform stylesheets, with complete owned-scope
cleanup. Stylesheet deletion advances CRM and SSM and writes two markers; its
recreation clears both markers while only SSM advances. SQL and HTML recreation
also clear their matching tombstones. Typed deletion/recreation writers and complete Oracle 8.62 text checkpoints
are now implemented. Normal reviewed saves, portable manual history and text
migration share the complete paths while preserving legacy partial histories.
Full native marker/token/counter checks, known-reference refusal and rollback
previews precede application. Physical-scope aliases cannot coexist in a set or
its prerequisites. The native service trial covers long Unicode metadata,
unchanged-version drift, lost-reply reconciliation without replay, fresh
remaining undo approval and full redo.
[Current protocol, scope and evidence](TEXT_DELETION.md).

Current acceptance: 20 native provider/service checks and six installed HRDMO
UI checks, with full metadata readback and complete owned-scope cleanup. The
native trial additionally verifies concurrent SQL/stylesheet saves across shared
counters. Installed controls verify actual approval-only/pause, fresh remaining
approval, destructive consent, interrupted inverse continuation and redo from
the original source history. Local gates pass 2,149 tests / one skipped, smoke,
18 editor and 9 package checks; production HTTP/UI checks pass all 63 cases.
[Exact text scope and evidence](TEXT_DELETION.md). Query/project creation
deletion and the remaining migration families are still open.

## October 20 Query/project deletion calibration

Six actual native cases now cover project deletion/empty recreation and public
and JARED-private Query deletion/native Save As recreation. Captures include
all seven populated Query table families, owner-specific QDM tombstones,
project membership preservation/removal boundaries, PJM/QDM/SYS counters and
marker clearing. The snapshot tool includes all native base-table Query/project
keys while excluding project target-account columns and unrelated row values.
All owned fixtures and markers are removed and the original native view restored.
Production typed deletion and reviewed creation reversal remain open for these
families. [Native protocol and implementation gates](QUERY_PROJECT_DELETION.md).

## Recorded 0.9.6 development checkpoints

The following checkpoints retain their original versions, test counts and
then-pending actions. Later entries and the current summary supersede those
statuses; they do not describe a newly inspected live session.

Latest (October 19, after AE/file acceptance): bounded **IB structural review**
is implemented on the existing `ib-service`/`ib-operation` adapters. The
writer's rollback preview defines the after-image; a checkpoint-derived input
must reproduce it exactly at staging, validation and apply. A new generic
`reversalRefusal` adapter hook refuses reversing an added handler up front.
Local: 2,037 tests passed / one skipped; 54 production HTTP/UI checks on Node 20
and Node 26. Native HRDMO rollback-only previews pass for four cases (see
[IB_STRUCTURE.md](IB_STRUCTURE.md)); no native commit or approval occurred.
Installed native acceptance passed (same day, runtime `602c9992…`): developer-
approved ZZ_IB_STDOP structural apply `a86ebb85-f99f-4df0-be0a-400949bd3af6`
and typed inverse `2d37cf05-71ca-4346-9215-dac670516efc` (original restored,
REVERTED); REST provider handler addition `0cb5ff8b-512b-4350-9151-531b9a9a2686`
applied, its reversal refused up front with no partial proposal. Details in
[IB_STRUCTURE.md](IB_STRUCTURE.md). Also: the stale psft_ib_save description is
corrected, and validating an empty Change Set is refused
without marking it CONFLICTED. Verify 2,038 passed / one skipped; 54
HTTP/UI checks on Node 20.20.2 and 26.9.0.

Readiness step 3, adapter acceptance (same evening): one three-object Change
Set `683f4196-2ce3-4ea9-8ff3-28d299bdf49f` (HTML ZZ_PCODE_LAB_HTM2 text +
description, freeform style sheet ZZ_PCODE_LAB_CSS3, Record PeopleCode
ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_MCP1.FieldChange) was developer-approved, applied
and VERIFIED with live MATCHES_RECORDED and independent readback (the decoded
PSPCMPROG carried the new literal). The typed inverse
`41bf31c5-6830-4655-b58e-8e924c9e3ee0` restored all three original snapshots
under fresh tokens; the original is REVERTED. Two defects surfaced and are
fixed: `psft_get_peoplecode` (and record/definition reads) returned decoded
2-space text while the review snapshot holds stored 3-space PSPCMTXT, so an
agent's read-modify-save re-indented every line (they now return stored
source when present); and the review page kept "Approve approach" after
approval (four PLAN_APPROVED entries). COVERAGE.md stale rows (Process,
Event PeopleCode, record/AE/project creation) now cite their native evidence.
Then PeopleCode events with redo: Page `ZZ_PCODE_LAB_PG.Activate` (44),
Component `ZZ_PCODE_LAB_CMP.GBL.PreBuild` (46) and Component Record Field
`...ZZ_PCODE_LAB_T.ZZ_PCODE_LAB_KEY.FieldChange` (48), comment-only, read
through the new stored-source path (each diff exactly one line). Forward
`dafc4ed2-2739-4e33-98d0-91bcb1b162ac`, typed inverse
`be13efe5-4d50-4830-afdd-1004c4279d90` and redo
`576f5403-e922-4107-a3a6-b29ecfeb69d5` were each developer-approved, applied and
VERIFIED; direct DatabaseProvider readback of PSPCMTXT and decoded PSPCMPROG
matched at every step; timelines are continuous (MATCHES_PREVIOUS) with live
MATCHES_RECORDED. The comment remains on these lab programs after the redo.
Found on the way: the plan buttons briefly hid the taken decision, which moved
"Reject approach" under the cursor (fixed 9eee74b: both stay, the taken one is
disabled), and redo titles read "Redo Revert ..." (now "Redo <original>").
Native Page redo then passed on ZZ_PCODE_LAB_PG (apply `2709920a…`, inverse
`3da9bfad…`, redo `2c568d3c…`; see PAGE_ADAPTER.md); the stale earlier redo was
correctly refused. Also fixed: an unknown Change Set ID returned a raw ENOENT
with the local storage path; it is now "Change Set not found". Query structural review
then passed on ZZ_QRY_LAB02: apply `b7bc09bc-99f7-4ba9-afaa-a98e49383de5`
(ESTABID selected as column 2, DESCR text heading "Lab description"; only four
PSQRYFIELD cells changed) and typed inverse
`6c504db6-9e8a-4a0a-b509-f031841c1d2e`, both developer-approved and VERIFIED
with live MATCHES_RECORDED, query VERSION read 16 before, 27 after apply and
28 after the inverse, and generated SQL
checked at each step. Query create/copy stay natively unverified because no
calibrated delete adapter exists to undo them. Query criteria/order then passed
too: apply `ac56e70a-478c-40ac-b2b0-b1644d5c6bf0` (a rollback dry run first
showed the calibrated `constant` operation replaces the single criterion; SQL
became `WHERE ( A.ESTABID = 'ZZLAB') ORDER BY 1`, no prompts) and typed inverse
`13d7ef06-672d-4633-b617-b018899be296` restoring `WHERE ( A.DESCR = :2)` with
prompt BIND2; VERSION 29 -> 30. Next: 8.61 / REST consumer structural
evidence; further native trials should be batched into one Change Set to cut
developer round trips.

Latest checkpoint: the native startup-trace Process UPDATE rolled back on a
JSON property-order comparison bug; its original full live baseline is intact.
The Process writer fix passes the exact native canonical-input rollback preview.
Recovery now confirms an existing UPDATE's exact original snapshot plus token,
without replay, to allow a fresh reviewed continuation. Full verify: 2,028 passed,
one skipped; 52 production HTTP/UI checks. Updated installed-runtime native
reconciliation and freshly approved continuation application now pass: the
original records BASELINE_CONFIRMED; continuation
`b4266a59-b0c9-43af-abfd-1317ff956bfb` revision 1 is APPLIED/VERIFIED with
independent full-input/token readback. Native App Designer then exposed invalid
Boolean uses of File.WriteLine (2,60). Reviewed correction
`af6dd54e-b44c-4c48-b1b0-0dd3e8f045bb` revision 2 is APPLIED/VERIFIED;
native validation passes. HCMDMO instance 607175 completed Success (report posting not verified) and
its 123-byte UTF-8/no-BOM CSV exactly matches expected output and summary.
Build Request is BUILT with no remaining objects. Run control is restored to
Once, all temporary tracing is cleared, project closure reports zero missing.
PC010 guard local checks: 2,030 tests passed / one skipped, protected 430 EXACT,
zero new-rule flags in 413 delivered WriteLine programs. Typed continuation
reversal remains unsupported; cleanup used a fresh approved Process UPDATE.
See the newest checkpoint in
[AE/file workflow](../build-requests/AE_FILE_WORKFLOW.md).

Build Request message ordering and installed acceptance were committed as
`2283c7d`. The bounded HRDMO build reached BUILT after native spec/SQL review
approval and independent state/SQL/AE/project readback. Developer trials also
verified DOCX intake and Claude analysis handoff; their production business-rule
questions were intentionally left unanswered. See ../build-requests/NATIVE_ACCEPTANCE.md.

The 0.9.5 release added `ib-service` and `ib-operation` adapters for existing
description/comments only. Full fixed noncredential checkpoints, native rollback
previews, exact revision/policy authorization, precommit after-image comparison,
typed inverse and history/timeline navigation are implemented. `psft_ib_save`
stages qualifying edits; other IB edits retain legacy confirmation and refuse
explicit Change Set grouping. Creation/deletion and structural IB review remain
future scope. See [IB header contracts](IB_HEADERS.md).

Local evidence: full verify passed 2,015 tests (one skipped), compile/bundle and
108-command/10-view activation smoke. Production HTTP/UI fixtures pass 49 checks,
including both IB adapters' real-writer staged/apply/inverse/history and drift
refusals on Node 20 and Node 26. Native HRDMO rollback previews passed on six existing custom standard/
REST provider/REST consumer service and operation definitions. Every baseline
hash/token and relevant cache counter remained unchanged after rollback.

Packaged and installed `/tmp/peoplesoft-studio-0.9.5-ib-review-dev.vsix`; its
runtime bundle matched the packaged source and installed extension byte-for-byte.
VSIX SHA-256: `b0c079f72d1fc905a35dbb0705ce77111229a17b4db05eecdb5732783a36dcb9`.
After developer reload, live MCP advertises all eleven adapters, including
`ib-service`/`ib-operation`, and `psft_ib_save` exposes Change Set/dependency
arguments. Activation is verified.

Installed native trial `49547af9-241c-49c0-8052-9af19a7a9caa`, **Native IB header
review acceptance**, revision 3, was staged READY_FOR_REVIEW. It changes only description
and comments on lab service `ZZ_IB_STD` and operation `ZZ_IB_STDOP`, with explicit
Service -> Operation ordering. Native rollback validation has no errors. Fresh
MCP readback at staging confirmed both original headers and source tokens unchanged;
both staged objects initially had PENDING review/application. Ownership classification is
UNKNOWN without a delivered baseline/prefix; effective policy requires developer
review. No ownership setting or approval gate was changed.

Developer applied revision 3 through installed Change Review. Read-only native
acceptance passed: APPLIED, both exact approval hashes, before checkpoints,
verified after snapshots, fresh live scoped tokens, expected header values,
clean native validators and Service -> Operation dependencies. Service token:
`5dfc0f9c74aa7099ed7936b05b87f494a5a1dbcddc124c3b2eaf8567286f72cf`;
operation token: `e54ea70612fdeb4ffff69302f68736c158ec54c73a9431bad675973186182640`.
Reports are generated by `tools/lab/ib-review-native-acceptance.mts` under /tmp.

Prepared typed inverse `60e672a7-7257-4d3e-8a05-2401f0973bc3`, **Revert Native IB
header review acceptance**, revision 1: READY_FOR_REVIEW, no validation errors,
both objects PENDING. Dependencies reverse to Operation -> Service. The inverse
restores each complete original scoped content image through typed header
requests, with fresh stamps/tokens; it is not raw row replay or approval reuse.
Developer separately approved/applied inverse revision 1. Read-only acceptance
passed: inverse APPLIED; original REVERTED with verified inverse backlink;
fresh inverse approval/checkpoints; Operation -> Service dependency order;
clean native validators; both complete original scoped content hashes restored.
Service hash: `9a04af1bbdd6af229dcc37e0443621d324082a07acbc2bb83b13de532cf6b774`,
fresh token `30a5167cf8b9cee4546cf4f66d41ebfd92d325c63b1df98897879f5a903768b0`.
Operation hash: `df3178efb4d22e5068b2f8f9a551b2adce6aad0ab81dc7dde409dab458acc4f7`,
fresh token `d44fe3cb7f87671f47f4cf4fcc6ce5c0a86cb60e708e4185378b1c5251df7307`.
The applied/inverse histories and live timeline matches are retained. Neither
trial has pending or uncertain object applications. This closes one installed
HRDMO standard-service/operation header apply/inverse cycle. REST and 8.61
reviewed application, redo and broader structural adapters remain separate
acceptance/scope. No runtime message transmission or credential changes occurred.

Immediate 0.9.6 target: [request to runnable AE/file interface](../build-requests/AE_FILE_WORKFLOW.md).
The user selected this ahead of further IB-only expansion. Development adds
`record-create`, `ae-create` and `project-create`: bounded new-definition native
rollback previews, exact vacant scopes/after-image checks, declared transitive
proposal validation, and live verified prerequisite checks before dependents.
The project composes its existing create/membership writers in one transaction;
Record/SQL/AE/project application as a whole remains per-writer and resumable,
not atomic. Creation undo remains unsupported. Installed native four-object creation and
independent metadata readback now pass; runtime acceptance remains open. See [creation contracts](STRUCTURED_CREATION.md).

Local 0.9.6 verification: 2,024 passed, one skipped; 108-command/10-view/three-editor
smoke, plus 51 production HTTP/UI fixtures on Node 20 and Node 26. The packaged
creation candidate was reloaded; all fourteen adapters are active. Developer
approved spec revision 1 for `br-60e7196e2b0a`, then approved/applied Change Set
`c1d1298e-29ff-4164-9233-d13936d524f1` revision 5. All four objects are VERIFIED;
independent exact after-image/checkpoint/dependency and fresh native timeline
checks pass. Native AE has no validation findings; the project has five exact
members. Closure's phantom MessageBox catalog 0.0 is fixed locally; installed
refresh is pending. Build Request proposals/manual handoffs now remain outstanding
instead of reporting BUILT. Full verification and 51 HTTP/UI checks on Node 20
and 26 pass after these fixes.

Native AE request page recognizes the program. The Run dialog requires a
component-linked Process Definition. The developer separately authorized the
exact lab prerequisite; guarded creation/readback passed. Native scheduler
instance 607102 on HCMDMO ran ZZ_RF_EXPORT / ZZ_RF_ACC_01 and ended No Success:
"Error retrieving Application Engine ZZ_RF_EXPORT.MAIN component: Step Export,
PeopleCode". Report posting also failed with HTTP 900 (63,72). No unrelated
process was run; no successful CSV or 0.9.6 release is claimed. Read-only native
metadata/corpus diagnosis found no proven metadata mismatch. Manual diagnostic
607105 reproduced 108,502 before selective tracing could start. Temporary
user tracing is removed/disabled and run-control Once restored, independently
verified. Startup-trace process update c811c902-977e-476f-8c92-bf350e61499d,
revision 2, is READY_FOR_REVIEW with exactly the Append mode and trace-argument
changes; rollback/full validation passes and nothing is persisted yet. User
application is pending. Build Request export progress is FAILED with actual
runtime evidence; remaining definitions stay verified. Candidate
identity and the concrete next gate are in the workflow tracker.

## 0.9.5 release closeout

Published annotated tag `v0.9.5` at `4f1b22ac09f858842a6621369145ae60e412be2e`
and [GitHub Release](https://github.com/HypergraphIntel/peoplesoft-studio/releases/tag/v0.9.5).
Release-head CI run `39190067531` passed full verification and all 49 MCP/editor
fixture checks. Published VSIX SHA-256:
`457cb2ab3961700b3e657c8a27064f0e332591f090ed4f145dbb739d0441e481`.
Downloaded release assets passed SHA256SUMS verification; the packaged runtime
bundle matches the tested release source. README/CHANGELOG/manifest were audited.
0.9.6 development is prepared separately after publication; the 0.9.5 tag and
published assets remain fixed. No 0.9.6 behavior changes are claimed.

## Historical 0.9.1 closeout

0.9.1 acceptance is complete. The developer authorized the Git release on `main` with annotated tag `v0.9.1`; remote refs provide completion evidence. Distribution publication remains separate. See the [release readiness tracker](../RELEASE_0_9_1.md) for current gates; historical session entries below retain their original evidence/status.

Current closeout: version, lockfile and MCP handshake are 0.9.1. Full verify
passed (1,915 passed, one skipped), 38 fixture HTTP/UI checks passed, and all
103 commands/nine views pass navigation/activation checks. The final candidate
`peoplesoft-studio-0.9.1.vsix` is packaged, source/document/bundle audited and
the prior candidate was installed and reloaded. Native closeout and developer
menu/history placement acceptance pass. The post-push render correction is
locally verified on Node 20/26; it is not yet installed/reloaded.
The earlier candidate was activated and verified with all nine adapters.

Developer-approved native Page/Record/AE application and checkpoint inverse,
Windows Application Designer inspection, a deliberate Record-only pause, fresh
AE-only continuation and separately approved final baseline restoration all
passed independent read-only acceptance. All three original lab scopes are
restored; Page remains version 565. The final audit found zero operational
pending changes and zero uncertain objects. The partial original is retained as
history with its completed continuation; no history was deleted or rewritten.
Native writes occurred only in these developer-approved lab cycles. The full
initiative remains bounded by the adapter coverage and future-work contracts.

Current handoff: commit/tag/push the accepted 0.9.1 snapshot, as requested.
Broader adapter coverage and future initiative work remain outside this release.

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
- [Bounded Page adapter contracts and acceptance gate](PAGE_ADAPTER.md).
- [Bounded Record/AE header preservation adapters](STRUCTURED_HEADERS.md).
- [Required test scenarios and evidence](TESTING.md).

The 0.9.0 live writer checks do not certify the new staged review workflow.
The installed Query apply/reversal/redo timeline has been reverified after
0.9.1 reload. Native Page description and corrected control cycles, Record/AE
header apply/inverse and deliberate pause/continuation/restoration are verified
within their documented scopes. Final UI inspection passed. Broader adapter
coverage remains future work outside the bounded 0.9.1 candidate.

## Objective

Menu-first navigation is implemented in the development source. The placement
contract is [Navigation and action placement](../NAVIGATION.md): bounded header
actions, contextual object/project commands and a dedicated review sidebar.
Approval/application remain in the trusted workspace, with secondary controls
under More actions and explicit All/Pending/History navigation. Installed VS Code
menu acceptance passed on the reloaded final 0.9.1 candidate; this does not
expand the bounded native writer acceptance.

Menu development verification (October 15): full verification passed with 1,916
tests (1,915 passed, one skipped), followed by successful final compile/activation
and 35 production HTTP/UI fixture checks. Navigation audit accounts for all 103
commands, nine views activate, and the view-header limit is checked. The actual
review HTML was rendered and inspected at wide/narrow sizes; narrow layout
probes report no horizontal body/sidebar overflow. Fixture checks verify that
navigation does not approve/apply and that unavailable review actions are absent.
Package `/tmp/peoplesoft-studio-menu-navigation-dev.vsix` matches the current
manifest and bundled JavaScript byte-for-byte and was installed with `--force`.
It includes the pending typed Page guard, Record/AE header adapters and controlled
pause work; those still require their separate native acceptance after reload.
No database changes were made for menu development, and no release/commit/tag/push
was performed. Next UI gate: reload and inspect the sidebar, object/project context
menus and state-specific review controls in the real VS Code window.

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

## Historical next task: final UI candidate reload and 0.9.1 handoff

Bounded native closeout has passed. Query history survives 0.9.1 reload with
three matching verified revisions. Corrected Page controls passed native
apply/inverse and developer Windows Application Designer inspection. Record/AE
headers passed full-scope native apply/checkpoint inverse. A separate Record →
AE trial passed deliberate pause, independently verified untouched AE baseline,
fresh AE-only continuation with pinned unchanged Record, and final full-scope
header restoration. Page remains restored at version 565.

The final read-only audit reports zero operational pending changes and zero
uncertain objects. The original header trial's partial record is preserved as
history, linked to its verified continuation; no history was deleted or rewritten.
Native crash/lost-response, wider object adapters and combined continuation
reversal remain outside this bounded release claim.

Final source fixes address pause-action discoverability and completed-follow-up
queue classification. Full verify passes (1,915 passed, one skipped), and the
production HTTP/UI suite passes 36 checks. Package/activate the final candidate,
inspect menus and Pending/History in the actual VS Code window, and retain the
final artifact fingerprint. 0.9.1 is not yet committed/tagged/pushed/published.

Current implementation source: `src/changeReview/`,
`src/mcp/changeReviewTools.ts`, `src/mcp/reviewRouting.ts`, provider/manual-history
hooks in `database.ts`, and extension/controller wiring. No encoder/decoder
calibration rules have been changed.

## Milestone tracker

Current as of October 20, 2026. Native acceptance is bounded by
[COVERAGE.md](COVERAGE.md); historical candidate checkpoints above and below
retain their original status.

| Milestone | Status | Required completion evidence |
|---|---|---|
| 1. Architecture and inventory | Documented; baseline verified | Source inventory, current/target architecture, contracts, affected files, UX plan, risks and baseline tests recorded; adapter-specific native research remains explicit |
| 2. Change Set foundation | Implemented; fixture verified | Durable schema-1/2 store, snapshots, lifecycle, plans, approval hashes, dependency ordering, reviewed continuation and retry identity; future migrations/retention/shared storage remain open |
| 3. Change Review interface | Implemented; bounded installed acceptance | Persistent review/history, semantic/native diffs, object timelines, baseline comparisons and explicit live checks; native Query, Page and PeopleCode timelines/redo verified; comprehensive visual/manual-path acceptance remains open |
| 4. MCP integration | Partial by explicit adapter | Fourteen Oracle adapters cover text/PeopleCode, Process, Query, bounded Page/Record/AE edits, new Derived/Work/AE/project creation and IB headers/structure; other tools/platforms retain legacy gates |
| 5. Safe application | Core implemented; bounded native acceptance | Native verified application, deliberate pause/continuation and exact-baseline reconciliation with fresh continuation approval; real crash/lost-response recovery remains open; no global atomicity or automatic replay |
| 6. History and reversal | Partial by adapter | Native typed inverse/redo and drift refusal demonstrated on documented Query, Page and PeopleCode paths, plus Record/AE and standard IB inverse cycles; creation and continuation reversal remain unsupported; broader native acceptance pending |
| 7. Full object coverage | Not complete | Corrected Page controls, Record/AE headers, bounded new-definition creation and IB structure have recorded native acceptance; remaining operations/families and platform/release trials need COVERAGE.md evidence |

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
- 2026-10-15: Resumed Change Review after that handoff. The installed MCP still
  reports the lab Query Change Set as `READY_FOR_REVIEW` with review/application
  pending. Added an object timeline in `src/changeReview/timeline.ts`, service,
  review workspace and read-only `psft_get_object_timeline` MCP tool. Scope is
  exact environment/adapter/canonical key. Baselines, verified revisions,
  manual/reversal/partial history, gaps and unresolved proposals are explicit.
  Live checking is opt-in, compares hash and native token, and cannot approve,
  reconcile or restore. History links and baseline comparison resolve retained
  revisions on the host. Also made existing history/compare key matching use
  canonical JSON. No object adapters or encoder/decoder rules were changed.
  Targeted service tests passed (19/19), production HTTP/UI checks passed
  (25/25), and full `npm run verify` passed (1,880 tests: 1,879 passed, one
  skipped; typecheck, bundle, activation smoke). Native apply/reversal and
  installed timeline acceptance remain pending; next task is still the actual
  developer-reviewed lab apply/readback, then reviewed inverse/redo.
  Final `npm run package` and all 25 HTTP/UI checks passed after the UI history
  navigation/cache-invalidation checks were added. Installed
  `/tmp/peoplesoft-studio-change-review-timeline-dev.vsix` successfully; the
  developer must reload the window to activate it. `git diff --check` passed.
  Changes are uncommitted and unpublished. The unrelated untracked
  `tools/corpus/save-protocol/results/cs01-edit/` capture was left untouched.


- 2026-10-15: Developer applied the lab Query proposal. Independent read-only
  acceptance checks confirmed APPLIED/VERIFIED, the exact approval hash, retained
  before-state checkpoint, native semantic snapshot equal to the reviewed after
  hash, and current native token equal to verified readback. The only semantic
  difference is DESCR: `MCP save verified` -> `Change Review validation`.
  Added `tools/lab/change-review-acceptance.mts` for repeatable read-only checks
  after developer-applied lab Query revisions; it cannot approve/apply. Also
  confirmed installed connection display-name resolution and idempotent request
  lookup return the original APPLIED set. Evidence is recorded in
  `tools/lab/results/change-review-native-validation.json`.
  Prepared and validated checkpoint inverse
  `5c6551dc-46de-4de6-81db-ae0cfe163b3f` (description restoration only); it is
  READY_FOR_REVIEW and has not written the database. Next: developer reviews
  and applies the inverse, then run the acceptance harness against that ID,
  confirm the original becomes REVERTED, and prepare reviewed redo. The running
  MCP does not yet expose the timeline tool; installed timeline acceptance
  requires activating the newly installed build. No new native certification
  is claimed for other families or failure/recovery scenarios.

- 2026-10-15: Developer applied inverse
  `5c6551dc-46de-4de6-81db-ae0cfe163b3f`. The read-only acceptance harness
  passed again: native Query semantic snapshot is exactly the original
  checkpoint hash, description `MCP save verified`, current token matches the
  inverse's verified readback, inverse approval hash and checkpoint are intact.
  Independently confirmed original Change Set status REVERTED with its link to
  the verified inverse. Prepared and validated redo
  `523036b4-853a-4f65-a9eb-59b0b55801d7`; fresh current baseline, pending review,
  no inherited approval, and a single description change. Next: developer
  approves/applies redo, then run the read-only acceptance harness against the
  redo ID and check the reversal/history links. Native timeline acceptance
  remains pending activation of the installed timeline build.

- 2026-10-15: Developer applied redo
  `523036b4-853a-4f65-a9eb-59b0b55801d7`. Independent read-only acceptance
  passed: current native token matches verified redo readback, semantic hash
  exactly matches the original reviewed after-state, description is again
  `Change Review validation`, and the redo checkpoint/approval are intact.
  Extended the acceptance harness to verify inverse snapshot links, distinct
  approval hashes, environment/key isolation, REVERTED predecessor statuses and
  journal backlinks throughout the reversal chain (with cycle detection). Ran
  it successfully against the redo. Original and inverse are REVERTED; redo
  is APPLIED. This completes one native developer-reviewed Query description
  apply -> checkpoint revert -> redo cycle, not all object/scenario acceptance.
  Evidence: `tools/lab/results/change-review-native-validation.json`.
  Next: reload to activate the already-installed timeline build, use its
  read-only live check to confirm the three retained verified revisions and
  current redo, then validate installed timeline navigation/comparison and
  restart persistence. Native conflict/crash and broader adapters remain open.

- 2026-10-15: Implemented reviewed remaining-work preparation in model/store,
  service, MCP and review workspace. Only previously approved untouched objects
  are copied; uncertain/manual outcomes and partial reversals block preparation.
  Confirmed/inherited prerequisites are pinned, included in fresh approval hashes
  and checked against history/live hash/token during validation, before each
  writer, at completion and reconciliation. Internal dependencies get new IDs;
  separate approach approval is required again when an original plan exists.
  Repeated requests reuse an existing follow-up. Original partial records remain
  partial with visible follow-up links; no successful writer is replayed.
  Continuations use schema 2 so old builds fail closed, while existing schema-1
  approvals remain compatible. Reversing a continuation needs combined recovery
  semantics and is explicitly unavailable. No encoder/decoder rules changed.
  Verification: 26/26 service tests; 27/27 production HTTP/UI fixture checks;
  final `npm run verify` passed (1,887 tests: 1,886 passed, one skipped), bundle
  and activation smoke. The native read-only redo acceptance harness still
  passes with the new schema-1 approval function. This is not native continuation
  certification. Mutation inventory regenerated: 56 registrations.
  Source changes remain uncommitted/unpublished; unrelated capture files were
  left untouched. Next task is the activation/native acceptance sequence above.

  Packaged `/tmp/peoplesoft-studio-change-review-recovery-dev.vsix` successfully
  through vsce (prepublish typecheck/bundle), then installed it with
  `code --install-extension ... --force`. Activation requires Developer: Reload
  Window. `git diff --check` passed. This build includes both the object timeline
  and reviewed continuation work; no release/tag/push was performed.

- 2026-10-15: Inspected Page/Record/AE writers and chose Page review as the first
  structured adapter target. The Page writer recalculates scroll levels/order
  and related properties, so a simple operation diff is insufficient to predict
  the reviewed native after-state. Added Page rollback-preview groundwork:
  `PageSaveRequest.dryRun`, shared writer verification followed by rollback
  (including unchanged-page lock release), provider preview handling without
  post-rollback verification, and `psft_edit_page` dryRun/expectedVersion.
  Preview asks no save approval, does not refresh editors, and preserves mode,
  writable/operator/scope/dirty/stale gates. Normal save approvals/commit path
  remain. Response explicitly separates base and hypothetical versions/counts.
  Page saves still use legacy gates; this is not a Page staging/reversal adapter.
  Verification: 53/53 targeted Page tests (existing capture-backed plans plus
  three transaction tests); 28/28 production HTTP/UI checks, including the real
  Page provider/writer over a transactional fixture; full `npm run verify` passed
  (1,890 tests: 1,889 passed, one skipped), bundle and activation smoke.
  Native preview acceptance remains open. The live MCP still lacks the timeline
  tool; the read-only native Query redo check continues to pass. No additional
  database writes were applied and no encoder/decoder rules changed.
  Updated capability catalog, Page save documentation, coverage and contracts.
  Next development task: exact native Page snapshot extraction around preview,
  then bounded existing-control staging with native readback equivalence.
  Packaged and installed `/tmp/peoplesoft-studio-page-preview-dev.vsix`
  successfully. Activation needs Developer: Reload Window; the build includes
  the pending timeline/continuation features as well. `git diff --check` passed.
  Changes remain uncommitted/unpublished; the unrelated `cs01-edit` capture
  was left untouched.

- 2026-10-15: Implemented exact Page writer-scope snapshots and a bounded Oracle
  Page review adapter. Eleven native writer tables retain full rows/CLOB text;
  content excludes only header version/save stamps, while tokens bind content
  plus version. Snapshot reads are consistent read-only transactions; previews
  capture native before/after images under the writer transaction and roll back.
  Snapshot failures after DML also roll back. Unsupported native values, missing
  columns/tables, unsafe numeric values, timezone columns and oversized snapshots
  fail explicitly. Existing-control geometry/label/use and description/comments
  stage via psft_edit_page; unsupported operations are refused without orphan
  proposals. Validation reconstructs typed editor requests and demands full
  native after-image equivalence, never opaque row replay. Application adds a
  full snapshot token guard under the native header lock. Stable-ID differences
  and manual Page history are integrated; checkpoint inverses must also pass
  exact equivalence. Fixed routed connection alias checks to compare resolved
  provider IDs. No encoder/decoder rules changed; unrelated captures untouched.
  Next: installed/native Page preview and reviewed bounded apply/inverse, plus
  timeline/restart acceptance. Record/AE and broader Page operations remain open.

  Verification for this Page slice: 59/59 targeted Page tests (50 existing
  capture-backed plans and nine transaction/snapshot tests); 31/31 production
  HTTP/UI checks; full `npm run verify` passed (1,896 tests: 1,895 passed, one
  skipped), bundle and activation smoke. Final HTTP/UI rerun passed. vsce
  packaged `/tmp/peoplesoft-studio-page-review-dev.vsix` with prepublish
  typecheck/bundle; installed successfully. Activation requires a window reload.
  Added `tools/lab/page-review-native-preview.mts`: it checks the advertised
  dryRun/includeSnapshots/version schema and active Page adapter before calling
  any Page writer, then performs preview-only scoped readback checks on a ZZ_
  lab Page. Its capability-only check refused the currently running old host
  because dryRun is absent; no Page writer was called. Native Page/timeline
  acceptance remains pending activation. No tag/push/release was performed;
  source is uncommitted and unrelated capture files remain untouched.

  Read-only installed MCP check confirmed the existing HRDMO lab candidate
  `ZZ_PCODE_LAB_PG` is available (observed version 533, description
  `Lab Page Edited`, 23 controls). No save/preview writer was invoked. Re-read
  live state after activation; these values are observations, not a fixed
  restoration baseline or permission to alter the Page.

- 2026-10-15: Developer reloaded the Page review build. Capability-only checks
  passed: dryRun/includeSnapshots/expectedVersion and the Page adapter are
  advertised. Installed local Query timeline reads retain all three verified
  revisions with MATCHES_PREVIOUS continuity and redo recorded as APPLIED.
  This verifies local history persistence across this reload, not current
  database state or UI navigation. Explicit live checking returns UNAVAILABLE
  rather than claiming a match. Both native acceptance harnesses stopped at
  their initial database reads: Oracle NJS-503 at `127.0.0.1:15210`, confirmed
  no local listener. No Page preview writer, staging, approval or apply ran.
  Sanitized evidence: `tools/lab/results/change-review-reload-validation.json`.
  Resume native preview and Query live acceptance after connectivity returns;
  no additional reload is currently required.

- 2026-10-15: HRDMO tunnel restored. Installed native Query acceptance passed:
  redo semantic snapshot/token still match, timeline MATCHES_RECORDED with
  three verified revisions; reversal links, checkpoints and distinct approvals
  remain intact. Installed Page harness performed three rollback-only previews
  on `ZZ_PCODE_LAB_PG`: all eleven scoped native tables and version/token stayed
  unchanged (version 533). Evidence: `page-review-native-preview.json` and the
  refreshed `change-review-native-validation.json` under `tools/lab/results/`.
  Global counter readback, native Page apply/inverse and visual reopen remain open.

  Description staging exposed an adapter type mismatch: native Oracle
  SECUREINVISIBLE is character `"0"`, while the typed request required integers.
  Existing Page layout/writer readers already convert that flag to Number.
  Added narrow `"0"`/`"1"` conversion for that column only, preserving raw
  snapshots and refusing geometry string coercion. Local projection of the
  captured full native preview now handles all 23 controls; exact diff is only
  PSPNLDEFN.DESCR, `Lab Page Edited` -> `Page Change Review validation`.
  No native Page save occurred; Change Set `ba4a466c-fbf6-4190-9f64-aa423d53edda`
  remains an empty DRAFT for retry after activation.

  Verification: full `npm run verify` passed (1,897 tests: 1,896 passed, one
  skipped), bundle and activation smoke; 31/31 HTTP/UI fixture checks pass with
  native character flags, including Invisible apply and checkpoint reversal.
  Fixture cleanup now retries transient ENOTEMPTY so background UI refreshes do
  not mask results. No encoder/decoder rules changed. Next: install/reload the
  corrected Page build, retry staging/validation, then developer review/apply.

  Packaged `/tmp/peoplesoft-studio-page-charflag-dev.vsix` successfully (vsce
  prepublish typecheck/bundle) and installed it with `code --install-extension
  ... --force`. Developer: Reload Window is needed to activate this correction.
  A final installed rollback-preview rerun still reports the original Page
  hash/token/version 533 unchanged. `git diff --check` passed. No release,
  commit/tag/push or native Page approval/application was performed.

- 2026-10-15: Developer reloaded the character-flag build. Installed native Page
  rollback preview passed again. Retried the same durable Change Set; staging
  returned REVIEW_REQUIRED/persisted=false and validation reached READY_FOR_REVIEW
  at revision 2 with no findings. Exact native diff has only PSPNLDEFN.DESCR:
  `Lab Page Edited` -> `Page Change Review validation`. Object ID:
  `52a831be-ee8d-465d-ac3d-64c52bebb487`. A post-staging/validation rollback
  readback still matches the original eleven-table content hash, token and
  version 533. No native Page save has occurred. Requested actual developer
  approval/application in the persistent workspace; status remains pending.
  Evidence: `tools/lab/results/page-review-native-validation.json` and refreshed
  `page-review-native-preview.json`. Next: independent applied-state readback,
  then separately approved checkpoint inverse and native visual reopen.

- 2026-10-15: Developer applied the native Page proposal successfully. Independent
  read-only installed MCP checks confirm APPLIED/VERIFIED, current exact-revision
  approval hash, the original checkpoint, complete native after-snapshot hash
  and live token. Layout re-read shows description `Page Change Review validation`,
  version 560 and 23 controls. Timeline MATCHES_RECORDED with one continuous
  verified Page revision. Added and successfully ran the strictly read-only
  `tools/lab/page-review-acceptance.mts`; it checks native snapshots, approval
  hashes, checkpoints, live timeline match and reversal-chain links. Evidence is
  appended under nativeApplications in `page-review-native-validation.json`.

  Prepared checkpoint inverse `dd4967c1-8835-4691-b6d2-05dec76ad072`, object
  `50b39a28-dc10-46d5-b10c-fea664741444`, using current live-state verification.
  Its bounded writer rollback validation reached READY_FOR_REVIEW with no
  findings; exact diff only restores description to `Lab Page Edited`. Actual
  developer approval/application requested separately. No agent approval/apply,
  raw-row restoration or cross-environment promotion was used. Native visual
  reopen, counter readback and wider Page operations remain unverified.

- 2026-10-15: Developer applied the Page checkpoint inverse successfully.
  Read-only acceptance harness passed for `dd4967c1-8835-4691-b6d2-05dec76ad072`:
  complete eleven-table after-image equals the original checkpoint content,
  exact approval hash and checkpoint token verified, live timeline matches the
  inverse's new token, and parent is REVERTED with its verified reversal backlink.
  Current description `Lab Page Edited`, version 561, 23 controls; both retained
  revisions are continuous. Native version/save stamps advance normally rather
  than being restored. This completes one bounded native Page description
  apply/inverse cycle, not general Page/control reversal or native redo.
  Evidence: `tools/lab/results/page-review-native-validation.json`.
  Native visual reopen, installed timeline navigation/comparison, wider control
  operations and controlled native continuation/crash scenarios remain open.

- 2026-10-15: User authorized the full next sequence and requested pings only
  when needed. Implemented Page before/after drawings in Change Review by
  reusing the Page designer's layout model, drawing primitives and CSS.
  Persisted control IDs connect highlights and change summaries for movement,
  resizing, label/use and other native properties. Fit/50/75/100 percent scale,
  paired selection and retained timeline baseline comparison are read-only;
  native snapshots/diffs remain inspectable. Captured HTML never executes;
  ambiguous identities, cross-Page snapshots, unknown after-state and excessive
  geometry fail visual preview explicitly. Fluid/subpages/runtime rendering
  remain outside the static preview.

  Five new model/render tests pass, full verify passed (1,902 tests: 1,901 passed,
  one skipped), activation smoke and all 31 production HTTP/UI fixture checks.
  Chromium rendered actual native rollback-preview images; fit, zoom and paired
  control selection/red outlines passed DOM checks and screenshot inspection.
  Native preview on lab Page control 21 has exactly eight PSPNLFIELD differences:
  left 80->88, top 520->528, right 208->248, bottom 540->552, FIELDSIZETYPE 0->2,
  label `Added by MCP` -> `Review control validation`, FIELDUSE 0->3 and
  SECUREINVISIBLE `0`->`1`. Staged set
  `3f97bd7c-eb53-461c-97e3-2250a127a37c`, object
  `8362d6ee-cd1b-444c-ba99-b02ba6a0acfc`, revision 2 is READY_FOR_REVIEW.
  Rollback preview binds restored native version 561 and its full token.
  Packaged/installed `/tmp/peoplesoft-studio-page-visual-dev.vsix`; requested
  developer reload plus visual review/apply and native Designer property check.
  No agent approval/application or native control save has occurred yet.
  Continue Record/AE adapter work while native acceptance awaits the developer.

- 2026-10-15: Developer applied the control-21 proposal; independent full native
  snapshot/token/approval readback passed at Page version 562. Native inspection
  then correctly identified a capability defect: Static Text does not offer
  Display Only or Invisible. The persisted flags were not proof of valid native
  control behavior. Developer separately approved/applied checkpoint inverse
  `6c734bb0-d838-4c30-b39c-a4057104a4e6`; read-only acceptance verifies exact
  original scoped content restored at version 563 with all use flags cleared.
  Marked control-type acceptance FAILED in
  `tools/lab/results/page-control-review-native-validation.json` rather than
  certifying the invalid combination. Added Static Text guards in MCP operations,
  native writer planning and copy projection, allowing unsupported flags to be
  cleared. The agent layout now advertises this limitation; the designer's
  Static Text Use tab already correctly omits the options. Repeat use flags on
  a field control, keeping static-text validation to geometry/label changes.

- 2026-10-15: Implemented deliberate trusted UI application of one approved
  object followed by a pause at a verified writer boundary. Journal records
  PAUSED_BETWEEN_WRITERS; remaining objects stay untouched and require a fresh
  pinned-prerequisite continuation and approval. All original preflight checks
  run before any write. Partial reversal application is refused. Two service
  tests and a production HTTP/UI fixture verify this behavior. This provides a
  controlled native continuation acceptance path without inducing a database
  failure; it is not crash or lost-response certification.

  Added bounded Record/AE description/comments review adapters. Record reads
  six complete native tables and refuses Related Language referrers. AE reads
  twenty complete tables, retaining SQL, source/binary PeopleCode and tombstones.
  Native tokens bind all raw content/stamps; snapshots omit native save stamps.
  Typed header-only requests execute the existing writers and verification inside
  rollback for exact equivalence, then reuse those writers for approved commit.
  Creation/deletion, field removal, DDL, structural AE edits and staged dependency
  overlays remain unsupported on these staged paths. No encoder/decoder changes.
  Native acceptance remains pending activation; local fixture tests cover actual
  writer commit/rollback/inverse, full token drift, capture failures, preservation,
  unsupported-operation refusals and live timeline checks. See STRUCTURED_HEADERS.md.

  Final verification for this slice passed: full `npm run verify` (1,916 tests:
  1,915 passed, one skipped), bundle and activation smoke; 34/34 production HTTP/UI
  fixture checks. Ten structured snapshot/writer tests cover native binary and
  full timestamp fidelity in addition to rollback/inverse and refusal paths.
  Inventory regenerated: 56 mutation registrations; no new agent apply/approval
  endpoint. `git diff --check` passed. No encoder/decoder semantics changed.

  Added capability-gated `tools/lab/structured-review-native-stage.mts` for the
  next controlled native acceptance: appropriate Page controls, existing custom
  Record `ZZ_RPT_LINE` description and AE `ZZ_AE_LAB01` description, all in one
  explicit dependency chain. The script checks advertised staging schemas and
  all three adapters before any edit tool, stages/rollback-validates only, and
  verifies live baselines remain unchanged. Its old-host capability check refused
  missing Record grouping support before any edit; no native Record/AE save ran.
  Native read-only discovery confirmed the custom lab Record is Derived/Work
  (observed version 227) and AE description/reference/PeopleCode validation has
  no errors. These are observations, not fixed restoration baselines.
  After activation, stage and inspect the exact native proposals, then request
  developer approve-all plus Apply one object then pause. Verify Page readback
  and untouched Record/AE baselines before fresh remaining-work approval. True
  crash/lost-response and general structural adapters remain open.

## 0.9.1 candidate activation and native rollback validation — October 15

- Developer reloaded. The actual MCP initialize handshake reports 0.9.1;
  tools/list and service capabilities expose all nine adapters, including
  Record/AE staged arguments. Capability checks passed before edit tools.
- All three controlled lab definitions were confirmed CUSTOM. Native Page,
  Record and AE rollback validation passed, with complete before/after scopes
  and exact semantic differences. Live baseline hashes/tokens remained unchanged.
- Proposal `e419a3b0-1438-41c6-bf4d-af9a90552178`, revision 4, is
  READY_FOR_REVIEW. Page object `0e259b41-1a50-48ee-b959-cce32ebbe54e`
  changes Static Text 21 geometry/label and Edit Box 2 use flags (eight native
  property differences). Record `ZZ_RPT_LINE` changes only RECDESCR; AE
  `ZZ_AE_LAB01` changes only DESCR. Dependencies are Page → Record → AE.
- The first harness attempt used a Record description exceeding the existing
  30-character limit and was refused before any Record save. The test input
  was shortened to “Record review validation”; the same local proposal was
  completed and validated. No native committed change resulted from staging.
- Developer was asked to review/approve the exact set and choose More actions
  → Apply one object, then pause. Native application is pending; do not infer
  it from READY_FOR_REVIEW or the successful rollback previews.
- Candidate artifact audit verified the current manifest/bundle and README /
  changelog after normalizing only VSCE repository-link and issue-autolink
  rewriting. SHA-256 is retained in the release-readiness report.

- After the 0.9.1 reload, the read-only Query acceptance harness passed again
  against redo `523036b4-853a-4f65-a9eb-59b0b55801d7`: exact live semantic
  content/token, approval/checkpoint, reversed predecessors and three verified
  revisions all match. This is preserved-history/reload evidence, not a new write.

## 0.9.1 native structured full application — October 15

Developer confirmed selecting Apply approved changes. The original three-object
set is APPLIED; WRITE_STARTED/WRITE_VERIFIED cover Page → Record → AE. The
read-only acceptance harness passed exact approval hashes, before checkpoints,
staged and persisted semantic snapshots, current native tokens and timelines
for all three. Page is version 564 with the six intended Static Text 21 changes
and two intended Edit Box 2 flag changes. Native Designer reopen remains a
separate check. The controlled pause was not exercised; do not count this as
pause or continuation acceptance. Preparing the normal dependency-aware inverse
will permit independent native header/control restoration checks.

## Native structured checkpoint inverse and Designer confirmation — October 15

The developer confirmed Windows Application Designer matches the corrected
Static Text 21 and Edit Box 2 settings. Then applied checkpoint inverse
`8c52441a-d3b0-48f6-83d3-9712713c46b1`. Read-only native acceptance passed:
original set REVERTED with backlink, fresh inverse approvals/checkpoints,
AE → Record → Page dependencies, complete original semantic scopes restored
under fresh native tokens, and current Page layout at version 565. This closes
one native Record/AE header apply/inverse cycle and corrected Page control
apply/inverse/Designer cycle. Native pause/continuation remains separate and is
being staged as a smaller Record → AE header trial.


## Separate native header pause trial staged

`7b01aa98-bf35-4ccf-8463-7f69113075ec`, revision 3, is READY_FOR_REVIEW.
It changes only Record `ZZ_RPT_LINE` RECDESCR and AE `ZZ_AE_LAB01` DESCR,
with Record → AE ordering. Native rollback previews passed; each full live
baseline content hash equals its restored original scope, and its current token
remained unchanged through staging. The developer was asked to approve both
and use More actions → Apply one object, then pause. No pause/continuation
result is recorded until independently observed. Evidence is in
`tools/lab/results/header-pause-native-validation.json`.

## Pause-action discoverability correction

The developer could not find the pause action while the header trial was
READY_FOR_REVIEW with both objects PENDING. Source and live state confirmed
the current build hid the option until two objects were approved. This was a
UX discoverability issue, not a missing native writer capability. Current
source now keeps the action visible for ordinary multi-object proposals,
disabled with a validation/approval explanation until enabled. It remains
hidden for completed, cancelled and inverse proposals. Production HTTP/UI
coverage checks zero/one/two approvals and refusal of a forged preapproval
application. The installed native test can proceed by approving both first;
the display correction will enter the final candidate package.


## Native controlled pause verified — October 15

Developer confirmed using Apply one object, then pause on header trial
`7b01aa98-bf35-4ccf-8463-7f69113075ec`. Read-only native acceptance passed:
PARTIALLY_APPLIED, exactly one WRITE_STARTED/WRITE_VERIFIED for Record, explicit
PAUSED_BETWEEN_WRITERS, exact fresh approvals/checkpoints, full Record after-state
and token, and AE still matching its complete original before-state and token.

Prepared/validated fresh schema-2 continuation
`0e67da7c-266d-4d78-9dee-1a0d7b586995`, “Remaining work · Native header pause
validation,” revision 1. It contains only AE with PENDING review and the original
before/after hashes. Record is a pinned read-only prerequisite, excluded from
writers. Developer was asked to separately approve/apply the AE proposal. No
continuation application is inferred until independently read back.


## Native header continuation and final lab restoration verified

AE-only continuation `0e67da7c-266d-4d78-9dee-1a0d7b586995` was freshly approved
and applied. Independent acceptance passed its approval/checkpoint, source map,
full AE result/native token and unchanged pinned Record snapshot/token. The
separately approved typed restoration `2dca21dc-f930-458d-9cea-e86617736490`
restored the full original Record/AE scopes under fresh tokens. The final
read-only closeout audit passed all original lab hashes, unchanged Page version
565, zero operational pending changes and zero uncertain results.

Candidate source now treats an original partial record as historical only when
its exact remaining objects, approvals, native baselines, target and pinned
prerequisites match a fully verified applied direct continuation. Its stored
partial status is preserved. Unverified/foreign/mismatched follow-ups remain in
Pending. Fixture HTTP/UI checks cover these refusal cases and the hidden/disabled
pause-control correction; 36 checks pass. Final candidate reload/real menu
inspection remain the last UI gate. No encoder/decoder or unrelated capture work
was changed.

## Final 0.9.1 candidate packaged and installed

The canonical `peoplesoft-studio-0.9.1.vsix` includes both final UI corrections.
Its manifest/contributions, compiled bundle and normalized README/CHANGELOG
match current source. SHA-256:
`161f0d201010460a18cab2e539e626c321aa50e376a364678bbaa7c4602700b6`.
Installation succeeded; reload and actual menu/history inspection are pending.
No release commit/tag/push/publication was performed.

## Final candidate reload verified

Developer reloaded the final candidate. Active MCP handshake is 0.9.1, all nine
adapters are available, and the installed bundle matches the final artifact.
The read-only native closeout passed again: original full lab scopes restored,
Page version 565, zero operational pending work and zero uncertain objects.
Actual menu/history visual acceptance is requested separately; reload alone
is not treated as that acceptance. No commit/tag/push/publication occurred.

## Final developer UI acceptance passed

On October 15, 2026, the developer confirmed “Yes — history and menus look
right”: Pending Changes shows 0, the native header pause original appears in
History as completed via follow-up, and placement is clear and uncluttered.
All bounded 0.9.1 candidate acceptance gates are complete. The readiness report
has no outstanding acceptance items. The larger initiative remains scoped by
the coverage/future-work contracts; release commit/tag/push/publication are
separate and have not occurred.

## 0.9.1 Git release authorized

The developer requested “Commit, tag, and push.” The accepted snapshot targets
`main` and annotated tag `v0.9.1`; matching origin refs are the completion
evidence. README/CHANGELOG now identify the dated 0.9.1 release. The release
VSIX is rebuilt with those final notes and the unchanged accepted runtime
bundle. The unrelated corpus capture remains excluded. Marketplace publishing
and a GitHub Release/artifact upload are separate from this Git release.

## Post-push CI exposed an overlapping-render selection race

The first 0.9.1 push (`f2ff499`, initially tagged `v0.9.1`) passed unit tests
and smoke in GitHub CI, but failed Page inverse approval in the HTTP/UI fixture
twice under Node 20.20.2. This reproduced locally on the same Node version.
Diagnostics showed “Select a current Change Set”: an older store-list render
reset the newly selected inverse to the prior applied set. Revision/selection
guards refused the approval; no wrong object was applied.

The correction gives each render a generation and captures its requested
selection/filter. Obsolete renders return before changing selection and before
publishing a late diff/timeline. Two deterministic regressions cover delayed
lists and delayed previews. The first fails on the original source even under
Node 26; both pass with the correction. Full verify passes (1,915 passed, one
skipped), and all 38 production HTTP/UI checks pass on Node 20.20.2 and 26.9.0.
Native adapters, writer/approval policy and visual placement are unchanged.

The follow-up commit is intended for main. Replacing the already-pushed release
tag is a separate explicit developer decision; it is not silently rewritten.
GitHub CI for the correction provides the remaining remote validation evidence.


Latest startup-trace gate: developer approval was recorded, but application
stopped before writing on missing HRDMO localhost:15210 tunnel (NJS-503),
displaying CONFLICTED. Restored the existing loopback SSH forward and verified
the native process baseline/input are unchanged. Official revalidation passes;
revision 2 is READY_FOR_REVIEW, object PENDING. Revalidation clears its prior
approval under the current service contract; developer re-approval/application
is required. No native update or approval bypass occurred.


Process key-order fix and exact-existing-baseline recovery candidate is installed
but needs Developer: Reload Window. VSIX
`/tmp/peoplesoft-studio-0.9.6-process-recovery-dev.vsix`, SHA-256
`a92edcf4e468b616a1b7c5de4ca8332e8b8cc06dae6174e34a50224c8824b3b3`;
tested/package/installed runtime bundle all match
`b5c60bf91be4a6569d9f22dc32741140bef8a76863e956ef4fb5382334ee4e71`.
2,028 tests passed / one skipped; 52 HTTP/UI checks on Node 20 and 26;
canonical Process input native rollback preview verifies the exact after-input
and unchanged before token/counters. The current live diagnostic record remains
PARTIALLY_APPLIED/UNCERTAIN until trusted UI reconciliation in the new runtime.
Next: reload, reconcile, prepare remaining work, validate and freshly approve/
apply its continuation; then resume native startup-trace capture. No 0.9.6
release, encoder modification or CSV runtime acceptance is claimed.
