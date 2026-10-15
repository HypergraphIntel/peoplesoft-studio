# Changelog

## Unreleased

### Change Review development

- Durable Change Sets and a persistent VS Code review/history workspace,
  separate optional approach approval, exact-revision object approval,
  dependency-aware checkpoints, execution journals and reviewed reversal/redo.
- Oracle MCP staging for supported SQL, HTML/freeform style sheets, Query,
  Process Definition and PeopleCode source operations. Supported manual saves
  feed the same history; remaining mutation families retain legacy gates.
- Snapshot integrity/privacy checks, target/policy/operator drift checks,
  partial/uncertain result reconciliation and retry protection. No multi-object
  transaction or physical data/DDL undo is claimed.
- This is an incremental development implementation. Native human-reviewed
  acceptance and broader metadata adapters remain pending; see
  [Change Review progress](docs/change-review/PROGRESS.md).

## 0.9.0 — 2026-10-14

### Added

- MCP product orientation and a filterable structured capability catalog covering
  all modeled definition types, Configuration Tools, Data Migration Tools,
  customization strategy and project migration limits, with operation-specific
  routes and explicit unsupported coverage.
- Process Definition MCP reference/get/save tools using the existing Oracle
  editor writer, rollback previews, concurrency tokens and readback verification.
- PS Query MCP reference/list/get/prepare/run/create/save/copy tools using the
  existing bounded query models, access checks and writer. Save previews roll
  back rows and counters; unsaved designer edits block MCP saves and clean
  designers reload after committed changes. See [MCP reference](docs/MCP_REFERENCE.md).

- Configuration Tools > Process Definitions: search by process name, choose by
  process type, and open a tabbed definition editor with scheduling defaults,
  overrides, output, recovery settings, components and process groups. Oracle
  saves include undo/redo, draft recovery, conflict checks and readback verification.

- Configuration Tools Page and Field Configurator editor for Standard
  and Masking configurations, sequence activation, catalog field selection,
  previews and verified saves through the existing PFC writer.

- Customization > Drop Zones component editor with component search, subpage
  assignments, page navigation, preview, verified save and reload/revert.

- Security tools for OAuth application search, public configuration, audiences,
  role names and installed code labels; matching MCP list/get/reference tools.
- Calibrated editing of existing CUSTOM / Client Only / Client Credentials
  OAuth applications on Oracle PeopleTools 8.62.09: client ID, issuer, token
  endpoint and scope URL, with preview rollback, concurrency checks, readback
  verification and MCP approval gates. Existing secrets/tokens remain untouched.
- Read-only legacy inbound SAML inspection using its four-part identity.
  The panel distinguishes it from PeopleTools 8.63 browser SAML SSO, which
  remains unimplemented. See [Security tools](docs/SECURITY.md).

### Fixed

- Query and Process Definition ownership now uses the complete native keys,
  including public Query owners and Process Definition names. Existing objects
  reach the delivered-object policy instead of being treated as new.
- MCP saves refuse dirty Query/Process editors; clean editors refresh after
  committed saves. Query rollback previews preserve rows and cache counters.

### Validation and limits

- Release verification covers typecheck, bundle, unit tests and activation smoke,
  plus production HTTP MCP fixture checks for routing, gates and editor state.
- Eleven installed-MCP checks passed on HRDMO: ownership, previews, token and
  access refusals, Query execution and committed create/edit/copy readback.
  The delivered Process Definition was previewed only and remained unchanged.
- Data Mover Scripts and Data Migration Workbench remain planned. Project
  migration apply remains in the UI. Full PS Query parity, customization plans,
  upgrade-impact analysis, Configurable Search/AE plug-in discovery and browser
  SAML SSO are outside this release's implemented scope.

## 0.8.9 — 2026-10-14

### Added

- **Integration Broker editors and MCP authoring** for messages, Document
  Builder, services, service operations, nodes and routings. Search, inspect,
  validate, create, preview and save through shared writers calibrated on
  PeopleTools 8.62.09. Standard services, REST consumers and REST providers
  are explicitly distinguished; unsupported structures require PIA.
- **Administration editors and MCP tools** for Message Catalog, HCM Text
  Catalog and URL Definitions, with typed inputs, concurrency checks,
  write gates and readback verification.
- **Portal Registry editing** in Structure & Content and MCP: create folders
  and component/external content references, edit properties and security,
  and preview writes. Native PIA navigation after Studio saves remains unverified.
- **Studio migration packages** for fields, basic SQL Table/Derived Work
  records and complete App Engine programs. Export, preview target changes,
  import through guarded writers and retain verification receipts. Unsupported
  members block export; saves commit independently and physical tables require
  a separate build.
- **Project migration review** with saveable reports, explicit dependencies,
  optional target comparison and selected dependency insertion.

### Fixed

- Project comparison separates target read errors from verified absence,
  compares modeled record/field metadata without local update stamps, and
  normalizes packed AE PeopleCode identities.

### Documentation

- Updated capability tables and added administration and migration guides;
  documented Integration Broker write boundaries and Portal Registry evidence.

### Also included

### Added

- **Create a Page and Field Configurator configuration** from the
  Customization Strategy view: a registered component with no Standard
  configuration offers *Create a configuration…* -- a description, the first
  sequence and its first field (hidden, display only, required or
  relabelled), saved as the configurator's first save, Event Mapping included
  (previewed, then confirmed).
- **Masking with the Page and Field Configurator**: *Mask a field…* on a
  masking configuration's sequence (and *Create a masking configuration…*) --
  the field picked from the component's pages (long fields left out) and
  shown masked with a mask profile, the field group's offered first, as the
  configurator's Add picks it. Agents pass `mask` to
  `psft_page_field_config_fields`.

## 0.8.8 — 2026-10-14

### Added

- MCP `psft_create_record` for SQL Table and Derived/Work definitions,
  including custom AE state records. Physical SQL table builds remain separate.
- MCP project insertion for AE sections and AE PeopleCode, including
  platform and effective-date variants. Native Application Designer export
  verified with four section and two PeopleCode members.
- Character field format on MCP create/edit: Uppercase and Mixed Case.
- Windows PS Query designer workflows for existing queries and new query
  creation; see `docs/PS_QUERY_WINDOWS.md` for the calibrated scope.

### Fixed

- Valid PeopleCode quote and statement-layout normalization no longer causes
  a false save refusal when complete binary and name-row roundtrips are exact.
- Missing AE state records return structured validation diagnostics.
- Verified Studio-created fields, records and AE programs retain ownership
  evidence across edits, related record version changes, AE copy and rename.
- MCP approval waits expire after 60 seconds or cancellation; late approvals
  cannot resume expired writes.
- README capability tables reflect the implemented editors and 0.8.8 MCP
  support, with PS Query limits and the planned 8.63 MCP integration stated.

Validation: 38/38 HRDMO MCP authoring checks, native project export with zero
errors or warnings, and the protected 430-definition EXACT regression gate.
Details: `docs/MCP_0_8_8.md`.

## 0.8.7 — 2026-10-14

### Added

- **Writing Page and Field Configurator** (`DatabaseProvider.savePageFieldConfiguration`):
  a component's Standard or Masking configuration saved as PeopleTools'
  configurator saves it -- its rows, then its Event Mapping regenerated on
  every content reference of the component, derived by a port of the
  configurator's own mapper (checked against every configuration on HRDMO)
  and replayed against PIA's saves. Agents use MCP
  `psft_page_field_config_get` / `psft_page_field_config_save`; in the
  Customization Strategy view, choose a configuration's sequence to configure
  a field -- hidden, display only, required or relabelled, picked from the
  component's own pages as the configurator's Select Fields lists them -- to
  take one out, or to activate or deactivate the sequence or the configuration
  (previewed, then confirmed). Agents list the fields with
  `psft_page_field_config_fields`.
- **Page and Field Configurator discovery** (Customization Strategy view, MCP
  `psft_customization_discover`): a component's configurations -- what each
  sequence hides, requires, relabels, disables, defaults or masks, for whom --
  and on which of its content references the Event Mapping that applies them
  is in place; one saved but not applied is flagged.
- **Drop Zones discovery** (Customization Strategy view, MCP
  `psft_customization_discover`): for a component or page, its drop zones --
  found as PeopleTools' Configure Drop Zones finds them, through subpages and
  secondary pages -- each with its page, label and key, and any custom subpage
  configured into it; or *verified unavailable* when its pages have none.
- **Writing Drop Zones** (`DatabaseProvider.saveDropZoneConfiguration`): a
  component's drop zones given a custom subpage, or cleared, saved as
  PeopleTools' Configure Drop Zones page saves them -- replayed against PIA's
  own saves captured on HRDMO, and read back by that page. In the
  Customization Strategy view, choose a drop zone to show a subpage in it or
  clear it (previewed, then confirmed; a Writable connection with an Operator
  ID); agents use MCP `psft_drop_zone_get` / `psft_drop_zone_save`.
- **Go to Definition** in PeopleCode (F12 / Ctrl-click): a qualified
  application class path (`PKG:SUB:CLASS`, as written in an import, an
  `extends`, a `create` or a type) opens that class; a definition reference
  (`Record.JOB`, `Page.JOB_DATA1`, `Scroll.DERIVED`, `SQL.X`, `HTML.X`,
  `Field.X`, `Component.X`, `Menu.X`) opens that definition. The target is
  confirmed to exist in the connection first -- the stored definition, with
  its real casing -- so a jump never lands on nothing. Resolution is textual,
  so it works whether or not the program compiles.
- **Definition-name completion** in PeopleCode: after a definition keyword and
  a dot (`Record.`, `Page.`, `Component.`, `Menu.`, `SQL.`, `Image.`, `HTML.`,
  `Field.`, `Scroll.`), the matching definitions in the connection are offered
  by name with their description, refined as you type. A `&variable.` or
  `%System.` still offers its members, not names.
- **Live hover** in PeopleCode: hovering a field (`Field.EMPLID`, or a record
  field reference like `JOB_DATA.EMPLID`) shows its type, length and label from
  the database (`EMPLID — Character, length 11 · Employee ID`); hovering any
  other definition reference (`Record.JOB`, `Page.X`, an application class, ...)
  shows its type, description and when it was last changed. Built-in functions,
  keywords and system variables still show their static help.
- **Go to Definition** also follows a declared function: on a call to a function
  the program brings in with `Declare Function <name> PeopleCode <REC>.<FIELD>
  <EVENT>`, it opens that Record PeopleCode (for example a FUNCLIB FieldFormula).
- **Find All References** (Shift+F12 / the editor's references peek) for the
  identifier under the cursor, the same engine as the *Find References* command
  (one PSPCMTXT search on a database, a bounded scan on a project export), now
  without the input box.
- **Signature help** for common built-in functions: typing `(` or `,` in a call
  to a known built-in (CreateRecord, SQLExec, MsgGet, GetRowset, Substring, …)
  shows its parameters with the current one highlighted.
- **Member completion** after `&obj.` when `&obj` has an explicit application
  class type (`Local/Component/Global/instance PKG:SUB:CLASS &obj`, or an
  `&obj As PKG:SUB:CLASS` parameter): the class's real public methods,
  properties and constants, including those inherited from its qualified
  `extends` chain. This is not type inference — it fires only on a declared
  type, so the members offered are always real.

## 0.8.6 — 2026-10-13

### Added

- **Compare With Environment** works again: a PeopleCode program, SQL or
  other text definition side by side with the same definition in another
  configured connection -- a database or a project export -- in VS Code's
  diff editor. The other side is read once through a temporary connection,
  as *Test Connection* reads, so the active connection stays as it is (one
  connection is still active at a time).
- **Run SQL** (a SQL editor's title bar): the query in the editor -- or the
  selected one -- run on the connected database and shown as rows beside
  it. Read only: one SELECT (or WITH ... SELECT), no INTO or FOR UPDATE,
  checked before anything is sent; run in a transaction that is always
  rolled back, on Oracle also READ ONLY; at most `peoplesoft.sql.maxRows`
  rows (500). `%Table(record)` becomes the record's table; other meta-SQL
  and bind variables are refused by name. Not offered to AI agents.
- **Build Project** (Projects view): one Create Tables script for every
  SQL Table record of a project, from the database's DDL model and Build
  Settings (recreate drops an existing table first), opened for review;
  nothing is run. Views, Derived/Work records and records with subrecords
  are listed as left out.
- **Preview HTML** (an HTML definition's editor title bar): the definition
  as a page beside it, with no script run and nothing fetched (inline
  styles and data: images only); meta-HTML such as `%Bind(:1)` shows as
  written. Its button had never appeared (it waited for a language no HTML
  definition opens in).
- **Compare Project** (Projects view, a project's inline button or the
  view's title bar): each definition of a project read from the active
  connection and from another -- a database or a project export, read
  through a temporary connection -- listed as different, not in the other
  environment, could not be read, not compared (no text form) or the same;
  choosing a difference opens it in the diff editor, and the list stays
  open for the next. Line endings and trailing whitespace at the end are
  not differences.
- **Validate PeopleCode** (PeopleCode editor title bar): compiles the
  editor's text with PeopleSoft Studio's compiler -- the one saves use --
  against the program's own record and field or class, for the
  connection's PeopleTools release, and shows in Problems where it stopped
  and why (`Local string &c = ;`: line 2, column 19). Any program can be
  checked, not only those the write scope allows saving.
- **Find References** (PeopleCode editor title bar, or the command palette):
  every occurrence of an identifier -- a whole word, so `JOB` finds neither
  `JOB_DATA` nor `&JOB` -- or of any text, in all PeopleCode of the
  connection, listed by program and line; picking one opens it there. On a
  database it is one search of the stored source (PSPCMTXT), so no program
  is missed; a project export is scanned.

## 0.8.5

### Added

- **Customization Intelligence, phase 1: who owns a definition, and the
  delivered-object policy.** Every definition is classified -- Delivered,
  Delivered modified, Partner (bolt-on), Custom or Unknown -- with a
  confidence and its evidence: its PPLSOFT stamp, an Oracle-delivered project
  listing it, the naming prefixes, and a delivered baseline of the release
  when one is captured (*PeopleSoft: Capture Delivered Baseline...*, from a
  vanilla demo database). The Customization Strategy view shows it for the
  definition you have open.
- **Delivered-object policies, enforced** on every save, rename and delete of
  an existing definition (one guard in the database provider, which every
  editor, designer and MCP tool passes). One for your writes in the editors
  (`deliveredObjectPolicy`, default allowWithAudit: written and recorded) and
  one for AI agents' through the MCP (`agentDeliveredObjectPolicy`, default
  requireApproval: you approve each in VS Code, even when MCP writes are
  "allow"). block refuses Oracle's and vendors' definitions; unknown
  ownership is asked, never let through silently. Every decision is in the
  audit log (*PeopleSoft: Show Customization Audit Log*). The Customization
  Strategy view offers to capture a baseline when the release has none.
- **Naming prefixes are a list** (`peoplesoft.customization.namingPrefixes`):
  the organization's and each bolt-on vendor's, with who owns definitions
  named with them -- a vendor's prefix is the evidence for Partner. 0.8.4's
  single `organizationPrefix` is deprecated and still read while the list is
  empty; failing both, the write-scope prefix counts as the organization's.
- **Event Mapping discovery** (read only). For a component -- a page or a
  record through its components, PeopleCode through its owner -- the
  Customization Strategy view shows whether Event Mapping can extend it
  (Verified available: registered as a content reference; Verified
  unavailable: not) and the configurations already on it: level, event,
  service and its application class, processing sequence, sequence, enabled,
  who saved them. Matched against PeopleTools' Configure Event Mapping page.
- **Event Mapping, written as PeopleTools writes it** (through the MCP):
  a content reference's configuration read as the Configure Event Mapping
  page lists it and saved as the page saves it -- every row re-saved at the
  next SCNFM, deleted rows' tombstones, the content reference's own row, the
  Event Map Parameter (EV_PARAM), a service's EV_PARAM parameter, and the
  Data Migration Workbench tracking rows with PeopleTools' own key hash.
  Proven against the page's saves on HRDMO. The write scope applies to the
  services mapped, not the (usually Oracle's) content reference.
- **The Event Mapping editor**: *Configure Event Mapping...* in the
  Customization Strategy view opens a content reference's configuration as
  the Configure Event Mapping page's grid, saved after its plan is shown.
  *New Service...* creates the service a row runs -- and its application
  class, a stub to fill in, and its package when missing -- as PeopleTools'
  Define Related Content Service page saves it. **Configuration Tools >
  Customization > Event Mapping** opens it too: type part of a component
  content reference's name and pick it, on a connected database.
- MCP: `psft_customization_get_policy`, `psft_object_classify`,
  `psft_customization_discover`, `psft_event_mapping_reference`,
  `psft_event_mapping_get`, `psft_event_mapping_save`,
  `psft_event_mapping_remove`, `psft_event_mapping_create_service`. See
  docs/CUSTOMIZATION.md.
- **Discovery & Intelligence Network, phase 1: local discoveries.** Research
  findings about PeopleSoft recorded as structured, versioned records
  (`psft-finding/1`): a claim with its evidence, a deterministic fingerprint,
  duplicates and reproductions told apart, the PeopleTools releases it was
  seen on. Deny by default: an allowlisted schema and a privacy scan refuse
  hosts, paths, addresses, credentials and data. Offline; nothing is
  uploaded. See docs/intelligence.
- **Discovery Center** (*Discoveries* view): this installation's findings
  and the workspace's research findings, each with its claim, evidence and
  submission history; a submission review showing exactly what would leave
  the machine and what was removed. Submitting to a discovery server is off
  by default (`peoplesoft.intelligence.uploadMode`, `serverUrl`), closed by
  VS Code telemetry `off` or an administrator's machine policy file, and
  needs your approval of each submission; the token is kept in secret
  storage. A submission never carries a definition name with your
  organization's or a vendor's naming prefix, or the time of day it was
  observed (rounded to the day). *Record Discovery from JSON*, *Show
  Discoveries*.
- **Discovery server MVP** (`server/intelligence/`, local development only):
  FastAPI and PostgreSQL; submissions validated and privacy-checked again,
  the same identities and outcomes as the extension, tokens and roles,
  an audit log; reviews (corroboration needs independent evidence,
  verification names its releases, admins publish and revoke), contributor
  withdrawal, and signed knowledge bundles.
- **Knowledge bundles in the extension**: signed (Ed25519), verified before
  use (trusted key, signature, expiry, no rollback), data only, kept apart
  from findings. *Check for Knowledge Updates* (`peoplesoft.intelligence.knowledgeSync`,
  off by default), *Install Knowledge Bundle from File…*. No signing key is
  trusted yet, so no bundle is installed.
- MCP: `psft_discovery_list`, `psft_discovery_get`, `psft_discovery_record`
  (local only, approved by you), `psft_knowledge_capability` (VERIFIED /
  UNVERIFIED / UNSUPPORTED / CONFLICTING / UNKNOWN for the connection's
  PeopleTools release, with the evidence; never a permission),
  `psft_knowledge_compatibility`, `psft_knowledge_evidence`. The
  Customization Strategy view's Event Mapping row and
  `psft_customization_discover` show what recorded knowledge says on the
  connection's release; its *Studio Knowledge* section does the same for the
  page, component, record, App Engine, channel or other definition open.
- Research tooling: lab end-to-end runs and writer replay tests recorded as
  findings (check names and outcomes only); a finding turned into an issue
  body and a regression fixture for review
  (`tools/intelligence/engineering-task.mts`; files nothing).

### Changed

- The README opens with what PeopleSoft Studio is for, and screenshots.

### Fixed

- A static text's Alignment in the page editor wrote Centered or Right on
  top of Left (DSPLFORMAT 0x3 / 0x5). App Designer keeps exactly one of
  Left 0x1, Centered 0x2 and Right 0x4; the editor now does too. Found by
  checking docs/PAGE_SAVE.md against the st06 capture while recording it.

## 0.8.4

### Added

- **Customization Intelligence UI (preview, stubbed)** -- the surfaces
  CUSTOMIZATION_INTELLIGENCE.md and CUSTOMIZATION_STRATEGY_PANEL.md describe,
  not yet connected to anything:
  - a **Customization Strategy** view (collapsed, above Connections) that
    follows the PeopleSoft definition in the active editor or designer, with
    Object Identity, Preferred Strategy, Configuration Capabilities (the
    frameworks documented for that definition type), Dependencies & Upgrade
    Impact and Actions; Pin / Unpin; ownership and every capability shown
    greyed as *Unknown* -- never a finding no environment has produced;
  - a **Customization Plan** editor tab (*Open Plan Designer*): Requirement,
    Discover, Strategy (configuration vs direct comparison), Validate and
    Approval (the delivered-object modification dialog), every action
    disabled;
  - settings `peoplesoft.customization.organizationPrefix`, `defaultStrategy`,
    `deliveredObjectPolicy`, `requireImpactAnalysis`,
    `suggestPrefixForNewObjects`, marked *not enforced yet*.

## 0.8.3

### Added

- **Message Channel window.** Message channels open in App Designer's
  Message Channel window, editable on Writable connections: the Messages tab
  (the channel's messages, and the fields to partition by as App Designer
  lists them -- the level-0 record fields every message shares, then MSGNAME,
  MSGNAMEDETAIL, PUBLISHER, PUBPROC -- checked, with Add Partition Field and
  its (78,1) check), Message Channel Properties (General; Use: Run / Pause,
  Archive Messages?, Unordered?), undo / redo, Validate, Preview Save, Save As,
  Rename, Delete and *New Definition > Message Channel*. Saved as App Designer
  saves, its quirks included: a new channel's defaults, the properties' OK
  writing a never-set status and ordering, stored partition fields App
  Designer does not list dropped (and reported) on open; Rename repoints the
  messages and project items naming the channel. Mapped from 19 controlled App
  Designer saves on the lab VM, every one replayed by the tests; the live end
  to end passes 25 of 25, and App Designer opens, shows, edits and saves what
  the writer creates. Message channels are also in the Definition Browser,
  Open Definition, Properties and Insert into Project. See
  docs/MESSAGE_CHANNELS.md.
- **Message channels through the MCP**: `psft_channel_reference`,
  `psft_channel_get`, `psft_channel_validate`, `psft_channel_create`,
  `psft_channel_edit`, `psft_channel_copy`, `psft_channel_rename`,
  `psft_channel_delete`.
- **Configuration Tools and Data Migration Tools panes** (placeholders), in
  the PeopleSoft Studio sidebar between the Definition Browser and
  Connections: PS Query, Customization (Page and Field Configurator, Event
  Mapping, Drop Zones), Administration (Message
  Catalog, Text Catalog, URL Definitions), Portal Registry (Structure &
  Content), Integration Broker (Message Definitions, Document Definitions,
  Service, Service Operation, Nodes, Routes) and Security (OAuth, SAML); Data
  Mover Scripts and Data Migration Workbench. Shown greyed, marked *Coming
  soon*; choosing one says it is not available yet.

### Changed

- **Projects**: message channels can be inserted into a project (OBJECTTYPE
  36), as App Designer's Insert into Project writes them.
- **Definition Properties** covers message channels.
- Repository: design notes for a future Customization Intelligence Engine and
  Customization Strategy panel (`CUSTOMIZATION_INTELLIGENCE.md`,
  `CUSTOMIZATION_INTELLIGENCE_PROMPT.md`, `CUSTOMIZATION_STRATEGY_PANEL.md`);
  proposals, not implemented.

## 0.8.2

### Added

- **App Engine Designer.** App Engine programs open in App Designer's App
  Engine window, editable on Writable connections: the Definition view
  (sections and their variants, steps, actions) and Program Flow; a property
  panel for the program (General, State Records, Temp Tables, Advanced),
  sections, steps and actions with every setting App Designer stores; Insert
  Section / Step/Action / Action, change type, rename, move, Cut / Copy /
  Paste, delete, undo / redo; SQL, XSLT and PeopleCode in VS Code editors;
  validation (App Designer's Edit Validation, structure, references, PeopleCode
  compiled); Preview Save; *New Definition > App Engine Program*. Saved as App
  Designer saves: mapped from about 95 controlled App Designer saves (driven on
  the lab VM), and 85 of 88 of them replay row for row through the writer on a
  live database (the other three differ only where App Designer leaves
  PSSQLHASH's market stale). App Designer opens, edits and saves what the
  writer creates. See docs/APP_ENGINE.md and docs/APP_ENGINE_SEMANTICS.md.
- **App Engine through the MCP**: `psft_ae_reference`, `psft_ae_get`,
  `psft_ae_explain`, `psft_ae_validate`, `psft_ae_compare`, `psft_ae_verify`,
  `psft_ae_create`, `psft_ae_edit`, `psft_ae_copy`, `psft_ae_rename`,
  `psft_ae_delete` — the designer's model, validator and writer, with dry runs,
  concurrency tokens and your approval for each write. App Engine PeopleCode
  also saves through `psft_save_peoplecode` and the PeopleCode editor.

- **Menu Designer.** Menus open in App Designer's menu window, editable on
  Writable connections: the menu bar with its bars and their items (a popup's
  items alone), dashed slots to add a bar or an item, Menu Properties (General
  and Use: label, group with its shared order and separator, orders,
  installed), Bar Item and Menu Item Properties (component, enabling component,
  Search Rec Override, separator), Transfer Properties for popups, drag to
  reorder, Cut / Copy / Paste / Delete, ItemSelected PeopleCode in a VS Code
  editor, undo / redo, validation (App Designer's 43,4 / 43,5 checks,
  references, PeopleCode compiled), Preview Save, Save As, Rename, Delete and
  *New Definition > Menu* (Standard or Popup). Saved as App Designer saves:
  mapped from 60 controlled App Designer saves on the lab VM; 52 of 55 replay
  row for row through the writer on a live database (the rest are App
  Designer's Menu installed counter noise). App Designer opens, edits and saves
  what the writer creates. See docs/MENUS.md.
- **Menus through the MCP**: `psft_menu_reference`, `psft_menu_get`,
  `psft_menu_validate`, `psft_menu_create`, `psft_menu_edit`, `psft_menu_copy`,
  `psft_menu_rename`, `psft_menu_delete`. Menu PeopleCode also saves through
  `psft_save_peoplecode` and the PeopleCode editor.
- **CI Designer.** Component Interfaces open in App Designer's Component
  Interface window, editable on Writable connections: the component's buffer
  on the left (search records, scrolls, records, fields) and the interface on
  the right (GETKEYS, FINDKEYS, CREATEKEYS, PROPERTIES and collections,
  METHODS with the user methods); drag a field, a search key or a whole scroll
  in; Edit Property (name, comment, Read Only), Toggle Read Only Access,
  Delete; Component Interface Properties (General, Standard Methods,
  Synchronization); the Methods PeopleCode in a VS Code editor; undo / redo,
  Validate, Preview Save, Save As, Rename, Delete, and *New Definition >
  Component Interface* -- the source component, then App Designer's "default
  the properties? (123,12)". New interfaces are made from the component as
  App Designer makes them: keys, the properties its pages show, collections,
  names (and the names its save makes unique), SEQUENCE_NBR_6 and SYNCIDs,
  Fluid system pages included -- identical, item for item, to App Designer's
  own on four components from three-level lab to a 123-item Fluid component.
  Saved as App Designer saves: mapped from 28 controlled App Designer saves on
  the lab VM, every one replayed by the tests; the live end to end passes 19 of
  19, and App Designer opens, validates and saves what the writer creates. See
  docs/COMPONENT_INTERFACES.md.
- **Component Interfaces through the MCP**: `psft_ci_reference`, `psft_ci_get`,
  `psft_ci_buffer`, `psft_ci_validate`, `psft_ci_create`, `psft_ci_edit`,
  `psft_ci_copy`, `psft_ci_rename`, `psft_ci_delete`. Component Interface
  PeopleCode also saves through `psft_save_peoplecode` and the PeopleCode
  editor.
- **Page editor: every control of App Designer's Insert menu.** Image, Tree,
  Chart, Secondary Page, Subpage, Grid, Tab Separator and Analytic Grid are no
  longer greyed out. Each is inserted as App Designer inserts it, captured on
  the lab VM and replayed live through the writer (12 of 13 rows identical;
  App Designer opens the result):
  - a field dropped on a grid becomes its next column, at (0, 0) after its last
    column, and the grid's column count follows; the Layout view draws the
    columns inside their grid;
  - a Subpage takes its subpage's own size and place; a Secondary Page and a
    Subpage name their page (checked to be a secondary page / subpage);
  - a Tree takes a root record field and levels (PSPNLTREECTRL), its control id
    re-derived from its tab order at every save;
  - an Analytic Grid takes its model, cube collection and axes, and the save
    runs App Designer's 15,89 check (every field of the collection a column);
  - a new scroll goes in the tab order where App Designer puts one.
- **MCP: grid composition.** `psft_edit_page` adds every Insert-menu control
  (`intoGrid` makes a field a grid column); `psft_get_page_structure` gives each
  scroll's kind, a grid's columns, and a note when a grid's record is also a
  record of the level above; `psft_explain_scrolls` explains grids -- their own
  record, keyed by the parent level's keys plus a row key.

### Changed

- **Page editor: Edit Box Properties** now match App Designer's dialog tab for
  tab and control for control, every setting mapped from an App Designer
  capture (eb01-eb82) and replayed by the tests:
  - Record: Record / Field Name (a rebind takes the field's default label and
    format family), Style, Fill Character, Size Average / Maximum / Custom,
    Alignment Auto / Left / Right, Family Name and Display Name (the family's
    display formats), and every Display Option — Display Zero, Password, Show
    Prompt Button, Auto Fill, Display Time Zone, Input Only (offered with
    Password), Display Century, Currency Symbol, 1000 Separator, Auto Decimal,
    Enable Spell Check (which greys Show Prompt Button, as App Designer does).
  - Label: Type, Label ID, Insert Line Feed, label Style, Alignment, Position,
    First occurs only, No colon.
  - Use: Show Label and Enable When Page is Display Only under Invisible, Smart
    Prompt (offered when the field has a prompt table), Related Field / Control
    Field, Popup Menu, Display-Only Appearance, Wrap Long Words, and Mouse Over
    Popup — No Popup, Page Popup (the Popup Pages) or Message Catalog Popup with
    its text — offered on a Display Only field.
  - Fluid: Placeholder Text and Input Properties — Input Type (text … url),
    Generate As Hyperlink for email / url, and a range's Min / Max / Step.

  Live: savePage round trip on HRDMO (web-on / web-off), and App Designer's own
  dialog reads the saved settings back.
- **Page editor: scroll levels as App Designer assigns them.** A control's level
  (OCCURSLEVEL) now follows the tab order exactly as App Designer's does: a
  Scroll Area, Scroll Bar or Grid sets the level for the controls after it, a
  Horizontal Rule's Set to Level sets it back, and every save assigns the levels
  again — so reordering in the Order tab moves a control into or out of a scroll
  (it used to be refused). Scroll Area and Scroll Bar can be inserted; a
  scroll's Occurs Level is editable; Set to Level stores its choice as App
  Designer does. A save with an empty scroll is refused with App Designer's "No
  data for scroll". Fitted to a page built in App Designer from lab records
  keyed for levels 0-2 (lv01-lv17) and checked against all 17,356 HRDMO pages.
- **Page save: App Designer's scroll checks.** Each save runs App Designer's
  checks -- No data for scroll, More than one data record in scroll, Invalid
  field level, Invalid related display (its Message Set 15 messages) -- and, as
  App Designer asks "Invalid page. Do you still want to save the page?", the
  editor offers Save Anyway; nothing is written otherwise. Checked against all
  17,357 HRDMO pages (4 flagged, all delivered and never re-saved).
- **Page save: a Scroll Area's settings rows.** An inserted Scroll Area now gets
  App Designer's PSPNLCNTRLDATA / PSPNLBTNDATA rows (without them App Designer
  could not open the page); pasting copies them, deleting removes them. A new
  page places its controls and levels as App Designer does.
- **MCP: scrolls, keys, component buffers and PeopleCode navigation.**
  `psft_get_page_structure` (a page's levels, scrolls, primary records and keys,
  App Designer's checks), `psft_get_component_structure` (a component's buffer:
  search record, each scroll level's primary record with parentKeys / rowKeys,
  records and fields, PeopleCode object and built-in scroll paths, keying notes)
  and `psft_explain_scrolls` (the rules). `psft_edit_page` adds Scroll Area /
  Scroll Bar, `set_occurs_level`, `set_level`, `set_order` and `saveInvalid`.
- **Page editor: a newly inserted control** opens its own Properties panel (its
  Record tab included), not a General-only one; Push Button gains a Record tab.

- **Page editor Insert**: more controls can be inserted on a page, each written
  byte-for-byte as App Designer's fresh row (verified against captures) —
  **Static Image**, **Radio Button**, **Long Edit Box** and **HTML Area**,
  alongside the Frame, Group Box, Horizontal Rule, Static Text, Check Box,
  Drop-Down, Edit Box and Push Button already there. An HTML Area takes a record
  and, optionally, a long-character field (App Designer writes the two
  differently; both are captured). A Radio Button goes on a character field and
  a Long Edit Box on a long-character field. (Image, Tree, grids, scrolls,
  subpages, secondary pages, Tab Separator and charts stay greyed for now.)
- **Page editor tab order**: a control you add now takes the tab-order place
  App Designer gives it — right after the control before it on the page
  (reading order: top to bottom, left to right on a row) — instead of going
  last. Pinned down from every captured App Designer insert plus three focused
  experiments (selection plays no part); the MCP's `psft_edit_page` does the
  same. See [docs/PAGE_SAVE.md](docs/PAGE_SAVE.md#where-an-added-control-goes).
- **Page editor property panels** for Static Text, Static Image, Group Box and
  Horizontal Rule now match App Designer's dialogs tab for tab and control for
  control, each setting mapped from an App Designer capture
  (see [docs/PAGE_SAVE.md](docs/PAGE_SAVE.md)):
  - Static Text: Label (Text / Message Catalog, Insert Line Feed, Text /
    Explanation, Alignment), Use (Multi-Currency, Paragraph), General, Fluid.
  - Static Image: the alt tag, the Image ID with its type, size and picture
    and an image picker, Scale / Size with Width / Height and Reset to actual
    image size, General, Fluid.
  - Group Box: every setting on Record, Label (RFT labels and Label ID, label
    and body styles, Embedded Popup Help, alignment, Hide Border, Suppress
    Accessible Label), Use (Hide all Fields, Collapsible Data Area with its
    images), General and Fluid (Group Box Type, Html Tag Type, ScrollBars, the
    Header Extension, Draggable / Droppable / Gestures / Capture Trigger, Scroll
    Sizing by Style). Saves write what App Designer's OK writes alongside.
  - Horizontal Rule: Text and Style, Multi-Currency, Set to Level, General,
    Fluid.
  - Check Box: Record (field and On / Off values), Label (None / Text / RFT
    labels with Label ID, Style, Location, Alignment), Use (every Field Use
    Option including Modifiable by JavaScript, Generate in HTML and Related
    Field with its Related Control Field, Popup Menu, Display-Only
    Appearance, screen-reader read-only), General, Fluid.
  - HTML Area: HTML (Field or Constant HTML, HTML Tags Only, Respond Only
    Once), Label (None / Text / Message Catalog / RFT labels), General, Fluid.
    A Constant's HTML is now read, saved, deleted with its control and copied
    on paste.
  - Long Edit Box: Record (Style, Enable Spell Check), Label (line feeds,
    Label Style, Alignment, Position, First occurs only, No colon), Use
    (Expand Field When Display Only, Display in Modal Window, Long Edit
    Counter, screen-reader read-only), General, Fluid (Placeholder Text) and
    Options (Rich Text and its five ids, saved to PSPTPNLRTEDITOR).
- **Page save fix**: a save that changed only a control's PSPNLFIELDEXT
  settings (a Fluid option, Paragraph ...) was skipped as "nothing changed";
  it is written now.
- **Page Properties** no longer shows the "greyed settings become editable once
  captured" note: every General / Use / Fluid setting is editable now, and the
  few greyed items (a secondary page's OK & Cancel / Close Box / Modal options
  on a standard page, a popup page's Allow Deferred) are disabled only because
  they do not apply to that page type, each saying so on hover.

### Fixed

- `psft_edit_page` added a Static Image, Scroll Bar or Secondary Page without
  the use bits App Designer gives one (display only / invisible); they now get
  them, as the Layout editor's inserts always did.

## 0.8.1

### Changed

- **Component PeopleCode editor** (Experimental): View PeopleCode on a
  component opens its first event straight away (PreBuild, or the first with
  code; RowInit for a record from the Structure tab), and the editor's title
  bar has App Designer's **Object** and **Event** drop-downs: the component,
  every record in its buffer with its fields, and their events, those with
  code marked. An event with no program opens empty and **saving creates
  it**; component, component record and component record field PeopleCode
  are compiled and saved as App Designer saves them (byte-identical to
  captured App Designer saves). Also through the MCP's
  `psft_save_peoplecode`. See [docs/COMPONENTS.md](docs/COMPONENTS.md).
- **New Definition > Component**: name, market, search record (required),
  first page and description; created as App Designer's New Component and
  Save As create one (identical rows), then opened to edit the rest.
- **Page PeopleCode** (Experimental): the page window's **View PeopleCode**
  (beside Save) opens the page's Activate program, empty when there is none;
  saving creates or updates it as App Designer does (byte-identical to
  captured App Designer saves).
- **Page editor** (Experimental):
  - **Select Field / Select Group / Select All**. Drag a rectangle to select a group
    (on empty page, or anywhere in Select Group). Shift / Ctrl+click adds or
    removes a control. Ctrl+A selects all. Dragging any selected control moves
    the group, and Delete removes it.
  - **Insert ▾** is App Designer's Insert menu, grouped (containers and text,
    controls, grids and scrolls, pages, charts). Controls not yet captured
    are listed greyed.
  - **Order** tab: Move Up / Move Down and drag-and-drop set the tab order,
    which is saved as FIELDNUM, as App Designer saves it. A move into or out
    of a grid or scroll area (a level change) is refused.
  - **Copy / Paste** (Ctrl+C / Ctrl+V), one control or a group, between any
    page windows of a connection. Copy also works on read-only pages. A
    pasted control is saved as App Designer's paste saves it: a copy of the
    source's rows at the new position, after its source in tab order.
  - **New Page** opens an empty page (570 × 330, Fluid Page off), and its
    first Save creates it. As in App Designer, a page needs a control before
    it can be saved. **New Page Fluid** offers App Designer's Choose Layout
    Page list, creates the page as a copy of the chosen Layout Page (Fluid
    Page on), and asks whether to copy its PeopleCode too. Both are in New
    Definition and the Command Palette.
  - The page can no longer be sized smaller than its controls, and controls
    can't be dragged off the page.
  - Subpages show their subpage name, as App Designer draws them.
  - **Page Properties** has App Designer's General / Use / Fluid tabs.
    Editable: Description, Comments, the page size, **Owner Id**, **Page Style
    Sheet**, **Page Background**, **Allow Deferred Processing**, **Adjust
    Layout for Hidden Fields**, **Popup Menu**, **Page Type** (every type;
    the Use tab enables and defaults each setting as App Designer does for
    that type), a secondary page's **OK & Cancel buttons**, **Close Box**
    and **Disable Display in Modal Window**, **Fluid Page**, and the whole
    **Fluid** tab (Style Classes, the Small / Medium / Large / Extra Large
    overrides, Suppress System-Specific Style Classes). Each is written as
    App Designer writes it, matching captured App Designer saves (a page made
    standard is 570 × 330, as in App Designer). The MCP's `psft_edit_page`
    `set_properties` takes them too. **Page Size** offers App Designer's list
    (640x480 Windows screen … 490xVar portal home page comp., Custom size),
    each stored as App Designer stores it. A page made Subpage or Popup Page
    stores the rectangle the editor draws; App Designer measures its own on
    its next save.
  - A control added or pasted **inside a scroll area, grid or scroll bar** now
    takes that scroll's occurs level (App Designer's component-buffer nesting),
    not level 0.
  - **Every control type now has App Designer's own property panel** in the
    sidebar, with the tabs App Designer shows for that type — not just Frame.
    Static Text, Group Box, Static Image, Edit Box, Drop-Down, Long Edit,
    Check Box, Radio, Image, Scroll Bar, Subpage, Push Button, Secondary Page,
    Grid, Tree, Horizontal Rule, HTML Area, Scroll Area and Chart each get
    their Record / Label / Use / General / Fluid (and Image / Options) tabs as
    they apply. Editable, each written as App Designer writes it (verified
    against captured saves): the **Label** type (incl. Message Catalog set /
    number), text, **Style**, Static Text **Alignment** and **Paragraph**,
    Static Image **Image ID** and **Scale/Size**; the **Use** bits (Display
    Only, Invisible, Display Control Field, Related Field, Multi-Currency,
    Enable When Page is Display Only, Set Component Changed, Wrap Long Words);
    a Check Box / Radio's **On / Off / Value**; **Record Name / Field Name**
    rebinding (the save refuses a field that is not on the record); **Allow
    Deferred Processing**; a Grid / Scroll Area / Scroll Bar's **Occurs
    Count** and a Grid's **Show Column Headings / Show Row Numbers / Allow
    Column Sorting**; **Page Field Name**, **Enable as Page Anchor**, **Adjust
    Layout for Hidden Fields**; and the whole **Fluid** tab on a Fluid page
    (style classes, suppress options, label rendering, control structure).
  - **Page Background** is a drop-down of the style classes, like Page Style
    Sheet.
  - Page types carry App Designer's names (7 Layout Page, 10 Master&Detail
    Target Page).

## 0.8.0

### Changed

- **Components** open as App Designer's component window: the
  **Definition** grid (Page Name, Item Name, Hidden, Item Label, Folder Tab
  Label, Allow Deferred Processing; a row's right-click View Definition opens
  the page), the **Structure** tab (the component buffer: search record,
  scroll levels, their primary records and records, component PeopleCode
  marked) and **Component Properties** (General, Use, Internet, Fluid).
  On a Writable connection the component is editable (Experimental): Item
  Label, Folder Tab Label and Hidden; drag, Cut / Copy / Paste / Delete page
  rows; **Insert Page...** (Insert > Page into Component); Description,
  Comments, search records, detail page, Actions, Disable Saving Page and
  Include in Navigation; Save -- reproduced from nine captured App Designer
  saves. A component without a search record is never saved. The
  **Internet**, **Fluid** and **Style** tabs are decoded and editable too --
  every toolbar, pagebar, navigation and header-action box, processing mode,
  search page settings, Fluid attributes, Classic Plus and the component
  style sheet / JavaScript objects -- from 70 one-control App Designer saves.
  See [docs/COMPONENTS.md](docs/COMPONENTS.md).
- **View PeopleCode** on a component (panel header, Structure tab right-click,
  or a component in the Definition Browser / a project): pick the component,
  a record or a field, then the event -- those with code marked -- to open its
  component, component record or component record field PeopleCode.

## 0.7.9

### Changed

- **MCP writes** (Experimental): AI clients can now edit through the
  PeopleSoft Studio MCP server, with the editors' own writers -- every save
  the same rows App Designer writes:
  - `psft_save_peoplecode`: compile and save Record PeopleCode or an
    Application Class (a new class is created in its package); the save
    leaves the same undo report as an editor save.
  - `psft_save_text_definition`: SQL, HTML and freeform style sheets
    (created when new).
  - `psft_get_page_layout` and `psft_edit_page`: a page's controls by id;
    add, move, resize, relabel, Display Only / Invisible, delete, and the
    page's Description, Comments and size.
  - `psft_edit_record` (insert / remove / move fields and subrecords, Use,
    Edits, defaults, labels, Record Properties, record type) and
    `psft_delete_record`.
  - `psft_create_field`, `psft_edit_field` (length, description, labels),
    `psft_edit_translate`.
  - `psft_create_project`, `psft_add_to_project`, `psft_create_package`.

  Each write needs what the editors need -- a database connection set to
  Writable, an Operator ID, a name in the write scope -- and no editor
  holding unsaved changes to the definition. The new **MCP writes** setting
  (`peoplesoft.mcp.writes`) decides the rest: **Confirm each write** (the
  default; VS Code shows the connection, the definition and the change, and
  nothing is written until you allow it), **Allow without asking**, or
  **Off** (read-only). See [docs/MCP_WRITES.md](docs/MCP_WRITES.md).

## 0.7.8

### Changed

- **Visual Page designer**: opening a page shows it in a panel with App
  Designer's two views -- **Layout**, the controls drawn in place from their
  stored geometry (PSPNLFIELD FIELDLEFT/TOP/RIGHT/BOTTOM), styled by control
  type with their labels, on a canvas at the page's size; and **Order**, App
  Designer's grid (tab order, field ID, level, label, type, field, record,
  page field name, deferred, control field). A shared sidebar shows the
  selected control's properties, or the page's (**Page Properties**).
  On a Writable connection, for pages in the write scope, the Layout view is
  an editor (Experimental): drag, resize, delete, relabel, Display Only /
  Invisible; **Insert** Frame, Group Box, Horizontal Rule, Static Text,
  Check Box, Drop Down List Box, Edit Box or Push Button; edit the page's
  Description and Comments; drag the page edge (or type a size) to set a
  Custom page size. Save writes PSPNLDEFN / PSPNLFIELD / PSPNLFIELDEXT and
  the PDM / SYS version counters as App Designer does -- every write shape
  proven against captured App Designer saves. See
  [docs/PAGE_SAVE.md](docs/PAGE_SAVE.md) and
  [docs/PAGES_COMPONENTS_MENUS.md](docs/PAGES_COMPONENTS_MENUS.md).
- **Microsoft SQL Server and DB2 connections** (Experimental): *Add
  Connection* offers SQL Server (`host[\instance][:port]/database`) and DB2
  for Linux, UNIX and Windows or z/OS (`host[:port]/database`). Everything
  reads as on Oracle -- browsing, search, every definition view, PeopleCode,
  Properties, the MCP server -- and the writers (PeopleCode, records, fields,
  translates, SQL, HTML, style sheets, projects, packages, Build) write the
  same rows. Schema per connection as on Oracle (`PSDBOWNER`, else the
  platform's default). Checked against SQL Server and DB2 lab databases
  loaded from HRDMO: 5,105 definitions render as on Oracle, and every writer
  stores what it stores on Oracle. No App Designer save has been captured on
  these platforms yet. See [docs/DATABASES.md](docs/DATABASES.md).
- **PeopleSoft: Install DB2 Driver** installs IBM's `ibm_db` (about 85 MB,
  with npm) for DB2 connections; or point `peoplesoft.db2.driverPath` at an
  installation. The SQL Server driver ships with the extension.
- Build... writes the platform's DDL: its PSDDLMODEL statements, its table
  space row, and its column types; SQL Server and DB2 scripts end statements
  with `go` and `;`.
- **Two-tier sign-on** (2 Tier): *Add Connection* offers 2 Tier (Oracle),
  2 Tier (MS SQL) and 2 Tier (DB2), like App Designer's two-tier sign-on. A
  Connect ID (the proxy database login, e.g. `people`) runs every query, and
  a PeopleSoft operator (OPRID) is the acting identity saves are recorded as,
  verified against PSOPRDEFN at connect (exists and not locked). The
  access-profile lookup (PSACCESSPRFL) is never done. See
  [docs/DATABASES.md](docs/DATABASES.md).
- **3 Tier (Application Server)** connection type (configured, transport
  pending): *Add Connection* collects App Designer's 3-tier profile --
  application server name, machine/IP, port, Tuxedo connect string, domain
  password, database type and PeopleSoft operator -- and stores it. The
  Tuxedo transport to the application server is not built yet, so a three-tier
  connection cannot be opened; the type and its configuration are in place for
  the transport. See [docs/DATABASES.md](docs/DATABASES.md).

### Fixed

- A record's table space came from whichever PSRECTBLSPC row was read
  first, so a record with rows for other platforms could be built on Oracle
  in DB2's table space (ABSHCOMUK_LNG: PSIMAGE2 for HRAPP). It is now the
  connection's platform row, else the default.
- Find Definition References, a portal folder's contents and a node's
  connector properties list in a fixed order (ties were in whatever order
  the database returned them).

## 0.7.7

### Changed

- **Connections in Settings collapse**: click a connection's header to
  open or close it. Closed, it is one line -- name, badges and connect
  string. The target connection starts open, as does one just added; the
  rest start closed, and each stays as you leave it.
- **Build Settings** reads as one panel: folder tabs (Build, Alter) over a
  bordered box, the selected tab joined to it.

## 0.7.6

### Changed

- **App Engine programs open** in a panel with App Designer's two views:
  **Definition** (sections, steps and actions in labelled boxes -- Commit
  After, Frequency, On Error, ReUse Statement, No Rows, Do Select Type, On
  Return ...) and **Program Flow** (each step's SQL and PeopleCode). A
  section from a project opens the same way.
  App Engine PeopleCode in a project now opens. The tables, keys and codes
  are mapped in [docs/APP_ENGINE.md](docs/APP_ENGINE.md). Log Message
  actions show their Message Catalog text.
- **Pages, components and menus** open as fuller read-only views: a page
  in App Designer's Order view (each control's level, type, label, record
  field or target) with the components it is in; a component's search
  records, actions, settings, pages and menus; a menu's bars and items.
  Mapped in [docs/PAGES_COMPONENTS_MENUS.md](docs/PAGES_COMPONENTS_MENUS.md).
- **File Layouts and Component Interfaces open** read-only: a file layout's
  format, options, segments and fields; a component interface's component,
  standard methods, keys, collections and properties. Mapped in
  [docs/FILE_LAYOUTS_COMPONENT_INTERFACES.md](docs/FILE_LAYOUTS_COMPONENT_INTERFACES.md).
- **Permission Lists, Roles and Message Catalog entries open** read-only: a
  permission list's roles, sign-on times, pages and their actions, Web
  Libraries, PeopleTools areas, Component Interface methods, web services,
  process and query access groups; a role's permission lists and users; a
  message's text, severity and explanation. Mapped in
  [docs/SECURITY_MESSAGES.md](docs/SECURITY_MESSAGES.md).
- **Queries open** read-only: owner, type and prompts, then the query, its
  subqueries and unions -- records and joins, output columns, and criteria
  in Query Manager's words (equal to, in list, Eff Date <= ...). Mapped in
  [docs/QUERIES.md](docs/QUERIES.md).
- **Process definitions open** read-only, their settings in Process
  Scheduler's words (PSXLATITEM): priority, run location, parameters,
  output, server, components and process groups. See
  [docs/PROCESS_DEFINITIONS.md](docs/PROCESS_DEFINITIONS.md).
- **Trees open** read-only: settings, levels, and the nodes as an outline
  with their detail ranges. See [docs/TREES.md](docs/TREES.md).
- **Integration Broker messages, services and service operations open**
  read-only: a message's versions and record structure, a service's
  operations, an operation's versions, messages, handlers and routings. See
  [docs/INTEGRATION_BROKER.md](docs/INTEGRATION_BROKER.md).
- **Portal registry entries open** read-only: a content reference's
  navigation path, component and URL, security and attributes; a folder's
  contents. See [docs/PORTAL_REGISTRY.md](docs/PORTAL_REGISTRY.md).
- **URL definitions, XSLT and message nodes open** read-only; a node's
  passwords are never read or shown. See [docs/URLS_NODES.md](docs/URLS_NODES.md).
- **Images open** in a panel (GIF, PNG, JPEG, SVG, BMP), each alternate
  with its format and size. See [docs/IMAGES.md](docs/IMAGES.md).
- The Definition Browser and Open Definition offer Queries (public), Process
  Definitions, Trees, Messages, Services, Service Operations, Images, Portal
  Registry entries, File Layouts, Component Interfaces, Permission Lists and
  Roles.
- **The MCP server reads every type the extension opens**, and says how:
  the search and read tools list the type codes, and the new
  `psft_list_definition_types` gives each type's key parts. Search with no
  type searches every type. Images come back as the image itself (PNG,
  GIF, JPEG, WebP; SVG as text). Message Catalog entries (by set, number
  or text) and App Engine sections can be searched.
- **Build Settings** is one panel in Settings with a Build tab and an Alter
  tab, as App Designer's Build Settings dialog.
- The Projects tree names 20 more item types it lists but does not open
  (Queries, Roles, Permission Lists, Images, Messages, Message Catalog
  entries, Portal Registry Structures, Process Definitions, Services, Service
  Operations, Trees ...), each checked against its definition table on
  HRDMO; the rest still show as "Type n".
- **SQL items in projects** (PSPROJECTITEM type 30) are SQL definitions:
  they open, App Engine and view SQL read-only. A SQL text with several
  market / platform / date versions shows one, not all run together.

### Fixed

- Components outside the GBL market (1,141 on HRDMO) did not open from the
  Definition Browser or Open Definition: search now keys them by market.
- Component record PeopleCode (project type 47) and component record field
  PeopleCode (48) now open from a project; 48 was labelled Component
  Record PeopleCode.
- The MCP PeopleCode tools (`psft_get_record_peoplecode`,
  `psft_get_component_peoplecode`, `psft_get_application_class`,
  `psft_find_peoplecode_references`) worked only on project exports: a
  database connection could not search PeopleCode. It now finds record,
  component, page, menu, App Engine and Application Class PeopleCode in
  `PSPCMPROG`, and Find Definition References opens all of them.
- SQL definitions and SQL / Dynamic View text opened as "[object Object]":
  the SQL text column is a CLOB and is now read as text.

## 0.7.5

### Changed

- **Build... for records**: Create Tables as a script, or **Build and
  execute** on a Writable connection (saved records; a confirmation names
  a table whose data would be dropped; statements logged to *PeopleSoft
  Build*). **Build Settings** in the Settings panel (Create and Alter, App
  Designer's defaults): *Recreate table* drops an existing table first, as
  App Designer's script does; *Skip table* leaves it. The Alter, index,
  view and sequence settings are stored for when those builds are
  supported.
- **Schema per connection**: the PeopleTools tables are no longer assumed
  to be in `SYSADM`. A connection's Schema (Settings) sets the owner ID;
  left empty it is read from `PS.PSDBOWNER`, else `SYSADM`. Each session
  sets `CURRENT_SCHEMA`, and Connect checks the schema has the PeopleTools
  tables.
- **Saving and creating are no longer limited to `ZZ_PCODE_LAB%` names**:
  every definition on a Writable connection with an Operator ID can be
  saved or created. The new setting `peoplesoft.writeNamePrefix` limits
  writes to names starting with a prefix again (empty by default: no
  limit).
- **Oracle In-Memory** (Record Properties, Use tab): Off, All Fields or
  Selective Fields, and each field's In Memory check under Selective
  Fields, saved as App Designer saves them. All Fields leaves a CLOB field
  out and is then stored as Selective Fields, as App Designer does.
- **Subrecords**: Insert Subrecord into a Derived/Work record, remove one,
  and edit records holding subrecords, saved as App Designer saves them (the
  subrecord's fields expanded into the record).
- **Alternate Search Keys** on SQL Tables (Record Field Properties), with
  their indexes as App Designer builds them; the **System ID Field**
  (Record Properties); and changing an **SQL View to an SQL Table** or
  **Derived/Work**, and **Derived/Work to a Dynamic View** and back.
- The **Build Script** writes alternate search key indexes, and leaves NOT
  NULL off Auto-Update number columns, as App Designer's script does.
- **The Field editor edits fields**: Change Length (and decimals), Add
  Label, Edit Label, Set Default Label and Change Description, each saved
  at once as App Designer saves a field -- the records holding the field
  take its new version. On Writable connections.
- Records: remove an SQL Table's last key, change an SQL Table to
  Derived/Work, re-create a record name that was deleted, and set the audit
  record, audit options and Timestamp Field (Record Properties, Use tab),
  as App Designer saves them.
- **Translate Table Edit** can be set and cleared in Record Field
  Properties (Edits tab), for fields that have translate values.
- **New Field** can create Image Reference fields.
- **Record Type tab** edits: change a Derived/Work record to an SQL Table
  or SQL View, or an SQL Table to an SQL View; set the Non-Standard SQL
  Table Name and Build Sequence No; write a view's SQL. SQL Views and
  Dynamic Views can now be edited like tables (fields, properties, SQL).
  Saved as App Designer saves them (tablespace row, key index and view SQL
  follow the type). On Writable connections.
- **Build Script** writes App Designer's Create Tables script exactly:
  the database's DDL model and storage parameters, App Designer's column
  types (`SMALLINT`, `INTEGER`, `DECIMAL`, `tIMESTAMP`, `vARCHAR2` ...),
  CLOB columns last, the index without `DESC`, and its line layout. Checked
  byte for byte against App Designer's scripts for two records.
- **New Application Class** takes a package path (`ROOT`, `ROOT:SUB` or
  `ROOT:SUB:SUB2`): the class is created in that subpackage, and
  subpackages that do not exist yet are created with it, as App Designer
  does. See [docs/CREATE_DEFINITIONS.md](docs/CREATE_DEFINITIONS.md).
- **Change Description...** for HTML definitions and freeform style
  sheets (right-click one in a tree, or its editor tab), saved as App
  Designer saves a description change. On Writable connections.
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
