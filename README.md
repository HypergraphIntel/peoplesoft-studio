

A note from the developer:

**October 9, 2026**
This extension is **under active development**, expect updates every couple days if not daily.


# PeopleSoft Studio

VS Code extension for **viewing and editing** PeopleSoft definitions — PeopleCode, SQL, records, and related objects — from an Oracle environment or an Application Designer project export. On connections you set to Writable, PeopleCode can be **saved natively** to the database (see [Saving PeopleCode](#saving-peoplecode-experimental)).

> **Please read the [Disclaimer](#disclaimer) before saving anything to a database.**

PeopleSoft Studio includes its own MCP server and does not require PeopleTools 8.63 MCP. When the delivered PeopleTools 8.63 MCP is available, PeopleSoft Studio can use it as a backend for supported operations.

AI agent compatibility in both directions:

```text
PeopleTools 8.63+
    -> PeopleSoft Studio can delegate to delivered MCP

Older PeopleTools
    -> PeopleSoft Studio implements the functionality itself thru its own MCP

AI Agent
    -> sees the same PeopleSoft Studio tools either way
```

## Disclaimer

**PeopleSoft Studio is provided "as is", without warranty of any kind**, express
or implied (see [LICENSE](LICENSE)). There is **no guarantee** that what it reads,
decodes, compiles or writes is correct, complete or fit for any purpose. You use
it at your own risk; the authors are not liable for data loss, corrupted
definitions, outages or any other damage.

- **Not an Oracle product.** PeopleSoft Studio is independent: it is not
  affiliated with, endorsed or supported by Oracle. PeopleSoft and PeopleTools
  are trademarks of Oracle.
- **Saving PeopleCode is experimental.** It writes directly to PeopleTools
  tables (`PSPCMTXT`, `PSPCMPROG`, `PSPCMNAME`, `PSVERSION`, `PSLOCK`) using an
  independently developed compiler and save routine, not Oracle's. It has been
  checked against Application Designer 8.62.09 in a lab. Other PeopleTools
  releases, patches and configurations may behave differently.
- **Compiling with Application Designer is still recommended.** After saving
  PeopleCode from VS Code, open the program in Application Designer and save
  (compile) it there, so PeopleTools' own compiler validates it. Do this
  especially before migrating it to another environment.
- **Make PeopleCode writable only where you can recover.** Connections are
  read-only by default. Allow writes only on development or lab databases you
  have backups of, and follow your organization's change-control process. Each
  save keeps a report of the rows it replaced, but that is not a backup.

## Get Started

1. Install **PeopleSoft Studio**.
2. Reload VS Code. Open the VS Code Command Palette ( CTRL + SHIFT + P ):
   ```text
   Developer: Reload Window
   ```
3. Add and connect to a PeopleSoft environment from the **PeopleSoft Studio** sidebar.
4. Verify that the MCP server is running: in the **PeopleSoft Studio**
   sidebar, the **Settings** panel shows **MCP server** below the compiler
   profile, green while it is running.
5. Connect an AI client to the MCP server. Open the VS Code Command Palette
   ( CTRL + SHIFT + P ) and run:

   ```text
   PeopleSoft: Configure AI Client
   ```

   Choose your client:

   - **Claude Code**: registers the server for all your local projects.
     The same as running:
     ```bash
     claude mcp add --transport http --scope user peoplesoftStudio http://127.0.0.1:7337/mcp
     ```
   - **Codex** (CLI / IDE): the same as running:
     ```bash
     codex mcp add peoplesoftStudio --url http://127.0.0.1:7337/mcp
     ```
   - **Any other MCP client**: choose **Copy MCP URL** and add it to the
     client as a Streamable HTTP server named `peoplesoftStudio`.
     **Manual Setup** shows the commands above to copy.

   The URL uses the port in the `peoplesoft.mcp.port` setting (7337 by
   default). Restart or reload the client if it was already running.

## What works now

Goal long-term: replace Application Designer. **Today this is a trusted reader and navigator that can save PeopleCode** (experimental), not a full designer.

| Capability | Status | Notes |
|------------|--------|-------|
| Connect to Oracle (PeopleTools tables) | Yes | Schema per connection: set it, or detected from `PS.PSDBOWNER` (else `SYSADM`) |
| Connect to **Microsoft SQL Server** or **DB2** (LUW, z/OS) | Experimental | Everything above and below that reads, as on Oracle; writes are the same rows Oracle's App Designer captures proved, not yet captured on these platforms. DB2 needs *PeopleSoft: Install DB2 Driver*. Two-tier (App Designer 2 Tier) sign-on too. See [docs/DATABASES.md](docs/DATABASES.md) |
| Open App Designer XML project export | Yes | |
| Project tree & definition browser | Yes | |
| Open Definition search | Yes | |
| **PeopleCode** as text (`psft://…`) | Yes | On Writable connections, Record Field PeopleCode and Application Classes open as their stored source (`PSPCMTXT`) and can be saved (see the next row). Other programs and Read-only connections open read-only, decoded from `PSPCMPROG`; an export's are taken from the file |
| **Saving PeopleCode** to Oracle | Experimental | Writable connections — see [Saving PeopleCode](#saving-peoplecode-experimental) |
| Settings panel | Yes | *PeopleSoft: Open Settings* — connections, compiler profile, MCP server, Build Settings (Build and Alter tabs) |
| Record → field → PeopleCode event navigation | Yes | |
| **SQL definitions** as text | Yes | Create and save on Writable connections, as App Designer saves them |
| **HTML definitions** as text | Yes | Create and save on Writable connections — see [docs/HTML_SAVE.md](docs/HTML_SAVE.md) |
| **Style sheets** | Yes | Freeform: read as CSS, create and save on Writable connections — see [docs/STYLESHEET_SAVE.md](docs/STYLESHEET_SAVE.md). Classic / sub: a read-only class list |
| Record editor (App Designer's Field / Use / Edits displays, Record Type) | Yes | Read-only, editable on Writable connections — see [docs/RECORD_SAVE.md](docs/RECORD_SAVE.md) |
| **Build...** (SQL Tables) | Experimental | Create Tables as a script, or build and execute on Writable connections. Alter Tables, Create Indexes alone and views not yet |
| Field editor (App Designer's Field dialog) | Yes | Read-only; length, labels and description editable on Writable connections |
| **New Definition...** (Projects / Definition Browser) | Yes | Records (SQL Table, Derived/Work), fields, projects, Application Packages and classes, SQL, HTML, freeform style sheets, on Writable connections — see [docs/CREATE_DEFINITIONS.md](docs/CREATE_DEFINITIONS.md) |
| Insert a definition into a project | Yes | Writable connections — see [docs/PROJECT_INSERT.md](docs/PROJECT_INSERT.md) |
| Translate values; Delete Record | Yes | Writable connections — see [docs/RECORD_SAVE.md](docs/RECORD_SAVE.md) |
| Definition **Properties** (packages, records, fields, components, pages, projects, menus, App Engine, SQL, HTML, style sheets) | Read-Only | A panel, from Oracle. Records and fields are changed in their editors; HTML and freeform style sheet descriptions with *Change Description...* |
| **Pages** (Page designer) | Experimental | App Designer's visual **Layout** view and Order grid, with page and control properties. On Writable connections: move, resize, delete, relabel, insert controls (Frame, Group Box, Horizontal Rule, Static Text, Check Box, Drop Down, Edit Box, Push Button), Description / Comments, Custom page size, and Save as App Designer saves — see [docs/PAGES_COMPONENTS_MENUS.md](docs/PAGES_COMPONENTS_MENUS.md) and [docs/PAGE_SAVE.md](docs/PAGE_SAVE.md). Creating pages not yet |
| **Components**, **menus** | Read-Only | A component's search records, actions and pages; a menu's bars and items — see [docs/PAGES_COMPONENTS_MENUS.md](docs/PAGES_COMPONENTS_MENUS.md). Page and component PeopleCode opens read-only |
| **App Engine programs** | Read-Only | Open in App Designer's Definition and Program Flow views: sections, steps and actions with their settings, SQL and PeopleCode — see [docs/APP_ENGINE.md](docs/APP_ENGINE.md). Browse, search and Properties. No editing or creating yet |
| **File Layouts**, **Component Interfaces** | Read-Only | A file layout's format, segments and fields; a component interface's methods, keys, collections and properties — see [docs/FILE_LAYOUTS_COMPONENT_INTERFACES.md](docs/FILE_LAYOUTS_COMPONENT_INTERFACES.md) |
| **Permission Lists**, **Roles**, **Message Catalog** | Read-Only | A permission list's pages and actions, sign-on times, Web Libraries and more; a role's permission lists; a message's text and explanation — see [docs/SECURITY_MESSAGES.md](docs/SECURITY_MESSAGES.md) |
| **Queries** | Read-Only | Records and joins, columns, prompts and criteria for the query, its subqueries and unions — see [docs/QUERIES.md](docs/QUERIES.md) |
| **Process Definitions** | Read-Only | Priority, run location, parameters, output, components and process groups — see [docs/PROCESS_DEFINITIONS.md](docs/PROCESS_DEFINITIONS.md) |
| **Trees** | Read-Only | Settings, levels, and nodes as an outline with detail ranges — see [docs/TREES.md](docs/TREES.md) |
| **Messages**, **Services**, **Service Operations** | Read-Only | Message versions and record structure; service operations with their messages, handlers and routings — see [docs/INTEGRATION_BROKER.md](docs/INTEGRATION_BROKER.md) |
| **Images** | Read-Only | Shown in a panel (GIF, PNG, JPEG, SVG, BMP) — see [docs/IMAGES.md](docs/IMAGES.md) |
| **Portal Registry** | Read-Only | Folders and content references: navigation path, component, URL, security — see [docs/PORTAL_REGISTRY.md](docs/PORTAL_REGISTRY.md) |
| **URL Definitions**, **XSLT**, **Message Nodes** | Read-Only | A node's passwords are never shown — see [docs/URLS_NODES.md](docs/URLS_NODES.md) |
| MCP server (AI clients) | Yes | Search and read every type above, PeopleCode by record, component or Application Class, and a bounded PeopleCode text search. `psft_list_definition_types` lists the type codes and key parts. **Writes** (Experimental): PeopleCode, SQL, HTML, style sheets, pages, records, fields, translates, projects and packages, through the same writers and gates as the editors, each approved by you in VS Code unless *MCP writes* says otherwise — see [docs/MCP_WRITES.md](docs/MCP_WRITES.md) |
| PeopleCode IntelliSense-lite | Yes | Completion, hover, outline, snippets |
| PeopleCode syntax highlighting | Yes | |

## What does **not** work yet

- Saving PeopleCode types other than Record Field PeopleCode and Application Classes
- Comparing a definition across two environments (only one connection is active at a time)
- Editing record shapes and settings no App Designer save has been captured for (see [docs/RECORD_SAVE.md](docs/RECORD_SAVE.md))
- Creating pages, components, menus and App Engine programs
- Page / component visual designers, App Engine editors
- Project build/DDL, project-level migrate/copy
- Full language server (go-to-definition across the environment, compile diagnostics)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the longer path.

## Two backends

**Oracle** — live PeopleTools tables. Full environment search; PeopleCode is decoded from the tokenized `PSPCMPROG` byte stream.

**Project export** — App Designer XML on disk. No DB credentials; PeopleCode is the plain source App Designer already wrote. Scope is that project only.

UI code talks only to a `DefinitionProvider` interface; capabilities (write, global search, build) are declared per backend.

## PeopleCode storage

Oracle does not document the on-disk format. Programs are a tokenized stream in `PSPCMPROG.PROGTXT` (chunked by `PROGSEQ`) with identifiers in `PSPCMNAME`.

This extension decodes that stream with a conservative opcode table: **unknown bytes are reported, never guessed**.

Settings:

- `peoplesoft.peoplecode.decoder`: `auto` (default) | `strict` | `raw`, the
  default for connections that do not set their own decoder (per connection, in
  Settings). Use `raw` when extending the decoder against real programs.

## Saving PeopleCode (experimental)

Read the [Disclaimer](#disclaimer) first. Every connection is **read-only** until
you change it. To allow saves on a connection, open *PeopleSoft: Open Settings*
and, in that connection's **PeopleCode saving** group:

1. Set **Operator ID** to a PeopleSoft operator that exists in that database
   (it is checked against `PSOPRDEFN`). Saves are recorded under it.
2. Set **Access** to **Writable** and confirm.
3. Leave **Save mode** at **Compile and save**.

Then open a program, for example record → field → event in the tree, edit it,
and save. A save is refused with the reason when:

- the program changed since you opened it;
- the edit does not compile;
- the stored program is not one the writer reproduces exactly;
- the operator does not exist in that database.

Currently saving covers existing Record Field PeopleCode and Application Class
programs in `ZZ_PCODE_LAB` definitions. Afterwards, compile the program in
Application Designer as well (see the Disclaimer). See
[CHANGELOG.md](CHANGELOG.md) for details.

## Editor features (PeopleCode)

- **Completion** — keywords, common built-ins, system variables, locals in the file, `Function` / `method` names
- **Hover** — short docs for keywords, built-ins, `%` system variables
- **Outline** — class / method / function / property symbols
- **Snippets** — `if`, `for`, `try`, `locs`, `msgbox`, `sqlexec`, …
- **Compare** — currently unavailable: it needs a second connected environment, and only one connection is active at a time

SQL documents use language id `psft-sql` (basic highlighting).

## Setup

1. Install the VSIX (`npm run dev` from a clone, or install a release build).
2. Open the **PeopleSoft** activity bar icon.
3. **Add Connection** (Oracle) or **Open Project Export File**.
4. Connect, then **Open Definition…** or use the project tree.

Oracle Instant Client is optional (`peoplesoft.oracle.thickModeLibDir`); leave empty for node-oracledb Thin mode.

The PeopleTools tables are read in the connection's **Schema** (Settings →
the connection → Edit). Left empty, it is the database's owner ID from
`PS.PSDBOWNER`, else `SYSADM`. Set it when the owner ID differs and the
access id is not the owner; the access id then needs grants on that
schema's PeopleTools tables. Connect fails with a clear message when the
schema has no PeopleTools tables.

Saving and creating definitions can be limited to names starting with a
prefix with `peoplesoft.writeNamePrefix` (empty: no limit).

## Coexisting with other PeopleSoft extensions

`jatz.peoplesoft-tools` contributes a language also called `peoplecode`, on
scope `source.peoplecode`, claiming `.pcode` and `.ppl`. Two grammars on one
scope means load order decides which wins.

So this extension uses `psft-peoplecode` on `source.psft.peoplecode`, and its
virtual documents end in `.peoplecode` rather than `.pcode`. Both extensions can
be installed together. `richardwood.peoplesoft-datamover` only claims `.dms` and
`.dmt`, so it does not overlap at all.


## Troubleshooting

1. Check that the MCP server is running: the **Settings** panel's **MCP
   server** row is green. If it is not, run *PeopleSoft: Start MCP Server*.
2. Check that your client has the server registered as `peoplesoftStudio`:
   ```bash
   claude mcp list    # Claude Code
   codex mcp list     # Codex
   ```
   For another client, check that its MCP settings hold the URL from
   *Copy MCP URL*.
3. Restart or reload the client if it was already running when you
   registered the server.

