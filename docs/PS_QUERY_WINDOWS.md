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

Fixtures: `src/test/fixtures/query/`. Full captures (not yet committed):
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

### Deliberate limits and next evidence

This first release is calibrated on **Oracle / PeopleTools 8.62.09** for one
SQL Table record without subrecords, direct character fields, and at most one
ungrouped equal-to criterion with a character constant or uppercase/mixed-case
prompt. It does not yet edit/run joins, unions, subqueries, effective-date
criteria, grouped Boolean criteria, expression columns, numeric/date fields,
aggregate SQL, translate SQL, DISTINCT, or row-security SQL. Rename, Delete,
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
