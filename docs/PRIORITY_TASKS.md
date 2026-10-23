# Priority tasks

## Release targeting

See the [release plan](RELEASE_PLAN.md) for explicit assignments:
V1-1 through V1-5 are core 1.0 reliability, support-scope and release gates;
broader structural review, separate-environment promotion and business/AI
workflow expansion target 1.5; platform/parity expansion targets 2.0.
Existing stable-path correctness and safety issues cannot be deferred merely
by assigning a related feature to a later release. The core profile is Oracle / PeopleTools 8.62.09 on Linux/Windows x64;
[qualification evidence](releases/1.0/PROGRESS.md) records completed gates. No
publication date is committed.

## Current priorities after 0.9.9

V1-1 through V1-5 are **complete** for the exact qualified 0.9.8 candidate;
[the evidence tracker](releases/1.0/PROGRESS.md) records native/client/CI scope.
The 1.5 targets V15-1 through V15-5 passed native and installed acceptance and
ship in [release 0.9.9](releases/0.9.9.md); the [1.5 tracker](releases/1.5/PROGRESS.md)
records the evidence.

| Target | Priority | Next work | Why it matters |
| --- | --- | --- | --- |
| Follow-up / V15-2 | Normal | Calibrated process definition deletion, so a promotion that creates a process definition can be undone | Today such a promotion is applied without undo |
| Follow-up / V15-2 | Normal | Subpackage and class metadata (descriptions, owners, comments) in migration | Still refused by export |
| Follow-up / V15-5 | Low | Native lost-response recovery for Run and Monitor (needs a deliberately lost response) | Covered by fixture tests only |
| 2.0 | Low, later | Canonical built-in function case in the PeopleCode encoder (`none(` stored as `None(`), under the protected baseline | A Studio save of a lower-case built-in is not App Designer's bytes |
| 2.0 | Planned | Production SQL Server/DB2, cross-platform promotion, Workbench and wider parity/security | Requires platform-specific native evidence and a wider product contract |

## Run and Monitor — native acceptance complete

RT-L1 through RT-L4 passed on October 22, 2026 with the installed extension on
HRDMO (instances 607496, 607500 and 607501; the downloaded CSV matched its
SHA-256). The gateway prerequisite was met by setting Req Verification to None
on the PROCESSREQUEST `PRCS_*` operations; the prepared nginx TLS route was not
needed. Native lost-response recovery remains fixture-tested only. See
[scope and evidence](PROCESS_SCHEDULER_RUNTIME.md).

## Earlier priority tasks — October 20, 2026

User-requested scope: complete all five tasks below. Source changes, fixture
checks, installed UI checks and live runtime evidence are separate gates.
This historical inventory is retained; the current 1.0 qualification and later release targets above define the active completion boundary.

| Task | Current state | Acceptance required |
| --- | --- | --- |
| 1. HRDMO report delivery | Complete. Targeted idle-agent recycle corrected its stale port 80 connection; the exact HTTPS transfer location now disables gzip, fixing XML acknowledgement parsing. Both original instances are Posted to Web (5); native View Log/Trace opens both stdout files and downloads both exact 123-byte CSVs. | [Native delivery evidence](../tools/lab/results/report-delivery-2026-10-20.json), independently refreshed client/runtime reports. |
| 2. Write confirmation timeout recovery | Implemented and packaged. AI Write Approvals has pending cards/status bar and expired/cancelled/declined/approved outcomes; fresh retries use new IDs. Current source verification: 2,149 pass / one skipped. Installed real deadline/decline/allow/native-refusal checks pass without changing the lab Process. | Visible pending confirmations, explicit terminal outcomes and safe retry; expiry/cancellation and late clicks never write; installed workflow verification. |
| 3. Deferred Build Request progress | MCP schema now accepts PENDING, with explicit deferred-work guidance. Focused and production HTTP checks pass, including FAILED to PENDING and preserved history. Actual installed tools/list and report/get accept PENDING, keep the create object unfinished, restore BUILT and retain history. | Discoverable MCP schema accepts PENDING, unfinished objects remain outstanding, history preserved, approval gates retained. |
| 4. Expanded project migration | Complete. HTML, freeform style sheets, standalone/associated PeopleCode, Query and Menu (Codex), plus fields with every stored property and translate values, Application Packages with classes and root properties, SubRecords and subrecord rows, SQL Table user indexes, pages and components (create and replace) — each through durable Change Review with native HRDMO trials, App Designer captures for every new writer, and App Designer checks of migration-made definitions. | See the continuation sections below and [PROJECT_MIGRATION.md](PROJECT_MIGRATION.md). Remaining refusals are explicit (alternate search keys, custom index DDL, translations, subpackage/class metadata, nested/SQL-Table subrecords, updates to indexed records/SubRecords). |
| 5. Change Review recovery | Complete. Crash/lost-reply reconciliation, continuation undo/redo and Record/AE/SQL/HTML/style sheet creation reversal (Codex); Query and project creation reversal; undo/redo of every migrated definition type through App Designer-calibrated deletion writers (dl01-dl13); same-run ownership re-stamping for dependent creations. 63/63 production HTTP/UI workflow checks. | [Query/project trial](../tools/lab/results/query-project-reversal-reviewed-native-2026-10-20.json), [migration undo/redo trial](../tools/lab/results/migration-reversal-native-2026-10-20.json). |

## PS Query parity — open tasks (October 21, 2026)

Released in [0.9.8](releases/0.9.8.md) on October 22, 2026. Existing
acceptance artifacts retain their original tested versions and checksums.

Joins, subqueries, unions, aggregates/HAVING/DISTINCT, expressions, translates,
effective dating, the designer, migration and review-only delete/rename are
integrated into `main` from `query-criteria` and natively verified on HRDMO
8.62.09: 31 Windows Query captures replay exactly, and eight Studio-written
queries reopen in Windows Query with identical SQL and rows
([evidence](../tools/lab/results/query-families-native-2026-10-21.json),
[PS_QUERY_WINDOWS.md](PS_QUERY_WINDOWS.md)). Installed acceptance is complete,
and 8.61.15 calibration followed in 0.9.9:

| Task | Needs | Acceptance required |
| --- | --- | --- |
| 1. Installed check — complete October 21 | Unmodified candidate VSIX installed in a separate real VS Code 1.143.0 window, private history, HRDMO 8.62.09 | [10 installed checks](../tools/lab/results/query-installed-2026-10-21.json): saved-query editing of criteria/HAVING, joins, aggregates, translates, expressions, subqueries and unions; SQL and every rendered result cell match independent native execution; undo/redo/discard; MCP rename/delete stage without writing, refuse missing destructive consent without writes, apply through rendered approval and undo to exact native snapshots. Cleanup and installed artifact integrity verified. |
| 2. 8.61.15 calibration — complete October 23 | Developer's RDP session to HCDEV (XX_ objects only) | Twelve Windows Query 8.61.15 queries, one or more per family, match Studio's rows; the 8.61 writer gate is removed (released in 0.9.9; see [Query families on 8.61.15](PS_QUERY_WINDOWS.md#query-families-on-86115-october-23)). |
| 3. Commit and push — complete in this checkpoint | Developer requested all changes committed and pushed | Query implementation and evidence were first committed on `query-criteria`; the complete branch is now integrated into `main` for release 0.9.8. |

Reproduce installed acceptance with HRDMO lab credentials in `PSLAB_ACCESSID`
and `PSLAB_ACCESSPSWD`: `npm run test:query:installed` (after `npm test` compiles
the independent reader). The tested candidate is
`/tmp/peoplesoft-studio-query-tested.vsix`; runtime bundle SHA-256
`00290cf52b6019a3478e0fd4634491d6edf9d0b7c4a486c66b002d59054c47cf`.
The user's running window and normal installation were unchanged. The installed
trial found and corrected expression Length
submission, result-column mapping and the overly broad subrecord metadata
restriction; see [installed acceptance](PS_QUERY_WINDOWS.md#installed-acceptance-october-21-2026).

The earlier priority work was checkpointed on branch `checkpoint/priority-tasks`
on October 21, 2026, with Codex's work credited in the commit messages. The
subsequent commit/push request applies to the current `query-criteria` branch;
release publication remains separate.
No encoder/decoder changes have been made for these tasks.

Installed tasks 2/3 evidence: [report](../tools/lab/results/write-approval-installed-2026-10-20.json), [pending](../tools/lab/results/write-approval-pending-2026-10-20.png), [outcomes](../tools/lab/results/write-approval-outcomes-2026-10-20.png). Candidate bundle: `1ba73ca20ba162ada5e7879994002255efd52ae934fcf5dbea010845b7cf88e9`.

Earlier migration/recovery installed candidate: `716dc5b65f3bf560e8935800845915b6709b6a2605523ef0103152c410de6450`. [Five installed/native checks](../tools/lab/results/priority-installed-native-2026-10-20.json) pass in a separate real VS Code window with private test history; the original window was not reloaded. Test fixtures were removed and complete native absence verified. VSIX: `/tmp/peoplesoft-studio-priority-current.vsix`. This is a development test installation, not publication or replacement of the original running extension.

Earlier interrupted-inverse recovery candidate: `e468c0a3fef05120bd2ad839996dea19651a345f0703877d60fb34500b32859d`.
[Six installed/native checks](../tools/lab/results/inverse-continuation-installed-2026-10-20.json)
pass, including rendered undo pause, remaining-work action, deletion consent
across identical refresh, fresh destructive approval and redo from the original
source history. [Six native lost-reply checks](../tools/lab/results/recovery-inverse-continuation-2026-10-20.json)
also pass without deletion replay. Both trials verified cleanup. Local full
verification: 2,136 pass / one skipped; 61 production HTTP/UI workflow checks.
VSIX: `/tmp/peoplesoft-studio-inverse-continuation.vsix`, verified against the
tested unmodified bundle. The private test window was closed; the original
window was never reloaded. Tasks 4 and 5 remain open for the listed missing
adapters and creation-deletion families.

SQL/HTML/freeform stylesheet deletion and native recreation are calibrated in
six Windows App Designer cases. The production typed writers and complete
metadata adapters now implement reviewed creation inverse and fresh redo,
including lost-reply reconciliation and interrupted inverse continuation.
Legacy partial histories retain their original contract and creation-undo
limits. Native marker/counter checks, known references, rollback preview and
full readback remain required. A long Unicode SQL metadata trial exposed an
inline CLOB-fetch boundary issue; complete locator reads now preserve it.
Concurrent saves lock shared counters before recording their baseline.
[Protocol and exact scope](change-review/TEXT_DELETION.md).

Current `npm run verify`: 2,149 passed / one skipped, activation smoke, 18 editor
checks and 9 package checks. Production HTTP/UI fixture checks: 63 passed.
These results do not complete the remaining migration adapters or Query/project
creation deletion. No encoder/decoder change or original-window reload occurred.

Latest text recovery candidate:
`8dae01cb0940cddde2116dd71b16c3eae0e62444907bc5ecbbc89f1c834ad19a`.
[Six installed HRDMO UI checks](../tools/lab/results/text-reversal-installed-2026-10-20.json)
pass through the unmodified packaged extension, including metadata-preserving
text revision, pause/remaining approval, interrupted destructive undo and full
redo. The [20-check native trial](../tools/lab/results/text-reversal-reviewed-native-2026-10-20.json)
also covers lost replies without deletion replay, unversioned metadata drift,
reference refusal and concurrent saves. Both verify full owned-scope cleanup.
VSIX: `/tmp/peoplesoft-studio-text-reversal.vsix`; archive and installed bundle
integrity are recorded in the report. The private test window is closed; the
original conversation/window was never reloaded. This is development acceptance,
not a release or replacement of the original running extension.

Next recovery work: native Query/project deletion and recreation calibration,
then complete guarded creation reversal for those scopes. Migration still needs
the pages/components, package/class, subrecord/index/translate and advanced-field
adapters listed in task 4.

Six Windows native Query/project delete/recreate cases are now captured with
owned-scope cleanup and regression gates. Project deletion preserves its member
definitions; public/private Query tombstones retain the correct owner. Production
delete/review integration remains open. See [protocol and next implementation](change-review/QUERY_PROJECT_DELETION.md).

Latest calibration gate: `npm run verify` passes 2,155 tests / one skipped,
activation smoke, 18 editor checks and 9 package checks; all six new native
protocol tests and strict capture/helper TypeScript checks pass. This turn
changes capture tooling, evidence, tests and documentation; the previously
tested runtime bundle remains unchanged.

## Continuation (Claude, October 20 evening)

Task 5 — Query/project creation reversal is now verified end to end on HRDMO.
The typed writers (`src/providers/queryProjectReversal.ts`) and adapters were
already wired; the reviewed flow failed because a same-set Query creation was
not treated as a proposed project member (its review key is `[name, owner]`).
`proposedProjectMembers` now includes it (unit test in
`reviewStructuredCreation.test.ts`). [16 native checks](../tools/lab/results/query-project-reversal-reviewed-native-2026-10-20.json)
(`tools/lab/query-project-reversal-native.mts --review`): rollback previews,
stale-token refusal, project-membership and nondefault-metadata refusal,
blank-owner and owner-specific PSQRYDEL / PSPROJECTDEL at QDM / PJM, tombstone
refusal for ordinary reads/creation, marker-bound redo, then durable review:
pause → fresh continuation → destructive inverse (project before Query) with an
injected lost reply → reconciliation without replaying the deletion → fresh
destructive approval → redo from original history. Cleanup verified.

Task 4 — field adapters:
- Translate values travel with their character field (canonical order,
  effective-dated); translations (PSXLATITEMLANG) and target-only values refuse;
  translate-only updates do not re-save the field definition.
- Every stored PSDBFIELD property now travels: owner ID, IME mode, number/time
  FORMAT, default century, custom format family/display name, formatted length.
  Export previously refused every real field (New Field stores DEFCNTRYYR 50)
  and silently dropped owner ID / non-character formats. Not Used, AUXFLAGMASK,
  image format and keyboard layout still refuse. `saveField` takes the full
  property set (`fieldPropertiesRefusal`); a missing target format family blocks.
- [10 native checks](../tools/lab/results/field-migration-native-2026-10-20.json)
  (`tools/lab/field-migration-native.mts`).

Further task 4 adapters (all same-database provider + ReviewService trials,
cleanup verified; details in [PROJECT_MIGRATION.md](PROJECT_MIGRATION.md)):
- Application Packages + classes: [6 checks](../tools/lab/results/package-migration-native-2026-10-20.json).
  Found: class creation moves every package row's VERSION, so the package
  review token is its structure.
- Subrecord rows in Derived/Work records: [4 checks](../tools/lab/results/subrecord-migration-native-2026-10-20.json).
- Pages (complete rows, create-only): [7 checks](../tools/lab/results/page-migration-native-2026-10-20.json).
- Components (complete rows, create-only): [7 checks](../tools/lab/results/component-migration-native-2026-10-20.json).
- Prerequisites now use the project writer's `definitionExists` (images, URLs,
  message catalog, processes, style sheets of any kind).

Windows App Designer work (HRDMO VM):
- [App Designer check](../tools/lab/results/migration-app-designer-check-2026-10-20.json): migration-made
  package, page, component, fields and subrecord record open correctly; native
  re-saves of the component and field change only VERSION/LASTUPDDTTM, and of
  the page leave every migrated control row unchanged.
- New captures (`tools/corpus/save-protocol/results/`): ix01 user index,
  sb01 SubRecord creation, pk01 package properties, pk02 subpackage under an
  owned root; frozen by `src/test/migrationCaptureProtocol.test.ts`.
- Adapters built on them, each compared row for row with App Designer's own
  rows: [user indexes, 6 checks](../tools/lab/results/index-migration-native-2026-10-20.json);
  SubRecord definitions (Studio-created rows identical to App Designer's;
  [subrecord trial](../tools/lab/results/subrecord-migration-native-2026-10-20.json));
  [package properties, 6 checks](../tools/lab/results/package-properties-native-2026-10-20.json).
- Pages and components now also replace an existing target definition, under
  its complete token, with the calibrated save counters (page PDM/SYS,
  component PGM/MDM/SYS): page and component trials, 7 checks each.

Task 4 remaining refusals (documented in PROJECT_MIGRATION.md): alternate
search key indexes, custom index DDL, subrecords in SQL Tables, nested
subrecords, subpackage/class metadata, updates to indexed records and
SubRecords, translations/language rows of every type.

Task 5 additions (Claude):
- Production HTTP/UI workflow checks were failing after Codex's last change
  (8.62 Query/project review paths had no fixture coverage); fixed the fixture
  (`readQueryForReview`/`writeQueryForReview` stubs, project reversal SQL in
  `src/test/fixtures/projectTransaction.ts`, consistent PJM lock seed) and the
  one outdated expectation (creation reversal for Record/SQL/AE/project is now
  prepared, not refused). 63/63 pass.
- Query/project writers guard deletion and replacement only; creating an absent
  definition keeps the creation-only path, like Record/AE creation.
- Review apply: a CREATE whose ownership stamp changed only because a dependency
  created earlier in the same run now exists (Record PeopleCode judged by its
  new record) is re-stamped and journaled (`AUTHORIZATION_REFRESHED`) after the
  live authorize gate; any other stamp change still stops the writer.
- Migration creation reversal for records, Record PeopleCode, AE programs and
  menus (calibrated deletion writers, rollback previews with same-inverse
  project/PeopleCode assumptions, grant refusal for menus) plus text, Query and
  project: [4 native checks](../tools/lab/results/migration-reversal-native-2026-10-20.json)
  covering import, destructive inverse, tombstones and fresh redo.
- Next: App Designer deletion captures for page, component, field and package so
  migrations that create those can be undone too.

Deletion calibration (Windows App Designer, HRDMO): dl01-dl13 capture File > Delete of
pages, components, fields and packages (with and without PeopleCode / translate values /
classes), deleting one class in the package editor, and saving deleted page, component
and package names again. New writers: `deletePageForMigration`, `deleteComponentForMigration`,
`deleteField`, `deletePackage`, `deleteClass`; page/component/package creation now clears
tombstones (dl11-dl13). [Migration undo/redo trial](../tools/lab/results/migration-reversal-native-2026-10-20.json):
ten definition kinds imported, undone in one destructive inverse and redone exactly.

Installed acceptance (October 21): a candidate VSIX built from this source
(bundle `f1e64169…`, identical to the tested `dist/extension.js`) ran in a separate
VS Code window with private history (`tools/lab/build-handoff/installed-host.mjs`;
your running window and installed extension were not touched).
[Three checks](../tools/lab/results/migration-installed-2026-10-21.json)
(`tools/lab/migration-installed-native.mts`): the Import command stages a field
with translate values, a page, a component listing it, a package with a class and
the project; the rendered Approve and apply creates them; the rendered review
applies the destructive inverse only with explicit consent; redo recreates them.
The first installed run exposed a real defect the native trials could not (they
stub the write guard): a reviewed write that creates a definition and then saves
more of it (a field's properties after New Field, subpackages after a package
root) was stopped by the delivered-object guard as "ownership changed after
review". The reviewed-write context now records definitions it created itself
(`noteReviewedCreation`), and the guard treats later steps on those as covered by
the approval; refusal by policy still applies.
