# PeopleSoft Studio

VS Code extension for **reading and navigating** PeopleSoft definitions — PeopleCode, SQL, records, and related objects — from an Oracle environment or an Application Designer project export.

Goal long-term: replace Application Designer. **Today this is a trusted reader and navigator**, not a full designer.

## What works now

| Capability | Status |
|------------|--------|
| Connect to Oracle (PeopleTools tables) | Yes |
| Open App Designer XML project export | Yes |
| Project tree & definition browser | Yes |
| Open Definition search | Yes |
| **PeopleCode** as text (`psft://…`) | **Read** — decoded from `PSPCMPROG` or taken from export |
| **SQL definitions** as text | **Read + write** on Oracle (chunked `PSSQLTEXTDEFN`) |
| Record field grid | Read-only custom editor |
| Compare definition between two environments | Text types via VS Code diff |
| PeopleCode IntelliSense-lite | Completion, hover, outline, snippets |
| PeopleCode syntax highlighting | Yes |

## What does **not** work yet

- Saving **PeopleCode** back to the database (no encoder; DB programs open **read-only**)
- Editing/saving **records** (grid is read-only)
- Page / component visual designers, App Engine editors
- Insert into project, project build/DDL, project-level migrate/copy
- Full language server (go-to-definition across the environment, compile diagnostics)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the longer path.

## Two backends

**Oracle** — live PeopleTools tables. Full environment search; PeopleCode is decoded from the tokenized `PSPCMPROG` byte stream.

**Project export** — App Designer XML on disk. No DB credentials; PeopleCode is the plain source App Designer already wrote. Scope is that project only.

UI code talks only to a `DefinitionProvider` interface; capabilities (write, global search, build) are declared per backend.

## PeopleCode storage

Oracle does not document the on-disk format. Programs are a tokenized stream in `PSPCMPROG.PROGTXT` (chunked by `PROGSEQ`) with identifiers in `PSPCMNAME`.

This extension decodes that stream with a conservative opcode table: **unknown bytes are reported, never guessed**. Saving PeopleCode to the database is refused until a verified encoder exists.

Settings:

- `peoplesoft.peoplecode.decoder`: `auto` (default) | `strict` | `raw`  
  Use `raw` when extending the decoder against real programs.

## Editor features (PeopleCode)

- **Completion** — keywords, common built-ins, system variables, locals in the file, `Function` / `method` names
- **Hover** — short docs for keywords, built-ins, `%` system variables
- **Outline** — class / method / function / property symbols
- **Snippets** — `if`, `for`, `try`, `locs`, `msgbox`, `sqlexec`, …
- **Compare** — right-click a definition (or use the command) with a second connection connected

SQL documents use language id `psft-sql` (basic highlighting).

## Setup

1. Install the VSIX (`npm run dev` from a clone, or install a release build).
2. Open the **PeopleSoft** activity bar icon.
3. **Add Connection** (Oracle) or **Open Project Export File**.
4. Connect, then **Open Definition…** or use the project tree.

Oracle Instant Client is optional (`peoplesoft.oracle.thickModeLibDir`); leave empty for node-oracledb Thin mode.

## Coexisting with other PeopleSoft extensions

`jatz.peoplesoft-tools` contributes a language also called `peoplecode`, on
scope `source.peoplecode`, claiming `.pcode` and `.ppl`. Two grammars on one
scope means load order decides which wins.

So this extension uses `psft-peoplecode` on `source.psft.peoplecode`, and its
virtual documents end in `.peoplecode` rather than `.pcode`. Both extensions can
be installed together. `richardwood.peoplesoft-datamover` only claims `.dms` and
`.dmt`, so it does not overlap at all.


