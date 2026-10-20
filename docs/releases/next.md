# PeopleSoft Studio 0.9.6 — unreleased

Development starts from [0.9.5](0.9.5.md), published October 18, 2026.
The `v0.9.5` tag and published VSIX remain the released build.

The developer's selected priority is a complete synthetic
request-to-runnable-AE/file workflow: coherent structural
creation review, explicit staged dependencies, native save/readback and actual
expected-output verification. Track implementation and boundaries in
[AE/file workflow](../build-requests/AE_FILE_WORKFLOW.md). Further IB structural
review remains subsequent work.

Bounded Integration Broker structural review now follows the AE/file
workflow: existing service owner/namespace and operation header, version,
parameter and handler edits, plus the calibrated OnRequest handler addition,
stage with exact rollback-preview reproduction. Installed developer-approved
HRDMO application passes for a standard operation with typed inverse and for a
REST provider handler addition whose reversal is refused. See
[IB structure](../change-review/IB_STRUCTURE.md).

Build gains Create Indexes, Alter Tables (by table rename or in place) and
Create Views on Oracle, in the record editor and Build Project. Every script
matches App Designer's own, captured script-only on HRDMO 8.62.09, and the
captures are golden tests. Studio's Alter and index rebuilds executed natively
on an empty lab table and left nothing to change; uncaptured cases are
refused. See [Build: indexes, views and Alter](../RECORD_SAVE.md#build-indexes-views-and-alter).

PeopleCode problems now appear as you type: Validate PeopleCode runs half a
second after typing stops, on a worker thread, with only the latest text
counting (`peoplesoft.peoplecode.validateAsYouType`). With a database it also
checks what App Designer's compiler checks against the environment: bare field
names are qualified as App Designer stores them (quick fix), undefined fields
are 2,17 and unknown functions 2,15.

Track the remaining project completion gates in
[1.0 readiness](../RELEASE_1_0_READINESS.md). No 1.0 delivery date is committed.

Development now implements three additional bounded creation adapters, native
rollback/precommit checks, proposed dependency validation and same-transaction
new project/membership. Full verification passes 2,030 tests (one skipped) and
108-command/10-view/3-editor activation smoke. Combined production HTTP/UI
fixtures pass 52 checks. Installed developer-approved HRDMO four-object creation and independent
readback pass. Native synthetic execution/output acceptance now passes after
the reviewed File.WriteLine correction: HCMDMO instance 607175 Success/Posted,
expected summary and exact 123-byte UTF-8/no-BOM CSV. This is not a published 0.9.6 release.

Process Change Review canonical JSON key ordering no longer causes a false
readback failure. Exact-baseline recovery of a rolled-back existing UPDATE can
prepare a fresh reviewed continuation without replay. The canonical Process
input passed a native rollback-only preview. Updated installed-runtime native
reconciliation and a freshly approved continuation application now pass with
independent full-input/token readback. PC010 now catches direct value uses of
known Local File.WriteLine calls; local full verify passes 2,030 tests / one
skipped, with protected 430 EXACT and zero flags in 413 delivered WriteLine
programs. Representative production workflows and broader 1.0 gates remain open.
