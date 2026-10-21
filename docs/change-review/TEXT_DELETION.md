# Text-definition creation reversal

The 0.9.7 writers now implement reviewed creation reversal and
freshly approved redo for bounded Oracle PeopleTools 8.62 standalone SQL, HTML
and freeform stylesheets. Query and project deletion remain separate work.

## Complete checkpoints and guarded application

New `sql-definition` checkpoints carry `{name,text,description,definition,ownerId}`;
`html-definition` and `stylesheet-definition` carry `{name,text,description}`.
The closed portable shapes require every other native property to match the
calibrated writer. Full native fingerprints include timestamps, CLOBs/chunks,
translations/orphan checks and deletion markers. SQL text and comments are
read through complete CLOB locators: direct inline conversion was observed
damaging an emoji at UTF-16 offset 4,029 in 19,200-character comments even though
the database retained the correct character. Locator reads preserve it and
release resources on success or failure.

Normal reviewed text saves and portable manual history use these complete
adapters. Text-only revisions retain metadata already proposed in the set. The SQL/HTML/stylesheet migration adapters share their typed writers.
Legacy text-only histories retain their original contract; they do not acquire
creation undo from metadata they never captured. Different adapter aliases for
one physical definition cannot be staged together, including continuation
prerequisites.

Deletion requires a configured operator, write scope, exact approved full
baseline, reference checks, locked native token/counters and precommit readback.
Known project membership, compiled references, stored source mentions and
stylesheet/page/content references can block deletion; comments can conservatively
block it, while dynamically constructed references remain unknown. Rollback
validation accounts only for explicitly declared inverse dependencies. A
committing writer rejects all proposed-deletion assumptions and checks actual
native references. Counters and the exact paired tombstone versions are checked
before commit; a separate connection verifies the committed token. Shared
counter baselines are read under lock so another definition save cannot advance
them while this writer waits for its lock.

Ordinary creation refuses deleted names, other SQL/content types, orphan rows
and translations/classes outside the portable scope. Explicitly reviewed redo
binds the complete vacant/tombstone baseline and clears only the calibrated
matching markers. Typed creation must reproduce all retained metadata and text.
There is no checkpoint-row replay or automatic approval.

## Native protocol calibration

Actual Windows Application Designer on HRDMO / Oracle PeopleTools 8.62 was used
for all six operations. Each case has before/after scoped rows, native deletion
markers, cache counters and a table-count survey under
`tools/corpus/save-protocol/results/`.

| Case | Native operation | Observed protocol |
| --- | --- | --- |
| td01-native-sql-delete | Delete SQLTYPE 0 `ZZ_PCODE_LAB_DSQ7` | Deletes one row from each of PSSQLDEFN, PSSQLDESCR, PSSQLTEXTDEFN and PSSQLHASH. Inserts PSSQLDEL with SQLTYPE 0 and the new SRM version. PSVERSION SRM/SYS and PSLOCK SRM each advance once. |
| td02-native-html-delete | Delete HTML `ZZ_PCODE_LAB_DHT7` | Deletes PSCONTDEFN and PSCONTENT. Inserts PSCONTDEL with CONTTYPE 4, ALTCONTNUM 1 and the new CRM version. PSVERSION CRM/SYS and PSLOCK CRM each advance once. |
| td03-native-css-delete | Delete freeform `ZZ_PCODE_LAB_DCS7` | Deletes PSSTYLSHEETDEFN, PSCONTDEFN and PSCONTENT. Inserts PSSTYLSHEETDEL at the new SSM and PSCONTDEL (type 9, alternate 1) at the new CRM. PSVERSION SSM/CRM/SYS and PSLOCK SSM/CRM each advance once. |
| td04-native-sql-recreate | Recreate the same SQL name through native New/Save | Clears its PSSQLDEL marker. Normal SQL create rows and SRM/SYS/lock-SRM increments. |
| td05-native-html-recreate | Recreate the same HTML name through native New/Save | Clears its PSCONTDEL marker. Normal HTML create rows and CRM/SYS/lock-CRM increments. |
| td06-native-css-recreate | Recreate the same freeform stylesheet through native New/Save | Clears both PSSTYLSHEETDEL and PSCONTDEL. PSVERSION SSM/SYS and PSLOCK SSM advance; CRM and lock-CRM stay unchanged. The content row version is 69, following CRM 68, and the stylesheet version is 76. |

Stylesheet deletion moves CRM as well as SSM; stylesheet saving moves SSM.
Recreation must remove the corresponding tombstones. Generic row deletion or
replaying stored rows would miss these distinctions.

The first three deletion confirmations are retained as
`tools/lab/results/text-delete-{sql,html,css}-native-confirm.png`.
Six regression gates in `src/test/textDeletionProtocol.test.ts` freeze the
native rows, marker identities and counter movements.
[Calibration and cleanup report](../../tools/lab/results/text-deletion-calibration-2026-10-20.json).

Captures retain scoped lab rows and global table/count observations. Unrelated
row values, including background authentication maintenance, are omitted; unknown
nonlab side effects are not certified. Use `snapshot.ts after --omit-nonlab-rows`
for subsequent scoped captures. The first two captures were scrubbed of unrelated
row values before retaining them. No credentials are part of this evidence.

The fixtures were seeded through the existing calibrated creation writers,
then deleted and recreated through native controls. Native recreation used an
empty disposable project, preserving the original project. Cleanup verified
absence of every owned definition, text row, translation, stylesheet class,
tombstone, and disposable project row. The original `ZZ_BENEFITS` project was
reopened afterward.

## Writer and recovery acceptance

The [native writer trial](../../tools/lab/results/text-reversal-native-2026-10-20.json)
passed 13 checks: complete creation, rollback/counter preservation, stale-token
and reference refusal, calibrated deletion, ordinary recreation refusal and
explicit restoration. The [reviewed trial](../../tools/lab/results/text-reversal-reviewed-native-2026-10-20.json)
passed 20 checks, including three rounds of concurrent SQL/stylesheet saves
with stable shared-counter verification. It also exercises dependency-ordered creation, unchanged-version SQL-comment drift,
paused application, combined undo with referring HTML, a test-injected lost
reply after committed HTML deletion, reconciliation without replay, freshly
approved schema-4 remaining undo and full-chain redo. This lost reply is separate
from the existing actual HTML SIGKILL trial. Both trials clean only their unique
owned names and verify complete native absence afterward. They are HRDMO
provider/service evidence; installed review evidence is recorded separately.

Reproduce with `npx tsx tools/lab/text-reversal-native.mts --review` using the
existing HRDMO lab environment. No encoder/decoder changes are involved.

## Installed review controls

Six [installed HRDMO UI checks](../../tools/lab/results/text-reversal-installed-2026-10-20.json)
verify normal MCP staging with complete metadata, rendered approval-only and
SQL-only pause, fresh remaining application, HTML-first destructive undo pause,
fresh schema-4 CSS/SQL undo continuation and full redo from the original source
history. The real deletion checkbox survives an identical exact-state refresh;
changed review state still requires fresh consent. All complete payloads are
independently read back, native tombstones are removed only by reviewed redo,
and both source histories become REVERTED only after the entire undo completes.
The test uses a separate VS Code window and private history. All temporary
native definitions/markers are removed and complete absence checked afterward.

Current local gates: `npm run verify` passes 2,149 tests / one skipped,
activation smoke, 18 editor checks and 9 package checks; all 63 production
HTTP/UI workflow checks pass. The installed report records the exact unmodified
bundle and VSIX hashes. This is bounded HRDMO development acceptance, not
publication, cross-database promotion or Query/project deletion certification.
