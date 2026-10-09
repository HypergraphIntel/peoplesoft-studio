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
