# Pages, components and menus

How PeopleTools stores pages, components and menus, mapped from HRDMO
(PeopleTools 8.62.09: 17,342 pages, 8,363 components, 637 menus) by querying
the tables, and what PeopleSoft Studio shows from them
(`src/model/uiDefinitions.ts`). Components and menus are read-only; pages are
edited in the Page designer below, whose save is proven against App Designer's
(docs/PAGE_SAVE.md).

Few of these codes have PSXLATITEM labels (only `LBLTYPE`). The names below
come from App Designer where it has shown them (the Default Page Control
names, which share `PSPNLFIELD.FIELDTYPE`'s numbers), else from the column
only one kind of control fills, the delivered definitions that use a value,
or their names -- each marked with its evidence. A code without evidence is
shown as its number.

## Components

| Table | Rows | Holds |
|---|---|---|
| `PSPNLGRPDEFN` | 8,363 | the component, by `PNLGRPNAME` + `MARKET`: description, search records (`SEARCHRECNAME`, `ADDSRCHRECNAME`), `SEARCHPNLNAME`, `ACTIONS`, settings |
| `PSPNLGROUP` | 13,325 | its pages by `SUBITEMNUM`: `PNLNAME`, `ITEMNAME`, `ITEMLABEL`, `FOLDERTABLABEL`, `HIDDEN` |
| `PSPNLGRPDEFNEXT` | 252 | fluid / search framework extensions |

`ACTIONS` is a bit mask, consistent with the actions of well-known delivered
components:

| Bit | Action | |
|---|---|---|
| 1 | Add | USERMAINT 3 = Add + Update/Display |
| 2 | Update/Display | PROCESSMONITOR 2 |
| 4 | Update/Display All | JOB_DATA 14 = Update/Display, Update/Display All, Correction |
| 8 | Correction | |

0 / 1 flags: `DISABLESAVE` (1,636 set), `FORCESEARCH` (74), `INCLNAVIGATION`
(7,883), `ALLOWACTMODESEL` (7,914), `FLUIDMODE` (802). Not decoded yet:
`PRIMARYACTION` (1 or 0), `DFLTACTION` (1, 3, 2, 10), `DFLTSRCHTYPE`,
`SHOWTBAR` / `TBARBTNS` (toolbar bit masks), `PNLNAVFLAGS`, `LOADLOC` /
`SAVELOC`, `COMP_TYPE`, `PNLGRPUSE`.

Component PeopleCode: `PSPCMPROG` 10 component / 39 market / 12 event;
component record 10 / 39 / 1 record / 12; component record field 10 / 39 /
1 / 2 field / 12.

## Menus

| Table | Rows | Holds |
|---|---|---|
| `PSMENUDEFN` | 637 | `MENUTYPE`, `MENULABEL`, `MENUGROUP`, description |
| `PSMENUITEM` | 10,096 | items by `BARNAME` + `ITEMNUM`: `ITEMTYPE`, `ITEMNAME`, `ITEMLABEL`, `BARLABEL`, `PNLGRPNAME` + `MARKET`, `SEARCHRECNAME` override |

| `MENUTYPE` | | |
|---|---|---|
| 0 | Standard | 621 |
| 1 | Popup | 16 (e.g. PT_ADS_POP) |

| `ITEMTYPE` | | Evidence |
|---|---|---|
| 5 | Component | 9,127, every one names a component |
| 8 | Separator | 942, labelled "-------------", "Separator1" |
| 9 | PeopleCode | 8; the items with Menu PeopleCode (3 menu / 4 bar / 5 item / 12 `ItemSelected`) |
| 12 | Transfer | 19, popup items labelled "Add ...", "Maintain ..." |

## Pages

| Table | Rows | Holds |
|---|---|---|
| `PSPNLDEFN` | 17,342 | the page: `PNLTYPE`, size, style sheets, description |
| `PSPNLFIELD` | 348,353 | its controls by `FIELDNUM` (the Order view): `FIELDTYPE`, `OCCURSLEVEL`, record field, label, position, subpage, link / process / action targets, `FIELDUSE` flags |
| `PSPNLFIELDEXT` | 147,022 | per-control extensions (modal size, placeholder, group box type) |
| `PSPNLBTNDATA` | 99,359 | grid and scroll area buttons |
| `PSPNLCNTRLDATA` | 15,562 | grid and scroll area header / footer settings |
| `PSPNLHTMLAREA` | 44 | constant HTML of HTML areas |

`PNLTYPE`:

| | Type | Evidence |
|---|---|---|
| 0 | Standard Page | 10,720 of 10,821 are in a component |
| 1 | Subpage | 2,782 of 2,873 are used as subpages |
| 2 | Secondary Page | 2,828 of 3,538 are used as secondary pages |
| 3 | Popup Page | TL_JOB_POP and 15 others |
| 4-11 | fluid page types | named from their pages: 4 Header (PT_HEADERPAGE), 5 Side Page 1, 6 / 7 Footer, 8 Search (PT_SEARCHPAGE_S), 9 Prompt (PT_PROMPTPAGE), 10 Master/Detail Start, 11 Side Page 2 (PT_SIDE2PAGE) |

`PSPNLFIELD.FIELDTYPE`, with HRDMO's counts:

| | Control | Count | Evidence |
|---|---|---|---|
| 0 | Static Text | 7,780 | no record field; label only |
| 1 | Frame | 1,493 | no record field ("spacer") |
| 2 | Group Box | 40,812 | large boxes ("yellow box"), optional record field |
| 3 | Static Image | 485 | an image (`CONTNAME`) without a record field |
| 4 | Edit Box | 183,689 | App Designer's control name |
| 5 | Drop Down List | 21,098 | App Designer's control name ("Dropdown List") |
| 6 | Long Edit Box | 4,862 | |
| 7 | Check Box | 14,362 | App Designer's control name |
| 8 | Radio Button | 4,207 | App Designer's control name |
| 9 | Image | 1,007 | App Designer's control name |
| 10 | Scroll Bar | 1,398 | labels "... Scroll Bar" |
| 11 | Subpage | 12,313 | `SUBPNLNAME`, every row |
| 12 | Push Button: PeopleCode Command | 23,223 | the plain button |
| 13 | Push Button: Scroll Action | 147 | `SCROLLACTION`, every row |
| 14 | Push Button: Toolbar Action | 112 | `TOOLACTION` (109) |
| 15 | Push Button: External Link | 274 | `URL_ID` (273) |
| 16 | Push Button: Internal Link | 268 | `GOTOPNLNAME` / `GOTOPNLGRPNAME` (249) |
| 17 | Push Button: Process | 2 | `PRCSNAME` |
| 18 | Secondary Page | 3,744 | `SUBPNLNAME` of secondary pages |
| 19 | Grid | 65,172 | `GRDCOLUMNCOUNT`, buttons and header data |
| 20 | Tree | 6 | labelled "Tree" |
| 21 | Push Button: Secondary Page | 770 | `SUBPNLNAME`, a record field |
| 23 | Horizontal Rule | 5,886 | two pixels high on average |
| 24 | Tab Separator | 1,739 | labelled "Tab Separator" |
| 25 | HTML Area | 2,956 | `PSPNLHTMLAREA` rows |
| 26 | Push Button: Prompt Action | 73 | "Select Personalization Value" |
| 27 | Scroll Area | 34,863 | buttons and header data |
| 29 | Push Button: Page Anchor | 30 | "Top of Page" |
| 30 | Chart | 139 | "... Charts" |
| 17, 31, 32 | | 2, 1, 18 rows: not named |

`LBLTYPE` (PSXLATITEM): 0 None, 1 Text, 2 RFT Short, 3 RFT Long; 4-8 have
no label (7: 29,809 controls without text or label ID). `LBLTEXT` holds the
label as App Designer shows it, also for RFT labels.

Not decoded: `FIELDUSE` (display only, invisible, and other flags), sizes,
styles, `PSPNLFIELDEXT`.

Page PeopleCode: `PSPCMPROG` 9 page / 12 event.

## Projects

| OBJECTTYPE | Item | OBJECTIDs |
|---|---|---|
| 5 | page | 9 |
| 6 | menu | 3 |
| 7 | component | 10, 39 |
| 9 | Menu PeopleCode | 3, 4, 5, 12 |
| 44 | Page PeopleCode | 9, 12 |
| 46 | Component PeopleCode | 10, 39, 12 |
| 47 | Component Record PeopleCode | 10, 39, 1, 12 |
| 48 | Component Record Field PeopleCode | 10, 39, 1, 2 -- the field (18) and event in the fourth value: `SAVE_PB           FieldChange` |

## In PeopleSoft Studio

A page opens in App Designer's Order view: each control by number, with its
level, type, label, record field or target, and page field name, and the
components the page is in. A component shows its search records, actions,
settings, pages (item name, label, hidden) and the menus it is on. A menu
shows its bars and items. Read-only.

## Visual Page designer (Layout view)

Opening a page shows it in a panel with two tabs
(`src/editors/pageHtml.ts`, `src/model/pageLayout.ts`):

- **Layout** -- the page's controls drawn where App Designer's Layout view
  puts them, from the geometry stored per control in `PSPNLFIELD`:
  `FIELDLEFT`, `FIELDTOP`, `FIELDRIGHT`, `FIELDBOTTOM` give each control's
  rectangle (in pixels), and `EDITLBLLEFT/TOP/RIGHT/BOTTOM` its label's. Each
  control is styled by its `FIELDTYPE` (edit box, drop-down, check box, radio,
  push button, group box, grid, scroll area, image ...), with its label drawn
  beside it; a label whose stored coordinates are negative is App Designer's
  "not shown" and is left out; an all-zero rectangle is drawn relative to the
  control, as App Designer does. The surface is the page's size
  (`PSPNLDEFN.PANELRIGHT` / `PANELBOTTOM`).
- **Order** -- App Designer's Order grid, one row per control by `FIELDNUM`.

A shared sidebar shows the selected control's properties, or the page's (Page
Properties: description, comments, owner, type, size, style sheets).

On a Writable connection with an Operator ID, for a page in the write scope,
the Layout view is an editor: drag to move, corner-resize, delete, relabel,
Display Only / Invisible; **Insert** a Frame, Group Box, Horizontal Rule,
Static Text, Check Box, Drop Down List Box, Edit Box or Push Button; edit the
Description and Comments; drag the page's edge (or type a size) for a Custom
page size; **Save**. The save, and each control's inserted rows, reproduce
captured App Designer saves -- see [PAGE_SAVE.md](PAGE_SAVE.md). AI clients do
the same through the MCP (`psft_get_page_layout`, `psft_edit_page`; see
[MCP_WRITES.md](MCP_WRITES.md)).
