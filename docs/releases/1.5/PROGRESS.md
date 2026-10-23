# 1.5 progress

Working tracker for the [1.5 targets](../../RELEASE_PLAN.md#15--deeper-development-and-delivery-workflows).
Started October 22, 2026. Native evidence lives in `tools/lab/results/`;
nothing here is released.

## Status

| Target | State | Evidence | Remaining |
| --- | --- | --- | --- |
| V15-1 Page structure | Implemented (b5912ba8) | Unit + transaction tests, HTTP/UI fixture, HRDMO rollback previews and a rolled-back native apply/inverse/redo cycle; App Designer captures ps01–ps04 | Installed developer apply/inverse/redo; App Designer reopen after a returned MAXPNLFLDID |
| V15-1 Record field structure | Implemented (75351f32) | Transaction tests, HTTP/UI fixture, HRDMO rollback previews and a rolled-back native apply/inverse/redo cycle | Installed developer apply/inverse/redo |
| V15-1 AE structural edits | Implemented | Unit tests, HTTP/UI fixture, HRDMO reconstruction of all 20 saveable ZZ_ programs, rolled-back native apply/inverse/redo with tombstone projection | Installed developer apply/inverse/redo |
| V15-1 Package/class lifecycle | Implemented | HTTP/UI fixture, HRDMO previews and rolled-back native create/undo/redo of classes and packages | Installed developer apply/inverse/redo |
| V15-2 Separate-environment promotion | Implemented | Unit tests, HTTP/UI fixture, HRDMO → HRDEV native trial (8 checks incl. undo/redo, conflicts, partial failure, alternate keys/In-Memory, message channels) | Installed UI promotion between two configured connections; class/subpackage metadata (no calibrated writer) |
| V15-3 Business application acceptance + Windows AI handoff | In progress 2026-10-22 | ps-win-client set up by the agent (winget Node 24.22.1 + Git 2.55.0; the developer installed Claude Code 2.1.309 / Codex 0.163.0, signed in and set PowerShell `RemoteSigned` for the user). Four Windows defects found and fixed: `.cmd` launchers via `cmd.exe` (`spawn EINVAL`); no quote in handoff arguments (PowerShell 5.1 strips double quotes, VS Code leaves single quotes unescaped: Claude gets an MCP config file, Codex a bare URL, which it reads as a literal); agent tasks identified by phase and agent (a running analysis hid the build). Request br-9e49eca2090e: Claude Code analyzed it, 5 questions answered and spec revision 1 approved 8:20:27 PM by the agent as the developer's delegate; Codex build started, first MCP write approval (field ZZ_AS_OF_DT) expired after 60 s, nothing written; Codex found the spec's AE state record ZZ_BENELIG_WRK breaks Studio's AET rule | Spec revision (state record ZZ_BENELIG_AET), Codex build with the developer approving each write (the classifier refused agent-driven approval and further VM driving), permission list manual step, native run, `MATCH`, HRDEV promotion |
| V15-4 Query/release/editor breadth | In progress | Row security (qrs01, qrs02); effective-date operators (qed01–qed06, [native](../../../tools/lab/results/query-effdt-native-2026-10-22.json)); HAVING OR (qhv01); date Min/Max (qag06); expression-column criteria (qex04); nested subqueries (qsq03); subqueries beside unions (qsq04); PeopleCode Format Document ([evidence](../../../tools/lab/results/peoplecode-format-2026-10-22.json)) | 8.61 captures need HCDEV RDP (batched) |
| V15-5 Run and Monitor RT-L1–RT-L4 (Low) | RT-L1–RT-L4 passed 2026-10-22 (uncertain-outcome reconciliation fixture-only) | RT-L1: public connector probe reaches operator authentication `(158,535)` ([preflight](../../../tools/lab/results/process-runtime-preflight-2026-10-22.json)) after the developer set Req Verification to None on the PROCESSREQUEST `PRCS_*` operations (the gundam nginx 8113 route was tried and rolled back). RT-L2: installed candidate, JARED, instance 607496 Success/Posted, the only new ZZ_BC_EXPORT instance; its run control was a completed Run Once, so the AE skipped with (108,517) — Studio now refuses that at Review. RT-L3: after ZZ_BC_ACC01 was set to Always, instance 607500 Success/Posted; stdout opened in the UI; downloaded CSV 123 bytes, SHA-256 `62d92d41…6b367` (match) RT-L4 (developer, installed): history kept across reload; double click produced exactly one instance (607501) and refused the second; stale run control, expiry, read-only and unsaved-editor requests all refused with no new instance (read-only check: ZZ_BC_EXPORT instances after 607265 are exactly 607496, 607500, 607501) | Native uncertain-outcome reconciliation (needs a deliberately lost response); covered by fixture tests only |

## Batched installed acceptance (one developer session)

The full ordered session, including the server, Windows and HCDEV steps, is
[ACCEPTANCE_SESSION.md](ACCEPTANCE_SESSION.md).

Per the developer's preference, installed acceptance waits until several items
can share one Change Set, one inverse and one redo. Queue:

1. Page: insert + delete + reorder on a ZZ_ lab page; inverse; redo; then
   App Designer reopen and a fresh App Designer add (MAXPNLFLDID + 1 after the
   returned high-water mark).
2. Record: insert/move/remove on ZZ_RPT_LINE; inverse; redo.
3. App Engine: add a SQL step and a PeopleCode step on ZZ_AE_LAB01; inverse
   (expect the projected deletion records); redo.
4. Package/class: create package + class; delete the class (destructive);
   undo; App Designer opens the re-created class.
5. Promotion: add an HRDEV connection (127.0.0.1:15210/hrdev, Writable,
   operator JARED); Promote Project ZZ_RF_PRJ from HRDMO; approve and apply on
   HRDEV; undo.

## Candidate

`peoplesoft-studio.vsix` rebuilt 2026-10-22 (full verify: 2,270 passed, 0 failed), SHA-256
`55faf214f31cf0dad51bbfee571349937e5d31533cef30e19a701fd722831444`. RT-L2–RT-L4 ran on the previous build
(`f1a577ca…e885`); this one adds only the completed-Run-Once refusal. Native findings from the session that changed it:

- The c5637317 candidate sent its UsernameToken without `soap:mustUnderstand="1"`; the gateway ignores such a token
  and answers `(158,535)`, so sign-in could not pass. Fixed; JARED sign-in verified in the installed candidate.
- After authentication the PROCESSREQUEST handler on psapp01 downloads its request schema from the IB Target
  Location (`http://hcm.deathstar…`), which psapp01 could not reach (NetAccessorException). Lab fix by the developer.
- That download re-enters the gateway and needs a second PSAPPSRV. Studio's parallel process-name/server calls
  held both PSAPPSRV processes of HCMDMO_APP and deadlocked IntegrationSvc (9 queued). The client now sends native
  calls one at a time, and a non-scheduling timeout says nothing was submitted. HCMDMO_APP raised to four PSAPPSRV.

Rebuild if later commits land before the session.

## Next action

Everything left needs the developer (passwords, sign-ins, spec approval, installed clicks). Run
[ACCEPTANCE_SESSION.md](ACCEPTANCE_SESSION.md) in order; the agent drives each step once the developer's part
of it is done.
