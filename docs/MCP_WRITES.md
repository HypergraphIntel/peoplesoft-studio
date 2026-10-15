# MCP writes

The PeopleSoft Studio MCP server (`src/mcp/`) gives AI clients the same edits
the editors make. Each write tool calls the editor's own writer, so what lands
in the database is what the editor's Save writes: rows reproduced from
captured App Designer saves (PeopleCode, records, fields, translates, SQL,
HTML, style sheets, projects, packages, pages). Core authoring tools are in
`src/mcp/writeTools.ts`; domain tools live in the corresponding `src/mcp/*Tools.ts`
modules. Authoring tools register only when VS Code provides the write host
(the setting, the approval dialog, and the editors' state).

## Additional authoring tools in 0.8.9

Integration Broker uses `src/mcp/ibTools.ts`; administration catalogs use
`src/mcp/administrationTools.ts`; Portal Registry uses `src/mcp/portalTools.ts`.
These share the connection, approval, dirty-editor and concurrency gates.
See [Integration Broker](INTEGRATION_BROKER.md), [Administration](ADMINISTRATION.md)
and [Portal Registry](PORTAL_REGISTRY.md) for supported writes and evidence limits.
[Project migration](PROJECT_MIGRATION.md) adds read-only MCP review, package
export and target preview; applying imports uses the extension UI.

## Security configuration

`psft_oauth_save` edits four public settings of existing CUSTOM / Client Only /
Client Credentials applications on Oracle PeopleTools 8.62.09, with preview,
concurrency and normal approval gates. It does not change credentials or tokens.
See [Security tools](SECURITY.md) for scope and native-save evidence.

## Gates

A write goes ahead only when all of these hold:

1. **`peoplesoft.mcp.writes` is not `off`.**
2. **A database connection, connected and set to Writable** (*Access* in
   PeopleSoft Studio Settings). Project exports are never written.
3. **An Operator ID** on the connection, recorded as `LASTUPDOPRID`.
4. **A name in the write scope** (`peoplesoft.writeNamePrefix`, when set).
5. **No VS Code editor with unsaved changes** to the definition. The user
   saves or reverts first.
6. **The user's approval**, when `peoplesoft.mcp.writes` is `confirm` (the
   default). A modal names the connection, the definition and the change: for
   text, where it changes and the new lines; for pages and records, each
   operation. Nothing is written unless the user chooses **Allow**.

The writers keep their own checks on top: each definition's concurrency token
(PeopleCode fingerprint, VERSION) is read just before the write, so a
definition that moves between that read and the write is refused. PeopleCode
is compiled before it is saved, as App Designer does. Record edits keep App
Designer's rules (Search Key needs Key, only observed record-type changes, and
so on), and page inserts only use field types a capture covers.

After a write, an open text editor of the definition (PeopleCode, SQL, HTML,
style sheet) reloads and the trees refresh; an open page or record editor
keeps its old version, so its next save is refused until it is reopened. A
PeopleCode save leaves the same report as an editor save
(`<global storage>/peoplecode-saves/*.json`, the rows it replaced).

## Setting

| `peoplesoft.mcp.writes` | |
|---|---|
| `confirm` (default) | VS Code asks before each write |
| `allow` | Writes go straight through the gates |
| `off` | The MCP is read-only |

## Tools

| Tool | What it writes |
|---|---|
| `psft_save_peoplecode` | Record PeopleCode (type 8: RECORD, FIELD, EVENT) or an Application Class (58: PACKAGE[, SUB...], CLASS, OnExecute), the whole program. A class that does not exist is created in its package |
| `psft_save_text_definition` | An SQL definition (30), freeform style sheet (50) or HTML definition (51); created when new. Optional description (HTML, style sheet) |
| `psft_get_page_layout` | Read-only: a page's controls with their ids, rectangles, labels, record fields and use, and the page's properties |
| `psft_edit_page` | Operations on a page: `add` (frame, groupBox, horizontalRule, staticText, scrollArea, scrollBar, or checkBox / dropDown / editBox / pushButton on a record field), `move`, `resize`, `set_label`, `set_use`, `delete`, `set_occurs_level` (a scroll's Occurs Level), `set_level` (a Horizontal Rule's Set to Level), `set_order` (the tab order), `set_properties` (description, comments, width / height ...). Every save assigns each control's scroll level from the tab order and runs App Designer's page checks (No data for scroll, More than one data record in scroll, Invalid field level, Invalid related display); a page that fails them is saved only with `saveInvalid: true`, App Designer's "Invalid page. Do you still want to save?" Yes |
| `psft_get_page_structure` | Read-only: a page's controls in tab order with their scroll level and scroll, its scroll tree (each scroll's primary record, that record's keys split into `parentKeys` / `rowKeys`, its records and fields, PeopleCode paths) and App Designer's checks on it |
| `psft_get_component_structure` | Read-only: a component's buffer as App Designer's Structure tab builds it -- search record and keys, level 0, every scroll level with its primary record and keys, records with their page fields, the PeopleCode object path and built-in scroll paths, and keying notes |
| `psft_explain_scrolls` | Read-only: the rules -- levels from the tab order, App Designer's page checks, record keying per level, how a component's buffer is built from its pages, PeopleCode navigation (GetLevel0, GetRowset(Scroll.X), scroll paths) |
| `psft_edit_record` | Operations on a record: `insert_field`, `insert_subrecord`, `remove_field`, `move_field`, `set_use`, `set_edits`, `set_default`, `set_label`, `set_properties`, `set_type` |
| `psft_delete_record` | Deletes a record definition |
| `psft_create_field` | A new field and its default label |
| `psft_edit_field` | Length / decimal positions, description, the label list |
| `psft_edit_translate` | Adds, changes or deletes a translate value |
| `psft_create_project`, `psft_add_to_project` | A new project; definitions added as items |
| `psft_create_package` | A new Application Package |

Page and record edits are lists of operations applied in order to the
definition as stored, then saved in one transaction. The geometry rules are
the Layout editor's: a move shifts a sized control's right / bottom and a
stored label rectangle with it; a resize makes the size custom.
`src/model/pageOperations.ts` and `src/model/recordOperations.ts` hold that
logic, tested in `src/test/mcpWrites.test.ts`.

## App Engine programs

`src/mcp/appEngineTools.ts`: the App Engine Designer's model and writer
(docs/APP_ENGINE.md), behind the same gates.

| Tool | Writes | What it does |
|---|---|---|
| `psft_ae_reference` | no | Runtime semantics and design guidance (docs/APP_ENGINE_SEMANTICS.md, in brief) |
| `psft_ae_get` | no | The program as a spec (App Designer's labels), its token and validation |
| `psft_ae_explain` | no | Execution in the runtime's order; flow from MAIN (calls, external, dynamic, recursion); dependencies |
| `psft_ae_validate` | no | Structure, App Designer's Edit Validation, references, PeopleCode compiled -- of the program or of proposed operations |
| `psft_ae_compare` / `psft_ae_verify` | no | Differences between two programs, or a stored program and a spec |
| `psft_ae_create` | yes | A program from a spec, built with App Designer's defaults; `dryRun` previews |
| `psft_ae_edit` | yes | Operations (add / set / rename / move / copy / delete sections, steps, actions; program properties; state records; temp tables); `expectedToken` refuses stale edits; `dryRun` previews |
| `psft_ae_copy`, `psft_ae_rename`, `psft_ae_delete` | yes | Save As, Rename, Delete as App Designer does them |

A write is refused when its program has validation errors, when the program
is open in the designer with unsaved changes, or when it changed since its
token was read; after a save the program is read back and compared with what
was written. `src/model/aeOperations.ts` maps the operations onto the
designer's (tested in `src/test/aeModel.test.ts`); `tools/lab/ae-mcp-e2e.mts`
runs an agent's session against the real server and a live database.
Nothing runs a program.

## Menus

`src/mcp/menuTools.ts`: the Menu Designer's model and writer (docs/MENUS.md),
behind the same gates.

| Tool | Writes | What it does |
|---|---|---|
| `psft_menu_reference` | no | Menus in brief: bars, item types, App Designer's checks, groups, renames |
| `psft_menu_get` | no | The menu as a spec (bars, items with their components, PeopleCode, transfers), its token and validation |
| `psft_menu_validate` | no | App Designer's save checks, names, components / search records / transfer menus named, PeopleCode compiled -- of a menu, a spec, or proposed operations |
| `psft_menu_create` | yes | A standard or popup menu from a spec, with App Designer's defaults; `dryRun` previews |
| `psft_menu_edit` | yes | Operations (Menu Properties; add / rename / relabel / move / delete bars and items; item type, component, search record override, ItemSelected PeopleCode, transfer); `expectedToken`, `dryRun` |
| `psft_menu_copy`, `psft_menu_rename`, `psft_menu_delete` | yes | Save As (PeopleCode optional), Rename, Delete as App Designer does them |

After a save the menu is read back and compared with what was written.
`src/model/menuOperations.ts` maps the operations onto the designer's
(`src/test/menuModel.test.ts`); `tools/lab/menu-e2e.mts` runs the same path on
a live database.

## The delivered-object policy

Every write tool's save passes the agent delivered-object policy,
`peoplesoft.customization.agentDeliveredObjectPolicy`, after the user's
approval of the write (docs/CUSTOMIZATION.md): a write to an Oracle- or
vendor-delivered definition, or one of unknown ownership, is asked for again
in VS Code under `requireApproval` (the default) -- even when MCP writes are
`allow` -- refused under `block`, and recorded under `allowWithAudit`. An
agent cannot approve it. Every tool call is tagged as an agent's
(`src/mcp/agentOrigin.ts`), so the policy follows whatever tool writes. `psft_object_classify` says beforehand who owns a definition and
what the policy would do; `psft_customization_get_policy` gives the policy.

## Message Channels

`src/mcp/channelTools.ts`: the Message Channel window's model and writer
(docs/MESSAGE_CHANNELS.md), behind the same gates.

| Tool | Writes | What it does |
|---|---|---|
| `psft_channel_reference` | no | Message channels in brief: properties, the partition list App Designer offers, what it drops, renames |
| `psft_channel_get` | no | The channel as a spec (properties, messages, partition choices and those checked), fields App Designer would drop, its token and validation |
| `psft_channel_validate` | no | Names, partition fields (PSDBFIELD, 78,1), Owner ID -- of a channel, a spec, or proposed operations |
| `psft_channel_create` | yes | A channel from a spec: App Designer's defaults, its properties' OK when the spec gives any, partition fields added; `dryRun` previews |
| `psft_channel_edit` | yes | Operations: `set_channel`, `add_partition`, `check_partition`; `expectedToken`, `dryRun` |
| `psft_channel_copy`, `psft_channel_rename`, `psft_channel_delete` | yes | Save As, Rename (messages and project items repointed), Delete as App Designer does them |

`src/model/channelOperations.ts` maps the operations onto the window's;
`tools/lab/channel-e2e.mts` runs the same path on a live database.

## Component Interfaces

`src/mcp/ciTools.ts`: the CI Designer's model and writer
(docs/COMPONENT_INTERFACES.md), behind the same gates.

| Tool | Writes | What it does |
|---|---|---|
| `psft_ci_reference` | no | Component Interfaces in brief: keys, properties, collections, defaulting, edits, names, security |
| `psft_ci_get` | no | The interface as a spec (properties, methods, synchronization, keys, the properties tree), its token and validation |
| `psft_ci_buffer` | no | The component's buffer as the window's left tree: offered keys, each scroll and its fields (present, defaulted, the parent's keys) |
| `psft_ci_validate` | no | Validation of an interface, or of proposed operations, with the resulting spec |
| `psft_ci_create` | yes | An interface on a component as File > New makes it (`defaultProperties` App Designer's (123,12) question), then operations; `dryRun` previews |
| `psft_ci_edit` | yes | Operations: `set_interface`, `set_methods`, `set_sync`, `set_item` (rename, comment, Read Only), `delete_item`, `add_key`, `add_field`, `add_scroll`; `expectedToken`, `dryRun` |
| `psft_ci_copy`, `psft_ci_rename`, `psft_ci_delete` | yes | Save As (Methods PeopleCode optional), Rename, Delete as App Designer does them |

Its Methods PeopleCode (the user methods) saves through `psft_save_peoplecode`
(type 42, parts `[CI, "Methods"]`). `src/model/ciOperations.ts` maps the
operations onto the designer's edits; `tools/lab/ci-e2e.mts` runs the same
path on a live database.

## Not written

The read-only types. Creating pages and records through the
MCP is also not offered yet.

## Process Definitions and PS Query

Process Definitions now expose reference/get/save, including rollback previews.
PS Query exposes reference/list/get/prepare/run/create/save/copy for the existing
calibrated shapes. Both use the editor writers, reject stale tokens and dirty
editors, and retain the provider ownership guards. Query execution uses the
existing record Query access checks and a bounded read-only transaction.
See [MCP reference](MCP_REFERENCE.md) for inputs, scope and preview semantics.
