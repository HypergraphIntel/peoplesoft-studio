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
it. **TODO: nail the FIELDNUM ordering rule with focused captures.**

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
