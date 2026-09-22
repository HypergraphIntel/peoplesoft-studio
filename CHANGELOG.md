# Changelog

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
