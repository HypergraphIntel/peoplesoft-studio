# Component Interfaces

How a Component Interface (CI) is stored, how App Designer's Component
Interface window makes one from a component, and how it saves the window's
edits, PeopleTools 8.62.09 on HRDMO. Every rule below was proven by a
controlled App Designer save driven on the lab VM and bracketed by before /
after reads (`tools/lab/def-capture.mts`, or the full sweep
`tools/corpus/save-protocol/snapshot.ts` for a first create, a rename and a
delete); the case is in brackets, its rows in
`tools/corpus/save-protocol/results/<case>`. The CI Designer
(`src/editors/ciDesignerPanel.ts`), the MCP's `psft_ci_*` tools and the
writer (`src/providers/ciWriter.ts`) implement them; the model is
`src/model/ciDocument.ts`.

## Tables

| Table | Key | Holds |
|---|---|---|
| PSBCDEFN | BCNAME | The interface: BCDISPLAYNAME (its name), BCPGNAME / MARKET (the component), MENUNAME, SEARCHRECNAME / ADDSRCHRECNAME (the component's), ITEMCOUNT, DESCR, VERSION (= PSVERSION BCM at its last save), BCSTDMETHODS, LASTUPDDTTM / OPRID, OBJECTOWNERID, DESCRLONG (Comments, CLOB; NULL when empty) |
| PSBCITEM | BCNAME, BCTYPE, BCITEMPARENT, BCITEMNAME | One row per item: BCTYPE 1 Get key, 2 Create key, 5 Find key, 3 collection, 4 property; BCITEMPARENT PS_ROOT or the collection; SEQUENCE_NBR_6 (its place in the component's buffer, below); BCACCESS (2 Read Only); BCSCROLL (level), BCSCROLLNUM, BCSCROLLNAME; RECNAME / FIELDNAME; COMMENTSHORT; SYNCID; SUBRECNAME always blank |
| PSCISYNCDEFN | BCNAME | Synchronizable: SYNCID, CONFLICTRESOLUTION, MSGSET, RELCONTENTPROJ, MPDEVICEPERSIST |
| PSSYSTEMID | RECNAME | PTNEXTSYSTEMID of PSBCITEM and PSCISYNCDEFN: the last SYNCID given |
| PSBCDEL | BCNAME, VERSION | Delete marker (at the new BCM) of a deleted or renamed-away interface; removed when the name is made again [ci28] |
| PSBCDEFNLANG, PSBCITEMLANG, PSCIREF* | + ... | Translations, references between interfaces (none in the lab): kept; re-keyed and deleted with the interface |
| PSPCMPROG / TXT / NAME | 74 interface, 12 `Methods` | Its PeopleCode: the user methods are its Functions [ci24]; deleted keys in PSPCMPROGDEL |
| PSAUTHBUSCOMP | CLASSID, BCNAME, BCMETHOD | Permission lists' grants of its methods |

Key items' BCSCROLLNAME is `AA-AA-00-00` (Get), `AA-AA-00-01` (Create),
`AA-AA-00-02` (Find); level 0's `00-00`; a scroll's its parent's plus
`-LL-NN`, LL its level and NN its place among its parent's scrolls
(BCSCROLLNUM), so `00-00-01-00-02-00` is the first level-2 scroll under the
first level-1 scroll. BCSTDMETHODS bits: 1 Cancel, 2 Create, 4 Find, 8 Get,
16 Save.

## The component's buffer

The window's left tree is the component's buffer: the search record (and a
separate add search record), *Scroll - Level 0* with its records, then each
scroll, *Primary Record: X*. SEQUENCE_NBR_6 numbers it, whether or not an item
is made of it [ci01-ci04]:

- Keys first: the search record's fields in record order, each making a Get
  key (a search key), a Create key (a search key, when the component can Add
  and its add search record is the search record) and a Find key (a search or
  alternate search key), each its number; then a separate add search record's
  search keys as Create keys.
- Level 0 takes a number. Then each record of a scroll, in the order its fields
  first appear on the pages: an SQL table's or dynamic view's every field in
  record order -- and an SQL view's when it is the scroll's primary record
  (PRCSRQSTDLGLIST under PRCSRUNCNTL_SBP, on 8.62.09 and 8.61.15) -- any other
  record's keys and its fields placed in the scroll (a non-primary view's or
  derived record's other fields are not in the buffer [ci02]); each field a
  number. Then each child scroll a number, and its records likewise.
- *Default the properties?* Yes offers a field shown in a data control on the
  component's pages, their subpages, or a secondary page they open -- not on a
  secondary page opened from a secondary page. Such a field and its scrolls are
  in the buffer (numbered, on the Structure tab) but not defaulted. Proved on
  HRDMO with ZZ_CI_XCMP (page > secondary > secondary: the last page's field not
  offered) and by PRCSRUNCNTL_SBP > PRCSRQSTDLG > PRCSRQSTCDMAUTH / PRCSRQST_FILE /
  PRCSRQSTITEMS_DLG on 8.62.09 and 8.61.15.
- A Fluid component's system pages follow its own: the side page
  (`PT_SIDE2PAGE`), then the header page (`PT_HEADERPAGE`), unless the
  component's *No System Side Page* / *No System Header Page* is set; their
  fields are numbered, never offered [ci04].
- A scroll is the Structure tab's (docs/COMPONENTS.md); a collection is named
  for its primary record when that is a record of the scroll and not derived,
  else its first such record (a grid naming a work record [ci04], or a record
  it has no field of: CI_FPM_CA_CTG_GRP).

## App Designer's new interface

File > New > Component Interface asks for the component, then *Do you want to
default the properties based on the underlying Component definition?
(123,12)*:

- **Yes** [ci01-ci04]: every key; every field placed in its scroll on the
  component's own pages in a visible Edit Box, Drop Down List Box, Check Box or
  Radio Button (not a push button, group box, Long Edit Box, image or HTML
  area; not invisible; not a key of the level above) becomes a property, Read
  Only (BCACCESS 2) when a visible placement is display only; a scroll with
  such a property, or a child scroll with one, becomes a collection; a scroll
  with none is left out (it keeps its numbers).
- **No** [ci28]: the keys only.
- Standard methods: Cancel, Find, Get, Save, and Create when the component can
  Add (PSPNLGRPDEFN.ACTIONS bit 1) [ci01: 31, ci02: 29].
- Names: an item is named for its field, a collection for its record. A name
  its collection already has becomes NAME_0, NAME_1 ... (in the window's
  order: by record, then name); a collection name another collection has,
  NAME2, NAME3 ... [ci01, ci04].
- SYNCIDs: from PSSYSTEMID PSBCITEM, in the window's order -- GETKEYS, FINDKEYS,
  CREATEKEYS each by name, then PROPERTIES: a node's properties by record,
  then name, then its collections in scroll order, each followed by its own
  [ci01-ci04].

The **save** then makes names unique across collections: in buffer order,
each name counts the items that had it -- a key property or a collection
twice, another property once -- and an item whose name was counted n times is
stored NAME_(n-1): EONC_TOKENID (a key), _1, _3, _5; DESCR100, _0, _1, _2;
GPFR_DA_CODE (a collection), its key property _1, then a property _3. A
renamed collection's items follow it. App Designer's window keeps showing the
names it had until the interface is opened again [ci01, ci03, ci04].

Delivered interfaces made by older releases default differently (every table
field became a property): `tools/lab/ci-corpus.mts` defaults all 458 HRDMO
interfaces again and compares; the differences are those, hand edits, and
components changed since.

## The window, as captured

- **Component Interface Properties > General** [ci05]: Description, Menu Name
  (the menus with an item for the component, e.g. `ADMINISTER_WORKFORCE_(GBL)`),
  Comments, Owner ID.
- **Standard Methods** [ci06]: Cancel, Create (greyed on a component that
  cannot Add), Find, Get, Save.
- **Synchronization** [ci07-ci10]: Synchronizable makes the PSCISYNCDEFN row
  (its SYNCID from PSSYSTEMID PSCISYNCDEFN); Conflict Resolution 1 Server
  Wins, 2 Device Wins, 3 Custom; Message Set Number; *Upload changes from
  mobile device?* Yes `N`, *No, restore server values* `Y`, *No, retain
  current device values* `D`; Related Content Project. Clearing Synchronizable
  deletes the row.
- **Edit Property** [ci11, ci12]: Name (a rename re-keys the row and keeps its
  SYNCID), Comment, Read Only Access; *Toggle Read Only Access*.
- **Delete** [ci13, ci16, ci19]: an item, a key, a collection with everything
  under it; no prompt.
- **Drag** from the left tree:
  - a record field onto its scroll's collection (PROPERTIES for level 0)
    [ci14, ci15]: any field -- a Long Edit Box, a push button -- numbered as
    the buffer numbers it, Read Only off, a new SYNCID;
  - a search record field onto a key set [ci17]: only a key App Designer would
    make (a field that is not a search key is not taken by GETKEYS [ci18]);
  - a scroll onto PROPERTIES or its parent's collection [ci20-ci23]: its
    collection with every field of the scroll but the keys of the levels above
    -- invisible ones, push buttons, Long Edit Boxes too -- and its child
    scrolls likewise, Read Only off; onto a scroll that has its collection, the
    missing fields are merged into it.
- **View PeopleCode**: the interface's `Methods` program; its Functions are its
  user methods, listed first under METHODS [ci24].
- A reopened interface lists its key sets alphabetically and each node's items
  by SEQUENCE_NBR_6.
- **Validate for Consistency**: on a synchronizable interface, the search
  record and each non-derived record with items need Record Properties'
  SystemID and Row Timestamp fields ("Record 'X' must have a SystemID field
  selected in Record Properties to be synchronizable"); App Designer reports
  them and still saves.

## The save

| What | Rows | Counters |
|---|---|---|
| Create | PSBCDEFN (VERSION new BCM), items, synchronization row; SYNCIDs from PSSYSTEMID; its PSBCDEL removed | BCM +1, SYS +1 [ci01-ci04, ci28] |
| Properties, items, synchronization | Changed rows; PSBCDEFN restamped (VERSION, LASTUPDDTTM, OPRID) and ITEMCOUNT; new items' SYNCIDs in the window's order | BCM +1, SYS +1 [ci05, ci07-ci23] |
| A standard method taken away | BCSTDMETHODS; permission lists' grants of it (inferred) | BCM +1, CLM +1, SYS +1 [ci06] |
| Methods PeopleCode | PSPCMPROG/TXT/NAME; the interface rows untouched | PCM +1, SYS +1 [ci24] |
| Save As | A copy, every item a new SYNCID in the window's order; App Designer asks whether to copy the PeopleCode (at the new PCM) | BCM +1, SYS +1 (PCM +1) [ci25] |
| File > Rename | Every row re-keyed in place, PSBCDEFN restamped; the PeopleCode re-keyed in place (VERSION kept) with a PSPCMPROGDEL marker at the new PCM; PSBCDEL for the old name; grants renamed (inferred) | BCM, CLM, MPM, PCM, PJM, SYS each +1 [ci26] |
| File > Delete | Every row; PeopleCode with a marker at the new PCM; PSBCDEL at the new BCM; grants deleted (inferred) | BCM, CLM, SYS +1 (PCM +1 with PeopleCode) [ci27] |

PSLOCK takes the new PSVERSION value for every counter but SYS.

App Designer's window does not learn the SYNCIDs it gives: items added since
it opened get new ones at every save until it is reopened [ci15]. The designer
reloads after each save, so its saves match a single App Designer save.

Permission-list grants (PSAUTHBUSCOMP) of a method taken away, a renamed or a
deleted interface follow -- inferred from App Designer moving CLM (the
permission-list cache) on exactly those saves; the lab interfaces are on no
permission list, so no row was seen to move.

## Verification

- `src/test/ciWriter.test.ts`: every captured save replayed through the
  planner -- App Designer's defaulting from the component (ci01-ci04, ci28, from
  the component's rows kept as `ci-source.json`), the dialogs, edits, drags and
  Save As (ci05-ci25): rows, SYNCIDs, names, counters, PSSYSTEMID.
- `tools/lab/ci-e2e.mts`: the designer's and the MCP's path on HRDMO --
  interfaces made from DRIVERS_LICENSE and the Fluid HCSC_ADH_NOTIFY_FL item for
  item as App Designer made them (ci02, ci04), the edits, the Methods
  PeopleCode, Save As with it, Rename, Delete, refusals: 19 of 19.
- `tools/lab/ci-corpus.mts`: defaulting replayed against every HRDMO interface.
- Native: App Designer opened an interface the writer made and edited, showed
  its user method, reported the same Validate findings, and saved an edit of
  it changing only the description [nce01].

## Not built

- Test Component Interface, Generate Java / C Template.
- Edit Reference / Create Reference (PSCIREF*: kept, not edited).
- Translations (PSBCDEFNLANG, PSBCITEMLANG) are kept, not edited.
- Per-property synchronization settings (MPDEVICEPERSISTINT): kept as stored.
