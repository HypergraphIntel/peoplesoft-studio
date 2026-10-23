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
| V15-3 Business application acceptance + Windows AI handoff | Done 2026-10-23 (native run MATCH, HRDEV promotion verified) | ps-win-client set up by the agent (winget Node 24.22.1 + Git 2.55.0; the developer installed Claude Code 2.1.309 / Codex 0.163.0, signed in and set PowerShell `RemoteSigned` for the user). Four Windows defects found and fixed: `.cmd` launchers via `cmd.exe` (`spawn EINVAL`); no quote in handoff arguments (PowerShell 5.1 strips double quotes, VS Code leaves single quotes unescaped: Claude gets an MCP config file, Codex a bare URL, which it reads as a literal); agent tasks identified by phase and agent (a running analysis hid the build). Request br-9e49eca2090e: Claude Code analyzed it, 5 questions answered and spec revision 1 approved 8:20:27 PM by the agent as the developer's delegate; Codex build started, first MCP write approval (field ZZ_AS_OF_DT) expired after 60 s, nothing written; Codex found the spec's AE state record ZZ_BENELIG_WRK breaks Studio's AET rule | Undo of a promotion that creates a process definition (no calibrated deletion); commit the session fixes |
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

Session §1–2 done; §3 done (ps-win-client set up, AI clients configured). §4 in progress: request br-9e49eca2090e
built by Codex from spec revision 2 (approved 2026-10-23 4:59 AM, state record ZZ_BENELIG_AET). HRDMO now has
ZZ_AS_OF_DT; records ZZ_BENELIG_RC (OPRID, RUN_CNTL_ID, ZZ_AS_OF_DT, COMPANY), _STG, _WRK, _AET; File Layout
ZZ_BENELIG_FL; AE ZZ_BENELIG (MAIN + OUTPUT, 10 steps); process ZZ_BENELIG (process group ZZ_BENELIG); page
ZZ_BENELIG_PG, component ZZ_BENELIG_CMP.GBL, menu ZZ_BENELIG_MNU; project ZZ_BENELIG_PROJ (24 items). No portal
content reference (private navigation). Codex sessions on the VM are closed.

Session 2026-10-23 (morning), on ps-win-client:

- Step 1 done. Studio's Build Project > Create Tables produced the script (6 statements; Studio's Run SQL is
  read-only), and App Designer ran it (Build Project, Create Tables, Execute SQL now; 2 records, 0 errors).
  ALL_TABLES/ALL_INDEXES on HRDMO: PS_ZZ_BENELIG_RC (4 cols) and PS_ZZ_BENELIG_STG (13 cols), each with its unique
  index, matching Studio's script.
- Lab: gundam's OOM killer killed ps-app-server at 07:01 CDT (VMs 8+12+16+20 GB on a 62 GB host, no swap). With the
  developer's OK the agent shut down Kali 2021.4 and started ps-app-server; its PeopleSoft domains do not autostart
  (8110/9000/7000 closed), so the developer boots them with psadmin (agent has no psapp01 login).
- Defect found and fixed (uncommitted): Promote Project failed with "HRDMO is not connected". Activating the target
  disposes the source under the one-active-connection rule; the command and `psft_project_promote` now read the source
  through `Workspace.readFromConnection`. Regression fixture `npm run test:promotion` (in verify) reproduces the exact
  error without the fix. HRDEV connection added on the VM (192.168.122.206:1521/hrdev, Writable, JARED).
- With that fixed, promotion stopped at "No migration adapter for definition type 20" (the process definition);
  AE step SQL members (type 30, SQLTYPE 1) would have refused next, and the project lacked ZZ_BENELIG_FL (the AE
  writes through it). Added (uncommitted): AE step SQL folded into its program asset; `process` and `filelayout`
  migration kinds (docs/PROJECT_MIGRATION.md); File Layout project items (31/71, from App Designer's own Insert
  into Project of ZZ_BENELIG_FL into ZZ_BENELIG_PROJ on HRDMO). Linux preview HRDMO → HRDEV (export + rollback
  validators, nothing committed): 13 creates, no blockers.
- Open: a promotion that creates a process definition cannot be undone (no calibrated process deletion). Needs a
  native deletion capture (App Designer project copy with Delete action, or another delivered path) or a decision.
- Step 2 done by the developer in PIA (permission list ZZ_BENELIG, role ZZ_BENELIG on JARED). Step 3 done: run
  control ZZ_BENELIG_ACC01 saved through the new page (JARED, 2026-11-02, Company blank; verified read-only).
- Step 4: Run and Monitor (developer typed JARED's scheduler password), instance 607550 submitted, Queued: the
  HCMDMO process scheduler was not restarted after the OOM kill (PSSERVERSTAT heartbeat 07:00:35); developer to run
  `psadmin -p start`.
- Step 5 applied with the developer's choice "apply without undo": Change Set "Migrate ZZ_BENELIG_PROJ ·
  cb771030ce97" on HRDEV is PARTIALLY_APPLIED: all 13 definitions VERIFIED (HRDEV read-only: process, menu,
  2 Record PeopleCode, File Layout, AE present); the project membership stopped: "ZZ_BENELIG_FL (File Layouts): no
  way to check that it exists" (projectWriter existence check; fixed). Next: install candidate `5dadcd3a…1851`,
  Prepare remaining work, apply, verify readback identical.
- Instance 607550 ran once the scheduler was up and ended Not Successful: ZZ_BENELIG.MAIN.EXTRACT abended with
  ORA-01799 (the built SQL outer-joins PS_NAMES on an effective-date subquery). Corrected SQL (outer join to an
  inline view) checked read-only on HRDMO: 1,821 rows, the verifier's count. Staging it through `psft_ae_edit`
  timed out waiting for the developer's approval (nothing written; token bef0d13d… unchanged). Studio's AE
  validation now warns `outer-join-subquery` (aeValidation.ts, test in appEngine.test.ts). After the fix: rerun
  (new instance), MATCH, then re-promote (the AE update and the project membership).
- Second defect found and fixed: Run and Monitor's 5 s background poll called workspace.require(HRDMO) for the
  queued instance, re-activating HRDMO and closing HRDEV mid-promotion (NJS-064). Polls now skip a panel whose
  connection is not active (promotion fixture covers it).

**§4 complete 2026-10-23.** Instance 607567 (Run and Monitor on the VM, JARED, ZZ_BENELIG_ACC01) Success/Posted;
ZZ_BENELIG_20261102.csv downloaded through Studio, SHA-256 `d91b2454…a381`, `benelig-expected.mts 2026-11-02
--compare` prints MATCH (1,821 rows). Promotion to HRDEV: Change Sets cb771030ce97 (13 creates, PARTIALLY_APPLIED
at the project) and 4eeb42533dcf (corrected AE update + project membership, APPLIED); a fresh export/preview reads
all 13 definitions back `same` on HRDEV and all 25 project members present. Undo: not available for this promotion
(process definition creation has no calibrated deletion; the developer chose to apply without it).

Findings fixed (uncommitted, candidate `5dadcd3a…1851` plus the later AE validation warning): promotion lost its
source; Run and Monitor polls stole the active connection; process/File Layout/AE step SQL migration; File Layout
project items and existence check; AE validation `outer-join-subquery`. Build-request finding: the Codex-built
EXTRACT failed natively (ORA-01799) and was corrected through psft_ae_edit with the developer's approval.

Next: rebuild the candidate (includes the AE validation warning), commit, then §5 (installed structural Change
Review, Linux) and §6 (HCDEV RDP, developer starts the session). Open: calibrated process definition deletion so a
promotion that creates one can be undone.

Do not drive Claude Code or Codex sessions through the VM: the auto-mode classifier refuses all VM input for the
rest of a session that did ("Create Unsafe Agents"). The developer runs agent sessions; the agent drives the rest.
