# Architecture

## One interface, two backends

Everything above the provider layer is written against `DefinitionProvider`
(`src/providers/provider.ts`). A tree view or editor asks for a definition by
key and gets it; it never knows whether it came from a database or an XML file.

The two backends differ in what they *can* do, so rather than throwing on
unsupported calls, each declares `ProviderCapabilities` — `write`,
`globalSearch`, `build`. The UI reads those and hides affordances that would
only fail. A project export cannot generate DDL, so no build command appears for
it; that is a capability check, not an exception handler.

## Definition identity

PeopleTools keys every definition with up to seven positional parts
(`OBJECTID1`/`OBJECTVALUE1` .. `OBJECTID7`/`OBJECTVALUE7`). A record uses one
slot; a record-field PeopleCode program uses four; an application class uses as
many as its package nesting needs.

`DefinitionKey` carries those parts positionally rather than modelling each type
with its own named fields. That mirrors `PSPROJECTITEM`, which is what both the
database and project exports use, so nothing has to be translated at the
boundary. Trailing blank slots are dropped at construction so equality is stable;
interior blanks are kept, because for record PeopleCode the empty second slot is
meaningful.

`DefinitionType`'s numeric values are the real `OBJECTTYPE` codes for the same
reason. The codes confirmed against a real export are marked CONFIRMED in the
enum; the rest are marked UNCONFIRMED and are provisional. An earlier revision
had several written from memory and wrong — Pages filed under Menus,
Application Classes under File Layouts — so unmapped codes are now surfaced as
`Type N` and still browsable rather than dropped or guessed at.

## The project export format

An export is not a PeopleTools table dump. It is a serialization of App
Designer's own C++ object model: `<instance class="PJM">` blocks containing
`<rowset name="...">` / `<row>` trees, with Hungarian-prefixed field names
(`sz` string, `n`/`l` integer, `e` enum, `b` boolean, `f` flags, `atm` atom,
`lp` pointer, `h` handle). Pointer and handle elements carry a marker word
(`POINTER`, `HANDLE`, `custom field`) followed by the rowset they reference, so
the parser descends into every child object rather than matching prefixes.

A file holds one `PJM` instance carrying the project manifest, then one
instance per definition. The class codes are not self-evident: `PGM` is a
Component (panel group), `CRM` is an HTML/content definition, `PDM` a page,
`MDM` a menu, `APM` an application package, `RDM` a record, `PCM` a PeopleCode
program. An export also includes definitions the project merely *references*,
so instance counts do not match item counts in either direction — and a project
item can have no instance behind it at all, which is why an item that will not
open says the export omitted it rather than reporting a failure.

`src/providers/projectFileFormat.ts` documents the shape;
`projectFileParser.ts` reads it. Two things worth knowing:

- **PeopleCode arrives as plain source** in a `peoplecode_text` element beside
  each `PCM` instance's rowset, which is why an export is the accurate source
  for PeopleCode while the database decoder is uncalibrated.
- **A program's key is longer than its project item's key.** Items carry four
  key slots, programs seven, and an application class item
  `PACKAGE.PATH.CLASS` corresponds to a program key with `OnExecute` appended.
  Matching is therefore longest-prefix, preferring PeopleCode-typed items — a
  record-field program is prefixed by its own record, and must not be filed
  under it.

Record keys are not in the field rows either: an export carries no USEEDIT
column, so key membership is derived from the index whose id is `_`.

## Definitions as virtual files

Definitions are exposed as `psft://` URIs through a `FileSystemProvider`, not a
text-document content provider. Content providers are read-only by
construction, which would rule out editing. Going through the file system means
every editor feature — diff, find in files, dirty-state tracking, source control
decoration — works on definitions without special-casing.

The URI carries a hash of the connection id in the authority and the definition
key in the first path segment:

```
psft://f2b0a70f1648f5cb/8%3AJOB.GBL.EFFDT.FieldChange/JOB.EFFDT.FieldChange.peoplecode
```

The trailing segment exists only so the editor tab reads well and the language
is detected from the extension. Identity is the segment before it.

**The authority must be a hash, not the connection id.** A resource crosses the
extension host boundary by being serialized with `toString()` and reparsed, and
documents are compared by their string form. Two things happen to an authority
on that trip: it is lowercased, because RFC 3986 defines it as
case-insensitive, and its slashes are not re-encoded. An authority holding a
file path therefore comes back with its casing destroyed and its path spilled
into the path component, so the URI reparses as a different resource entirely.

This shipped broken once. Records kept working because a custom editor receives
the URI object directly, while everything else went through the file system
provider and the round-trip — which is why the symptom was "only records open".
`src/test/uri.test.ts` guards it using vscode-uri, the same implementation
`vscode.Uri` is built on; the stub in `scripts/vscode-stub.mjs` uses it too,
because a hand-written parser round-trips what the real one mangles and let the
bug pass the smoke test.

Read-only-ness is expressed as a `FilePermission.Readonly` stat rather than a
save-time failure, so a document that cannot be written back says so before it
is typed into.

## Writes are narrow on purpose

PeopleTools keeps derived state consistent through App Designer. A definition
written without bumping the matching `PSVERSION` and `PSLOCK` counters stays
invisible to running application servers, which keep serving a cached copy. Any
write path here updates those counters in the same transaction as the definition
(`bumpVersion` in `src/providers/oracle.ts`).

Where that guarantee cannot yet be made, the operation is refused rather than
approximated:

- **PeopleCode to the database** — the stored format is not mapped well enough
  to round-trip; see `encodeProgram` in `src/peoplecode/decoder.ts`.
- **Record definitions** — a save must rewrite `PSRECDEFN` and `PSRECFIELD`,
  bump counters and regenerate DDL together.
- **Project export files** — a faithful writer must preserve element order,
  `PSCAMA` audit blocks and App Designer's exact encoding, or the file imports
  incorrectly.

Each of these throws `UnsupportedOperationError` with the reason, and the
corresponding UI is read-only.

## Application packages are a hierarchy, not a list

Packages and classes arrive as two flat item types with different key layouts,
and are folded back into App Designer's tree by `src/model/appPackages.ts`.
The awkward parts are in the keys: a package keyed `[Id, Root, QualifyPath]`
uses `.` in the path slot to mean "this is the root", and a class keyed
`[Root, QualifyPath, ClassId]` with a blank ClassId keeps its own name in the
QualifyPath slot, meaning it sits directly in the root package.

Interior nodes are created for any path segment a class references, even when
that package is not itself an item. An export includes referenced definitions
selectively, so requiring the package to be present would hide real classes.

## Expanding a definition

`DefinitionProvider.listChildren` returns a definition's nested definitions —
a record's fields, a component's pages. Children are keyed as definitions in
their own right rather than as display rows, so clicking a field under a record
opens that field, which is what App Designer does.

Whether to draw an expander is decided by type alone (`canExpand`), without a
round trip. Deciding per definition would mean fetching every record's field
list just to know whether to draw a twisty, which would make expanding a
project unusable. The cost is that a definition the provider cannot supply
children for shows an expander that opens onto nothing; providers return an
empty array rather than throwing so that stays harmless.

## Connecting costs nothing

A live environment holds tens of thousands of definitions, so connecting to one
does not list anything — not its projects, not its records. The trees show a
database connection and stop there. Definitions are reached by name through the
Open Definition dialog, which is how App Designer works too.

The distinction is drawn by the `globalSearch` capability rather than by asking
which provider is in hand. A project export is local and finite, so the browser
lists its contents for free and its single project appears without being asked
for. A database is neither, so nothing is fetched until a search is submitted,
and a project appears in the tree only once it has been opened by name.

`OpenDefinitionPanel` is a webview rather than a chain of quick picks because
searching is a loop, not a wizard: pick a type, search, look, adjust the
pattern, search again. Quick picks force that into a one-way sequence where
refining means starting over.

Projects are searchable and openable through the same path as everything else.
They are not definitions — a project contains items rather than being one, and
has no OBJECTTYPE — so `DefinitionType.Project` is a local sentinel, like
`SqlDefinition`. Opening one adds it to the project tree instead of opening a
document, which gives the same contents view an opened export does.

Searches remain bounded regardless: every query carries a `FETCH FIRST` cap and
a name pattern.
