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
  native rows, token and execution diagnostics. Unsupported definitions remain
  inspectable.
- `psft_query_prepare`: same identity; generated SQL and active prompts,
  without execution or saving.
- `psft_query_run`: same identity, optional `values` keyed by prompt number,
  and `maxRows` (1–10000, default 500); Query access and prompt checks, read-only
  transaction, always rolled back.
- `psft_query_save`: same identity, `expectedToken`, typed `operations`, optional
  `dryRun`; host reads current rows rather than accepting arbitrary table rows.
- `psft_query_create`: identity plus `record` and operations; select at least
  one character field. Target must be absent.
- `psft_query_copy`: source identity plus `expectedSourceToken`, `targetName`,
  optional `targetOwner`, operations and `dryRun`. Target must be absent.

Operations are the designer's `select`, `heading`, `order`, `constant`,
`prompt`, `clearCriteria` and `properties` operations. Authoring is calibrated
for Oracle PeopleTools 8.62.09: one SQL Table record without subrecords,
direct character fields, and at most one ungrouped equal-to constant/prompt
criterion. Joins, unions, aggregates, row-security SQL and other unsupported
shapes remain refused. There is no Query rename/delete tool.

Both save previews execute the shared transactional writer and readback, then
roll back. They still require writable access and valid write configuration,
but do not request save approval or trigger editor refresh. Preview tokens
represent hypothetical state: retain the original get token for the actual
save. Committed changes notify the extension to refresh clean editors; dirty
editors block MCP saves.

## Remaining gaps

Data Mover Scripts and Data Migration Workbench remain planned. Project
migration has review/export/preview but no MCP apply tool. Configuration-first
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

## Change Review development (after 0.9.0)

The development server can expose durable Change Set tools. On supported
Oracle paths, SQL/HTML/freeform style sheet, Query, Process and PeopleCode
mutations stage proposals and return `REVIEW_REQUIRED`, not immediate saves.
Use the persistent **PeopleSoft: Open Change Review** workspace for developer
approval/application and poll the Change Set status. Other paths retain legacy
gates. Existing immediate-save lab scripts need adaptation for staged paths.
See [contracts](change-review/CONTRACTS.md), [coverage](change-review/COVERAGE.md)
and [progress](change-review/PROGRESS.md). New native reviewed-path acceptance
is pending; 0.9.0's live evidence does not establish it.
