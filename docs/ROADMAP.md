# Roadmap

Ordered by what unblocks the most work, not by visibility. Full Application
Designer parity is the goal; this is the path to it.

## Done

- Provider abstraction with declared capabilities
- Oracle backend: projects, project items, search, record read, PeopleCode read,
  SQL definition read and write
- Project export backend: parses the real App Designer serialization
  (instance/rowset/pointer format), verified against a production export —
  project items, PeopleCode source, record fields and primary keys, plus
  read-only views of fields, HTML definitions, components, menus, pages and
  application packages
- Application packages browse as a hierarchy in the project tree — root
  package, subpackages, classes as leaves — rather than two flat lists
- Records expand to their fields and components to their pages, in both trees;
  each child is a definition that opens on click
- Open Definition dialog: pick an environment and type, search by name, choose
  a result, open it. Connecting to a database lists nothing until asked
- Projects open from the dialog by name and show the same contents tree an
  opened project export does
- Definitions as editable virtual files over `psft://`
- Connections, projects and definition browser trees
- PeopleCode TextMate grammar and language configuration
- Read-only record editor (field grid, attributes, view SQL)
- Secrets in OS secret store, never in settings
- Installable VSIX with a one-command update loop (`npm run dev`), gated on
  typecheck, unit tests and an activation smoke test
- Language ids namespaced so `jatz.peoplesoft-tools` can stay installed

## Next: make reads trustworthy

1. **Calibrate the PeopleCode decoder.** Run `decoder: "raw"` against real
   programs, extend `OPCODES` one confirmed construct at a time, and verify each
   by round-tripping against App Designer. This is the single highest-value
   item: it turns the database backend into a real PeopleCode source.
2. **Project export writer.** Preserve element order, the `lp*`/`h*` marker
   words and the numeric encoding so edited exports still import. Unblocks
   editing PeopleCode today, without the decoder.
3. **Confirm the remaining OBJECTTYPE codes**, including SQL definitions, whose
   code is currently an explicit local sentinel.
4. **Package hierarchy in the Definition Browser too.** The project tree folds
   packages and classes together; the browser still lists them flat, because
   building the same tree from a live database needs PSPACKAGEDEFN and
   PSAPPCLASSDEFN queries rather than a project's item list.
5. **Structured editors** to replace the read-only text summaries now used for
   fields, pages, components, menus and application packages. The page
   summary in particular lists field identifiers only, because the layout
   rectangles and flag words in `PdmField` are not yet decoded.

## Then: writes

4. **Record save** — `PSRECDEFN`/`PSRECFIELD` rewrite with version counters, in
   one transaction. Makes the record editor editable.
5. **DDL generation and build** — `PSRECTBLSPC`, `PSIDXDEFN`, `PSKEYDEFN`;
   create/alter scripts matching App Designer's build output.
6. **PeopleCode encoder** — only once the decoder round-trips completely.

## Then: language intelligence

7. Language server: diagnostics, go-to-definition across record PeopleCode and
   application classes, completion for record fields and class members, and
   references.
8. Compile against the environment so errors match what PeopleTools reports.

## Then: the remaining definition types

9. App Engine programs — section/step/action tree, a text-first editor
10. Components and menus — structured editors
11. Component interfaces, file layouts, application packages
12. **Page designer** — the largest single item. `PSPNLFIELD` holds absolute and
    flow layout; a faithful editor is a project of its own, and a read-only
    layout preview should come first.

## Then: lifecycle

13. Insert into project, project compare and copy between environments
14. Definition compare with the existing diff editor
15. Migration: project copy to file and database

## Not planned

- Anything requiring App Designer's undocumented binary project formats beyond
  XML export
- Replacing Data Mover
