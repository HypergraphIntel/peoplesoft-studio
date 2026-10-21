# Windows PS Query recreation

## Reference and scope

Reference: the Windows **Query** application in `ps-win-client`, inspected
through the existing Guacamole console on 2026-10-14. The application was
already signed in. The captured query saves are on **HRDMO, PeopleTools
8.62.09**, under **JARED**. All live work is restricted to HRDMO.
This is the Windows interface, not PIA Query Manager.

The existing Studio implementation (`model/queryDefinition.ts`,
`DatabaseProvider.readQuery`) reads seven query-definition tables and renders
a text view. Configuration Tools > PS Query now opens the designer. The original text renderer remains available internally.
See [Queries](QUERIES.md) for the prior HRDMO table investigation.

## Directly observed interface

- Left pane: **Database** and **Query** tabs. Database lists expandable
  records. Double-clicking `AAP_TBL` adds it to the draft and switches to Query.
- Query tree: `PRIVATE.QUERY.UNTITLED`, record `A = AAP_TBL`, Record hierarchy,
  fields, Expressions, Prompts. Double-clicking `ESTABID` selects an output
  column.
- Right pane: **Fields**, **Criteria**, **SQL**, **Results**.
- Fields columns: Col, Record.Field, Format, Rel, Ord, Xlt, Agg, Heading.
- Criteria columns: Logical, Expression 1, Operator, Expression 2, Belongs To.
- File menu: New, Open, Save, Save As, Rename, Delete, Properties,
  Run (Current Query), Run to Excel, Print Results, Preview Print Results,
  Print (Current Query Object), Print Setup, Recent File, Exit. Some entries
  are disabled for an empty draft.
- Edit menu includes New Union, context-dependent New/Delete Component,
  Select, New Criteria, Properties, and clipboard/undo actions.
- Criteria menu: New, Delete, NOT, Group, Ungroup. Availability depends on
  selection.

### Query Properties

PUBLIC, DISTINCT, SECURITY JOIN OPTIMIZER; type choices User Query (Ad Hoc),
Role Query, Process Query, View Query, Search Query, Archive Query. View and
Search were disabled in the inspected draft. Description, Query Definition
(multiline), Last Updated Date/Time and By User.

### Field Properties

Tabs: Column#, Heading, Order By, Aggregate, Related Record.

- Column#: Column Number.
- Heading: None, Text, RFT Short, RFT Long; Heading Text; Unique Field Name.
- Order By: Order By Number; Descending.
- Aggregate: None, Sum, Count, Min, Max, Average. Sum and Average were
  disabled for the character field ESTABID.
- Field context menu: Select, Column Number, Heading, Order By, Aggregate,
  Translate, Related Record, Edit Expression, New Criteria.

### Criteria editing and SQL

New Criteria on ESTABID creates an `equal to` row with a blank constant and
switches to Criteria. Double-clicking Expression 1 opens a Field dialog with
Record Name and Field Name selectors. Double-clicking Expression 2 opens a
Constant dialog with Edit Constant Value.

The SQL tab for that unsaved draft shows:

```sql
SELECT A.ESTABID
FROM PS_AAP_TBL A
WHERE ( A.ESTABID = ' ')
```

This single example establishes only this record/field/constant combination.
It does not establish effective dating, security, joins, expression types,
prompt binding or SQL generation rules for other queries.

## Capture and implementation gates

1. Verify the Windows connection's database, release and operator.
2. Inventory all tables with QRYNAME/OPRID keys, including language,
   reference, deletion and ancillary rows; do not assume the seven reader
   tables are the full write set.
3. Capture a baseline before the first save, query rows and all PSVERSION /
   PSLOCK counters, then capture after **one** native save.
4. Use dedicated custom query names. Separate cases for creation, no-change
   save, one field/heading/order/aggregate change, constant/field/prompt
   criteria, grouping, expressions, joins, effective dates, subqueries,
   unions, public/private ownership and Save As. Deletion needs its own
   explicitly authorized disposable case.
5. Derive save plans from captured rows and counter deltas. Replay the
   captures before enabling Studio database writes. Reopen Studio-written
   queries in Windows Query and compare its SQL/results.
6. Query execution must account for PeopleSoft query access and row security;
   existing generic Run SQL is not evidence of PS Query security parity.

## Captured saves

Private custom query `ZZ_QRY_LAB01`, owned by JARED, selects AAP_TBL.ESTABID
started with one equal-to-blank constant criterion. Subsequent cases changed its fields and prompts and ran it. Public copy `ZZ_QRY_LAB02` was also captured.

| Case | Single native operation | Observed change |
|---|---|---|
| qry01-create | First save | Inserts PSQRYDEFN/SELECT/RECORD/FIELD/CRITERIA/EXPR |
| qry02-heading | Heading: Text, Lab Establishment | HDGTYPE 3 → 2; HEADING blank → literal |
| qry03-order | Order By 1, Descending | ORDERBYNUM 0 → 1; ORDERBYDIR blank → D |
| qry04-count | Aggregate: Count | TTLTYPE 1 → 3; AGGREGATEFUNC remains blank |
| qry05-min | Aggregate: Min | TTLTYPE 3 → 4 |
| qry06-max | Aggregate: Max | TTLTYPE 4 → 5 |
| qry07-none | Aggregate: None | TTLTYPE 5 → 1 |
| qry08-prompt | Replace constant with runtime prompt | EXPRTYPE 8, expression :1; new uppercase ESTABID prompt with Prompt Table edit |
| qry09-add-field | Select DESCR | Appends field 2 and output column 2 |
| qry10-no-criteria | Remove criterion | Deletes criterion/expression; retains unused prompt with USECOUNT 0 |
| qry11-public-copy | Save As public ZZ_QRY_LAB02 | Rekeys every row; sets new creation stamps; source preserved; full sweep |
| qry12-unselect-first | Unselect ESTABID | Retains hidden field 1; clears heading/order position, retains direction D; DESCR becomes output 1 |
| qry13-text-prompt | DESCR runtime prompt | Mixed-case FORMAT 6, No Table Edit, prompt :2; unused :1 remains |
| qry14-properties-saved | Description and Query Definition | DESCR and DESCRLONG changed; other definition rows replaced |
| qry15-studio-save | Studio first save | Seven definition tables, QDM/SYS/PSLOCK counters; native reopen and matching SQL/results |

Each observed save advances PSVERSION.QDM, PSLOCK.QDM and PSVERSION.SYS
by one. PSQRYDEFN.VERSION takes the new QDM. All populated definition
tables are physically replaced on the property saves, including unchanged
records, selects, criteria and expressions. Initial creation and heading
were captured with the full save-protocol sweep (1,592 tables); background
Integration Broker timestamp changes are separated from query evidence.
Later property captures use the narrower query-keyed table/counter tool.

Fixtures: `src/test/fixtures/query/`. Full captures:
`tools/corpus/save-protocol/results/qry*`. The narrow tool is
`tools/lab/query-capture.mts`; it inventories actual tables with QRYNAME
and OPRID (48 on this HRDMO), keeps row identities and exact timestamp
fractions, rolls back its read-only transaction, and refuses other databases.
It does not replace the full sweep for a new operation family. Rows whose
ROWIDs were reused may need flashback investigation to distinguish an
update from a delete/reinsert.

Credentials are exported from `~/.bashrc` for interactive shells. Invoke
scripts through `bash -ic` and capture startup output in a local log;
never print credential values.

## First usable release

Both requested workflows are implemented together:

- **PeopleSoft: Open PS Query** (also Configuration Tools > PS Query): searches
  public and the configured operator's own private queries. Other query shapes
  remain readable in Fields, Criteria, Expressions, Prompts and Definition.
- **PeopleSoft: New PS Query**: choose a name, public/private visibility and a
  SQL Table record. Select character fields from the record catalog.
- Field selection, text/RFT Short headings, Order By position and descending
  direction; one equal-to constant or runtime-prompt criterion; prompt reuse;
  remove criterion; description and query-definition comments; Undo/Redo.
- **Save** persists the document; **Save As** opens a copy under a new key for
  saving. Requires a Writable Oracle connection, configured PeopleSoft Operator
  ID and a name within the configured write scope. The shared delivered-object
  guard remains in the provider path.
- **SQL** shows host-generated SQL. **Results / Run** asks only for referenced
  prompts and returns a bounded grid. Runs use a read-only transaction and
  always roll back; prompt values are bound separately from SQL. The editor
  retains the active tab and runtime input, and clears results when edited.

The save planner replays native captures across every stored definition
column, supplying captured clocks separately. The Oracle writer locks the
QDM/SYS counters and QDM lock, checks an optimistic token of all seven tables,
replaces the rows and increments the observed counters in one transaction,
verifies before commit, then verifies from another connection. No-change saves
roll back without a counter bump. Existing creation stamps are preserved;
new queries/copies use the database clock. This does not claim Windows client
clock equality. Reads for editing use a consistent read-only transaction.
Unknown ancillary query rows, missing columns, approval/logging/optimization
states, and different PeopleTools releases refuse saving.

Execution checks the acting operator, ownership, Query access role/class/group
nodes in active valid access-group trees, and declines conflicting grants.
Records needing QRYSECRECNAME security are refused. Prompt Table edits check
record access and value existence; set-controlled and additional composite
keys are refused. Effective-date prompt-table selection semantics are not yet
fully calibrated, so this is not a claim of general native lookup parity.

### Verified on HRDMO

- Studio created private `ZZ_QRY_STUDIO01`, selecting ESTABID and DESCR with
  an ESTABID runtime prompt. Windows Query reopened it, generated the same
  SQL and returned `KU001 / GBI HQ Affirmative Action Plan`.
- Studio changed its heading to **Studio Establishment**, preserving creation
  stamps, and saved public copy `ZZ_QRY_STUDIO02`. Windows Query reopened the
  public copy with that heading and returned the same prompted row.
- Browser integration preview of the same renderer/provider created and saved
  `ZZ_QRY_STUDIO_UI01`, edited its heading, created a prompt, and returned the
  same row for lowercase input `ku001`. This exercised the renderer and live
  provider; the extension host itself was checked by activation smoke testing.
- Live checks: stale token rejected; duplicate creation refused; no-change
  save made no changes; overlength description rejected with unchanged token;
  invalid prompt value and absent operator refused; row truncation verified.
- `npm run verify`: build/typecheck, 1,744 passing tests, one skipped test,
  and activation smoke (71 commands, 8 views, 2 custom editors).
- No encoder/decoder changes were made. Existing README changes were preserved.

`qry14-properties` retains an early after snapshot taken before the deferred
native save completed; it shows no changes. `qry14-properties-saved` reuses the
same original baseline and records the completed save. Only the completed
capture is used for the properties replay test.

### PeopleTools 8.61.15

On a PeopleTools 8.61.15 database, a private query was built in the 8.61
Windows Query client (App Designer's Go menu): STATE_TBL, select STATE and DESCR,
then New Criteria on the unselected COUNTRY with the constant `USA`. Studio's
writer then made the same query from the same typed operations. Every row of
PSQRYDEFN, PSQRYSELECT, PSQRYRECORD, PSQRYFIELD, PSQRYCRITERIA, PSQRYEXPR and
PSQRYBIND was equal apart from the key and stamps, including the timestamp
formats. The counters moved the same way as on 8.62 (QDM and SYS +1). Windows Query
reopened Studio's query with the same SQL. The 8.61.15 query tables have the
8.62.09 columns; 8.62 adds only PSQRYHDFTTEXT (header/footer text), which
Studio neither reads nor writes.

- New Criteria on an unselected field adds it as a criteria-only field: the
  next field number, column 0, heading None (HDGTYPE 1), use count 1. It is the
  same row an unselect leaves (qry12). Studio's `constant` and `prompt`
  operations do the same when the field is not selected.
- PIA Query Manager saves the same query differently: QRYAPPROVED `U`
  instead of `A`, and the constant expression's USECOUNT 2 instead of 1. Studio
  follows Windows Query. Studio saves only queries whose QRYAPPROVED is `A`,
  so a PIA-made query opens and runs but is refused for saving.

### Other patches

Another patch of 8.61 or 8.62 (8.61.12, say) is accepted when the seven query
tables have exactly the columns and types they have on the calibrated patch.
Studio compares fingerprints of the tables (`src/providers/calibratedSchemas.ts`)
and refuses a mismatch, naming the tables that differ. Other releases are refused.

### Criteria and numeric/date captures (October 21, 8.62.09)

Private `ZZ_QRY_CRIT01` (AAP_TBL ESTABID, DESCR) and `ZZ_QRY_NUM01`
(AAP_YEAR ESTABID, START_DT date, FEMALE_GOAL number), one native save per
case, narrow query-capture tool (`tools/corpus/save-protocol/results/qcr*`,
`qnm*`). Every save rewrites the definition rows and moves QDM/SYS by one.

| Case | Change | Stored |
| --- | --- | --- |
| qcr01-create | ESTABID not equal to 'ZZZ' | CONDTYPE 3, EXPRTYPE 1, COMBTYPE 3 on the first criterion |
| qcr02-and-like | AND DESCR like 'A%' | COMBTYPE 1, CONDTYPE 14 |
| qcr03-or | AND to OR | COMBTYPE 2 |
| qcr04-greater | AND ESTABID greater than 'A' | CONDTYPE 4 |
| qcr05-group | Group criteria 2-3 | LPARENLVL 1 on the first, RPARENLVL 1 on the last |
| qcr06-not | NOT on criterion 1 | NEGATION 'N' (blank otherwise; delivered rows use only 'N' and blank) |
| qcr07-between | between Const-Const 'A' and 'M' | CONDTYPE 10, EXPRTYPE 9, R2CRTEXPNUM to a second expression |
| qcr08-in-list | in list A, B | CONDTYPE 8, EXPRTYPE 5, one expression text `('A','B')`; unused expressions removed |
| qcr09-is-null | like to is null | CONDTYPE 16, EXPRTYPE 0; the old expression and R1CRTEXPNUM are kept |
| qcr10-field | criterion 1 Expression 2 = field DESCR | EXPRTYPE 2, R1CRTSELNUM/R1CRTFLDNUM; DESCR USECOUNT 2; expressions renumbered |
| qnm01-create | FEMALE_GOAL greater than 5 | numeric constant expression FIELDTYPE 2 |
| qnm02-date-const | START_DT greater than 01/01/2000 | expression `2000-01-01` FIELDTYPE 4 |
| qnm03-date-prompt | date criterion to prompt | EXPRTYPE 8, expression `:1` FIELDTYPE 0; PSQRYBIND FIELDTYPE 4 LENGTH 10 HDGTYPE 4 |
| qnm04-number-prompt | numeric criterion to a new prompt | PSQRYBIND BIND2 FIELDTYPE 2 LENGTH 6; expressions compacted in existing order |

Windows Query SQL (SQL tab, saved cases plus unsaved operator views): `=`,
`<>`, `>`, `<=` (not greater than), `<`, `>=` (not less than), `IN (...)`,
`NOT IN (...)`, `BETWEEN x AND y`, `NOT BETWEEN x AND y`, `LIKE`, `NOT LIKE`,
`IS NULL`, `IS NOT NULL`; NOT prefixes the criterion (`NOT A.ESTABID <> ...`);
AND/OR and parentheses as stored. Character constants are quoted, numeric
constants bare, date constants `TO_DATE('2000-01-01','YYYY-MM-DD')`, date
prompts `TO_DATE(:1,'YYYY-MM-DD')`. A selected date column is
`TO_CHAR(A.START_DT,'YYYY-MM-DD')`. New numeric criteria default to constant 0,
date constants to today (entered MM/DD/YYYY). With `like` only Constant and
Prompt operands are offered; `in list` offers In List and Subquery.

### Deliberate limits and next evidence

Authoring is calibrated on **Oracle / PeopleTools 8.62.09 and 8.61.15** for
one SQL Table record without subrecords. On 8.61.15 that is direct character
fields and at most one equal-to criterion with a character constant or
uppercase/mixed-case prompt. On **8.62.09** it also covers number and date
fields and a `criteria` operation that replaces every criterion: AND/OR, NOT,
parentheses, every comparison operator, like/not like, is (not) null, in/not
in constant lists and between/not between two constants, with constant,
character field, prompt (new or existing, character/number/date) and list
operands. Between, lists, like and field comparison are calibrated for
character fields; the writer refuses these shapes on other releases. It does
not yet edit/run joins, unions, subqueries, effective-date criteria,
expression columns, aggregate SQL, translate SQL, DISTINCT, or row-security
SQL.

Native acceptance: the replay tests reproduce all fourteen qcr/qnm saves
column for column (expression numbering included), and every captured
definition compiles to the SQL Windows Query shows. Studio then saved
`ZZ_QRY_STUDIO_CRIT` (NOT field comparison, OR group, is null, in list, like)
and `ZZ_QRY_STUDIO_NUM` (not less than 0, date prompt) on HRDMO; Windows
Query reopened both with the same criteria and SQL, and its Results matched
Studio's run row for row (2 and 3 rows,
`tools/lab/results/query-criteria-native-2026-10-21.json`). Studio's reader
and designer now show NOT for NEGATION 'N', the only value Windows Query and
the delivered queries use (they previously expected 'Y'). Rename, Delete,
Excel export and printing remain future workflows. Unsupported shapes show a
reason and retain their readable definition.

Native No Table Edit accepted an empty DESCR prompt even though
QRYREQUIREDPROMPT was Y, and returned zero rows. Blank input binding itself
still lacks a positive blank-value control, so Studio reports it as explicitly
uncalibrated rather than interpreting the flag as a required-input rule.

Next native cases: blank prompt binding positive/negative controls;
effective-date/compound-key prompt lookups; additional criteria and Boolean
grouping; related-record/effective-date/security joins; numeric/date fields;
aggregate SQL and translation; expression columns, subqueries and unions.
Each new operation needs native captures, row-plan replay and native reopen /
SQL / results validation before enabling it. This release covers both requested
workflows in a bounded scope; it does not claim full PS Query parity.

## MCP workflows in 0.9.0

The existing query model, access checks and writer are exposed through
reference/list/get/prepare/run/create/save/copy tools. Save previews use the
real transactional writer and readback, then roll back; committed saves notify
clean editors to reload and dirty designers block MCP saves. Query identity is
name plus owner, with blank owner for public queries and the configured Operator
ID for private queries. Existing ownership uses that full key and passes the
agent delivered-object policy. The installed MCP passed live HRDMO Query
create/edit/copy and readback checks. See [MCP reference](MCP_REFERENCE.md) for
inputs, prompt handling, limits and the repeatable validation command.
