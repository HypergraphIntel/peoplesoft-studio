# Page save — proving the write (Phase 2)

The visual Page designer's Layout view (docs/PAGES_COMPONENTS_MENUS.md) is
read-only. Before it can edit and save a page, the save transaction App
Designer performs has to be captured and proven, exactly as the record and
PeopleCode saves were (docs/RECORD_SAVE.md, docs/PEOPLECODE_WRITEBACK.md): no
generated row is written until a controlled App Designer save shows the precise
rows and counters it moves.

This extension cannot drive App Designer, so the captures are made by hand on a
scratch page, each save bracketed by the read-only snapshot tool.

## What a page save touches

- **`PSPNLDEFN`** — one row per page (`PNLNAME`): its `VERSION`, `LASTUPDDTTM`,
  `LASTUPDOPRID`, type, size, style.
- **`PSPNLFIELD`** — one row per control, keyed `(PNLNAME, PNLFLDID)`. The
  geometry (`FIELDLEFT/TOP/RIGHT/BOTTOM`, `EDITLBL*`), `FIELDNUM` (draw order),
  `FIELDTYPE`, `FIELDUSE`, label, record field, and the rest.
- **`PSVERSION` / `PSLOCK` `OBJECTTYPENAME = 'PPC'`** — the page version
  counter (HRDMO is at 24). A save bumps it, and stamps the page's
  `PSPNLDEFN.VERSION` to the new value, the same pattern records and PeopleCode
  follow.
- Possibly `PSPNLFIELDLANG` (label language rows) and, when the page is in a
  component, cache records — caught by the snapshot's scope sweep.

Open questions the captures must answer: how `PNLFLDID` is assigned to a new
control (max + 1? reused?); whether `FIELDNUM` is renumbered on insert/delete
or move; the exact geometry a dropped/added control is written with; whether
`PPC` moves by one per save; what a move/resize changes beyond the four
geometry columns.

## The scratch page

Use a page named within the write scope, e.g. **`ZZ_PCODE_LAB_PG`** (≤ 18
chars, matches the snapshot tool's scratch filter). It is a standalone page, not
in a component, so a save touches only `PSPNLDEFN` and `PSPNLFIELD`.

## Capturing a save

Against HRDMO, from the repo, with `PSLAB_ACCESSID` / `PSLAB_ACCESSPSWD` set:

```bash
npx tsx tools/corpus/save-protocol/snapshot.ts before --case 01-create
#   ... make the one controlled change in App Designer and Save ...
npx tsx tools/corpus/save-protocol/snapshot.ts after  --case 01-create
```

`after` writes `tools/corpus/save-protocol/results/<case>/delta.json`: the
row-level before/after of `PSPNLDEFN` and `PSPNLFIELD` for the scratch page,
the `PPC` counter move, and a flashback diff of anything else touched. A save
made before `before` ran can still be bracketed with `--as-of` (see the tool
header).

## The sequence to capture

One change per save, so each delta isolates one operation:

| Case | Change in App Designer | Proves |
|---|---|---|
| `01-create` | New page `ZZ_PCODE_LAB_PG`, add one edit box on a record field, save | Create: `PSPNLDEFN` insert, first `PSPNLFIELD` row, `PPC` move |
| `02-add-edit` | Add a second edit box, save | New `PNLFLDID`, `FIELDNUM`, geometry of an added control |
| `03-move` | Drag the second box to a new spot, save | Which columns a move writes |
| `04-resize` | Resize it, save | Which columns a resize writes |
| `05-label` | Change its label text / type, save | Label columns, `PSPNLFIELDLANG` if any |
| `06-dropdown` | Add a drop-down, a check box, a push button, save | Geometry/defaults per control type |
| `07-groupbox` | Draw a group box around controls, save | Container geometry, draw order vs contained controls |
| `08-delete` | Delete one control, save | `FIELDNUM` renumbering, `PNLFLDID` reuse |
| `09-property` | Set a control Display Only / Invisible, save | `FIELDUSE` bits (also lets the Layout view mark use state) |

Run them in order on the one scratch page; each builds on the last. Keep the
`delta.json` for each case — they become the fixtures the page writer is proven
against, and `09` also pins down the `FIELDUSE` bit meanings the Layout view can
then show.

## After the captures

With the deltas in hand: build the page-geometry writer against them (insert /
update / delete `PSPNLFIELD`, stamp `PSPNLDEFN` and the `PPC` counter in one
transaction, verified again after COMMIT), then make the Layout view's controls
draggable/resizable and wire Save. Writes stay refused until the capture proves
them, and only within the write scope.

## Findings (captured on HRDMO, PeopleTools 8.62)

Counters and stamping (same pattern as records / PeopleCode):

- The page counter is **`PDM`** (not `PPC`): a save bumps `PSVERSION` and
  `PSLOCK` `OBJECTTYPENAME='PDM'` by one, and the global `SYS` in `PSVERSION`.
  `PSPNLDEFN.VERSION` is stamped to the new `PDM` value.

Rows a save writes, per page / control:

- **`PSPNLDEFN`** — the page: `VERSION` = new PDM, `FIELDCOUNT`, `MAXPNLFLDID`
  (the high-water PNLFLDID), `PANELRIGHT`/`PANELBOTTOM` (page size),
  `LASTUPDDTTM`, `LASTUPDOPRID`, a `LICENSE_CODE`.
- **`PSPNLFIELD`** — one row per control, key `(PNLNAME, PNLFLDID)`.
- **`PSPNLFIELDEXT`** — one row per control, same key, with
  `PARENTPNLFLDID` / `PAGEPNLFLDID` (`$0` = none), `PTDISABLESMARTPROM`,
  `FFSTYLELONG`. The page writer must insert/delete these alongside
  `PSPNLFIELD`.

### 01-create
New page with one edit box on `ZZ_PCODE_LAB.ZZ_PCODE_LAB_C01`:
`PDM` 44->45, `SYS` 1549->1550; `PSPNLDEFN` insert (VERSION 45, FIELDCOUNT 1,
MAXPNLFLDID 1); `PSPNLFIELD` insert (PNLFLDID 1, FIELDNUM 1, FIELDTYPE 4,
FIELDLEFT 72 FIELDTOP 68, auto-size); `PSPNLFIELDEXT` insert (PNLFLDID 1).

### 02-add-edit
Added a second edit box (PERSON.EMPLID): `PDM` 45->46, `SYS` +1;
`PSPNLDEFN` update `VERSION`/`FIELDCOUNT 1->2`/`MAXPNLFLDID 1->2`/stamp;
`PSPNLFIELD` + `PSPNLFIELDEXT` insert at `PNLFLDID = MAXPNLFLDID+1` (2),
`FIELDNUM` appended (2). Existing rows untouched. So a new control takes the
next PNLFLDID (page's high-water + 1) and the next FIELDNUM.

### 03-move
Dragged the second edit box: `PDM` +1, `SYS` +1; `PSPNLDEFN` update is only
`VERSION` + `LASTUPDDTTM` (no FIELDCOUNT/MAXPNLFLDID); one `PSPNLFIELD` update
on that PNLFLDID -- `FIELDLEFT`, `FIELDTOP`, and the label box `EDITLBL*`
recomputed (here to a degenerate/negative "not shown" value). An auto-sized
control's move touches LEFT/TOP only (no RIGHT/BOTTOM). No PSPNLFIELDEXT change.

### 04-resize
Resized the second edit box: `PDM` +1, `SYS` +1; `PSPNLDEFN` VERSION+stamp
only; one `PSPNLFIELD` update -- `FIELDRIGHT`/`FIELDBOTTOM` set to the new
extent and `FIELDSIZETYPE` 0->2 (auto-size -> custom). (LEFT also moved here
because the drag shifted the corner.) No EXT change.

### 05-label
Changed the second box's label to a custom Text label: `PDM` +1, `SYS` +1;
one `PSPNLFIELD` update -- `LBLTYPE` 3->1 (RFT Long -> Text), `LBLTEXT`
-> "My Label". `USEDEFAULTLABEL` unchanged; no `PSPNLFIELDLANG` row for a
single-language save.

### 06-types  (key finding: FIELDNUM is reordered on save)
Added a drop-down (type 5), check box (7) and push button (12) in one save.
`PSPNLDEFN` VERSION/FIELDCOUNT 2->5/MAXPNLFLDID 2->5/stamp. New rows took
`PNLFLDID` 3,4,5 (= high-water + 1 each), each with a `PSPNLFIELDEXT` row.
Auto-size controls (dropdown, checkbox) stored LEFT/TOP only; the push button
stored a full rect and `FIELDUSE`/`LBLTYPE 1`.

**FIELDNUM is a page-wide order App Designer reassigns on every save, not an
append.** Here the existing edit box (PNLFLDID 2) was renumbered FIELDNUM 2->5
while the new controls took 1..4 by the order App Designer computes (related to
geometry/tab order, not yet fully pinned down). A page writer must reproduce
App Designer's FIELDNUM ordering, or a later App Designer save will reshuffle
it. (The rule for an added control is now pinned down: see
[Where an added control goes](#where-an-added-control-goes).)

Counters: a save that adds controls bound to record fields also bumped `RDM`
(record definition manager) and more `SYS`, besides `PDM` -- `PDM` 49->52,
`RDM` 160->164, `SYS` +7 for this save. The page write proper is PDM; RDM is
the referenced records' cache invalidation.

### 07-groupbox
Drew a group box (type 2) around two controls: `PDM` +1, `SYS` +1 (no RDM --
a group box binds no record field). `PSPNLDEFN` FIELDCOUNT 5->6/MAXPNLFLDID 5->6.
New row `PNLFLDID` 6, rect 100/112/400/268, `LBLTYPE 1` "Group Box", inserted at
`FIELDNUM 3` -- just before the controls it encloses -- with id4 3->4, id5 4->5,
id2 5->6 shifting down. A container is ordered immediately before its children.

**Resolution of the FIELDNUM TODO:** FIELDNUM is App Designer's draw/tab order
and it re-derives it each save. A writer does not have to match the algorithm
byte for byte; it needs a valid contiguous 1..N ordering with containers before
their children. A later App Designer save may re-sequence FIELDNUM, which is
cosmetic and does not change the rendered page. The hard invariants are: stable
unique PNLFLDID (new = page MAXPNLFLDID + 1), MAXPNLFLDID/FIELDCOUNT on
PSPNLDEFN, a PSPNLFIELDEXT row per control, and the PDM + SYS counter bumps.
(0.8.2 matches App Designer's placement of an added control exactly: see
[Where an added control goes](#where-an-added-control-goes).)

### 08-delete
Deleted the check box (PNLFLDID 4): `PDM` +1, `SYS` +1. `PSPNLDEFN` VERSION/
`FIELDCOUNT 6->5`/stamp -- **`MAXPNLFLDID` stays 6**. The `PSPNLFIELD` and
`PSPNLFIELDEXT` rows for PNLFLDID 4 are deleted; the later fields renumber
contiguously (id5 5->4, id2 6->5). **PNLFLDID is a monotonic high-water mark:
a deleted id is never reused** -- a new control always takes MAXPNLFLDID+1.

### 09-property  (FIELDUSE bits)
Set one control Display Only and another Invisible in one save: `PDM` +1,
`SYS` +1; two `PSPNLFIELD` updates. **`FIELDUSE` bit 0x01 = Display Only**,
**0x02 = Invisible** (the Invisible control also set `SECUREINVISIBLE` 0->1).
These are the bits the Layout view marks.

## The page save transaction (derived from 01-09)

In one transaction, verified again after COMMIT (as records / PeopleCode):

1. Bump `PSVERSION` and `PSLOCK` `OBJECTTYPENAME='PDM'` by one (the new value
   is the page's VERSION); bump `PSVERSION` `SYS`. Controls bound to record
   fields also move `RDM` (the referenced records' cache) -- a side effect, not
   the page write.
2. `PSPNLDEFN`: `VERSION` = new PDM, `FIELDCOUNT` = control count,
   `MAXPNLFLDID` = high-water PNLFLDID (monotonic, never lowered),
   `PANELRIGHT`/`PANELBOTTOM`, `LASTUPDDTTM`, `LASTUPDOPRID`, `LICENSE_CODE`.
3. `PSPNLFIELD` + `PSPNLFIELDEXT`, one row each per control, key
   `(PNLNAME, PNLFLDID)`:
   - add: new `PNLFLDID` = MAXPNLFLDID + 1; geometry per op (move = LEFT/TOP
     and the label `EDITLBL*`; resize = RIGHT/BOTTOM + `FIELDSIZETYPE` 2);
   - delete: remove both rows, keep MAXPNLFLDID;
   - label: `LBLTYPE` + `LBLTEXT`; use: `FIELDUSE` bits (+ `SECUREINVISIBLE`).
   - `FIELDNUM` is a contiguous page-wide order App Designer re-derives each
     save (containers before their children); a writer needs any valid 1..N
     ordering, not App Designer's exact rule.

Deltas for every case are in `tools/corpus/save-protocol/results/0*/delta.json`
-- the fixtures the page writer is proven against.

## The writer (pageWriter.ts), proven live

`DatabaseProvider.savePage` (src/providers/pageWriter.ts) writes move / resize /
label / use changes and deletes of existing controls in one transaction -- bump
`PDM` (PSVERSION + PSLOCK) and `SYS`, stamp `PSPNLDEFN` (VERSION = new PDM,
FIELDCOUNT, LASTUPDDTTM/OPRID), update only the changed `PSPNLFIELD` columns,
delete a removed control's `PSPNLFIELD` + `PSPNLFIELDEXT`, renumber `FIELDNUM`
contiguously, insert an added control's `PSPNLFIELD` + `PSPNLFIELDEXT` rows --
verified in the transaction and again after COMMIT. Write scope + a valid
operator gate it. `planPageSave` is pure and unit-tested.

Proven on `ZZ_PCODE_LAB_PG` against the snapshot tool
(`results/10-writer-move`, `11-writer-delete`):

- 10 move PNLFLDID 1 by (40,40): `PDM` 56->57, `SYS` +1; `PSPNLDEFN`
  VERSION/stamp; one `PSPNLFIELD` update `FIELDLEFT`/`FIELDTOP`. Same shape as
  App Designer's 03-move.
- 11 delete PNLFLDID 3: `PDM` 57->58, `SYS` +1; `PSPNLDEFN`
  VERSION/`FIELDCOUNT 5->4`/stamp; `PSPNLFIELD` + `PSPNLFIELDEXT` rows for 3
  deleted; survivors renumbered. Same shape as App Designer's 08-delete.

- 12 add an Edit Box on `PERSON.EMPLID` (`results/12-writer-add`): `PDM`
  58->59, `SYS` +1; `PSPNLDEFN` VERSION/`FIELDCOUNT 4->5`/`MAXPNLFLDID 6->7`/
  stamp; one `PSPNLFIELD` and one `PSPNLFIELDEXT` insert. Every column equals
  App Designer's 02-add-edit row (98 + 34 columns) except PNLFLDID, FIELDNUM
  and the position. (02 also rewrote an older control's PARENTPNLFLDID from
  `$0` to `ZZ_PCODE_LAB_PG$0`, a leftover of how 01 created the page.)
- 13 the Layout editor's own save payload, from a scripted browser session
  (`results/13-writer-ui-add`): a sized group box moved by (10,5) -- `FIELDLEFT/
  TOP` and `FIELDRIGHT/BOTTOM` all shift, its relative (all-zero) label is left
  alone -- plus an added Edit Box and Group Box: `MAXPNLFLDID 7->9`, two
  `PSPNLFIELD` + `PSPNLFIELDEXT` inserts, one update, `PDM`/`SYS` +1.

App Designer (8.62.09) opens `ZZ_PCODE_LAB_PG` cleanly after 12 and 13 (checked
by hand, 2026-10-09): it reads the writer's inserted rows as its own.

When dragged, the editor moves a stored label rectangle (`EDITLBL*`) with
the control, as App Designer's 03-move did, but leaves an all-zero (relative)
or negative (hidden) one as it is. A blank label is written as `' '`, never
`''` (Oracle stores `''` as NULL, and LBLTEXT is NOT NULL).

- 20 the editor's payload again (`results/20-writer-kinds-props`): Static
  Text, Frame, Horizontal Rule, and an Edit Box on a number field added, plus
  Description / Comments edited: four inserts identical to App Designer's
  15 / 16 / 17 / 18 rows except id, order and position; `PSPNLDEFN` DESCR and
  DESCRLONG as in 19; `PDM`/`SYS` +1.

## App Designer saves 14-19 (bracketed afterwards with `--as-of`)

Six saves made in a row, each bracketed retroactively between their commits:

- 14-props-use, Use tab: Page Size set to Custom, then the page edge dragged:
  `PANELRIGHT/BOTTOM` 570x330 -> 959x988 and `PNLUSE` 32 -> 11. `PDM` rose by
  **2** in that single commit (every other save is +1; not explained); `SYS`
  +1. `PNLUSE`'s low byte is the Page Size choice: 0x03 plus one size bit
  (0x04 782x452, 0x20 570x330, 0x40 760x330, 0x80 984 wide ...) or 0x08 for
  Custom -- 6,982 delivered pages carry 11, at 6,259 sizes; 32 (no 0x03) is
  only on 38 new, never-reopened 570x330 pages like this one was.
- 15-static-text, 16-frame, 17-hrule: one insert each (FIELDTYPE 0 / 1 / 23).
- 18-number-datetime: Edit Boxes on a number (PSDBFIELD type 2) and a
  datetime (6) field. DSPLFORMAT is the same as on a character field.
  PTDISABLESMARTPROM is 0 and FFSTYLELONG `' '`, against 1 and `' | | | | '` on
  character fields (smart prompt is character typeahead). The window also
  holds a record save (ZZ_PCODE_LAB_N1 added to ZZ_PCODE_LAB_T, `RDM` +1).
- 19-props-descr, General tab: `DESCR` and `DESCRLONG` (a nullable CLOB, NULL
  until first set); `PDM`/`SYS` +1.

App Designer deletes and re-inserts the page's every PSPNLDEFN / PSPNLFIELD /
PSPNLFIELDEXT row on each save (the rowid sweep shows it in every case,
02-19), keeping their values. The writer updates in place and leaves the same
rows behind.

## Adding controls

A new control is App Designer's own freshly dropped row
(`src/providers/pageControlTemplates.ts`), checked against the captures by
`src/test/pageControlTemplates.test.ts`: Edit Box (02, and 18 on number /
datetime), Drop-Down List Box, Check Box, Push Button (06), Group Box (07),
Static Text (15), Frame (16), Horizontal Rule (17), and since 0.8.2 Static Image
(in01), Radio Button (rb-fresh), Long Edit Box (le-fresh) and HTML Area (on a
field, ht-field; on its record alone, ht-fresh). The writer fills in PNLNAME,
PNLFLDID (`MAXPNLFLDID + 1` onward), FIELDNUM (where App Designer puts it: see
[Where an added control goes](#where-an-added-control-goes)), the
position, label and record field; a record-bound control without an edited
label takes the field's default label (`PSDBFLDLABL` DEFAULT_LABEL = 1,
LABEL_ID + LONGNAME).

Limits, from the evidence:

- A record-bound control is only added on a field type a capture covers
  (`FIELD_TYPES_SEEN`): Edit Box on character, number and datetime fields;
  Drop-Down, Check Box (one character, ON/OFF `Y`/`N`) and Push Button on
  character fields. Date, time, signed number, long character and the rest
  are refused until a capture shows them.
- A Group Box is written with RECNAME blank (as 7,739 delivered group boxes
  are); App Designer's 07 carried the page's record onto it.
- Other Insert-menu controls (Radio Button, Long Edit Box, Static Image,
  Image, HTML Area, Grid, Scroll Area, Subpage, Secondary Page ...) are not
  offered yet: each needs a capture of its fresh row.

## Page Properties

The sidebar shows PSPNLDEFN's properties. On a Writable connection,
Description and Comments are edited there and written on Save (19-props-descr;
DESCR limited to 30 characters). The page size is set by dragging the page's
right / bottom edge or corner on the Layout canvas (drawn at the page size), or
typing it in the sidebar: the writer writes `PANELRIGHT/BOTTOM` and makes the
Page Size choice Custom (`PNLUSE` low byte 11, other bits kept), as 14 did.
Proven live in `results/21-writer-page-size` (a dragged 959x988 -> 1000x900:
`PSPNLDEFN` PANELRIGHT/BOTTOM + stamp, `PDM`/`SYS` +1). The other Use-tab
settings (page type, style sheet, deferred processing, fluid, hidden-field
layout, popup menu) and Owner ID have not been captured.

The sidebar has App Designer's three tabs. Every setting is shown as stored,
read from PSPNLDEFN:

- General: DESCR, DESCRLONG, OBJECTOWNERID (listed by PSXLATITEM
  OBJECTOWNERID's long names), and the stamp.
- Use: PNLTYPE, the Page Size choice (PNLUSE low byte) with PANELRIGHT /
  PANELBOTTOM, STYLESHEETNAME, PNLSTYLE (Page Background), DEFERPROC,
  PNLUSE 0x4000 (Fluid Page), PNLUSE 0x100 (read as Adjust Layout for
  Hidden Fields), and POPUPMENU.
- Fluid: Style Classes is FFSTYLEDESKTOP. Small, Medium, Large and Extra Large
  are FFSTYLEPHONE, FFSTYLEMEDIUM, FFSTYLETABLET and FFSTYLEEXLARGE. Delivered
  _SCF pages put their Sff class on PHONE and their one class on the other
  three.

Only the captured settings are editable. Of PNLUSE's high bits on delivered
pages, 0x100, 0x4000 and 0x800 occur on standard pages, and 0x1000 only on
secondary pages (OK & Cancel or Close Box). Each needs a capture to pin down.

Block A was eight App Designer saves on ZZ_PCODE_LAB_PG, one setting each,
bracketed by commit SCN. Each wrote PSPNLDEFN's one column, VERSION and
LASTUPDDTTM, with `PDM` +1 (PSVERSION, PSLOCK) and `SYS` +1:

| Case | Setting | PSPNLDEFN |
|---|---|---|
| g01-page-owner | Owner Id: HR Core Objects | OBJECTOWNERID ' ' -> HCR |
| u01-page-stylesheet | Page Style Sheet | STYLESHEETNAME ' ' -> PSSTYLEDEF |
| u02-page-background | Page Background | PNLSTYLE ' ' -> PSIMAGE |
| u03-page-deferred-off | Allow Deferred Processing off | DEFERPROC 1 -> 0 |
| u04-page-adjust-layout | Adjust Layout for Hidden Fields on | PNLUSE 11 -> 267 (0x100) |
| u05-page-popup | Popup Menu | POPUPMENU ' ' -> PT_ADS_POP |
| u06-page-size-preset | Page Size: the first preset | PNLUSE low byte 0x0B -> 0x03; PANELRIGHT/BOTTOM -> 0/0 |
| u07-page-size-custom | Page Size: Custom size | PNLUSE low byte -> 0x0B; PANELRIGHT/BOTTOM 0/0 -> 848x778 |

The writer writes the first six (`planPageProperties`; an unset name is ' ').
On save it refuses an owner ID, style sheet, style class or popup menu that
the database does not have. `pageWriter.test.ts` replays g01 and u01-u05
column for column. Live, `wp01-writer-page-props-revert` set all six back in
one save, and its delta has exactly App Designer's shape. Choosing a preset
Page Size (u06, u07) is not offered yet: the preset's name in App Designer's
list was not recorded, and neither was where 848x778 comes from.

Block B was five saves: a page type change and a secondary page's options.

| Case | Setting | PSPNLDEFN |
|---|---|---|
| u08-page-type-secondary | Page Type: Secondary Page | PNLTYPE 0 -> 2; PNLUSE 0x0B -> 0x10; PANELTOP 0 -> 20 |
| u09-page-okcancel-off | OK & Cancel buttons off | PNLUSE 0x10 -> 0x11 |
| u10-page-closebox-off | Close Box off | PNLUSE 0x11 -> 0x13 |
| u11-page-modal-on | Disable Display in Modal Window on | PNLUSE 0x13 -> 0x2013 |
| u12-page-type-standard | Page Type: Standard Page | PNLTYPE 2 -> 0; PNLUSE 0x2013 -> 0x2023; PANELTOP 20 -> 0; 848x778 -> 570x330 |

So PNLUSE's low byte is two flags and a size choice:

- 0x01 means no OK & Cancel buttons and 0x02 means no Close Box. A standard
  page always has both set.
- Then one Page Size bit: 0x08 Custom, 0x10 a secondary page's own size, 0x20
  570x330, and so on. Delivered secondary pages carry 0x08-0x0B and 0x10-0x13.

A page made secondary takes the topmost control's FIELDTOP as PANELTOP (20 on
the lab page; 1,706 of 3,538 delivered secondary pages match it). A page made
standard is 570x330 (0x20) at PANELTOP 0, and keeps its other bits, Disable
Modal's 0x2000 included.

The writer does Standard <-> Secondary only, and refuses other type changes.
OK & Cancel, Close Box and Disable Modal are written only on a secondary page.
A Custom size keeps a secondary page's 0x01 / 0x02. `pageWriter.test.ts`
replays u08-u12. Live, wp02-wp04 made the writer's own secondary, options-off
and standard saves, each in App Designer's shape. A size save then put
ZZ_PCODE_LAB_PG back to Custom 848x778 (PNLUSE 11).

Page types: t01-t11 went through every type on ZZ_PCODE_LAB_NP2, each from
the last (Standard -> Subpage -> Popup -> Header -> Side 1 -> Footer -> Layout
-> Search -> Prompt -> Master&Detail Target -> Side 2). r01-r06 added the
missing returns to Standard and direct jumps. What a type change writes
depends on the new type alone. Other PNLUSE bits stay, and a type change
never turns Fluid Page off (r01, r03-r06 kept 0x4000):

| New type | PNLUSE low byte | Page rectangle |
|---|---|---|
| Standard (0) | 0x23: no buttons, 800x600 page inside portal | 0, 0, 570, 330 |
| Secondary (2) | 0x10: Auto-size, OK & Cancel and Close Box shown | PANELTOP = topmost control's top |
| Subpage (1), Popup (3) | 0x13: Auto-size, no buttons | the drawn content, as App Designer measures it (4, 44, 105, 70 on NP2) |
| Header (4) ... Side Page 2 (11) | 0x23, and Fluid Page (0x4000) set | 0, 0, 570, 330 |

So 0x10 is Auto-size and 0x20 is "800x600 page inside portal". Moving between
two types of the same kind changes only PNLTYPE.

App Designer measures the Auto-size rectangle from what it draws, label
text included. Of 2,306 delivered Auto-size subpages, 3 have the plain
control extent. The editor sends the rectangle it draws
(`autoSizeExtent`); without one (the MCP) the writer uses the controls'
extent (`controlsExtent`). App Designer measures again when it next saves
the page.

App Designer's Use tab per type, from its screenshots, is followed by the
editor:

- **Subpage, Popup:** Page Size Auto-size, Width / Height blank.
- **Header ... Side 2:** 800x600 page inside portal, Width / Height
  greyed; Fluid Page on.
- **Background:** greyed on Subpage and Popup.
- **Style Sheet:** greyed on Popup.
- **Allow Deferred Processing:** checked and greyed on Popup.
- **Popup Menu:** Standard and Secondary only.
- **OK & Cancel, Close Box and Disable Modal:** Secondary only.

`pageWriter.test.ts` replays all sixteen changes; the Auto-size ones are given
App Designer's measured rectangle. Live, wp10-wp12 (Subpage, Header,
Standard on NP2) wrote the columns App Designer wrote.

Page Size: s01-s08 chose each entry of a standard page's Page Size list on
ZZ_PCODE_LAB_NP2, in turn. Each wrote PNLUSE's size bits (0x03 kept) and
the size:

| Choice | Size bit | Stored size |
|---|---|---|
| 640x480 Windows screen | none | 0 x 0 (App Designer shows 632 x 326) |
| 800x600 Windows screen | 0x04 | 782 x 452 |
| 800x600 page inside portal | 0x20 | 570 x 330 |
| 800x600 page without portal | 0x40 | 760 x 330 |
| 1024x768 page inside portal | 0x800 | 760 x 498 |
| 1024x768 page without portal | 0x80 | 984 x 498 |
| 240xVar portal home page comp. | 0x200 | 210 x the current height less 8 |
| 490xVar portal home page comp. | 0x400 | 460 x the current height less 8 |
| Custom size | 0x08 | the size kept |

The "Var" widths are 8 less than App Designer shows (218, 468), and the
height drops by 8 at each choice (s06: 498 -> 490, s07: 490 -> 482). The
size bits are 0x04-0x80 and 0x200-0x800 (`PAGE_SIZE_BITS`, 0xEFC); 0x100
between them is Adjust Layout for Hidden Fields. A page type change clears
them all.

Choosing Custom from 640x480 (stored 0 x 0) starts the writer at 632 x 326.
App Designer's u07 chose 848 x 778 there, and no capture shows where that
size comes from. `pageWriter.test.ts` replays all ten. Live, wp13 (1024x768
inside portal), wp14 (240xVar) and wp15 (Custom) wrote what s04, s06 and s08
wrote.

Block C was eight saves: Fluid Page on, the Fluid tab one field at a time,
then Fluid Page off. Each wrote one PSPNLDEFN column, and no control changed.

| Case | Setting | PSPNLDEFN |
|---|---|---|
| u13-page-fluid-on | Fluid Page on | PNLUSE 0x0B -> 0x400B |
| f01-page-style-classes | Style Classes `zz-sc` | FFSTYLEDESKTOP |
| f02-page-style-small | Small `zz-s` | FFSTYLEPHONE |
| f03-page-style-medium | Medium `zz-m` | FFSTYLEMEDIUM |
| f04-page-style-large | Large `zz-l` | FFSTYLETABLET |
| f05-page-style-xlarge | Extra Large `zz-xl` | FFSTYLEEXLARGE |
| f06-page-suppress-classes | Suppress System-Specific Style Classes | PNLUSETEMP 0 -> 1 |
| u14-page-fluid-off | Fluid Page off | PNLUSE 0x400B -> 0x0B (classes kept) |

The classes are stored as typed: case kept, up to 100 characters, blank
' '. PNLUSETEMP is a bit mask (delivered pages carry 1, 2, 4, 26), so the
writer sets and clears 0x01 alone. `pageWriter.test.ts` replays all eight.
Live, `wp05-writer-page-fluid-clear` (Fluid on, every class cleared, Suppress
off) and `wp06-writer-page-fluid-off` put ZZ_PCODE_LAB_PG back to its
pre-Block C state, each in App Designer's shape.

Still not written: the preset Page Sizes, page types other than Standard /
Secondary, and FFSTYLESHEETNAME (a Fluid page's style sheet; not captured).

In g01 App Designer also turned control 21's PSPNLFIELDEXT.FFSTYLELONG from
NULL into ' '. Control 21 is a Static Text the MCP added, and a fresh Static
Text row (15) has it NULL. App Designer makes it ' ' on its next save of the
page; its own static texts 10 and 15 now read ' ' as well.

## Tab order

The Order tab sets FIELDNUM directly (`PageSaveRequest.order`, the surviving
controls first to last). o01-page-order-drag (one row dragged in App
Designer's Order tab) wrote just that: FIELDNUM on the two controls that
changed places (10: 5 -> 6, 14: 6 -> 5), plus the stamp and `PDM` / `SYS` +1.
`pageWriter.test.ts` replays it. A move that changes which grid / scroll area
a control follows would change its OCCURSLEVEL too, and is refused until a
capture shows what App Designer writes then.

### Where an added control goes

App Designer does not append a new control, and does not put it after the
selected control: it puts it **right after the control before it in reading
order** -- the last of the page's controls at or above-left of the drop point,
two controls being on one row when their tops are within 20 pixels (then left
to right). Of several at one spot, the first in tab order counts; with none
before it, the new control goes first. The controls after it move down one.

Evidence: every App Designer insert captured (02, 06, 07, 15-18, in01, in03,
eb/gb-hr/rb/le/ht-fresh, ht-field, sa/sb/sec/sub-fresh) and three focused ones
on ZZ_PCODE_LAB_CT:

- **to-a-selected**: Static Image (tab 2) selected in the Order tab, a Static
  Text dropped at the bottom right: tab 9 (by position), not 3 or the end.
- **to-c-canvas-sel**: the Check Box (tab 3) selected on the canvas, a Static
  Text dropped at y 724: tab 9, not 4. Selection plays no part.
- **to-d-band24**: a Static Text 24 px below and left of another: placed after
  it (another row). 18-number-datetime has two controls 20 px apart on one row,
  so the band is 20 (App Designer snaps tops to 4 px).

The older ZZ_PCODE_LAB_PG captures show why it is "after the predecessor" and
not "rank by position": controls moved after they were added leave the tab
order out of reading order, and a new one still lands right after its
neighbour above (15: static text at y 376 after the push button at y 200, ahead
of controls higher on the page but later in the order).

`pageWriter.ts` `newControlTabIndex`; `pageWriter.test.ts` replays all 22
captures (the new controls' FIELDNUM and every other control's renumbering).
Not covered: a field dropped inside a grid (App Designer stores it at 0,0 and
orders it in the grid; gr-fresh). A pasted control keeps its own rule (after
its source, c02).

## A control's Properties: Frame

fr01-fr07 set one Frame Properties setting each, on frame 16 of
ZZ_PCODE_LAB_PG. Each wrote one PSPNLFIELD column:

| Tab | Setting | PSPNLFIELD |
|---|---|---|
| Label | Text | LBLTEXT |
| Label | Style (EDGE) | FIELDSTYLE (a style class; ' ' default) |
| Label | Hide Border | FIELDUSE 0x4000000 |
| Label | Adjust Layout for Hidden Fields | PTADJHIDDENFIELDS 0 -> 1 |
| Use | Multi-Currency Field | FIELDUSE 0x20 |
| General | Page Field Name | PNLFIELDNAME |
| General | Enable as Page Anchor | ENABLEASANCHOR 0 -> 1 |

The first OK on the dialog (fr01) also wrote the frame's PSPNLFIELDEXT
FFSTYLELONG ' ' -> ' | | | | ', the five-slot Fluid style form. The writer
does the same when a dialog column of a frame with a blank one changes
(`extUpdates`).

A changed Page Field Name is checked: up to 18 letters, digits or _, and not
another control's. Delivered names may start with a digit (1OF10), and 30
delivered pages repeat a name, so stored names are left alone. A new Style
must be a style class. `pageWriter.test.ts` replays fr01-fr07 through
`planPageSave`. Live, `wp16-writer-frame-revert` set all six columns back in
one save.

App Designer offers the Fluid tab only on a Fluid page. `wp17` turned Fluid
Page on for ZZ_PCODE_LAB_PG (PNLUSE 11 -> 0x400B) for its captures,
fr08-fr20:

| Fluid setting | Column |
|---|---|
| Style Classes, Small, Medium, Large, Extra Large | PSPNLFIELDEXT.FFSTYLELONG |
| Suppress System-Supplied Style Classes | FIELDUSETMP 0x400000 |
| Suppress On Form Factor: Small | FIELDUSETMP 0x40000000 |
| Suppress On Form Factor: Medium | PSPNLFIELDEXT.FIELDUSETEMP2 0x10 |
| Suppress On Form Factor: Large | FIELDUSETMP 0x20000000 |
| Suppress On Form Factor: Extra Large | FIELDUSETEMP2 0x80 |
| Label Rendering: After Control | FIELDUSETMP 0x2000000 |
| Include Labels in Grid Cells | FIELDUSETEMP2 0x02 |
| Control Structure: Basic | FIELDUSETMP 0x4000000 |

FFSTYLELONG holds the five class entries in order, separated by `|`, with an
empty entry stored as ' ' and classes kept as typed: fr12 wrote
`zz-fc|zz-fs|zz-fm|zzfl|zz-fx`. `pageWriter.test.ts` replays fr08-fr20.
Live, `wp18` set frame 16's Fluid settings back. `wp19` cleared the page
classes set by mistake (fr08x) and turned Fluid Page off again.

## A control's Properties: Static Text

st01-st10 set one Static Text Properties setting each, on control 1 of
ZZ_PCODE_LAB_CT (then a classic page). The dialog's tabs are Label, Use,
General and Fluid:

| Tab | Setting | Column |
|---|---|---|
| Label | Text / Message Catalog | LBLTYPE 1 / 7 |
| Label | Text | LBLTEXT |
| Label | Message Set / Number | GRDLBLMSGSET / GRDLBLMSGNUM |
| Label | Message Catalog shown as Explanation | DSPLFORMAT 0x40000000 |
| Label | Style | FIELDSTYLE |
| Label | Alignment Centered / Right (Left = neither) | DSPLFORMAT 0x2 / 0x4 |
| Use | Multi-Currency Field | FIELDUSE 0x20 (st11) |
| Use | Paragraph | PSPNLFIELDEXT.FIELDUSETEMP2 0x800 |
| General | Page Field Name, Enable as Page Anchor | PNLFIELDNAME, ENABLEASANCHOR |

The Static Text dialog has no Adjust Layout for Hidden Fields.

**Insert Line Feed** stores a bare LF (0x0A), no CR. In st11 two line feeds
and a second line were added (`Control mapping\n\n- Did it work?`), along
with Multi-Currency (FIELDUSE 0 -> 32). ct-fluid-on (v257) had just
turned Fluid Page on for ZZ_PCODE_LAB_CT (PNLUSE 11 -> 16395), so st11 (v258)
was on a Fluid page. That save also wrote the control's FFSTYLELONG
' ' -> ' | | | | ', as a frame's dialog does (fr01). On the classic page
(st01-st09) a Static Text's dialog never did. The writer writes the five
slots for a Static Text only on a Fluid page. `pageWriter.test.ts` replays
st02-st08 and st11.

## A control's Properties: Static Image

si01-si12 set one Static Image Properties setting each, on control 2 of
ZZ_PCODE_LAB_CT. The dialog's tabs are Label, General and Fluid:

| Group | Setting | Column |
|---|---|---|
| Alt tag for image | Label Type None / Text / Message Catalog | LBLTYPE 6 / 1 / 7 |
| Alt tag for image | Label (Text) | LBLTEXT |
| Alt tag for image | Message Set / Msg Number | GRDLBLMSGSET / GRDLBLMSGNUM |
| Image | Image ID | CONTNAME |
| Image Format / Size | Scale / Size | DSPLFORMAT 0x800 / 0x4000 (a fresh image has neither: Size) |
| Image Format / Size | Width / Height | FIELDRIGHT / FIELDBOTTOM |
| General | Page Field Name, Enable as Page Anchor | PNLFIELDNAME, ENABLEASANCHOR |

Choosing Message Catalog blanks the alt text (si04: LBLTEXT 'ZZ Alt' -> ' '),
and the greyed Label shows the catalog message. Scale and Size swap the two
bits and keep the rest (si10: 10241 -> 24577). The dialog's Width and Height
are the control's rectangle less 2: control 2 at 16,48-58,80 shows 40 x 30.
Its Type / Width / Height are the image definition's own format and pixel
size. Reset to actual image size is not captured; the editor takes it to
set Width / Height to the image's pixel size.

## A control's Properties: Group Box

gb01-gb27 set each Group Box Properties setting on ZZ_PCODE_LAB_CT (a Fluid
page; group box 6 and a fresh group box 21), gb28 on ZZ_PCODE_LAB_PG (classic).
The dialog's tabs are Record, Label, Use, General and Fluid:

| Tab | Setting | Column |
|---|---|---|
| Record | Record Name / Field Name | RECNAME / FIELDNAME |
| Label | Type Text / RFT Short / RFT Long / Message Catalog | LBLTYPE 1 / 2 / 3 / 7 |
| Label | Text | LBLTEXT (RFT: the label's SHORTNAME / LONGNAME) |
| Label | Label ID (*** Use Default Label ***) | LABEL_ID, USEDEFAULTLABEL 1 (an explicit label 0) |
| Label | Message Set/Number | GRDLBLMSGSET / GRDLBLMSGNUM |
| Label | Label Style | LABELSTYLE |
| Label | Embedded Popup Help: Message Catalog Popup | FIELDUSETMP 0xA000; PSPNLFIELDEXT MESSAGE_SET_NBR / MESSAGE_NBR |
| Label | Alignment Left / Centered / Right | DSPLFORMAT 0x80000 / 0x100000 / 0x200000 |
| Label | Body Style | FIELDSTYLE |
| Label | Adjust Layout for Hidden Fields | PTADJHIDDENFIELDS |
| Label | Hide Border / Suppress Accessible Label | FIELDUSE 0x4000000 / 0x2000 |
| Use | Multi-Currency Field | FIELDUSE 0x20 |
| Use | Hide all Fields when Group Box Hidden | PTHIDEFIELDS |
| Use | Collapsible Data Area / Default Initial View to Expanded State | PTCOLLAPSEDATAAREA / PTDFLTVIEWEXPANDED |
| Use | Label Image for Collapsed / Expanded State | PTLBLIMGCOLLAPSE / PTLBLIMGEXPAND (' ' default) |
| General | Page Field Name, Enable as Page Anchor | PNLFIELDNAME, ENABLEASANCHOR |
| Fluid | Group Box Type | PSPNLFIELDEXT.GRPBOXTYPE: the list index, 0 Default ... 26 Group Box Header Extension |
| Fluid | Html Tag Type | GRPBOXHTMLTYPE 0-6: Default, DIV, Section, Article, UL, OL, LI |
| Fluid | ScrollBars | SCROLLBARS 0-4: None, Vertical, Horizontal, Both, Carousel |
| Fluid | Textual Info / Actionable Info / Action Items | PTGBRELTXTINFO / PTGBRELACTINFO / PTGBRELACTFLD |
| Fluid | Draggable / Droppable | FIELDUSETMP 0x800000 / 0x1000000 |
| Fluid | Gestures / Capture Trigger / Scroll Sizing by Style | FIELDUSETEMP2 0x40 / 0x8000 / 0x8 |

Binding a field (gb16) makes the label RFT Long with the field's default
label: LBLTYPE 3, LABEL_ID, LBLTEXT its long name. Message Catalog blanks
LBLTEXT to ' ' (gb14); switching back keeps the set and number. Context is a
read-only display. The Header Extension lists offer the page's group boxes of
type Group Box Header Extension, shown "tab order | label" and stored as
FIELDNUM - 1 (gb27: "14 | Long 254" stored 13); none is -1. They are offered
only on a Default group box.

OK on the dialog also writes, with nothing changed (gb06, gb28): DSPLFORMAT
0x80000 (Left, explicit), FIELDUSETMP 0x6000000 and FFSTYLELONG ' | | | | '.
On a Fluid page (gb06, not gb28) it also turns the Header Extension's 0s to
-1. The writer does the same when a group box's dialog columns change.
`pageWriter.test.ts` replays gb01-gb27 (less gb08, a full snapshot without
PSPNLFIELDEXT) and checks gb06 / gb28. Live, `wgb2-on` / `wgb3-off` saved
group box 21's Multi-Currency, Hide all Fields, ScrollBars, popup message
and Label ID through `savePage` and back.

## A control's Properties: Horizontal Rule

hr01-hr06 on rule 17 of ZZ_PCODE_LAB_PG (classic), hr07 on rule 7 of
ZZ_PCODE_LAB_CT (Fluid). The dialog's tabs are Label, Use, General and Fluid:

| Tab | Setting | Column |
|---|---|---|
| Label | Text | LBLTEXT (LBLTYPE stays 0; blank is ' ') |
| Label | Style | FIELDSTYLE |
| Use | Multi-Currency Field | FIELDUSE 0x20 |
| Use | Set to Level | FIELDUSE 0x2 with SECUREINVISIBLE 1 (cleared together, hr05) |
| Use | the level | OCCURSLEVEL |
| General | Page Field Name, Enable as Page Anchor | PNLFIELDNAME, ENABLEASANCHOR |

The level list runs from 0 to the scroll level where the rule sits; the lab
pages have no scroll, so only 0 was captured. Delivered rules with Set to Level
sit at OCCURSLEVEL 0-2 (4,424 / 234 / 34), so the level chosen is OCCURSLEVEL.
OK on the dialog writes FFSTYLELONG ' | | | | ' on either page type (hr01,
hr07). On ZZ_PCODE_LAB_CT an OK that changed nothing did not save at all; the
first OK of hr07 wrote the slots. `pageWriter.test.ts` replays hr02-hr06 and
checks hr01 / hr07.

## A control's Properties: Check Box

cb-* (property grid) and cbx01-cbx17 (the dialog) on check box 3 of
ZZ_PCODE_LAB_CT. The dialog's tabs are Record, Label, Use, General and Fluid:

| Tab | Setting | Column |
|---|---|---|
| Record | Record Name / Field Name, On Value / Off Value | RECNAME / FIELDNAME, ONVALUE / OFFVALUE |
| Label | Type None / Text / RFT Short / RFT Long | LBLTYPE 0 / 1 / 2 / 3 (None keeps LBLTEXT) |
| Label | Text | LBLTEXT (RFT: the label's SHORTNAME / LONGNAME; cbx05 "C01") |
| Label | Label ID (*** Use Default Label ***) | LABEL_ID, USEDEFAULTLABEL 1 (explicit 0) |
| Label | Style | FIELDSTYLE |
| Label | Location Left / Right | LBLLOC 0 / 1 |
| Label | Alignment Left / Centered / Right | DSPLFORMAT 0x80000 / 0x100000 / 0x200000 |
| Use | Display Only / Multi-Currency / Display Control Field | FIELDUSE 0x1 / 0x20 / 0x8 |
| Use | Invisible | FIELDUSE 0x2 with SECUREINVISIBLE 1 |
| Use | Modifiable by JavaScript (invisible only) | SECUREINVISIBLE 0 |
| Use | Generate in HTML (invisible only) | FIELDUSETEMP2 0x20 |
| Use | Related Field | FIELDUSE 0x10, and Display Only 0x1 with it |
| Use | Related Control Field | ASSOCFIELDNUM: the control field's FIELDNUM - 1 |
| Use | Enable When Page is Display Only | FIELDUSE 0x40000 |
| Use | Popup Menu | POPUPMENU |
| Use | Allow Deferred Processing | DEFERPROC |
| Use | Set Component Changed (off) | FIELDUSETMP 0x8 |
| Use | Display-Only Appearance: Disabled Edit Control | FIELDUSETMP 0x4 |
| Use | Read only control for screen reader | FIELDUSETEMP2 0x10000 |
| Use | Wrap Long Words | FIELDUSETMP 0x40 |

Turning Invisible off clears Generate in HTML and SECUREINVISIBLE (cbx15;
delivered visible controls carry SECUREINVISIBLE 1 only 4 times in 164,547).
Related Field off clears ASSOCFIELDNUM and leaves Display Only on (cbx14). A
related display must follow its control field in tab order, or App Designer
calls the page invalid (cbx13 was saved through that warning); delivered
related fields point at a Display Control Field's FIELDNUM - 1 in 29,485 of
29,572. Show Label, the left Enable When Page is Display Only, Smart Prompt,
Persist Grid Column in Menu and Field Format Override stay greyed on a check
box outside a grid. A fresh check box already has Left (0x80000) and five
Fluid slots, so its OK writes nothing more; an Edit Box's OK on a Fluid page
writes the slots (cbx12). `pageWriter.test.ts` replays cbx02-cbx17.

## A control's Properties: HTML Area

ha01-ha10 on HTML Area 15 of ZZ_PCODE_LAB_CT (Fluid). The dialog's tabs are
HTML, Label, General and Fluid:

| Tab | Setting | Column |
|---|---|---|
| HTML | Value: Field | RECNAME / FIELDNAME (a record alone is allowed, ha10) |
| HTML | Value: Constant | PSPNLHTMLAREA (PNLNAME, PNLFLDID, HTMLAREA CLOB); RECNAME / FIELDNAME ' ' |
| HTML | HTML Tags Only | FIELDUSETMP 0x100000 |
| HTML | Respond Only Once | PSPNLFIELDEXT.FIELDUSETEMP2 0x1000 |
| Label | Type None / Text / Message Catalog / RFT Long / RFT Short | LBLTYPE 0 / 1 / 7 / 3 / 2 |
| Label | Text, Label ID | LBLTEXT, LABEL_ID / USEDEFAULTLABEL |
| Label | Message Set / Msg Number | GRDLBLMSGSET / GRDLBLMSGNUM |

Constant (ha03) inserts the PSPNLHTMLAREA row and blanks RECNAME; editing the
text (ha04) replaces it; Field again (ha05) deletes it. App Designer wrote no
PSPNLHTMLLANG row. Binding a field (ha05) fills LABEL_ID and LBLTEXT with its
default label and leaves the label type; Message Catalog blanks LABEL_ID and
LBLTEXT (ha06); an RFT type takes back the default label (ha07); Text and None
keep both (ha08, ha09). Context is read-only. The first OK (ha01) wrote DSPLFORMAT
0x80000 and, on this Fluid page, FFSTYLELONG ' | | | | '. Delivered HTML Areas
carry 0x80000 on classic pages too (401 of 451) but the five slots rarely (137),
so the writer adds the Left bit on any page and the slots on a Fluid page.
Deleting a Constant HTML Area deletes its PSPNLHTMLAREA / PSPNLHTMLLANG rows; a
pasted one copies its source's text. `pageWriter.test.ts` replays ha01-ha10;
live, wha-const / wha-edit / wha-field saved a Constant, edited it and went
back to Field through `savePage`.

## A control's Properties: Long Edit Box

le01-le19 on Long Edit Box 9 of ZZ_PCODE_LAB_CT (Fluid). Tabs: Record, Label,
Use, General, Fluid and Options:

| Tab | Setting | Column |
|---|---|---|
| Record | Record Name / Field Name | RECNAME / FIELDNAME |
| Record | Style (greyed with Rich Text) | FIELDSTYLE |
| Record | Enable Spell Check | FIELDUSETMP 0x2 |
| Label | Type None / Text / RFT Short / RFT Long | LBLTYPE 0 / 1 / 2 / 3 |
| Label | Text (Insert Line Feed: a bare LF) | LBLTEXT |
| Label | Label ID, Style | LABEL_ID / USEDEFAULTLABEL, LABELSTYLE |
| Label | Alignment Left / Centered / Right | DSPLFORMAT 0x80000 / 0x100000 / 0x200000 |
| Label | Position Left / Custom / Top | LABELSIZETYPE 0 / 1 / 2, with the label rectangle laid out again |
| Label | First occurs only | DSPLFORMAT 0x400000 |
| Label | No colon | LBLLOC 1 |
| Use | Display Only, Invisible, Modifiable by JavaScript, Generate in HTML, Multi-Currency, Related Field | as a Check Box's |
| Use | Expand Field When Display Only | PTLEBEXPANDFIELD |
| Use | Display in Modal Window | FIELDUSETMP 0x100 |
| Use | Enable Long Edit Counter | FIELDUSETMP 0x8000000 |
| Use | Read only control for screen reader | FIELDUSETEMP2 0x10000 |
| Fluid | Placeholder Text None / Static / Message Catalog | PSPNLFIELDEXT.PLHTYPE 0 / 1 / 2, PLACEHOLDER, PLH_MSG_SET_NBR / PLH_MSG_NBR |
| Options | Enable Rich Text | FIELDUSETMP 0x80 and a PSPTPNLRTEDITOR row |
| Options | Configuration Settings / Image Location URL / Plugin / Template / Style File Id | PSPTPNLRTEDITOR PTRTECFGSETTINGSID / PTRTEIMGLOCURLID / PTRTEPLUGIN / PTRTETEMPLATE / PTRTESTYLE |

Enable Rich Text inserts the PSPTPNLRTEDITOR row with Image Location URL Id
PT_RTE_IMG_DB_LOC filled in (le01); turning it off deletes the row (le03).
The lists: HTML definitions PT_RTE_CFG* (Configuration Settings) and
PT_RTE_PLUGIN* (Plugin), URL definitions PT_RTE* (Image Location); the Template
and Style File lists are empty on HRDMO and no delivered page sets them. Every
one of HRDMO's 286 rows sits on a long edit box with FIELDUSETMP 0x80.
Position writes the label rectangle App Designer lays out from the label's text
(le05: Top, le06: Custom, le07: Left); the editor sets LABELSIZETYPE and keeps
the label rectangle it has. Message Catalog placeholder blanks the static text;
None clears the set / number. Deleting a long edit box deletes its
PSPTPNLRTEDITOR row; a pasted one copies it. `pageWriter.test.ts` replays
le01-le19; live, wle-on / wle-off saved Rich Text and a placeholder through
`savePage` and back.

## Copy and paste

c01-page-paste-editbox pasted a copy of an auto-sized Edit Box.
c02-page-paste-groupbox pasted a group box with the static text inside it.
n01 pasted onto a new page. App Designer's paste is a copy of the source's
stored rows:

- PSPNLFIELD and PSPNLFIELDEXT are copied column for column. The only changes
  are the new PNLFLDID (MAXPNLFLDID + 1 on), FIELDNUM, and FIELDLEFT / TOP /
  RIGHT / BOTTOM.
- All four FIELD coordinates move by the paste offset, even an auto-sized
  control's 0 RIGHT (c01: RIGHT 0 -> 4, BOTTOM 385 -> 425).
- A hidden (negative) label rectangle stays put.
- PARENTPNLFLDID / PAGEPNLFLDID name the page pasted onto. n01 pasted before
  the new page had a name, so it wrote `$0`.
- Each copy goes right after its source in tab order (c02: group box 9 at 13,
  its copy at 14; static text 21's copy last). The controls after it move down
  one. c01's copy landed one place further on; c01 alone can't tell whether
  the source was copied before o01 moved it.

The editor's Copy (Ctrl+C) describes the selected controls. Copy also works
on a read-only page, so you can copy from a delivered page. Paste (Ctrl+V,
on any page window of the same connection) draws the copies 20 px down-right
and sends each as `copy: { pnlName, pnlFldId }`. The writer reads the
source's stored rows at Save (`copyControlRows`). A copied control that was
itself new is pasted as another new one. `pageWriter.test.ts` rebuilds c01's,
c02's and n01's pasted rows column for column, and c02's tab order.

## New Page and New Page Fluid

n01-page-new was File > New > Page, one control added (App Designer will not
save a page without one), saved as ZZ_PCODE_LAB_NP1. It wrote a fresh
PSPNLDEFN row (`NEW_PAGE`): PNLTYPE 0, 570 x 330 at PNLUSE 32, grid 4 x 4,
DEFERPROC 1, every name ' ', DESCRLONG NULL. It also wrote the control's
rows and `PDM` / `SYS` +1.

n02-page-new-fluid was New Page Fluid from Layout Page PSL_APPS_CONTENT,
saved as ZZ_PCODE_LAB_NPF1. App Designer asked whether to save
PSL_APPS_CONTENT's PeopleCode too. The page is the Layout Page's rows,
verbatim but for:

- PNLNAME and VERSION (the new PDM), and the stamp;
- PNLTYPE 7 -> 0 and OBJECTOWNERID PPT -> ' ';
- LICENSE_CODE (see below).

PSPNLFIELD / PSPNLFIELDEXT change only PNLNAME; PARENTPNLFLDID keeps
`PSL_APPS_CONTENT`. PSL_APPS_CONTENT has no page PeopleCode, so nothing was
copied.

`createPage` writes both (`planNewPage`; `pageWriter.test.ts` rebuilds n01's
and n02's PSPNLDEFN rows). New Page opens the page window on an empty page,
and its first Save creates the page, refused while it has no control. New
Page Fluid offers Choose Layout Page (every PNLTYPE 7 page) and a name, then
asks App Designer's PeopleCode question. On Yes, the Layout Page's Activate
program is saved for the new page through the Page PeopleCode create path
(q01).

LICENSE_CODE is App Designer's own value: set when a page is created, kept
by every later save. It can't be derived from the page; pages created
together share one (RUNCTL_TRN001 ... 022). A writer-created page therefore
carries ' ', as delivered GPES_JOB_EMPLS does. App Designer opens such a page
and fills the code in at its next save. ZZ_PCODE_LAB_PG kept its code
through every App Designer save in Blocks A-C, so App Designer only writes it
when it is blank. The code follows the page's content, not its name or time:
App Designer gave the writer's ZZ_PCODE_LAB_NP2 exactly the code it gave its
own ZZ_PCODE_LAB_NP1.

Re-saving the writer's two pages unchanged in App Designer (`wp07r`, `wp08r`)
also tidied values App Designer itself writes at creation:

- NP2: PNLUSE 32 -> 35. A standard page's 0x03 no-buttons bits are added;
  n01's first save left them off too.
- NPF2: PANELRIGHT 570 -> 863, as wide as the template's group box.
  PARENTPNLFLDID / PAGEPNLFLDID were renamed from PSL_APPS_CONTENT to the
  page's own name; n02 copied them as they were too.

Nothing else changed.

Live on HRDMO, each compared column for column with App Designer's capture
(the name, version, stamp and LICENSE_CODE aside); each took `PDM` / `SYS` +1
and PSLOCK `PDM` +1, as App Designer's did:

- `wp07-writer-page-new` (ZZ_PCODE_LAB_NP2, with n01's paste) matches n01.
  The only difference is the control's PARENTPNLFLDID / PAGEPNLFLDID,
  `ZZ_PCODE_LAB_NP2$0` where n01's not yet named page wrote `$0`.
- `wp08-writer-page-new-fluid` (ZZ_PCODE_LAB_NPF2 from PSL_APPS_CONTENT)
  matches n02.
- `wp09-writer-page-paste` (control 14 again at +4, +40) matches c01's
  pasted row, PSPNLFIELD and PSPNLFIELDEXT. It went in after its source in
  tab order.

The writer also refuses an empty New Page, a template that is not a Layout
Page, and a name already taken.
