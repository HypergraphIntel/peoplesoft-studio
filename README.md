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

## Coexisting with other PeopleSoft extensions

`jatz.peoplesoft-tools` contributes a language also called `peoplecode`, on
scope `source.peoplecode`, claiming `.pcode` and `.ppl`. Two grammars on one
scope means load order decides which wins.

So this extension uses `psft-peoplecode` on `source.psft.peoplecode`, and its
virtual documents end in `.peoplecode` rather than `.pcode`. Both extensions can
be installed together. `richardwood.peoplesoft-datamover` only claims `.dms` and
`.dmt`, so it does not overlap at all.
