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
| V15-1 Package/class lifecycle | Next | — | — |
| V15-2 Separate-environment promotion | Not started | — | — |
| V15-3 Business application acceptance + Windows AI handoff | Not started | — | — |
| V15-4 Query/release/editor breadth | Not started | — | — |
| V15-5 Run and Monitor RT-L1–RT-L4 (Low) | Not started | — | Needs server maintenance (gateway TLS) |

## Batched installed acceptance (one developer session)

Per the developer's preference, installed acceptance waits until several items
can share one Change Set, one inverse and one redo. Queue:

1. Page: insert + delete + reorder on a ZZ_ lab page; inverse; redo; then
   App Designer reopen and a fresh App Designer add (MAXPNLFLDID + 1 after the
   returned high-water mark).
2. Record: insert/move/remove on ZZ_RPT_LINE; inverse; redo.
3. App Engine: add a SQL step and a PeopleCode step on ZZ_AE_LAB01; inverse
   (expect the projected deletion records); redo.

## Next action

V15-1 package/class lifecycle: combined Application Package / class
metadata checkpoints so a new class and a class deletion can stage with exact
inverse (blocker 2 in change-review/COVERAGE.md).
