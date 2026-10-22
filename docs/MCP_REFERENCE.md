# MCP product orientation and capability catalog

Start with `psft_studio_reference` for a product overview or
`psft_capability_catalog` for structured, filtered coverage. The server's
initialization instructions point clients to these tools.

The catalog accepts optional `kind` (`definition`, `configuration`,
`dataMigration`, `strategy`, `projectMigration`), numeric definition `type`,
and text `query` filters. Filters compose; an unknown type returns no entries.
Every modeled definition type has a purpose, related types, known key parts,
operation-specific tool routes and explicit missing operations. Every leaf in
the Configuration Tools and Data Migration Tools panes is included, with its
purpose, relationships and bounded operation routes. `BOUNDED` means at least
one routed operation exists, not full App Designer or PIA parity. Configuration
creation means creating a configuration entry, not adding delivered page drop
zones or creating other underlying definitions.

The pane inventory comes from `src/model/toolTrees.ts`; definition types come
from the model and MCP key guide. Tests check coverage and that tool routes
resolve to actual registrations. These are implementation references, not
release certification. Use `tools/list` for tools registered in the current
server session. Authoring tools register only with a write host; actual writes
still depend on the connection, Operator ID, scope, MCP mode, ownership policy,
concurrency checks and editor state.

Use `psft_list_connections` to select a connection,
`psft_customization_get_policy` for effective policy,
`psft_object_classify` for ownership, and `psft_customization_discover` for
configuration evidence. Release-specific findings are available through
`psft_knowledge_capability` and `psft_knowledge_evidence`. Local observations
are not universal verified knowledge. Reference information grants no write
authorization.

## Process Definitions

- `psft_process_reference`: editable fields, workflow and limitations.
- `psft_process_get`: `connection`, `processType`, `name`; stored properties,
  complete editable `input`, installed choice labels and `token`.
- `psft_process_save`: same identity, `expectedToken`, complete `input`, and
  optional `dryRun`. Preview and actual save use the existing editor writer.

Only existing definitions can be edited; Oracle saves preserve the calibrated
counter, reference and readback checks. No scheduling, execution, creation,
rename, copy or deletion is exposed. Component/group arrays are complete
replacement associations; omitted stored associations are removed.

## PS Query

- `psft_query_reference`: supported shapes, operations and ownership rules.
- `psft_query_list`: `connection`, optional SQL LIKE `pattern`; public queries
  and the configured operator's own private queries, bounded to 500 entries.
- `psft_query_get`: `connection`, `name`, optional `owner` (blank: public);
  native rows, token, execution diagnostics and `criteria`: each top-level or
  union select's WHERE and HAVING criteria as the specs the `criteria` and
  `having` operations take. Unsupported definitions remain inspectable.
- `psft_query_prepare`: same identity; generated SQL and active prompts,
  without execution or saving.
- `psft_query_run`: same identity, optional `values` keyed by prompt number,
  and `maxRows` (1–10000, default 500); Query access and prompt checks, read-only
  transaction, always rolled back. Returns native `rows` and `columnNames` in
  projection order, including the driver's disambiguated duplicate names;
  the designer uses those names for aggregates, expressions and translates.
- `psft_query_save`: same identity, `expectedToken`, typed `operations`, optional
  `dryRun`; host reads current rows rather than accepting arbitrary table rows.
- `psft_query_create`: identity plus `record` and operations; select at least
  one field. Target must be absent. An effective-dated record starts with the
  `EFFDT <= current date` criterion, as Windows Query adds it.
- `psft_query_copy`: source identity plus `expectedSourceToken`, `targetName`,
  optional `targetOwner`, operations and `dryRun`. Target must be absent.
- `psft_query_delete`: identity plus `expectedToken`. Review-only (Change
  Review, Oracle 8.62): deletes the query rows and writes the PSQRYDEL marker;
  a project member or stored source mention blocks it.
- `psft_query_rename`: identity, `expectedToken`, `targetName`, optional
  `targetOwner`. Review-only: one Change Set with the copy under the new key and
  the reviewed deletion of the old one (not Query Manager's in-place Rename).

Operations: `select`, `heading`, `order`, `aggregate` (none, sum, count, min,
max, average), `translate` (none, short, long; current date or a date field),
`expression` (text with `A.FIELD` references, character or number, length),
`distinct`, `criteria` (replace a select's WHERE criteria; optional `select`
for a union), `having`, `join` (standard, leftOuter, related with `field`),
`union` (adds a select; name its fields `B.FIELD`), `constant`, `prompt`,
`clearCriteria` and `properties`. Criteria take a `field` (absent for
exists/notExists), an operator, optional `logical`, `not`, `open`, `close`, and
operands `constant`, `field`, `prompt`, `list`, `currentDate`, `expression` or
`subquery` `{record, field, criteria}` (inside it an unaliased field is the
subquery's record; `A.FIELD` correlates). Authoring is calibrated for Oracle
PeopleTools 8.62.09 and 8.61.15 (8.61.15: one record, character fields and at
most one equal-to constant/prompt criterion). Row-security SQL, nested
subqueries, subqueries with unions, effective-dated subquery and union records
and HAVING OR remain refused; see docs/PS_QUERY_WINDOWS.md.

Both save previews execute the shared transactional writer and readback, then
roll back. They still require writable access and valid write configuration,
but do not request save approval or trigger editor refresh. Preview tokens
represent hypothetical state: retain the original get token for the actual
save. Committed changes notify the extension to refresh clean editors; dirty
editors block MCP saves.

## Remaining gaps

Data Mover script templates are available through **New Data Mover Script**;
Studio does not execute them. Data Migration Workbench remains planned. Project
migration has UI import/apply and MCP review/export/preview, but no MCP apply
tool; packages support fields, basic records, bounded Oracle standalone SQL
and AE. SQL preview includes target text/properties, and UI import checks the
native target identity and full SQL row fingerprint before saving and verifying
complete readback. See [migration scope and evidence](PROJECT_MIGRATION.md). Configuration-first
is a preference; customization plans, the registry and upgrade-impact analysis
remain previews. Configurable Search and AE plug-in discovery remain UNKNOWN.
Generic definition read support does not imply create/edit or migration
support.

## Validation and activation

`npm run verify` runs typecheck, bundle, unit tests and activation smoke.
`npm run test:mcp-workflows` starts the production HTTP server with fixture
providers and checks routing, schemas, write gates, tokens, previews,
create/copy behavior and read-only registration. These HTTP fixtures do not
establish live database compatibility. Native Query captures and transaction
adapter tests validate the existing row plans and preview rollback path.

Changes take effect after rebuilding and restarting the extension's MCP server;
an already running server does not acquire new tools automatically.

### Live HRDMO verification

The installed MCP passed 11 live checks on the HRDMO connection: tool discovery,
structured catalog filtering, stored/delivered Process Definition ownership,
Process Definition rollback preview and stale-token refusal, public Query
ownership, Query access/prompt/row-limit checks, Query rollback preview, and
committed Query create/edit/copy with readback. The original lab query and
delivered Process Definition remained unchanged. No delivered Process
Definition edit was committed.

Run `npx tsx tools/lab/mcp-workflow-live-e2e.mts` for read/preview checks, or add
`--writes` to create two retained custom Query fixtures and exercise committed
saves through the installed MCP's approval and ownership gates. This uses the
existing HRDMO saved connection; no credentials are read into the script.
Results and retained fixture names are recorded in
`tools/lab/results/mcp-workflow-live-e2e.json`.

## Change Review — 0.9.7 release

The development server can expose durable Change Set tools. On supported
Oracle paths, SQL/HTML/freeform style sheet, Query, Process and PeopleCode
mutations and bounded Page/Record/AE edits stage proposals and return
`REVIEW_REQUIRED`, not immediate saves.
Open **PeopleSoft sidebar → Change Review → Open Review** for developer
review and the primary **Approve and apply** action, then poll the Change Set
status. Approach approval stays separate, with approval-only and per-object
review retained. The combined action preserves revision/rendered-state binding,
all native application checks and explicit destructive approval; it is not an
MCP endpoint. See [design and verification](change-review/APPROVE_AND_APPLY.md).
Other paths retain legacy
gates. Existing immediate-save lab scripts need adaptation for staged paths.
`psft_get_object_timeline` reads a selected object's retained baseline, verified
revisions and other proposals. Optional `checkLive` compares the actual content
and native token in the recorded target environment; it grants no approval.
`psft_prepare_remaining_work` prepares untouched approved objects from a
reconciled partial application, pins verified prerequisites and requires fresh
review. Uncertain outcomes and drift block preparation/application. Repeated
requests return the existing follow-up; this is not an automatic retry tool.
Continuation records require schema 2 and cannot be opened by older builds.
On Oracle with Change Review, `psft_edit_page` stages existing-control move/resize,
label/use and Page description/comments. Structural/other property changes and
`saveInvalid` are refused for staging; explicit `dryRun` keeps rollback preview.
Optional `includeSnapshots` returns scoped native before/after rows and full
CLOB text inside that preview; `expectedVersion` rejects stale layout input.
Native equivalence validation and a full locked content/version token guard
protect application. Manual Page saves enter history; inverse changes must be
exactly reproducible through the typed writer. Static Text cannot use Display
Only/Invisible; those flags require an appropriate field control. Visual
before/after and retained-baseline drawings reuse the Page designer model. One
native description apply/inverse is verified, and a corrected Static Text / Edit
Box control trial passed apply/inverse and Windows Designer inspection. The older
invalid static-text flag trial was restored and remains explicitly uncertified. See [Page adapter scope](change-review/PAGE_ADAPTER.md).
Record/AE description/comments edits now stage preservation snapshots on Oracle.
Other operations are refused on those staged edit paths. New Derived/Work record,
AE and project creation also stage through dedicated adapters with declared
proposal dependencies and exact rollback-preview checks; creation undo remains
unsupported. Other create/copy/rename/delete paths retain legacy gates.
Record public dryRun is an actual rollback preview;
AE public dryRun remains plan-only. One native Record/AE description apply and
checkpoint inverse is independently verified over the full preservation scopes.
See [structured header scope](change-review/STRUCTURED_HEADERS.md).
`psft_ib_save` stages existing service/operation description/comments and bounded
structural edits on Oracle with Change Review. It accepts the full
`psft_ib_get.input`, its `expectedToken`, and optional `changeSetId`/`dependsOn`.
Out-of-contract edits retain legacy confirmation and are refused if attached to
a Change Set. The `ib-service`
and `ib-operation` adapters use fixed noncredential checkpoints and exact native
rollback previews; inverse changes go through the same typed writer. Native
rollback tests passed for standard and REST provider/consumer shapes; installed
standard HRDMO review/apply/inverse acceptance passed with full scoped readback,
checkpoints and restored original states. Native structural application also
passed for a standard operation (typed inverse restored its original) and a
REST provider OnRequest handler addition (reversal refused). 8.61 structural
acceptance and REST consumer structural application remain open. See
[IB header scope](change-review/IB_HEADERS.md) and
[IB structural scope](change-review/IB_STRUCTURE.md).
The trusted UI can apply one object and pause after verified readback. Remaining
work still needs fresh continuation approval; one native header pause and
continuation/restoration is verified. No MCP apply/approve tool is exposed.
See [contracts](change-review/CONTRACTS.md), [coverage](change-review/COVERAGE.md)
and [progress](change-review/PROGRESS.md). One installed developer-approved
Query description update has independent snapshot/token/checkpoint evidence;
its checkpoint reversal and redo are also verified, including live timeline match
after reload. Broader reviewed-path and native fault acceptance remain pending. 0.9.0's earlier live evidence does not establish the new workflow.

Complete Oracle 8.62 text adapters use a name-string key. `sql-definition`
requires `{name,text,description,definition,ownerId}`; `html-definition` and
`stylesheet-definition` require `{name,text,description}`. `after: null`
proposes guarded deletion. These full checkpoints support creation inverse and
fresh redo; legacy partial adapters retain their existing history contracts.
Normal `psft_save_text_definition` selects the complete adapter for supported
portable definitions. It still returns REVIEW_REQUIRED, with no agent approval
or apply endpoint. See [text checkpoints and native evidence](change-review/TEXT_DELETION.md).
