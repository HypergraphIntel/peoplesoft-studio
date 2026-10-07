# Changelog

## 0.7.5

### Changed

- **Build Script** writes App Designer's Create Tables script exactly:
  the database's DDL model and storage parameters, App Designer's column
  types (`SMALLINT`, `INTEGER`, `DECIMAL`, `tIMESTAMP`, `vARCHAR2` ...),
  CLOB columns last, the index without `DESC`, and its line layout. Checked
  byte for byte against App Designer's scripts for two records.
- Record Field Properties names the Default Page Control (Edit Box,
  Dropdown List, Check Box, Radio Button, Image, System Default) and offers
  each but Image.

- The README's AI client setup covers Claude Code, Codex and any other MCP
  client (*Copy MCP URL*), with the command each choice of *PeopleSoft:
  Configure AI Client* runs; Troubleshooting checks the Settings panel and
  `claude mcp list` / `codex mcp list`.

## 0.7.4

### Added

- **New Definition...** in the Projects view (its empty-state button and
  title bar) and the Definition Browser's title bar: pick the type, then
  name it. Records (SQL Table or Derived/Work: the record editor opens
  empty, and the first save creates the record with its fields, keys and
  tablespace), Fields, Projects, Application Packages, Application Classes,
  SQL definitions, HTML definitions and freeform style sheets can be
  created, each as App Designer creates them; pages, components, menus and
  App Engine programs are listed as not available yet. Scratch names
  (`ZZ_PCODE_LAB%`) for now. See
  [docs/CREATE_DEFINITIONS.md](docs/CREATE_DEFINITIONS.md).
- **Style Sheets**: in the Open Definition dialog, with a Properties panel
  and Insert Into Project. Freeform style sheets open as CSS and, on a
  Writable connection, save with Ctrl+S; *PeopleSoft: New Style Sheet...*
  creates one on its first save. Both write what App Designer writes (the
  style sheet and content rows, the text, the SSM and SYS version
  counters). Scratch definitions (`ZZ_PCODE_LAB%`) for now. Classic and sub
  style sheets open read-only, listing their style classes. See
  [docs/STYLESHEET_SAVE.md](docs/STYLESHEET_SAVE.md).
- **HTML Definitions** in the Open Definition dialog.
- **HTML definitions** can be edited and created. On a Writable connection,
  an HTML definition opened from the tree saves with Ctrl+S, and
  *PeopleSoft: New HTML Definition...* opens an empty editor that the first
  save creates. Both write what App Designer writes (the definition row,
  the text in 32,000-byte chunks, the CRM and SYS version counters). Scratch
  definitions (`ZZ_PCODE_LAB%`) for now. See
  [docs/HTML_SAVE.md](docs/HTML_SAVE.md).

### Fixed

- HTML definitions opened with a stray NUL character at the end (most
  stored HTML ends in a NUL terminator).

## 0.7.3

### Added

- **Properties** for Application Packages, Records, Fields, Components,
  Pages, Projects, Menus, App Engine programs, SQL definitions and HTML
  definitions. Right-click one in the Projects or Definition Browser tree
  (or run *PeopleSoft: Properties* with its editor focused). A read-only
  panel shows the General properties App Designer shows (description,
  comments, owner ID, last update, version), the type's own properties (for
  example a record's type, parent and audit records, or a component's
  search records), a field's labels, and every column stored in the
  definition row. Codes without a known name are shown as stored.
  Properties are read from the database, so they are not available for
  project exports.
- **Insert Into Project...** adds the open definition, or one right-clicked in
  the tree, to a project in the database, as App Designer's *Insert Current
  Definition into Project* and save do. It is on the tree's context menu and
  the editor tab's context menu, and offers the projects open in the Projects
  view first. It needs a connection whose Access is Writable and an Operator
  ID, and writes the same rows App Designer does: the project item, the
  project's version and last-update stamp, and the PJM and SYS version
  counters. It refuses an item already in the project or a definition that
  does not exist. Records, fields, pages, menus, components, Record
  PeopleCode, SQL, App Engine programs, HTML, Application Packages and
  Application Classes. See [docs/PROJECT_INSERT.md](docs/PROJECT_INSERT.md).
- **Records** open laid out like App Designer's record editor: a Record
  Fields tab with Field, Use and Edits displays (keys, order, direction,
  list box items, defaults, required, prompt and translate edits, bold for
  fields with PeopleCode) and a Record Type tab.
- **Editing records** on Writable connections: drag rows to reorder, Insert
  Field, Delete, Move Up / Down, Key / Dir / List in the Use display, and
  in Record Field Properties: Duplicate Order Key, Search Key, Search
  Edit, From / Through / Default Search Field, Disable Advanced Search
  Options, Allow Search Events, the audit flags, System Maintained and Do
  Not Trace Value;
  Ctrl+S saves, with undo and revert. A save writes what App Designer's
  does (field rows, the key index, version counters) in one transaction and
  is refused if the record changed since it was opened. For now: scratch
  records (`ZZ_PCODE_LAB%`) that are SQL Tables or Derived/Work, without
  subrecords or alternate search keys. See
  [docs/RECORD_SAVE.md](docs/RECORD_SAVE.md).
- **Record Field PeopleCode from the record**: right-click a field under its
  record in the Projects or Definition Browser tree and choose
  *PeopleCode...*, or double-click a field (or press Enter) in the record
  editor. Every record field event is listed, those with PeopleCode first.
- **New Record Field PeopleCode**: choose an event with no PeopleCode
  (*PeopleCode...* on a record field, or double-click the field) and an
  empty editor opens; saving creates the program, as App Designer does.
  Writable connections, scratch records.
- **Record Properties** in the record editor (Alt+Enter, or the field
  menu): App Designer's General and Use tabs; on editable records the
  description, Record Definition text, owner ID, set control field, related
  records, Tools Table and Managed can be changed and saved.
- **Cut, Copy, Paste** of record fields (also between records, through the
  clipboard), multi-select (Ctrl / Shift-click) for Delete, Cut and Copy.
- **Find Definition References** for a field or a record field: the
  records, pages and PeopleCode programs that use it.
- **Build Script** for SQL Tables: the Create Table and key index script,
  generated and opened, never run. Its column types match 99.4% of the
  columns HRDMO's tables were built with (the rest: older tables' number
  columns), and NOT NULL 99.998%.
- **Record Type tab** shows each record type's own controls, as App
  Designer does: Build Sequence No, the view SQL (Click to open SQL
  Editor), the query of a query view, Materialized View and GTT.
- In Record Field Properties on an editable record: Required, the table
  edit (Prompt Table Edit, Prompt Table with No Edit, Yes/No Table Edit),
  the Record Field Label ID, the default value, Smart Prompt / Smart
  Drop-Down, and Default Page Control.
- **The record editor's field menu**, as in App Designer: right-click a
  field for View Definition (Ctrl+D), View PeopleCode (Ctrl+E), View
  Translates, View Field Properties, Delete, **Record Field Properties**
  (Ctrl+Enter: the Use and Edits tabs -- keys, audit, label ID, default
  value, page control, required, table edit) and Record Properties
  (Alt+Enter). Settings whose stored form is not established yet show as
  "–" rather than cleared, with any unexplained stored bits listed.
- **Translate values** in the record editor's Translates dialog (View
  Translates): on Writable connections, a scratch field's values can be
  added, changed (long and short names, status) and deleted. Each is
  written at once, as App Designer writes them.
- **Delete Record...** on a record in the Projects or Definition Browser
  tree removes its definition as App Designer's Delete does (the SQL table,
  if built, is not dropped). It asks first, and refuses a record that is
  still in use: Record PeopleCode, pages, components, projects, other
  records. Scratch SQL Table and Derived/Work records.
- A record referred to by another as its Analytic Delete Record can now be
  saved.
- Saving a record refreshes the Projects and Definition Browser trees, so
  its fields show as saved.
- Fields open in a **Field editor** laid out like App Designer's Field
  dialog: type and length, the Field Labels grid with the default label
  ticked, and Field Format. Read-only.
- The side bar's **Settings** view shows the **MCP server** status below the
  PeopleTools release and compiler profile; green while it is running.

### Fixed

- Saving an SQL definition to Oracle did not write what App Designer writes
  (no PSSQLHASH row, missing key columns, a version counter that does not
  exist) and was offered even on Read-only connections. It is replaced by a
  save reproduced from App Designer's (definition, text, hash, SRM), on
  Writable connections with an Operator ID, for scratch definitions; SQL
  definitions elsewhere open read-only.

- Dynamic views, query views and temporary tables were shown as the wrong
  record type (RECTYPE 5, 6, 7 were read as 6, 7, 8).
- The record grid showed some field attributes from the wrong USEEDIT bits
  (Descending was read as 0x200 and Required as 0x40; From / Through Search
  Field and the Audit Change / Delete flags were also wrong). Corrected
  against App Designer.

- Searching for Application Packages on Oracle found nothing: the search
  looked for root packages with a blank `QUALIFYPATH`, which PeopleTools
  8.62 stores as `.`. It now matches root packages by `PACKAGELEVEL = 0`.

## 0.7.0 — MAJOR UPDATE

Version **0.7.0** is a major update. PeopleSoft Studio can now **save
PeopleCode natively to the database**, with no App Designer in the save
path. It also gains a **Settings panel**, per-connection configuration,
and a **one-active-connection** model. Read *Upgrading* below before
enabling saves: nothing is writable until you turn it on per connection.

### Upgrading: what you need to know

- **Existing configurations keep working.** Saved connections, passwords
  (still in the OS secret store) and settings carry over. Every connection
  starts **Read-only**.
- **Only one connection is active at a time.** Connecting one disconnects
  any other and makes it the target. *Compare With Environment*, which
  needs two live connections, is unavailable until it can read the other
  side without activating it.
- **To save PeopleCode on a connection**, open *PeopleSoft: Open Settings*
  and, in that connection's **PeopleCode saving** group:
  1. Set **Operator ID** to an operator that exists in that database
     (PSOPRDEFN). Pressing Save checks it before storing it. Saves are
     recorded under it as LASTUPDOPRID. The database access id is not an
     operator.
  2. Set **Access** to **Writable**. A confirmation names the database and
     user; the operator is checked again.


### Native PeopleCode saving

- **Ctrl+S on writable PeopleCode** compiles the source and writes
  PSPCMTXT, PSPCMPROG and PSPCMNAME as App Designer does:
  - the PSPCMTXT HASH_SIGNATURE;
  - the reference rows and PROGEXTENDS;
  - the PSVERSION / PSLOCK counters;
  - a deletion marker when you save an empty program.

  It all happens in one transaction, verified column by column before and
  after COMMIT.
- **Interoperability is proven against App Designer 8.62.09.** App
  Designer reopens programs saved from VS Code and, on re-save, recompiles
  them to identical rows.
- **Every save is checked first and refused with the reason**, writing
  nothing, when:
  - the program changed since you opened it (for example, saved in App
    Designer);
  - the edit does not compile, or its compiled form does not read back to
    your source;
  - the stored program is outside what the writer reproduces exactly;
  - the operator does not exist in the database.
- **A save report** of the rows each save replaced is kept in the
  extension's global storage (`peoplecode-saves/`), so a save can be
  undone by hand.
- **Save only is not available.** App Designer compiles before every save
  and never stores uncompiled source, so saves are refused in that mode.

### Settings panel

- **Opening it:** run *PeopleSoft: Open Settings* (`psft.settings.open`),
  use the new **Settings** view in the PeopleSoft side bar, or click the
  gear on the Settings and Connections views.
- **Where values are stored:** settings are VS Code configuration. Each
  value is saved in the scope that defines it (User, Workspace or
  Workspace Folder), and the panel refreshes when settings change
  elsewhere. *Open VS Code Settings* shows the same keys natively.
- **Connections section:** Test Connection, Edit (connect string, access
  id, project file path), Add and Remove. Passwords never reach the panel.
- **On each connection:**
  - its access: PeopleCode writable or read-only;
  - its **Compiler / Analysis** details: the PeopleTools release read from
    PSSTATUS and the compiler profile it selects (PT861 / PT862);
  - its own **PeopleCode decoder**.

  The release and profile come from the live connection, or from the last
  Test Connection while disconnected.
- **Current target** is shown for information. It is chosen in the
  Connections view or the status bar, not in Settings.
- **The side-bar Settings view** summarizes the target. Its icons turn
  green while the connection, and the release and profile read from it,
  are live.

### Connections and navigation

- **Record → field → event:** in the Projects and Definition Browser
  trees, a record's fields now expand to their PeopleCode events. Opening
  an event opens its program; opening the field still opens the field.
- The connection you activate becomes the target, however it was
  activated.

### MCP server

- The server can be turned off (`peoplesoft.mcp.enabled`), and its port
  is configurable (`peoplesoft.mcp.port`), both in Settings.
- Changing the port restarts a running server there and offers to
  reconfigure AI clients, which saved the old URL.
- A port already in use is reported as such.
- Configure AI Client and Copy MCP URL use the running server's URL.

### Compiler

- **Version-aware compiler profiles:** PT861 for 8.61 and PT862 for 8.62,
  selected from the connection's PeopleTools release.
- 8.62.09 compatibility: 30,067 / 30,067 shared definitions reproduced
  byte for byte.

### Settings reference

| Setting | Default | Meaning |
|---|---|---|
| `peoplesoft.connections[].peoplecodeAccess` | `read-only` | `writable` allows native PeopleCode saves on that connection. Anything but exactly `writable` is read-only |
| `peoplesoft.connections[].peoplesoftOperatorId` | — | PeopleSoft operator saves are recorded as (LASTUPDOPRID); required for `writable` and must exist in that database |
| `peoplesoft.connections[].peoplecodeSaveMode` | `compile-and-save` | `save-only` is not available; saves are refused in that mode |
| `peoplesoft.connections[].decoder` | (the default below) | `auto`, `strict` or `raw`: how this connection renders PeopleCode |
| `peoplesoft.peoplecode.decoder` | `auto` | The decoder for connections that do not set their own |
| `peoplesoft.oracle.thickModeLibDir` | empty | Oracle Instant Client directory for Thick mode; empty uses Thin mode |
| `peoplesoft.mcp.enabled` | `true` | Run the local MCP server |
| `peoplesoft.mcp.port` | `7337` | MCP server port (1024–65535, always 127.0.0.1) |

A writable connection in `settings.json` (its password stays in the OS
secret store):

```jsonc
"peoplesoft.connections": [
  {
    "name": "HRDMO",
    "kind": "oracle",
    "connectString": "dbhost:1521/HRDMO",
    "user": "SYSADM",
    "peoplecodeAccess": "writable",
    "peoplesoftOperatorId": "PS",
    "peoplecodeSaveMode": "compile-and-save"
  }
]
```

Prefer setting Access and the Operator ID in the Settings panel: it
verifies the operator, which hand-editing `settings.json` does not.


## 0.2.4


## 0.2.3

Version **0.2.3** improves PeopleCode dependency lifetime modeling and
adds corpus-scale evidence for how PeopleTools allocates and reuses
`PSPCMNAME` references.

### PeopleCode Compiler Semantics

- Corrected Record and Scroll dependency reuse across flat top-level
  statements. Reuse-participating calls now allocate fresh leading
  dependencies at the flat top level while preserving established reuse
  inside control-flow bodies and Function or Method bodies.
- Added a narrower same-statement reuse rule for repeated `Record.X`
  arguments. This covers nested calls such as `DeleteRow(...,
  ActiveRowCount(...))` and repeated `.GetRecord(Record.X)` chains within
  one expression without leaking dependencies into later statements.
- Preserved the existing FetchValue-specific fallback and the separate
  `RowScrollSelect`, `RowScrollSelectNew`, and `ScrollSelect` reference
  machinery.
- Updated encoder tests that previously expected the disproven behavior
  of sharing Record dependencies between independent flat top-level
  FetchValue statements.

### Compiler Research and Diagnostics

- Added machine-readable reference-lifecycle evidence that compares stored
  `PSPCMPROG` reference operands with generated `ALLOC` and `USE` events.
- Expanded reference tracing to cover direct `0x48` and `0x4A` reference
  emission paths.
- Added branch, control-depth, function-depth, statement, and epoch
  analysis for corpus-scale dependency-lifetime research.
- Ran full-population studies across FetchValue, ActiveRowCount,
  ScrollFlush, GetRecord, RowScrollSelect, and ScrollSelect. These studies
  rejected several broader syntax-based hypotheses and isolated the
  flat-top-level lifetime boundary implemented in this release.

### Corpus Validation

- Corpus size: **30,209 PeopleCode definitions**.
- Full-corpus exact result: **23,069 / 30,209 (76.4%)**.
- Five definitions became newly exact: **7365, 14699, 14717, 17132, and
  22618**.
- The protected regression baseline remains **430 / 430**.
- Full-corpus comparison found **zero previously-exact regressions**.

### Extension Activation

- Simplified explicit activation events by removing redundant per-view
  activation entries. The extension continues to activate for the `psft`
  filesystem and after VS Code startup.

## 0.2.2

Version **0.2.2** expands PeopleSoft Studio's local MCP integration and continues the reverse engineering of the PeopleCode compiler.

- Next Cycle is real work on the compiler, expect significant updates.

### MCP Server and AI Integration

PeopleSoft Studio now provides a more complete local MCP experience for AI clients.

- Added MCP server status to the VS Code status bar.
- Added a centralized MCP control menu for:
  - viewing server status
  - starting the MCP server
  - stopping the MCP server
  - restarting the MCP server
  - copying the MCP endpoint URL
  - configuring supported AI clients
- Added direct configuration support for:
  - OpenAI Codex
  - Claude Code
  - manual MCP client setup
- MCP startup is managed through a dedicated controller rather than directly from extension activation.
- MCP startup failures no longer prevent PeopleSoft Studio from activating.
- MCP can be disabled during smoke tests with `PSFT_DISABLE_MCP=1`.
- PeopleSoft Studio exposes its own stable MCP interface and does not require PeopleTools 8.63 MCP.
- When the delivered PeopleTools 8.63 MCP is available, PeopleSoft Studio is designed to delegate or proxy supported operations while preserving the same client-facing PeopleSoft Studio MCP interface.
- Older PeopleTools environments continue to use PeopleSoft Studio's native providers and reverse-engineered PeopleCode capabilities.

### PeopleCode MCP Tools

Expanded read-only PeopleCode tooling exposed through MCP.

Current tools support:

- listing configured PeopleSoft connections
- searching PeopleSoft definitions
- retrieving definitions
- listing definition children
- listing project items
- retrieving PeopleCode by definition key
- retrieving Record PeopleCode
- retrieving Component and Component Record PeopleCode
- retrieving Application Class PeopleCode
- searching PeopleCode source references

The MCP layer uses the same PeopleSoft Studio `Workspace` and `DefinitionProvider` infrastructure as the VS Code UI rather than scraping `psft://` documents.

### PeopleCode Compiler Reverse Engineering

Continued byte-for-byte reconstruction of the PeopleTools PeopleCode compiler.

Recent compiler work includes:

- improved PSPCMNAME reference allocation and reuse
- improved control-group-aware reference lifetime handling
- improved Record, Field, Scroll, Row, and Rowset reference semantics
- improved cross-record FIELD reuse behavior
- improved explicit `Record.RECORD.FIELD.Value` handling
- improved `GetRecord()`, `GetRow()`, and related postfix reference behavior
- improved `RowScrollSelect`, `RowScrollSelectNew`, `ScrollSelect`, and `ScrollFlush` reference behavior
- improved quoted metadata reference scoping
- improved Application Class and package path handling
- added `%metadata` package-root encoding
- added package-qualified constant encoding
- improved Function metadata and nested `array of array of ...` type handling
- added additional declaration syntax support including `ComponentLife`
- improved explicit Record method-call statements
- improved alternate comparison syntax such as `Not =` and `Not >`
- expanded variable-name handling for legacy PeopleCode identifier forms

### Comments and Legacy Source Preservation

Improved reproduction of PeopleTools comment and legacy source encoding.

- Added additional `REM` and `remark` handling.
- Improved multiline `REM` payload preservation.
- Preserved semicolon-delimited REM continuations.
- Preserved inline comments following REM statements.
- Added support for REM comments inside additional control-flow bodies.
- Improved comment placement around `Then`, `Else`, declarations, Functions, and control-flow boundaries.
- Improved preservation of whitespace and blank-line structural markers where those affect compiled output.

### Corpus and Compiler Validation

PeopleSoft Studio's local HCDEV compiler corpus remains the primary conformance suite for reverse-engineering work.

- Corpus size: **30,209 PeopleCode definitions**
- Latest full-corpus exact result: **22,984 / 30,209 (76.1%)**
- Protected regression baseline remains **430 / 430**
- Broad compiler changes continue to require full-corpus validation with zero previously-exact regressions.
- Reference tracing continues to track generated `ALLOC` and `USE` behavior against stored `PSPCMNAME` data.
- Failure analysis is increasingly focused on reconstructing underlying compiler semantics rather than accumulating isolated byte-pattern fixes.

### Compiler Architecture Direction

The compiler research effort is transitioning from direct byte-pattern calibration toward reconstruction of the PeopleTools compiler model itself.

Current areas of investigation include:

- semantic binding
- lexical and control-flow scope
- implicit owner resolution
- dependency interning
- PSPCMNAME reference lifetime
- reference reuse epochs
- intrinsic-function argument semantics
- separation of parsing, binding, dependency planning, and bytecode emission

The long-term objective remains an independent PeopleCode compiler capable of reproducing PeopleTools-generated `PSPCMPROG` and `PSPCMNAME` output.

### Notes

- PeopleCode database saves remain disabled while compiler and dependency semantics continue to be validated.
- SQL definitions remain writable where supported by the Oracle provider.
- PeopleSoft Studio's MCP server remains usable independently of PeopleTools 8.63 MCP.
- Delivered PeopleTools 8.63 MCP support is additive rather than a requirement for PeopleSoft Studio AI integration.



## 0.2.1

Version **0.2.1** brings editional encoding / decoding maps and even more AI tooling, refactored

## 0.2.0

Version **0.2.0** brings editional encoding / decoding maps and AI tooling

- Add tools for the following provider methods:
  psft_get_peoplecode
  psft_find_peoplecode_references
  psft_get_application_class
  psft_get_record_peoplecode
  psft_get_component_peoplecode

## 0.1.9

Version **0.1.9** AI clients added:
- Codex
- Claude
- Manual Config

## 0.1.8

### Local MCP Server wrapper for AI Agents

Version **0.1.8** represents a major step forward for PeopleSoft Studio's native PeopleCode tooling.


## 0.1.7

### Major PeopleCode Compiler and Decoder Expansion

Version **0.1.7** represents a major step forward for PeopleSoft Studio's native PeopleCode tooling.

This release substantially expands the reverse-engineered PeopleCode compiler, decoder, dependency resolver, and validation framework used by the extension. The goal is not simply to parse PeopleCode, but to reproduce the same compiled structures, reference metadata, and binary behavior generated by PeopleSoft Application Designer.

A large portion of this release focused on byte-for-byte calibration against real PeopleSoft definitions stored in `PSPCMPROG` and `PSPCMNAME`.

### PeopleCode Encoding

- Significantly expanded native PeopleCode source-to-binary encoding.
- Improved generation of `PSPCMPROG` structures to more closely match Application Designer output.
- Added additional compiler handling for:
  - `If` / `Else` / `End-If`
  - `For` / `End-For`
  - `While`
  - `Evaluate`
  - `When`
  - `When-Other`
  - `Function`
  - `End-Function`
  - `Return`
  - `Break`
  - `Try` / `Catch`
  - local, global, component, and panel group declarations
  - Application Class declarations
  - imported Application Classes
  - declared functions
  - rowsets, rows, records, fields, scrolls, and pages
- Added support for previously unmapped PeopleCode opcode and control-marker combinations.
- Improved preservation of structural control-group markers generated by Application Designer.
- Improved statement terminator handling in contexts where PeopleSoft omits or structurally represents semicolons differently.
- Added special handling for top-level statements at end-of-file where Application Designer does not emit a normal terminating semicolon.
- Added support for semicolon variations appearing in `Evaluate` clause headers.
- Improved distinction between syntactic semicolons and semicolons that actually generate compiled bytes.

### PeopleCode Function Metadata

- Reverse-engineered additional Function metadata emitted after executable PeopleCode.
- Corrected Function metadata directory generation.
- Identified the second Function directory field as a **signature-slot offset**, rather than a simple Function ordinal.
- Added cumulative signature-slot tracking based on Function parameters.
- Improved Function parameter type encoding.
- Improved Function return-type metadata.
- Added support for untyped Function parameters.
- Improved handling of primitive Function parameter and return types.
- Expanded detection of Function declarations and Function program metadata boundaries.

### PeopleCode Reference Resolution

A major part of 0.1.7 is improved reproduction of Application Designer's `PSPCMNAME` dependency behavior.

- Added more accurate reference allocation and reuse.
- Added control-group-aware dependency tracking.
- Improved ordering of `PSPCMNAME` references.
- Improved distinction between RECORD, FIELD, RECORD/FIELD, SCROLL, PAGE, PACKAGE/Application Class, and Declare Function references.
- Improved Record and Field reference reuse inside control structures.
- Improved Field lookup scoping to avoid incorrectly reusing references from unrelated control groups.
- Added row-shorthand Record caching by control group.
- Added row-shorthand Field scoping by control group.
- Improved Record reuse for `Select()` calls.
- Improved Record reuse for explicit `Record.RECORDNAME` syntax.
- Improved Record/Field handling for explicit chains such as:

```peoplecode
Record.RECORD_NAME.FIELD_NAME
```

- Improved Rowset expression handling such as:

```peoplecode
&Rowset(&i).RECORD_NAME.FIELD_NAME.Value
```

- Added correct handling for single Record members returned from Rowset selectors:

```peoplecode
&Rowset(CurrentRowNumber()).RECORD_NAME
```

- Corrected distinction between Row properties and Record references.
- Row state/property members such as `.Visible`, `.IsNew`, `.IsDeleted`, and `.IsChanged` now remain inline instead of incorrectly generating RECORD dependencies.

### Scroll and Rowset Reference Handling

- Improved SCROLL dependency allocation.
- Added calibrated reuse behavior for repeated `GetRowset(Scroll.RECORD_NAME)` calls within the appropriate control group.
- Prevented duplicate SCROLL metadata entries where Application Designer reuses an existing dependency.
- Preserved occurrence-sensitive Scroll behavior outside the proven `GetRowset()` context.
- Improved nested Rowset/Row/Scroll traversal parsing.

### Application Class Support

- Expanded Application Class dependency generation.
- Improved `import` handling.
- Added root wildcard import support.
- Improved imported package/reference grouping.
- Added runtime Application Class dependency generation.
- Improved dependencies created by `create PACKAGE:Class(...)`.
- Added Function-local Application Class dependency handling.
- Added support for late top-level Application Class local declarations.
- Improved receiver-sensitive Application Class method reference behavior.
- Improved Package root, qualify path, and class metadata generation.
- Prevented ordinary PeopleCode containing the word `class` inside comments from being incorrectly classified as an Application Class program.

### Declaration Encoding

Expanded declaration support and corrected several previously ambiguous byte patterns.

- `Local`
- `Global`
- `Component`
- `PanelGroup`
- Application Class locals
- multiple variables in a single declaration
- primitive declarations
- object declarations
- untyped parameters
- `Rowset`
- `SQL`
- Record-oriented declaration behavior

Additional calibration includes:

- Correct `PanelGroup` declaration encoding.
- Correct reopening and closing of declaration sections.
- Improved declaration boundaries following imports.
- Correct handling of comments between imports and declarations.
- Improved top-level declaration grouping.

### Comment Encoding

Comment handling received substantial improvements.

- Improved standalone block comments.
- Improved comments immediately following statements.
- Added calibrated support for inline block comments after `Then`.
- Added calibrated support for inline block comments after `Else`.
- Added same-line comment preservation after statement terminators.
- Improved distinction between normal block-comment encoding and inline comment opcode forms.
- Improved comments appearing at Function boundaries.
- Improved comments between imports and declarations.
- Improved comments within nested control-flow structures.
- Added support for PeopleCode disabled-code blocks:

```peoplecode
<*
   disabled PeopleCode
*>
```

Disabled PeopleCode is preserved as an opaque UTF-16 payload using the compiled format generated by PeopleTools.

### Blank-Line and Structural Marker Fidelity

PeopleTools stores more structural formatting information than initially expected.

0.1.7 improves preservation of these structures, including:

- repeated `0x4F` grouping markers
- control-body boundaries
- declaration boundaries
- blank lines preceding certain control terminators
- blank-line multiplicity before `End-If`
- grouping transitions around imports, Functions, loops, and conditional blocks

Several rules were intentionally narrowed after corpus validation showed that seemingly similar whitespace patterns can compile differently depending on structural context.

### PeopleCode Decoder

The decoder has also been expanded to support additional compiled constructs.

- Improved Function decoding.
- Improved typed `Catch` reconstruction.
- Improved `While` header reconstruction.
- Improved `For` header reconstruction.
- Improved Function header semicolon reconstruction.
- Improved object-type local declarations.
- Improved `PanelGroup` declarations.
- Improved comment reconstruction.
- Added inline comment reconstruction after `Then`.
- Added inline comment reconstruction after `Else`.
- Improved keyword casing normalization.
- Improved message/function name reconstruction.
- Improved Record, Field, Scroll, and Application Class reconstruction.
- Improved blank-line reconstruction around control structures.

The encoder and decoder are validated independently:

- **source → binary exactness** validates compiler behavior.
- **binary → source → binary exactness** validates semantic decoder correctness.
- Literal decoded-source equality is tracked separately because some original formatting is not recoverable from `PSPCMPROG`.

### Corpus Validation Framework

0.1.7 introduces a much more robust regression and calibration framework for validating PeopleCode behavior against a real PeopleSoft environment.

New corpus tooling includes:

```text
tools/corpus/
├── baselines/
├── reports/
├── baseline.ts
├── classifications.ts
├── cli.ts
├── corpus-results.sqlite
├── corpus-runner.ts
├── discovery.ts
├── failures.ts
├── inventory.ts
├── next.ts
├── reporter.ts
├── schema.sql
└── validator.ts
```

The harness now tracks:

- stable definition IDs
- PeopleSoft seven-part object identities
- source hashes
- stored binary hashes
- generated binary hashes
- first differing byte offset
- stored/generated diff windows
- source encoding success
- source-to-binary exactness
- decoder success
- round-trip exactness
- failure classifications
- failure constructs
- run history
- protected baseline regressions

### Stable Definition IDs

Corpus definitions now receive a stable local `definition_id`.

This allows a specific PeopleCode definition to be repeatedly targeted even when its current traversal offset changes:

```bash
npm run corpus:harness -- --definition-id 4428 --verbose
```

Reference tracing can also be enabled:

```bash
npm run corpus:harness -- --definition-id 4428 --verbose --trace-refs
```

The authoritative PeopleSoft identity remains the seven-part `OBJECTID` / `OBJECTVALUE` key.

### Reference Tracing

Added optional reference tracing for compiler diagnostics.

Trace events distinguish `ALLOC` and `USE` and include source offset, control group, assigned reference index, reference type, and Record/Field/Package information.

Example:

```text
REF SOURCE ALLOC #11 idx=10 group=1 scroll CRSE_SESSN_VW
REF SOURCE USE   #11 idx=10 group=1 scroll CRSE_SESSN_VW
```

This has proven particularly useful for diagnosing `PSPCMNAME` ordering and reference reuse mismatches.

### Persistent Corpus Results

Corpus runs are now stored in SQLite.

The database tracks:

- corpus runs
- stable definitions
- per-definition results
- exact/non-exact status
- binary differences
- source hashes
- generated hashes
- failure classifications

Current inventory is calculated using the newest completed result for each definition rather than assuming the most recent run covered the entire corpus.

This allows targeted runs without corrupting the state of the full corpus inventory.

### Protected Regression Baseline

Added a protected set of known-exact PeopleCode definitions.

The baseline acts as a compiler regression contract:

> An `EXACT → non-EXACT` transition is always considered a regression.

The harness now explicitly reports:

- improved definitions
- regressed definitions
- unchanged failures
- newly discovered definitions
- source changes

The regression gate prevents a new calibration rule from silently fixing one definition while breaking previously proven behavior.

### Corpus Failure Analysis

Added tooling for working the corpus by **failure family** rather than simply processing definitions sequentially.

New commands include:

```bash
npm run corpus:harness
npm run corpus:failures
npm run corpus:next
npm run corpus:work
npm run corpus:inventory
npm run corpus:baseline
npm run corpus:verify
```

The workflow now prioritizes repeated, actionable compiler patterns rather than blindly working definitions by offset.

### Compiler Calibration Workflow

The encoder/decoder development workflow has been formalized around the following process:

1. Select a representative failure family.
2. Target a stable definition ID.
3. Locate the first stored/generated binary difference.
4. Map the difference back to the source construct.
5. Inspect reference traces when appropriate.
6. Compare additional HCDEV examples.
7. Derive the narrowest evidence-supported encoding rule.
8. Re-run the target.
9. Validate related definitions.
10. Run the protected regression baseline.
11. Reject or narrow any rule causing an `EXACT → non-EXACT` regression.
12. Continue to the next actionable failure family.

This replaces speculative compiler development with corpus-driven calibration.

### Corpus Scale

The PeopleCode validation corpus now contains more than **30,000 PeopleCode definitions** from the HCDEV environment.

This provides a large real-world test surface covering Record PeopleCode, Field PeopleCode, Component PeopleCode, Application Packages, Functions, legacy and modern PeopleCode, nested Rowsets, Application Classes, unusual control structures, comments, disabled code, historical Oracle-delivered code, and highly specialized PeopleSoft constructs.

### Connection Selection

Improved PeopleSoft connection handling in the VS Code status bar.

- Added persistent selected connection state.
- Added connection selection through VS Code Quick Pick.
- Added a dedicated connection-selection command.
- Improved synchronization between the active workspace connection and the status bar.
- Corrected cases where clicking the active connection status item could fail to locate or switch the connection.
- Improved support for multiple configured PeopleSoft environments.

The status bar now clearly exposes the active PeopleSoft connection while maintaining the extension's current read-only state.

### Read-Only Safety

PeopleSoft Studio remains intentionally conservative while the compiler and metadata model continue to be calibrated.

- Existing PeopleSoft definitions remain read-only.
- Corpus access remains read-only.
- Compiler development is validated against stored PeopleTools output rather than writing speculative changes back to PeopleSoft.
- Write support will only be enabled when PeopleSoft Studio can reliably generate the same compiled structures and dependency metadata expected by PeopleTools.

### Architecture Work Toward Native PeopleCode Creation

0.1.7 lays significant groundwork for future creation and modification of PeopleCode directly from PeopleSoft Studio.

The compiler is being designed to eventually generate the same core artifacts Application Designer produces, including:

```text
PeopleCode source
        ↓
PeopleSoft Studio compiler
        ↓
PSPCMPROG
PSPCMNAME
definition/reference metadata
```

The objective is not merely executable PeopleCode. The long-term target is **Application Designer-compatible compilation**, including:

- exact binary structures
- dependency discovery
- dependency ordering
- dependency reuse
- Function metadata
- Application Class metadata
- compiler control structures
- PeopleTools definition context

### Internal Engineering Improvements

- Added stronger compiler state isolation.
- Added control-group-aware reference maps.
- Added specialized reference caches for Row/Rowset shorthand behavior.
- Reduced broad global dependency fallbacks.
- Added additional parser context flags for narrow compiler behaviors.
- Improved compiler diagnostics around first-difference locations.
- Improved binary comparison reporting.
- Added stored/generated size comparison.
- Added round-trip binary comparison.
- Improved corpus run bookkeeping.
- Added protection against partial/targeted runs replacing full inventory state.
- Added clearer failure-family classification.
- Added regression-focused development workflows.
- Added more extensive TypeScript compiler checks around encoder changes.

### Fixed

- Fixed duplicate Record dependencies in several Rowset and `Select()` patterns.
- Fixed duplicate Scroll dependencies for repeated `GetRowset(Scroll.X)` calls.
- Fixed incorrect global Field reuse across unrelated control groups.
- Fixed missing Record references for single-member Rowset selectors.
- Fixed Row properties being incorrectly classified as Record dependencies.
- Fixed Application Class programs being falsely detected from comments containing the word `class`.
- Fixed import-section termination around standalone comments.
- Fixed late top-level Application Class declarations failing to generate Package dependencies.
- Fixed Function-local Application Class method dependency generation.
- Fixed explicit `Record.RECORD.FIELD` dependency generation.
- Fixed missing inline comments following `Then`.
- Fixed missing inline comments following `Else`.
- Fixed comment opcode selection after top-level statement terminators.
- Fixed multiple-variable Component declaration handling.
- Fixed Function metadata offsets for Functions containing parameters.
- Fixed repeated blank-line markers before certain `End-If` boundaries.
- Fixed top-level EOF semicolon handling for several statement classes.
- Fixed several decoder keyword casing inconsistencies.
- Fixed Function, `For`, and `While` header reconstruction.
- Fixed several declaration-section boundary mismatches.
- Fixed Package-reference duplication in Application Class usage.
- Fixed multiple Record/Field reference ordering discrepancies.
- Fixed several byte-level mismatches previously hidden by semantically equivalent source output.

### Validation Philosophy

PeopleSoft Studio now treats compiler fidelity as a measurable property rather than an assumption.

A definition can independently satisfy:

```text
decode SOURCE MATCH
source→bin EXACT
roundtrip EXACT
```

The most important compiler criterion is:

```text
source→bin EXACT
```

which means the extension generated the same compiled PeopleCode representation stored by PeopleTools.

`roundtrip EXACT` additionally proves that decoded PeopleCode can be recompiled back into the exact original binary representation.

This validation model will continue to drive future PeopleCode compiler development.

### Looking Ahead

Work begun in 0.1.7 is intended to ultimately enable PeopleSoft Studio to safely:

- create new PeopleCode definitions
- edit existing PeopleCode
- compile PeopleCode without Application Designer
- generate correct `PSPCMNAME` dependencies
- generate correct `PSPCMPROG`
- validate PeopleCode before persistence
- compare Studio compilation against PeopleTools compilation
- support richer PeopleSoft metadata-aware refactoring
- provide deeper PeopleCode navigation and dependency analysis directly inside VS Code

0.1.7 is the largest compiler-focused release of PeopleSoft Studio to date and establishes the validation infrastructure needed to continue closing the remaining gaps between PeopleSoft Studio and Application Designer.


## 0.1.6

PeopleCode encoder foundation and PSPCMPROG calibration

- Added initial PeopleCode encoder capable of producing PeopleTools-compatible compiled PeopleCode byte streams.
- Added byte-exact encoder tests using PSPCMPROG output generated by PeopleTools / Application Designer as the reference.
- Added `encodeFragment()` for encoding PeopleCode executable fragments.
- Added `encodeProgram()` for generating complete PSPCMPROG payloads, including calibrated program headers, executable sections, metadata, and program boundaries.
- Added `encodeProgramArtifacts()` for returning the compiled PSPCMPROG payload together with external PeopleCode reference metadata required by the compiled program.

- Added expression encoding for:
  - `&variables`
  - string literals, including PeopleCode doubled-quote escaping
  - `True` / `False`
  - unsigned integer literals
  - unary minus
  - arithmetic operators (`+`, `-`, `*`, `/`)
  - comparison operators (`=`, `<>`, `<`, `<=`, `>`, `>=`)
  - Boolean operators (`Not`, `And`, `Or`)
  - parentheses and nested expressions
  - function calls and nested calls
  - multiple function arguments
  - member method expressions such as `&e.ToString()`

- Calibrated PeopleTools Boolean-expression structure, including the structural `0x41` / `0x42` markers used with expression precedence and grouping.

- Added declaration encoding for:
  - `Local`
  - `Global`
  - `Component`
  - `Constant`

- Calibrated declaration-section boundaries and declaration-to-executable transitions, including PeopleTools `0x2D` and `0x4F` structural markers.

- Added Function definition encoding:
  - Function names
  - typed parameters
  - `Returns` clauses
  - Local declarations inside functions
  - executable function bodies
  - `Return`
  - `End-Function`

- Calibrated Function PSPCMPROG headers and metadata trailers.
- Calibrated PeopleCode type metadata for function parameters and return values, including string, boolean, and integer types.

- Added control-flow encoding for:
  - `If` / `Then` / `Else` / `End-If`
  - `Evaluate` / `When` / `When-Other` / `End-Evaluate`
  - `While` / `End-While`
  - `For` / `To` / `Step` / `End-For`
  - `Repeat` / `Until`
  - `Break`

- Added exception-handling encoding for:
  - `try`
  - `catch`
  - `throw`
  - `end-try`

- Added `Declare Function ... PeopleCode RECORD.FIELD EVENT` encoding.
- Calibrated external PeopleCode reference encoding, including the `0x3A`, `0x21`, `0x40`, and `0x42` structures used by `Declare Function`.
- Added external reference collection as a separate encoder artifact rather than coupling PSPCMNAME persistence directly to the PeopleCode encoder.
- Added deduplication of repeated external PeopleCode references. Multiple declarations referencing the same `RECORD.FIELD` and event reuse the same compiled reference index.
- Calibrated reference indexing against PSPCMNAME data using multiple distinct and repeated PeopleCode targets.
- Added golden test coverage proving exact PSPCMPROG reproduction and external-reference deduplication across multiple `Declare Function` declarations.
- Added explicit unsupported-syntax handling so the encoder fails deterministically instead of silently producing unverified bytecode.
- Continued separation of shared PeopleCode binary knowledge into reusable format/layout definitions, including opcode metadata, numeric formats, and PSPCMPROG layout constants.

### Notes

- The encoder is under active calibration against real PeopleTools-generated PSPCMPROG data. Supported syntax is intentionally limited to constructs whose binary representation has been verified.
- PeopleCode encoding is now substantially functional, but this release does not yet enable unrestricted PeopleCode database saves.
- External references required by compiled PeopleCode are now exposed by the encoder, but PSPCMNAME database persistence remains a separate implementation step.
- Some PeopleTools structural bytes have been calibrated in specific contexts but are not yet treated as universal semantics outside those contexts.
- Full PeopleCode expression and statement coverage is not yet complete.
- Decoder/encoder round-trip testing will continue to expand as additional PeopleCode constructs are calibrated.


## 0.1.5

Status Bar ( Database & Read-Only indicator )

- Database is a command, but its not wired to anything yet.


## 0.1.4

PeopleCode completion, hover, outline, and snippets

- PeopleCode completion — keywords, common built-ins, system variables (%Mode, %Request, …), locals harvested from the open file, and Function / method names declared in the same document; member hints after . on common receivers (%Request, rowset/record/field-style names).
- PeopleCode hover — short docs for keywords, built-in signatures, and system variables; basic note for Record.FIELD-style tokens and & variables.
- Document outline / breadcrumbs — symbols for class, interface, method, Function, property, and instance fields (regex-based).
- PeopleCode snippets — if / ifelse, for, while, evaluate, try, local declarations (locs, locn, …), MessageBox, SQLExec, GetLevel0, function/method skeletons, and more.
- Compare With Environment… — opens the same definition from a second connected backend in VS Code’s diff editor (text types: PeopleCode, SQL, and other canReadAsText definitions).
- SQL syntax highlighting — TextMate grammar for psft-sql (keywords, comments, strings, bind variables).
- Editor title actions — context-sensitive actions for PeopleCode/SQL (psft://) and the record custom editor; project view actions for build/compare where contributed.
- Record refresh — reloads the active record editor from the provider.
- Fixed PeopleCode string literals — embedded " characters are re-escaped as "" in decoded source so output matches Application Designer (e.g. JSON fragments in string literals).
- Activation / smoke coverage for new language providers and commands.
- README rewritten to match reality: trusted read of PeopleCode and SQL, SQL write on Oracle, record grid read-only, no PeopleCode save to the database yet, no page designer or full LSP.
- Clearer separation of what works vs what is still roadmap (encoder, record save, designers, project migrate).

### Notes 
- PeopleCode opened from Oracle remains read-only until a verified encoder exists; project export remains the safest path when you need editable source text offline.
- Compare needs two connections (or export + DB). Non-text definitions (e.g. records) are not diffed as text yet.
- Completion/hover/outline are editor-side helpers, not a full language server (no environment-wide go-to-definition or compile diagnostics).


## 0.1.3

- README.md modified for VS Marketplace
- Added DEVELOPER.md


## 0.1.2

Marketplace fixes

- GitHub URLs


## 0.1.0

First installable build.

- Connect to a PeopleSoft environment over Oracle, or open an Application
  Designer project export
- Browse projects, records, fields, pages, components, menus, application
  packages, App Engine programs and SQL definitions
- Open definitions as editable `psft://` documents
- PeopleCode syntax highlighting, including MetaSQL and application classes
- Read-only record editor showing the field grid, attributes and view SQL
- SQL definitions are readable and writable against the database

Known limits: PeopleCode read from the database decodes only as far as the
opcode table goes and cannot be saved back; record definitions and project
export files are read-only. See `docs/ROADMAP.md`.
