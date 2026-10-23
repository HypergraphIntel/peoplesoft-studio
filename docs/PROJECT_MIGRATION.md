# Project migration in PeopleSoft Studio

Studio exports and imports its own versioned JSON packages. Application Designer is not required.

## Export

Right-click a project and choose **Export Migration Package...**, or use the command palette. Choose a destination for `<project>.psft-migration.json`.

Version 1 carries custom field definitions, SQL Table and Derived/Work record metadata, standalone SQL definitions, complete App Engine documents with their SQL and PeopleCode, bounded HTML and freeform stylesheets, authoritative stored standalone event/existing-class PeopleCode, bounded Oracle PS Queries, and scoped standard/popup menus including ItemSelected PeopleCode. AE sections and PeopleCode retain their separate project memberships while their contents travel with the owning program. A Record also carries all its associated authoritative PeopleCode assets, even when those programs are not separate project members; their original project membership is preserved.

Standalone SQL migration is calibrated for Oracle. It carries SQLTYPE 0 text, short description, full comments and Owner ID, excluding installation-local versions and audit stamps. The supported shape is non-effective-dated, with one GBL / default DBTYPE / 1900-01-01 text, description and hash row, SEQNUM 0, and at most 14,000 text characters. Effective-dated, platform/market variants, split text, translations and incomplete/orphaned rows stop migration. Export reads the entire scope rather than selecting the display reader's preferred variant. SQL text uses native CRLF/trailing-whitespace normalization; comments retain their complete text. SQL comment bind-marker restrictions from the existing writer also apply.

Unsupported project members or record/field settings stop export with a concrete error. They are never silently omitted. Pages, components, Application Packages with their classes, SubRecord definitions and subrecord rows in Derived/Work records, SQL Table user-defined indexes, translate values and every stored field property now migrate (see the sections below). Still unsupported: alternate search key indexes, custom index DDL, subrecords in SQL Tables, nested subrecords, subpackage and class descriptions/owners/comments, and updates to existing indexed records or SubRecords. Existing readers for App Designer XML remain available for compatibility; that format is not the Studio package format. Older Studio builds reject unknown asset kinds rather than silently dropping them; field/record/AE-only version 1 packages remain compatible.

Packages include the source PeopleTools release family, project member keys, explicit external prerequisites, and a SHA-256 content checksum. Credentials, database connection strings, application data, and installation-local version/update stamps are not included. The checksum detects changed content; it is not a digital signature.

## Review and import

Run **Import Migration Package...**, choose the package and target database connection, and inspect the preview. Import requires Writable access and a PeopleSoft Operator ID.

The preview classifies assets as create, update, or same and includes both the current target payload (`before`) and proposed package payload (`asset.data`). SQL comparison includes text, description, comments and owner. It also checks known prerequisites, compiles AE PeopleCode for the target release, and reports release or scope blockers. Review the target and changes in the resulting Change Set before approval/application. The current source and target release families must match; cross-release migration is not inferred. On Oracle, preview binds the database/container/schema/release and configured connection address through a digest; credentials and raw connection strings are not retained.

Before applying, Studio reads the preview state again. Concurrent target edits invalidate the preview. Each changed asset is checked again immediately before its writer runs, closing the gap while earlier definitions save. SQL additionally locks and checks a full native row fingerprint inside the writer transaction, so a metadata edit without a VERSION change is refused. Changes run in dependency order through the existing guarded writers; each stored definition is read back and checked against the package. SQL readback compares the complete CLOB text and metadata, including beyond character 4,000, as well as the writer's native hash/stamps. Finally the target project is created or only its missing memberships are added with a version check and membership readback. Repeated import does not re-add existing members or save unchanged SQL.

Change Review retains each object outcome, checkpoints and any failure in its journal. The lower-level import API also returns a receipt of verified saves and the failed definition. Writers commit independently: if a later save fails, earlier saves remain. Re-previewing a package recognizes unchanged definitions and resumes the remaining work. Existing project items are preserved; import does not remove definitions or members absent from the package.

Import now stages changed definitions and target project membership into durable Change Review. The preview is rechecked before staging, and each complete portable payload retains its native baseline token, target identity and dependency ordering. Review and approve the concrete objects through Change Review; import itself grants no approval and performs no save. Existing members are preserved. An applied migration can be undone and redone from its history (see "Undo and redo" below).

Record migration writes metadata. Use Studio's Build commands for physical SQL tables; application data is not copied. SQL views and complex record shapes need additional migration adapters.

## Dependency review

**Review Project Migration...** opens a saveable Markdown report with project members, optional modeled target comparison, explicit dependencies, and unresolved coverage. On Writable sources, select supported dependencies to include through the existing project writer. Nothing is selected automatically.

Direct dependencies come from record fields, prompt/default/property records, AE state and temporary records, sections, variant-specific PeopleCode, and static external calls. Dynamic calls and references inside SQL/PeopleCode are not a complete dependency closure. Dependencies outside the source project may already be delivered in the target. Include the custom definitions your program requires and validate the resulting runtime behavior.

Text comparison normalizes CRLF and trailing whitespace. When both database providers support complete SQL migration reads, project comparison includes SQL descriptions/comments and owner as well as text; unsupported SQL shapes remain concrete errors. Other providers retain text comparison. Record/field comparison uses modeled metadata and excludes local version/update stamps. Target read failures remain errors unless a successful untruncated search establishes exact-key absence. Packed AE PeopleCode identities and SQLTYPE 0's optional key part normalize through the existing project-item model.

## MCP

- `psft_project_migration_review`: `connection`, `project`, optional `target`; structured review and Markdown.
- `psft_project_export_migration`: `connection`, `project`; Studio package JSON.
- `psft_project_preview_migration`: `connection`, `packageJson`; read-only target preview.

Apply imports through the extension's preview-and-apply command. The existing MCP project-add tool remains available for membership additions.

## Validation

Tests cover package round trips, dependency ordering, idempotent import, checksum failures, unsupported members, missing prerequisites, release mismatch, concurrent target edits, verification failures and orphan AE members. Comparison tests cover real export fixtures, read errors, wildcard/truncated searches, omitted payloads, record stamps, metadata changes, and packed AE keys.

Native Oracle HRDMO 8.62.09 acceptance passed 11 checks through the production provider export/preview/apply pipeline: create/update with full SQL metadata, unchanged repeat import with stable counters, complete independent readback of 7,059-character SQL and 24,020-character Unicode comments, execution through the read-only query path, concurrent SQL/metadata/project refusal, and resume preserving unrelated memberships. All temporary lab SQL/project rows were verified absent afterward; version counters remain monotonic. The source export and vacant-target import used the same lab database, so this is not cross-database or Application Designer certification. See the [native report](../tools/lab/results/project-migration-native-2026-10-20.json).

Reproduce with lab credentials in `PSLAB_ACCESSID` and `PSLAB_ACCESSPSWD`:

```sh
npm run test:migration:native
```

The script is restricted to HRDMO and uses unique, initially vacant names. It commits native test definitions and removes only those lab rows during cleanup. It never resets global version counters. No SQL in a migration package is executed by import; the native runtime check is a separate read-only query.

## October 20 expanded text migration development

HTML and freeform stylesheet migration preserves text and description only when all other native metadata matches the calibrated creation defaults. Alternate content, translations, classic sheets, nondefault owner/URL/auxiliary metadata, malformed UTF-16/chunk layouts and unsupported chunk boundaries stop export. Complete native row fingerprints cover both headers and every content chunk, with a locked transaction-time recheck in each writer. Standalone PeopleCode uses PSPCMTXT and its native fingerprint, never a decompiled substitute; owning Record/Field, Page, Component, Menu, Component Interface or package prerequisites are explicit. New Application Classes still need package/class metadata migration and are refused.

Current local verification: 2,149 passed / one skipped, compile/bundle, activation smoke and existing editor/package fixtures. Native text, associated Record PeopleCode, Query and Menu migration trials passed; installed Import/Menu review now also passes, with the remaining adapter families separate. The earlier SQL-only evidence remains bounded to that earlier trial. Pages, components, package/class creation, subrecords, indexes, translates and advanced field metadata remain open adapters.

## Bounded Query migration

The Query asset carries all seven supported native table scopes and preserves public/own-private ownership, selected fields, supported headings/order, one criterion/prompts and descriptions/comments. Writer-controlled audit/version stamps are excluded. One record and one select with at most one criterion are supported; joins, unions, additional native/translation tables, orphan rows and unsupported approval/logging states are refused. Target preview executes the real Query writer inside rollback and requires its complete semantic after-image to equal the package. Existing Query access grants and the configured Operator ID still apply; migration never grants access or changes the owner to bypass a private-query restriction.

Query membership now uses native OBJECTTYPE 10 / IDs 30,25 and preserves the public blank-owner slot. Native HRDMO acceptance passed export, vacant-target creation/readback, unchanged repeat import with stable counters, and durable reviewed Query/project creation. [Query evidence](../tools/lab/results/query-migration-native-2026-10-20.json). The text trial additionally passed Record-only export with automatic associated PeopleCode and unchanged preview: [six checks](../tools/lab/results/text-migration-native-2026-10-20.json). These are same-database provider/ReviewService trials with test API approval, not installed UI, Windows or cross-database certification.

## Scoped Menu migration

Menus carry their complete modeled header, bars/items, transfer/origin rows and authoritative ItemSelected source. Source export compares the typed projection with every native row and checks stored programs against their binary; unknown rows/columns, translations, binary-only or orphaned programs and noncanonical payloads refuse migration. The target token includes every menu, program/text/name and deletion-marker row with full timestamps. Native transaction-time rollback preview and committed readback must reproduce the complete portable payload.

Creation and scoped updates use the calibrated Menu writer. Existing menu type/group settings cannot change, and target items cannot be removed, renamed or moved: those operations can update other menus or permission-list items and need additional review scopes. Migration never changes grants. ItemSelected changes also require compile-and-save access and clean source editors. When a project separately lists an ItemSelected program, its payload belongs to the owning Menu asset; unsupported project insertion layouts still refuse.

[Four native HRDMO checks](../tools/lab/results/menu-migration-native-2026-10-20.json) passed standard/popup export with comments, transfer rows and stored source/binary, vacant-target rollback previews and reviewed dependency-ordered creation, unchanged counter preservation, group/item-removal refusal, unversioned drift refusal and cleanup. This is same-database provider/ReviewService evidence with test API approval.

## Installed workflow acceptance

A separately installed unmodified development VSIX (`716dc5b6…`) completed the actual Import command, file and target pickers, durable unapproved Menu/project staging, rendered **Approve and apply**, and independent complete native readback. Both native menus and project membership verified; temporary rows were removed and full absence checked. This test used private history and kept the original conversation/window running. [Installed/native evidence](../tools/lab/results/priority-installed-native-2026-10-20.json). This certifies that installed workflow for the tested Menu package, not every definition family or cross-database promotion.

## Reviewed text creation reversal

Oracle 8.62 SQL, HTML and freeform stylesheet migration adapters now share the
complete text-definition writer and calibrated deletion/recreation protocol.
SQL checkpoints retain full comments and owner; all three retain complete
portable metadata/text and native tokens. A freshly reviewed inverse can delete
an eligible creation, and redo binds its tombstones before typed recreation.
Project membership and other known references can block deletion. Project
creation/membership inversion is still separate, so this does not certify
package-wide undo. Legacy partial text histories retain their original limits.
See [scope and recovery evidence](change-review/TEXT_DELETION.md).

## Fields: every stored property and translate values

A field asset carries every semantic PSDBFIELD column: owner ID, IME mode, FORMAT for every type (number 7, time/datetime 12/13, the Character formats), default century, custom format family and display name, and formatted length. Values equal to New Field's defaults are left implicit, so older packages keep their meaning. Not Used, AUXFLAGMASK, image format and keyboard layout stop export. The target saves every property through the calibrated field save (`saveField` with `properties`); a format family/display name missing from the target's PSFMTITEM blocks preview. Before this, export refused every real field (New Field stores DEFCNTRYYR 50) and dropped owner ID and non-character formats.

Character fields carry their base PSXLATITEM translate values, ordered by value and effective date. Translations (PSXLATITEMLANG) stop export. The target adds and changes values through the calibrated translate writer and never deletes one: a target-only value blocks preview. A translate-only change does not re-save the field definition.

[Ten native checks](../tools/lab/results/field-migration-native-2026-10-20.json): `tools/lab/field-migration-native.mts`.

## Application Packages and classes

A package project member exports one `package` asset for its root: the subpackage paths (at most two levels, the writer's bound). Every class in the package travels as its authoritative PeopleCode asset, even when the project lists only the package. The target creates the root and missing subpackages through the calibrated package writers, then each new class through the calibrated class-creation save (c04-c06), which also creates any subpackage on its path. A target-only subpackage blocks preview.

The root's Package Properties (description, comments up to 4,000 characters, owner ID) travel with the package. Windows App Designer capture `pk01-native-package-properties` stores them on the root row only, moves every package row to the new APM version with the save's stamp, and moves APM/SYS/lock APM once; the new `savePackageProperties` writer does the same. Capture `pk02` shows a subpackage created under an owned root starts with a blank owner, and the properties dialog applies only to the root, so subpackage and class descriptions, owners and comments, and package references, still stop export. [Six native checks](../tools/lab/results/package-properties-native-2026-10-20.json) (`tools/lab/package-properties-native.mts`) export the package App Designer saved, remove it, import it and compare every PSPACKAGEDEFN row with App Designer's apart from version stamps, then apply a property-only update and a reviewed import.

Creating a class moves the VERSION of every package row (c06). The package's review token is therefore its structure, not VERSION, so applying a class after its verified package is not mistaken for a concurrent change.

[Six native checks](../tools/lab/results/package-migration-native-2026-10-20.json): `tools/lab/package-migration-native.mts`.

## Subrecords

Subrecord rows migrate in Derived/Work records, which is where the record writer's subrecord protocol is calibrated (r53, x35, x40, r56). The row carries no settings of its own; the subrecord is a prerequisite record unless the package carries it, and the target writer expands PSRECFIELDDB from the target's subrecord.

SubRecord definitions migrate too. Windows App Designer capture `sb01-native-subrecord-create` shows that a new SubRecord is stored exactly like a new Derived/Work record with RECTYPE 3: PSRECDEFN, PSRECFIELD and PSRECFIELDDB, no index or tablespace, RDM/SYS/lock RDM +1. The record writer now creates one that way, and a Studio-created SubRecord matched App Designer's rows exactly apart from name, version and stamps (`tools/lab/subrecord-create-compare.mts`). Updating an existing SubRecord would have to re-expand every record that includes it, so migration creates SubRecords but does not update them. Nested subrecords and subrecords in SQL Tables stop export.

[Four native checks](../tools/lab/results/subrecord-migration-native-2026-10-20.json) (`tools/lab/subrecord-migration-native.mts`) migrate a Derived/Work record holding a delivered subrecord and a new SubRecord carried in the same package, which the target creates first.

## User-defined indexes

Windows App Designer capture `ix01-native-user-index-add` (Tools > Data Administration > Indexes > Add Index on an SQL Table) stores one PSINDEXDEFN row (INDEXTYPE 4, unique/cluster/active/custom-order flags, the platform flags, comments) and one PSKEYDEFN row per key field (KEYPOSN, ASCDESC), raises PSRECDEFN.INDEXCOUNT at the new RDM version, and moves RDM/SYS/lock RDM once. A record asset carries those rows without RECNAME, in INDEXID order. The record writer creates them with a new SQL Table. Custom index DDL (DDLCOUNT, PSIDXDDLPARM) stops export, and an existing target record with or without user indexes is not updated when either side has them: the record writer does not yet edit indexed records.

[Six native checks](../tools/lab/results/index-migration-native-2026-10-20.json) (`tools/lab/index-migration-native.mts`) export the record App Designer saved, remove it, import it and compare every PSRECDEFN/PSRECFIELD/PSRECFIELDDB/PSINDEXDEFN/PSKEYDEFN/PSRECTBLSPC row with App Designer's, apart from version stamps. The [first run](../tools/lab/results/index-migration-native-run1-2026-10-20.json) used App Designer's record directly; its cleanup removed it, so the recorded run restores those App Designer rows before exporting.

## Pages and components

A page asset carries its complete native rows in the eleven tables the page writer owns (PSPNLDEFN, PSPNLFIELD, PSPNLFIELDEXT, HTML areas, rich-text editor, control/button/grid/tree data), without VERSION and update stamps. Rows in PSPNLACTIVEX, PSPTPNLRAWIDGET or the page language tables stop export. A component asset carries PSPNLGRPDEFN, PSPNLGROUP, PSPNLGRPDEFNEXT and PSPNLGRPSCRIPTS; language and Performance Monitor rows stop export.

The target creates an absent page or component by inserting those rows as App Designer's copy writes them, at a new PDM (page) or PGM (component) version with the save's stamp, and PSVERSION/PSLOCK moved as in the calibrated creation cases (n02, c01). An existing page or component is replaced only when its complete native token still matches the preview: every row in those tables is deleted and the package rows inserted, as an App Designer save deletes and re-inserts them, with PDM/SYS (page) or PGM/MDM/SYS (component, c02-c08b) moved once. Readback must reproduce every row. A rollback preview runs the real writer. A deletion tombstone (PSPNLDEL / PSPNLGRPDEL) refuses creation, and target rows in the unmigrated language or ActiveX tables refuse replacement.

Prerequisites come from the rows: records, fields, subpages and secondary/popup pages, style sheets, popup and transfer menus, transfer components, images, message catalog entries, URL and process definitions; for components also search records, the search page and CSS/JS scripts. Field labels, style classes, format families and portal/node transfer targets are not checked.

[Seven native page checks](../tools/lab/results/page-migration-native-2026-10-20.json) copy delivered classic HRS_APP_PRINT_PAGE (60 controls, grids, buttons, HTML area) and Fluid EOQF_EVENT_NOTF_FL to disposable names, then migrate them. [Seven native component checks](../tools/lab/results/component-migration-native-2026-10-20.json) do the same for delivered DEPEND_BENEF and the lab component with CSS/JS scripts and an extension row. Both are same-database provider/ReviewService trials.

## App Designer check

[Seven checks](../tools/lab/results/migration-app-designer-check-2026-10-20.json) opened definitions that migration itself created (export, removal, import; `tools/lab/migration-app-designer-fixtures.mts`) in Windows Application Designer: the package tree with its subpackage and class, the classic page with every control, the component with its pages, the field with owner ID and translate values, the Custom PHONE/NORMAL format family, and the Derived/Work record's subrecord row. Native re-saves of the component and the field changed only VERSION and LASTUPDDTTM. A native re-save of the page left every migrated PSPNLFIELD row unchanged; App Designer also added extension and button rows to bring the delivered source page's older storage format up to date, which the delivered page would receive on its own next save. Screenshots and row snapshots are in `tools/lab/results/migration-app-designer-check/`.

## Undo and redo

Reverting an applied migration prepares an unapproved inverse in Change Review: updates restore the previous complete payload through the same writers, and every definition the migration created is deleted through a deletion writer calibrated against Windows App Designer's File > Delete. The inverse needs destructive approval; it deletes in reverse dependency order (a project before what it lists, a component before its pages, PeopleCode before its record, classes before their package, a record before its fields). Its rollback previews may assume deletions earlier in the same inverse; application always runs each writer's real reference checks. Redo from the original history recreates everything, clearing the deletion tombstones exactly as App Designer does when a deleted name is saved again.

| Definition | Deletion protocol (capture) |
| --- | --- |
| Page | Every page row and its PeopleCode; PSPNLDEL at the new PDM; PDM/SYS + 1, PCM + 1 with a PSPCMPROGDEL per program (dl01, dl06). Recreation clears PSPNLDEL (dl12). |
| Component | Its rows and component PeopleCode; PSPNLGRPDEL at the new PGM; PGM/MDM/SYS + 1, PCM with PeopleCode (dl02, dl07). Recreation clears PSPNLGRPDEL (dl13). |
| Field | Labels, translate values and header; no tombstone; RDM/XTM/SYS + 1 (dl03, dl08). |
| Application Package | Package rows, classes and their PeopleCode; PSPACKAGEDEL at the new APM; APM/SYS + 1, PCM + 1 and one more per class (dl04, dl05, dl10). Recreation clears PSPACKAGEDEL (dl11). |
| Application Class | Package-editor delete then save: class row and program, PSPCMPROGDEL at the new PCM; PCM/PBM/APM + 1, SYS + 2 (dl09). |
| Record, AE program, menu, other PeopleCode, SQL/HTML/style sheet, Query, project | Existing calibrated deletion writers. A menu still granted by a permission list refuses (File > Delete would remove the grants). |

Anything still using a definition outside the inverse refuses: pages, components, menus, content references, projects, records, other PeopleCode naming a package, and any row in the roughly 130 tables with a PACKAGEROOT column. [Four native checks](../tools/lab/results/migration-reversal-native-2026-10-20.json) (`tools/lab/migration-reversal-native.mts`) import a field with translate values, a record using it with Record PeopleCode, an AE program, a menu with ItemSelected PeopleCode, a page, a component listing that page, a package with a class and their project, then undo all ten in one destructive inverse (tombstones verified) and redo them exactly. The captures are frozen by `src/test/migrationCaptureProtocol.test.ts`.

The undo/redo workflow also passed in a separately installed candidate build: the Import command, rendered Approve and apply, rendered destructive inverse and redo, for a field with translate values, a page, a component listing it and a package with a class ([installed report](../tools/lab/results/migration-installed-2026-10-21.json)).

## Promotion between environments (1.5, V15-2)

**Promote Project to Another Environment…** (project context menu and Data
Migration Tools) and the MCP tool `psft_project_promote` combine export,
preview and staging without a package file: the project is exported from the
source connection (read only), a target that is the same environment is
refused, the import is previewed against the target and, when nothing blocks,
every changed definition and the project membership are staged into one
Change Set on the target and validated. Approval, application, undo and redo
are the migration's own (above). Packages now record their source environment
(`source.environment`: a digest of database unique name, container, schema,
PeopleSoft GUID and release; no address or credentials). Cloned PDBs share a
GUID and still differ by container.

Corrections found on separate databases (they did not show on one database):

- A project's AE section and AE PeopleCode members, menu ItemSelected programs
  and subpackages are created by their parent asset in the same promotion;
  project validation now credits them (`containedMemberKeys`).
- An App Engine program requires the SQL definitions it names (`SQL.NAME` in
  its PeopleCode, `%SQL(NAME)` in its actions' SQL): the target must have them
  or the promotion carry them, and undo deletes the program before them.
- Undoing a promotion deletes a record or SQL used by a program the same undo
  deletes: their deletion previews assume that program's deletion
  (`proposedAeDeletions` from `migration-ae`), as App Designer would see it
  after the program is gone.

### Native acceptance: HRDMO → HRDEV

`tools/lab/promotion-native.mts`
([report](../tools/lab/results/promotion-native.json)) runs the production
`promoteProject`, ReviewService and database adapters between HRDMO and HRDEV,
two separate PeopleTools 8.62.09 databases (cloned PDBs HRDMO and HRDEV in
container CDBHCM, same PeopleSoft GUID). Approval uses the trusted service test
API, not the installed UI. Eight checks:

1. Promoting to the same environment (HRDMO reached through another
   connection string) is refused before anything is staged.
2. Missing target prerequisites (ZZ_XA8_PRJ: two fields and a package) block
   the promotion; nothing is staged or written.
3. ZZ_RF_PRJ (record, SQL, App Engine with PeopleCode naming the SQL) stages on
   HRDEV, applies, and every definition reads back exactly as exported from
   HRDMO; promoting again changes nothing.
4. The applied promotion undoes on HRDEV with destructive approval (program
   before its record and SQL) and redoes exactly.
5. A target definition created after approval stops the application before
   any write (CONFLICTED, zero applied, no overwrite); a target field of
   another type then blocks promotion explicitly.
6. An injected writer failure after five definitions committed leaves
   PARTIALLY_APPLIED; the failed outcome is reconciled from live state, the
   remaining work is prepared, freshly approved and completes exactly.

7. An SQL Table with alternate search keys and Oracle In-Memory (Selective
   Fields), ZZ_PCODE_LAB_R6 with its 13 fields, promotes; its six-table record
   checkpoint on HRDEV equals HRDMO's (key and alternate-key indexes,
   AUXFLAGMASK, field In-Memory marks); undo removes it.
8. A message channel (ZZ_CHNL_E2E4) promotes with its properties and stored
   partition fields exactly; undo deletes it.

### Broader shapes added with promotion

- **Alternate search keys:** an SQL Table's indexes '0'–'9' export; the
  target record writer derives them from the fields' Alt Search Key settings
  (r55) and refuses stored ones made by hand. Other unread indexes still
  refuse.
- **Oracle In-Memory:** an SQL Table's All/Selective Fields setting travels as
  a record property (`inMemory`) with the fields' marks; other auxiliary
  record flags still refuse.
- **Message channels:** properties and stored partition fields (PSSUBCHNL).
  Messages are their own definitions; without them in the target, App
  Designer offers no partition fields and drops the stored ones when it next
  opens the channel. Node rows (environment specific) and translations
  refuse. Undo deletes the channel (rollback-previewed) unless messages name
  it.
- **App Engine step SQL members** (PSPROJECTITEM type 30, SQLTYPE 1/6, as
  App Designer lists them for every SQL action) travel with their program:
  the first 12 characters of the SQLID name it, and the member stays in the
  target project.
- **Process definitions:** what the PRCSDEFN component edits (the
  Process Definition and Options properties Studio's process editor models),
  components and process groups. The target adds the definition as the
  component's Add mode does, then saves those values (processWriter.ts). A
  definition with any other PS_PRCSDEFN column away from its Add-mode default,
  or rows in the other PRCSDEFN child tables (notification, messages, content
  distribution, URL links, page transfer, conditions, metadata,
  translations), refuses. It requires the App Engine program it runs and its
  components (GBL). No calibrated deletion exists, so a promotion that
  creates one cannot be undone in Studio yet.
- **File Layouts:** the File Layout window's document; the target saves it
  with the File Layout writer. Undo deletes it (rollback-previewed). Project
  membership: App Designer's Insert into Project writes OBJECTTYPE 31,
  OBJECTID1 71 (HRDMO, 2026-10-23).

Found by promoting the 1.5 business request (ZZ_BENELIG_PROJ) on
ps-win-client, 2026-10-23: the installed Promote Project command connected
the target, which disconnected the source (one connection is active at a
time) and failed with "HRDMO is not connected". The command and
`psft_project_promote` now read the source through a temporary provider
(`Workspace.readFromConnection`), as Compare With Environment does;
`npm run test:promotion` reproduces the failure without the fix.

Cleanup removed every promoted definition, tombstone and project from HRDEV;
its ZZ_ counts equal the starting ones. Installed UI promotion between two
configured connections remains part of the batched installed acceptance.
Cross-platform promotion (SQL Server, DB2) is a 2.0 target.
