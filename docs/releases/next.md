# PeopleSoft Studio 0.9.6 — unreleased

Development starts from [0.9.5](0.9.5.md), published October 18, 2026.
The `v0.9.5` tag and published VSIX remain the released build.

The developer's selected priority is a complete synthetic
request-to-runnable-AE/file workflow: coherent structural
creation review, explicit staged dependencies, native save/readback and actual
expected-output verification. Track implementation and boundaries in
[AE/file workflow](../build-requests/AE_FILE_WORKFLOW.md). Further IB structural
review remains subsequent work.

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
