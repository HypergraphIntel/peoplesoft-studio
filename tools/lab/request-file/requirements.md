# Synthetic outbound file acceptance

Build a new HRDMO-only lab interface, using no business data. This is the
complete requirement; no business-rule questionnaire is needed.

Create derived/work state record `ZZ_RF_AET` with existing fields
`PROCESS_INSTANCE` then `DESCR`, description `Synthetic file state`. No keys,
subrecords, physical table or data load. Reuse the field definitions unchanged.

Create reusable SQL `ZZ_RF_ROWS` from `rows.sql`. It returns these fixed rows,
ordered by ID: A001 / Alpha / 10.25; A002 / Bravo, Inc / 20.50;
A003 / Rejected / -1.00; A004 / Quote "Lab" / 0.00. No binds, business tables,
DML or outbound transmission. Return ID, description and numeric amount.

Create standard App Engine `ZZ_RF_EXPORT`, description `Synthetic CSV export`,
with Disable Restart, one default state record `ZZ_RF_AET`, and active default
MAIN / Export PeopleCode action containing `export.peoplecode`. Abort on errors;
no commit during row processing. All computation is local to this action.

Write `ZZ_RF_EXPORT.csv` as UTF-8 without BOM, relative to the native batch
process output directory. A repeat run replaces only this lab file. Emit the
header and rows in `expected.csv`. Reject negative amounts, log their count,
include zero amounts, quote every description and double embedded quotes. Use
a period and exactly two fractional digits for amounts. The trailer contains
the accepted row count and sum. Close the SQL cursor and file. Failure to open
or write must abort the process, with no success claim.

Log `ZZ_RF_EXPORT: accepted=3 rejected=1 total=30.75` after successful close.
No runtime schedule, run-control UI, security grant or production deployment is
requested. Run once through the existing native Process Scheduler or Application
Designer connection after metadata approval. If Application Designer uses its
own output directory, record that actual path; do not assume scheduler placement.

Create `ZZ_RF_PRJ` with the new state record, reusable SQL, AE program, MAIN
section, Export PeopleCode and any generated action SQL. Include reused fields
only if project-content policy requires them; make no delivered-field edits.
Check project related-definition closure after native apply.

Approval: exact Build Request spec, then one Change Set containing the new
Record, SQL, AE and project with explicit dependencies. The developer approves
and applies the reviewed metadata. Runtime execution and output comparison are
separate evidence. Creation undo is unsupported; do not promise automatic
deletion of these lab definitions.

Acceptance: read back all metadata and membership; run the AE natively; capture
native process identity/status, messages and actual output; compare UTF-8 content
with `expected.csv`, permitting LF or CRLF line endings only. Verify there is no
BOM and no unexpected rows, amounts or output transmission. A local compiler,
fixture run, successful metadata save or simulated output does not prove this.
