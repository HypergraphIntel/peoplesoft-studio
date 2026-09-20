# PeopleSoft Studio

A VS Code extension for developing PeopleSoft definitions — PeopleCode, records,
pages, components, App Engine programs and SQL — with the aim of replacing
Application Designer.

## Status

Early. The foundation is in place and builds: connection management, a provider
abstraction with two backends, definitions surfaced as editable virtual files, a
project and definition browser, PeopleCode syntax highlighting, and a read-only
record editor. Most write paths and all the visual designers are still ahead —
see [docs/ROADMAP.md](docs/ROADMAP.md).

## Two ways to reach your definitions

**Direct database** connects to the PeopleTools tables on Oracle and reads
definitions live. It sees the whole environment and every project in it.

**Project export file** reads an Application Designer XML export from disk. It
sees only what is in that project, but it needs no database credentials — and it
is currently the accurate source for PeopleCode.

Both are the same to the rest of the extension; views and editors are written
against one `DefinitionProvider` interface and never learn which is behind them.
Capability differences (writability, global search, DDL) are declared by each
provider so the UI can adapt rather than fail.

## The PeopleCode problem

Oracle does not document how PeopleCode is stored. It is not source text: it is
a tokenized byte stream in `PSPCMPROG.PROGTXT`, split across rows by `PROGSEQ`,
with every identifier replaced by an index into a per-program `PSPCMNAME` table.

What is implemented and verified: chunk reassembly, gap detection, and name
table resolution. What is not: the opcode table itself, which covers only the
constructs confirmed so far. Everything else decodes to an explicit unknown
token and is reported at the top of the rendered source.

This is deliberate. A decoder that guesses at an unrecognised opcode produces
source that looks right and means something else. So:

- Unmapped opcodes are surfaced, never smoothed over.
- Saving PeopleCode to the database is **refused**, not attempted, and such
  documents open read-only so you find out before you type rather than after.
- `peoplesoft.peoplecode.decoder: "raw"` dumps the token stream and name table,
  which is how the opcode table gets extended from real programs.

Until the table is calibrated against a real database, read PeopleCode from a
project export, where App Designer has already written plain source.

## Getting started

```bash
npm install
npm run compile     # typecheck + bundle to dist/
npm test            # unit tests for the pure logic
npm run watch       # rebuild on change, then F5 in VS Code
```

Then **PeopleSoft: Add Connection** from the command palette, or
**Open Project Export File** to start without a database.

For a database connection, the password is requested on first connect and kept
in the OS secret store. It is never written to `settings.json`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/model/` | Definition types, keys, record and field structures |
| `src/providers/` | The provider interface, Oracle, project files, virtual FS |
| `src/peoplecode/` | Program assembly and the token decoder |
| `src/views/` | Connections, projects and definition browser trees |
| `src/editors/` | Structured editors; the record grid so far |
| `syntaxes/` | PeopleCode TextMate grammar |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why it is shaped this way.

## The update loop

```bash
npm run dev
```

That is the whole cycle: typecheck, bundle, unit tests, activation smoke test,
package to `peoplesoft-studio.vsix`, and install it over the previous build.
Then **Developer: Reload Window** in VS Code to pick it up.

Packaging is gated on `npm run verify`, so a build that fails typecheck, tests
or activation never reaches a VSIX.

For tighter iteration, skip packaging entirely: `npm run watch` and then F5,
which opens an Extension Development Host running straight from `dist/`.

### What `npm run smoke` covers

It loads the bundled extension against a stub `vscode` module
(`scripts/vscode-stub.mjs`) and activates it, which catches the failures that
otherwise cost a full package-install-reload cycle:

- the bundle fails to load, or `activate()` throws
- a command in `package.json` with no matching registration — the palette entry
  would fail with "command not found"
- a command registered but not declared, so it never appears in the palette
- a contributed view with no data provider, which renders permanently empty
- a tree that throws when no connection is configured, which is the state on a
  fresh install

It is not a simulation of VS Code. Anything that needs real editor behaviour —
opening a definition, editing, saving — is a manual pass.

## Coexisting with other PeopleSoft extensions

`jatz.peoplesoft-tools` contributes a language also called `peoplecode`, on
scope `source.peoplecode`, claiming `.pcode` and `.ppl`. Two grammars on one
scope means load order decides which wins.

So this extension uses `psft-peoplecode` on `source.psft.peoplecode`, and its
virtual documents end in `.peoplecode` rather than `.pcode`. Both extensions can
be installed together. `richardwood.peoplesoft-datamover` only claims `.dms` and
`.dmt`, so it does not overlap at all.
