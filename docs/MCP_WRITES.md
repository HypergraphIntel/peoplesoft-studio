# MCP writes

The PeopleSoft Studio MCP server (`src/mcp/`) gives AI clients the same edits
the editors make. Each write tool calls the editor's own writer, so what lands
in the database is what the editor's Save writes: rows reproduced from
captured App Designer saves (PeopleCode, records, fields, translates, SQL,
HTML, style sheets, projects, packages, pages). The tools are in
`src/mcp/writeTools.ts`, and they register only when VS Code provides the
write host (the setting, the approval dialog, and the editors' state).

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
| `psft_edit_page` | Operations on a page: `add` (frame, groupBox, horizontalRule, staticText, or checkBox / dropDown / editBox / pushButton on a record field), `move`, `resize`, `set_label`, `set_use`, `delete`, `set_properties` (description, comments, width / height) |
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

## Not written

Components, menus, App Engine programs and the other read-only types, page
PeopleCode and component PeopleCode: no writer exists for them yet. Creating
pages and records through the MCP is also not offered yet.
