# 0.9.6: request to runnable AE/file interface

Status: complete for this bounded synthetic scope. The exact spec and
four-object Change Set were approved and applied by the developer, plus one
reviewed PeopleCode correction. Independent native metadata acceptance passes,
and HCMDMO instance 607175 produced the exact expected CSV (see the October 19
checkpoint below).

The developer selected the higher-value 0.9.6 target: a fully specified AE/file
interface built through Build Requests, reviewed as one coherent change, run
natively and checked against expected output. This supersedes further IB-only
structural expansion as the immediate priority. Use synthetic data and a
complete test specification; retain business approval and every writer gate.

## Concrete acceptance scope

- HRDMO only, new `ZZ_RF_` lab metadata after live absence checks.
- New derived/work `ZZ_RF_AET`, reusable read-only SQL `ZZ_RF_ROWS`, standard AE
  `ZZ_RF_EXPORT`, and project `ZZ_RF_PRJ` with verified related membership.
- Reuse delivered fields; no delivered metadata edits, business-row changes,
  physical DDL, security changes or file transmission.
- Synthetic source rows produce deterministic CSV output, with documented
  quoting, amount formatting, ordering, negative-row handling and totals.
- The exact spec is approved in Build Requests. Stage the new metadata and
  explicit dependencies together in one Change Set for native review/application.
- Creation adapters must refuse existing/orphaned definitions, preserve normal
  validation/authorization and prove native readback. Do not imply creation undo
  without a calibrated deletion adapter.
- Validate proposed prerequisite records/SQL without requiring premature saves.
  At application, require their actual verified persistence before dependents.
- Native runtime is a distinct verified step. No runtime success from metadata
  readback or local/mock execution. Keep outputs isolated to the lab directory.

## Milestones

| Milestone | State |
| --- | --- |
| Complete synthetic requirement and expected-output fixtures | Prepared in tools/lab/request-file; local compiler and installed HRDMO validator pass |
| Bounded Record/AE creation staging and proposed dependency validation | Implemented; transaction/service/HTTP fixtures pass |
| Reviewed project creation/membership and coherent Change Set | Implemented; same-transaction project create/membership and combined four-object HTTP/UI fixture pass |
| Fixture coverage: stale/absent gates, dependency drift, no premature writes, partial recovery | Full verify: 2,030 passed / 1 skipped; 52 production HTTP/UI checks previously passed on Node 20 and 26 |
| Installed request/spec/build handoff and native approvals | Reload verified all 14 adapters; br-60e7196e2b0a spec revision 1 approved; Change Set revision 5 approved/applied by developer |
| Native metadata apply/readback and project closure | Original creation plus reviewed PeopleCode correction independently verified; five project members, zero missing dependencies |
| Native execution and exact expected-output comparison | Passed: HCMDMO instance 607175 Success/Posted; 123-byte UTF-8/no-BOM CSV exactly matches expected; Once restored, tracing off |

## Runtime reconnaissance

The existing `gundam-server-01` connection reaches the running `ps-app-server`
guest at 192.168.122.151. The current default SSH account is not authorized on
that guest; guest-exec is disabled. The developer selected the existing native Process Scheduler/App Designer
session. The developer signed in to the existing Chrome PeopleSoft tab. A live UI
check confirms the HRDMO Update Manager homepage is authenticated. Browser
authentication is ready for the later native runtime check. Earlier Windows
PSAE evidence was blocked by PSORA64.dll, so that path is not assumed working.

## Creation implementation

See [creation contracts](../change-review/STRUCTURED_CREATION.md). The new
`record-create`, `ae-create` and `project-create` adapters keep exact native
rollback/precommit/readback checks. Proposed dependency context is restricted
to declared transitive stored blobs. Actual application revalidates against live
verified dependencies and stops on drift. New project creation and its explicit
membership share one transaction; the whole Change Set remains per-writer.
Creation undo is unsupported. No encoder or decoder changes were needed.

Live read-only preflight found no matching ZZ_RF_AET, ZZ_RF_ROWS, ZZ_RF_EXPORT
or ZZ_RF_PRJ definitions. PROCESS_INSTANCE is Number(10), DESCR Character(30),
both version 1. HRDMO PeopleCode validation reports valid/PT862/importsChecked
with no problems. These do not substitute for native creation or execution.

## Candidate and local intake

Initial creation candidate: packaged and installed
`/tmp/peoplesoft-studio-0.9.6-ae-file-dev.vsix` after
full verify (2,024 passed, one skipped; 108 commands, 10 views, three editors)
and 51 production HTTP/UI checks on Node 20 and Node 26. Package/runtime/source
bundles match byte-for-byte. Candidate SHA-256:
`15090e05e95783e87578561d3422a4d402a3a16043288eb136f8e3daae3d32f9`.
Bundle SHA-256:
`23671a779183c70a2bf4b7b156e7e05978fef389b62cd22104cbaa25c781456e`.
This is a development candidate, not a published release or native acceptance.

The fixture bootstrap created one new local intake with the current
BuildRequestStore and four synthetic attachments with provenance hashes.
The developer approved exact spec revision 1 for `br-60e7196e2b0a`,
**Synthetic CSV export acceptance**. After reload, live MCP advertised all
fourteen adapters and the typed creation/dependency arguments.

## Installed native application and readback

The developer approved/applied **Synthetic CSV export acceptance — ZZ_RF_EXPORT**,
Change Set `c1d1298e-29ff-4164-9233-d13936d524f1`, revision **5**. It is APPLIED;
all four objects are APPROVED and VERIFIED, with empty validation findings.
Independent `tools/lab/request-file/native-acceptance.mts` checks exact approved
hashes, absent-before checkpoints, complete typed after-images, declared
Record/SQL -> AE -> project dependencies and fresh live timeline matches.
Report: `/tmp/psft-ae-file-native-metadata.json`.

| Adapter / key | Verified native after-image SHA-256 |
| --- | --- |
| record-create / ZZ_RF_AET | `1f701f7ac7ecb17d9c335abc72893446776f55d5d19a8c093267cb3fa2185e03` |
| sql / ZZ_RF_ROWS | `056d87eae9aa33a4619a9f197bf08c1c10711df556a94f5f2b7cc832a0f54512` |
| ae-create / ZZ_RF_EXPORT | `a7322e125dd748863dca2a6d3d0385e0273c46dbcaa90802c8db45aa83e35e58` |
| project-create / ZZ_RF_PRJ | `63d068df17ae3faeaa9a7bf6d945bcdf617c6be8c3efcdbebbc5f5f3cbe834c1` |

The AE reader returns no errors or warnings. The project contains exactly the
state record, reusable SQL, AE program, MAIN section and Export PeopleCode.
No generated action SQL is expected for this PeopleCode-only action.
Creation undo remains unsupported; no deletion was attempted.

Two follow-up fixes arose from the installed trial:

- STAGED and MANUAL had counted as Build Request completion. They now remain
  outstanding: **Awaiting Change Review application** / **Manual steps remaining**.
  Real store, panel-message and production HTTP fixtures cover the lifecycle.
- Project closure reported a phantom Message Catalog `0.0` for the fallback
  `MessageBox(..., 0, 0, defaultText)` idiom. The scanner now excludes that exact
  pair and still includes real catalog references. Oracle documents this idiom
  in its [PeopleCode reference](https://docs.oracle.com/cd/F44948_01/psft/pdf/pt858tpcl-b072021.pdf).
  The active earlier candidate still reports the phantom; verify closure again
  after installing/reloading the corrected candidate. Do not create catalog 0.0.

## Native runtime checkpoint

The authenticated HRDMO browser opened **PeopleTools > Application Engine >
Submit AE Process Requests**, recognized `ZZ_RF_EXPORT` with its saved description,
and created lab run control `JARED / ZZ_RF_ACC_01`, frequency Once, no parameters.
The native Run dialog lists existing component-linked Process Definitions;
`ZZ_RF_EXPORT` is absent. No unrelated process was selected or submitted.
The [Oracle AE request-page documentation](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/application-engine/starting-programs-application-engine-process-request-page.html)
describes the native request workflow; metadata persistence alone does not run it.

Prepared a separate rollback-only Process Definition preview:
Application Engine / `ZZ_RF_EXPORT`, description `Synthetic CSV export`, server
execution, API aware/log request, restart disabled, default category, component
`AE_REQUEST`, existing process group `TLSALL` (as the delivered test definition),
no server override, recurrence, command override or permission-list changes.
The native writer preview passed and rolled back. This prerequisite was not in
approved spec revision 1; the developer separately authorized this exact lab
Process Definition. The guarded create saved it as JARED, VERSION 30, and an
independent readback verified its complete input/associations and token
`92f9f2f3ef6f97aa8083170a49d750faf36f22ad849ce63ed500a89d890b7b82`.
Process creation uses its existing per-write confirmation, not a creation
Change Review adapter. It is not part of the applied four-object Change Set.

Next: run `ZZ_RF_EXPORT` once through the native request page, capture the
instance/status/log/output, and compare the actual UTF-8 CSV. If runtime fails,
record the native error before proposing a correction. No runtime success or
complete AE/file acceptance is claimed yet.

## Corrected candidate

The same temporary VSIX path now contains the two follow-up fixes. Full verify
still passes 2,024 tests / one skipped and activation smoke; all 51 production
HTTP/UI checks pass on Node 20 and 26. It is installed; a VS Code window reload
is required to activate these follow-up fixes. Source/package/installed runtime
bundle SHA-256 matches:
`87f1c45b51568d4ee7d47377435d7518f6d3981f3a6d32848fa0d9c906ea9a66`.
Corrected VSIX SHA-256:
`ad55dad08e82d50819a7a0cc6689ddacef6bafbeef188f6f6ee8966a35d56abb`.
Reports: `/tmp/psft-096-final-verify.log`,
`/tmp/psft-096-status-workflow.log`, `/tmp/psft-096-final-node20.log`.
No release/tag/commit was created for this development work.

After independent native acceptance, all four spec objects were reported BUILT
with their exact hashes and the explicit runtime/closure caveats. This records
metadata persistence only. It does not establish successful execution or CSV
acceptance. Native request screenshot: `/tmp/psft-ae-native-request.png`.

## First native execution: failed, evidence retained

Native request `607102`, run control `JARED / ZZ_RF_ACC_01`, executed on
scheduler `HCMDMO` October 18, 2026, 10:38:07 PM CDT. It ended **No Success**.
Message Log and actual shared stdout both report:

> Error retrieving Application Engine ZZ_RF_EXPORT.MAIN component: Step Export, PeopleCode (108,502)

The stdout identifies **Application Engine Server 8.62.07**; the database lab
was calibrated as 8.62.09. This version difference is observed, not established
as the cause. Report posting independently failed HTTP 900 (63,72), leaving
content 94690 Not Posted and View Log/Trace unavailable. The scheduler output
is accessible read-only through the existing authorized gundam-server-01 NFS
export: `/opt/nginx/shared/reports/HCMDMO/AE_ZZ_RF_EXPORT_607102/` corresponds to
its `/mnt/nginx_shared/reports/HCMDMO/AE_ZZ_RF_EXPORT_607102/` path. Only stdout
is registered for this request; no CSV was generated. Local evidence:
`/tmp/psft-ae-607102.stdout`, `/tmp/psft-ae-607102-message-log.png`.

Read-only `native-diagnose.mts` captures program/variant/step/action keys,
PeopleCode headers/names, the exact scheduler request, report metadata and
noncredential report-node fields into `/tmp/psft-ae-runtime-diagnosis.json`.
Native built-in File dependency metadata matches the generated shape; no
speculative metadata or encoder correction was made. Targeted HCDEV harness
checks for IDs 27362, 28098 and 19282 pass source-to-bin and roundtrip EXACT.
These are diagnostic comparisons, not a native runtime pass. Next diagnostic:
user-scoped selective tracing for only ZZ_RF_EXPORT; preserve existing settings
and disable the temporary tracing after the diagnostic run.

User-scoped selective tracing was configured through PIA for only
`JARED / ZZ_RF_EXPORT / MAIN` (all steps/actions in that section), PC trace 2
and SQL trace 3. A fresh browser reload and independent read-only native tables
confirm the exact scope and enabled state; no other enrolled programs exist
for JARED. Diagnostic rerun submitted as instance **607104** using the same
run control and Once frequency. Disable selective tracing after it finishes.

PIA automation note: text entered through generic fill did not reach its native
FieldChange state; native key input plus Tab did. Dependent trace selections
must wait for the native numeric flag to change before the next selection.
Required-field validation refused the earlier unsaved drafts. Reload confirmed
the original disabled/empty state before the final scoped setup was saved.

Instance 607104 completed with a warning that the Once request was inactive
(108,517); it did not execute the export, so its scheduler Success status is
not accepted as runtime evidence. For a manual diagnostic retry, the run
control frequency was changed to Always (no recurrence), and only ZZ_RF_EXPORT
was submitted as **607105**. Restore Once after this diagnostic finishes.
Build Request `export` progress is now FAILED with the native 607102 evidence,
so the overall request remains BUILDING with export outstanding. The three
other definitions remain BUILT/verified; no approval or checkpoint was altered.

## Next review gate: startup trace

Manual diagnostic instance **607105** reproduced No Success / 108,502 before
MAIN could emit a selective trace. Its stdout is retained at
`/tmp/psft-ae-607105.stdout`; actual shared output contains only stdout.
A later request has distribution status Posted; the first request's HTTP 900
posting failure is separate from the repeatable PeopleCode-load failure.
Do not treat an exit/return code of 0, or 607104's skipped Success, as CSV
acceptance. Actual execution, expected summary and exact file are required.

Cleanup is independently verified in native tables: JARED's selective tracing
is N, enrolled scope rows are empty, and the run control is back to Once (O).
No temporary selective tracing remains enabled. Screenshot:
`/tmp/psft-ae-607105-runtime-result.png`.

Prepared **Diagnose ZZ_RF_EXPORT native PeopleCode load**, Change Set
`c811c902-977e-476f-8c92-bf350e61499d`, revision **2**, READY_FOR_REVIEW.
It contains one process UPDATE with exactly two differences:

- `PARMLISTTYPE`: None (0) -> Append (3).
- `PARMLIST`: blank -> ` -TRACE 7 -TOOLSTRACEPC 2131 -TOOLSTRACESQL 3`.

The [Oracle process-parameter reference](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/process-scheduler/entering-global-definitions-processes.html)
documents these startup trace flags. Native rollback preview and full Change
Set validation pass; original process token remains unchanged, so staging
persisted nothing. Original token:
`92f9f2f3ef6f97aa8083170a49d750faf36f22ad849ce63ed500a89d890b7b82`.
Before/after hashes:
`44c3acd74ac4757a13913a202041302e69a617129f005dcab7cd739122c1b8dc` /
`69638c2ff21084b8ac939de5658f40986dfebb63d71646120ad6669a12801535`.
Proposal artifact: `/tmp/psft-ae-startup-trace-proposal.json`.

Developer review/application of this exact revision is pending. After it is
applied: verify its full input and token, execute only this synthetic program
through the native request page (rearm the consumed Once request for that manual
run), read startup trace from the known NFS output, and diagnose the first
concrete loading error. Then prepare the process adapter's typed reversal with
fresh baseline for separate native review and restore Once after execution.
Do not alter the approved AE or encoder based on the generic 108,502 message.
The original four-object creation Change Set stays intact.

## Connection recovery after developer approval

Developer approved startup-trace revision 2, but its application stopped before
any write because the local HRDMO tunnel at 127.0.0.1:15210 was absent (NJS-503).
The durable set displayed CONFLICTED; its process object stayed PENDING, with
no checkpoint/write/uncertain application. The existing authorized SSH forward
through gundam-server-01 to 192.168.122.206:1521 was restored, bound only to
127.0.0.1:15210, with keepalives. Native process readback confirms the exact
original token and input are unchanged.

Official Change Review revalidation now passes with no findings and returns
revision 2 to READY_FOR_REVIEW. Its current validate implementation clears
approval during revalidation, so the developer must approve/apply this same
revision again. No JSON approval/status was altered outside the review service;
no trace update has persisted. This was transport failure, not native drift.

## Process canonical-order failure and recovery correction

The developer's next application entered the Process writer, but its precommit
readback comparison failed. The writer rolled back; fresh native full input and
token still match the original baseline exactly. Change Set
`c811c902-977e-476f-8c92-bf350e61499d` is PARTIALLY_APPLIED with one UNCERTAIN
object because the review service conservatively records any thrown write that
way. Do not retry that original application or alter its stored approval JSON.

Confirmed cause: the review store serializes property keys alphabetically;
`saveProcess` compared its fixed-order `processEdit()` result with that input
using JSON.stringify. Key insertion order alone caused the false failure.
Two new writer regressions reproduce the error before the fix. The installed
old writer also fails a rollback-only preview of the exact canonical after-image.
The writer now compares property values structurally and sorted association
sets for both no-op detection and readback. Actual value differences, version,
operator, unrelated-column and PPC/SYS checks remain required.

Native `tools/lab/request-file/process-trace-preview.mts` runs that exact
canonical reviewed input through the corrected source writer in rollback-only
mode: full output input matches; native token and PPC/SYS/lock counters are
unchanged afterward. It never commits. Report:
`/tmp/psft-process-canonical-native-preview.json`.

Reconciliation now handles a thrown existing UPDATE whose complete before-image
AND original non-absent token are still exact: mark the application PENDING,
journal BASELINE_CONFIRMED, and permit a fresh reviewed continuation. It performs
no write or automatic retry and cannot reuse approval for the continuation.
Previously VERIFIED writes, content drift, token drift, absent creations and
unknown manual outcomes do not take this branch. Unit and production HTTP/UI
fixtures cover the blocked/reconciled/fresh-review/application lifecycle.

Updated local checks: 2,028 passed / one skipped, activation smoke and 52
production HTTP/UI checks. Corrected installed extension activation and native
reconciliation/application are the next gate; the existing record is still
UNCERTAIN until the developer uses Reconcile live state in the corrected runtime.
After a VS Code window reload: reopen the original diagnostic set, Reconcile
live state, Prepare remaining work, then approve/apply the new continuation.
This retains the failed original record and its before checkpoint honestly.

Corrected Process/recovery candidate packaged and installed:
`/tmp/peoplesoft-studio-0.9.6-process-recovery-dev.vsix`, SHA-256
`a92edcf4e468b616a1b7c5de4ca8332e8b8cc06dae6174e34a50224c8824b3b3`.
Source, packaged and installed runtime bundles match SHA-256
`b5c60bf91be4a6569d9f22dc32741140bef8a76863e956ef4fb5382334ee4e71`.
Full verify: 2,028 passed / one skipped; 108 commands, 10 views, three editors.
All 52 production HTTP/UI checks pass on Node 20.20.2 and Node 26.9.0.
Reports: `/tmp/psft-process-recovery-verify.log`,
`/tmp/psft-process-recovery-http20.log`, `/tmp/psft-process-recovery-http26.log`.
Native canonical source-writer rollback preview passes; no commit or native
review-status mutation was performed by that script. No encoder changes.

Developer next steps: Developer: Reload Window; reopen the existing diagnostic
set; Reconcile live state; Prepare remaining work. The new continuation starts
as DRAFT: Refresh and revalidate, Approve all eligible, Apply approved changes.
The service requires fresh continuation approval and trusted UI application.
The original approval/checkpoint/history are retained, not rewritten to applied.

## Installed recovery and continuation verified — October 19

The developer reloaded, reconciled and freshly approved/applied the continuation.
Original set `c811c902-977e-476f-8c92-bf350e61499d` retains its partial history;
the original object is now PENDING with BASELINE_CONFIRMED and
RECONCILED_WITH_LIVE_STATE journal entries. No original write was replayed.

Continuation `b4266a59-b0c9-43af-abfd-1317ff956bfb` revision 1,
“Remaining work · Diagnose ZZ_RF_EXPORT native PeopleCode load”, is
APPLIED/VERIFIED. Its process object is
`087f5fc7-733b-4264-b0f0-b81638121d86`. Verified after hash is
`69638c2ff21084b8ac939de5658f40986dfebb63d71646120ad6669a12801535`;
verified token is
`11ca328545bdf8f7a4d87bb37b2364e3a8983a53f289390f52bbf38d6beb12c7`.
Fresh native process readback independently matches full input and token:
VERSION 31, Append parameters
` -TRACE 7 -TOOLSTRACEPC 2131 -TOOLSTRACESQL 3`, AE_REQUEST and TLSALL.
Installed project closure also reports five members, zero missing dependencies.

The existing PeopleSoft browser session expired overnight; its sign-in page has
been reopened. Next: sign in, rearm the consumed lab request for one manual run,
capture the startup trace through the existing NFS path, and restore Once.
Prepare the typed reversal of the applied continuation after evidence capture.
The original four-object build is retained; native CSV runtime acceptance is
still incomplete.

## Startup trace captured — native instance 607168

After browser sign-in, the existing JARED / ZZ_RF_ACC_01 request was rearmed for
one manual run. Only ZZ_RF_EXPORT was selected, with blank recurrence. Native
Process Scheduler instance **607168** ran on HCMDMO at October 19, 13:21:59 CDT
and finished **No Success** at 13:22:00. Distribution subsequently reached Posted.

The stdout confirms all three reviewed flags were active: AE trace 7,
PeopleCode trace 2131 and SQL trace 3. Files in
`/opt/nginx/shared/reports/HCMDMO/AE_ZZ_RF_EXPORT_607168/` are stdout, `.trc`
and `.AET`; no CSV was produced. Local captures:
`/tmp/psft-ae-607168.stdout` (SHA-256
`0bde1c3875b2d26983d48c16df2241ea13062f60ba4356a3440be3455d393314`)
and `/tmp/psft-ae-607168.trc` (SHA-256
`340488fc2f7cf205615bec1f3314ff65296efd211d84b6679c3d4709ab27ab46`).

Failure remains 108,502, retrieving MAIN / Step Export / PeopleCode before any
action executes. Stdout now also shows SearchArchive RC=3,
AeCursCheckOutCallState RC=3 and AeDefnGetSection RC=8. The trace contains no
PeopleCode execution, action-definition retrieval SQL or lower-level compiler
error; its AE trace contains only the program header. These observations do
not establish a cache or encoding defect. Server identifies as 8.62.07 while
the database is calibrated as 8.62.09; the mismatch is not proven causal.
Native reference inspection confirms blank first PSPCMNAME rows are normal
(all 12,723 existing AE first-name rows), and existing File/SQL package rows
match this program's conventions. No encoder/decoder rule was changed.

Run-control PROCESS_FREQUENCY is independently verified **O (Once)** after
cleanup. User-scoped selective tracing remains disabled with no scope rows.
For PIA restoration, reloading the component, selecting O with selectOption,
letting the field change settle and saving persisted the change; the initial
keyboard-only selection displayed Once but did not persist it. Always verify
the database value after this workflow.

Typed prepare-revert refuses a continuation with “Reversing continued work
needs a combined recovery plan; it is not supported yet.” No inverse was
forced. Instead a normal guarded Process UPDATE stages the original complete
input against the current verified token in **Restore ZZ_RF_EXPORT trace
parameters**, Change Set `9771ac70-e1ae-446f-903e-cde0f1bb7af8`, revision **2**,
object `8400d02b-610f-4b6f-b28c-f57ca7197d22`. Rollback preview and full
validation pass. The only differences clear PARMLIST and set PARMLISTTYPE to
0; after hash is the original
`44c3acd74ac4757a13913a202041302e69a617129f005dcab7cd739122c1b8dc`.
The developer approved/applied revision 2 at 19:32:51 UTC on October 19.
Status is APPLIED; the object is VERIFIED. Independent native readback confirms
VERSION 32, PARMLIST empty, PARMLISTTYPE 0, original complete editable input,
and verified token
`52698092840291afc1c44d356f7664b9d2be7b51af7ecbf89f76a4428e13d1a4`.
Run control remains Once, selective tracing is disabled and its scope is empty.
Temporary tracing cleanup is complete; no further approval is pending for it.

Build Request export stays FAILED / overall BUILDING with this native evidence.
Next evidence needed: open the exact Export PeopleCode in native App Designer
and validate it without saving; capture any native loader/compiler diagnostic.
A cold standalone PSAE run could separately distinguish a persistent-server
cache problem, but no scheduler restart/configuration change is authorized or
performed as part of this run. Native CSV acceptance remains open.

## Native syntax correction and completed CSV acceptance — October 19

Native App Designer Validate Syntax reported **2,60**, “Function or method does
not produce a result value,” at the header's `If Not &out.WriteLine(...)`.
The same invalid Boolean usage existed at the detail and trailer writes.
Studio's compiler/semantic checks had accepted that invalid source; metadata
readback alone did not establish native validity. Oracle documents that
[WriteLine returns no value](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/peoplecode-api-reference/writeline.html)
and [non-field File errors terminate the program](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/peoplecode-api-reference/file-layout-error-processing.html).
All three calls are corrected to standalone statements, retaining the same
data, format, open check, resource closure and abort-on-error requirement.

The developer approved/applied **Fix ZZ_RF_EXPORT WriteLine return-value
error**, Change Set `af6dd54e-b44c-4c48-b1b0-0dd3e8f045bb`, revision **2**.
PeopleCode object `c9eda2e3-1194-49b2-81a9-312840ed220c` is VERIFIED;
after hash `a608fd8bdf38679256993452fb92413f891e289a9c1b7b7f3ffda40e94c32f4d`,
live token `800d674f36a2d12fa4b6e6e275885c707591b7f8cb504bdfb8fad789b983268e`.
The developer then confirmed the corrected code validates in native App Designer.
The original approved attachment and creation history are retained unchanged.

Native Process Scheduler **607175**, HCMDMO / JARED / ZZ_RF_ACC_01, ran at
14:54:09–10 CDT and completed **Success** (RUNSTATUS 9), **Posted** (DISTSTATUS 4).
Stdout says `ZZ_RF_EXPORT: accepted=3 rejected=1 total=30.75 (0,0)` and that the
program ended normally. Actual output in
`/mnt/nginx_shared/reports/HCMDMO/AE_ZZ_RF_EXPORT_607175/ZZ_RF_EXPORT.csv`
was read through the existing authorized NFS host. The output comparator
passes: **123 bytes, UTF-8 without BOM, exact expected content**, SHA-256
`62d92d414fc02901271744facb65c61b5d9bbecc6f7edfecc31fc734f11b6367`.
Retained evidence: [manifest](../../tools/lab/request-file/results/607175.json),
[actual CSV](../../tools/lab/request-file/results/607175.csv) and
[native stdout](../../tools/lab/request-file/results/607175.stdout).
Run control Once and selective tracing off/empty scope are independently
verified after execution. Process startup-trace parameters remain cleared.

The installed-MCP audit now verifies the immutable original creation plus an
explicit supplemental correction, including its before/after source, approval,
live hash/token, complete current AE spec and project closure:

```bash
npx tsx tools/lab/request-file/native-acceptance.mts c1d1298e-29ff-4164-9233-d13936d524f1 --correction af6dd54e-b44c-4c48-b1b0-0dd3e8f045bb --require-closure
npx tsx tools/lab/request-file/check-output.mts tools/lab/request-file/results/607175.csv
```

Build Request `br-60e7196e2b0a` is now BUILT, with no remaining, awaiting-review
or manual objects. This completes this bounded synthetic acceptance; it does
not establish representative production-interface or full 1.0 readiness.

Local PC010 prevents known Local File receivers' WriteLine being consumed as
a value. Focused regressions prove the old rejection gap and legal neighbors;
the HCDEV census of all 413 programs containing WriteLine has zero flags.
Literal delimiters are retained only for this check to avoid false positives
after `When = "literal"`; default masking behavior and encoding rules are
unchanged. Targeted definitions 27362, 28098 and 19282 remain EXACT; protected
430 remain EXACT with zero regressions. Full verify: 2,030 passed / one skipped,
108 commands, 10 views, three editors. These validator changes are local source
until a new candidate is installed/reloaded; the native PeopleCode correction
is already applied and successfully executed.
