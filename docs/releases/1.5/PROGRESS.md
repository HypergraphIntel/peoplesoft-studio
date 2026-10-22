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
| V15-3 Business application acceptance + Windows AI handoff | Prepared | Representative request [documents](../../build-requests/samples/benefits-eligibility/) (read correctly by Studio's intake), independent expected-output verifier `tools/lab/benelig-expected.mts` (1,821 rows as of 2026-10-22); ps-win-client inventoried (VS Code present; Node, Claude Code, Codex missing) | [Session](ACCEPTANCE_SESSION.md) §3–4: Windows CLI install and sign-in, intake, approval, Codex build, native run, HRDEV promotion |
| V15-4 Query/release/editor breadth | In progress | Row security (qrs01, qrs02); effective-date operators (qed01–qed06, [native](../../../tools/lab/results/query-effdt-native-2026-10-22.json)); HAVING OR (qhv01); date Min/Max (qag06); expression-column criteria (qex04); nested subqueries (qsq03); subqueries beside unions (qsq04); PeopleCode Format Document ([evidence](../../../tools/lab/results/peoplecode-format-2026-10-22.json)) | 8.61 captures need HCDEV RDP (batched) |
| V15-5 Run and Monitor RT-L1–RT-L4 (Low) | Prepared | Gateway script now inspects first and applies only against the hashes it printed (guard, idempotence and rollback tested locally) | [Session](ACCEPTANCE_SESSION.md) §1–2: sudo inspect/apply, JARED sign-in, one confirmed run |

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

`peoplesoft-studio.vsix` built by `npm run package` at c5637317 (full verify passed), SHA-256
`576795570ea6f3b3b18f1001b3551e84495562dc9855b09095855af001558067`. Rebuild if later commits land before the session.

## Next action

Everything left needs the developer (passwords, sign-ins, spec approval, installed clicks). Run
[ACCEPTANCE_SESSION.md](ACCEPTANCE_SESSION.md) in order; the agent drives each step once the developer's part
of it is done.
