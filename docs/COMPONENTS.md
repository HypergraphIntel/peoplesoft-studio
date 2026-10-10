# Components

Opening a component shows it as App Designer's component window does
(`src/editors/componentPanel.ts`, `componentHtml.ts`): a **Definition** tab,
a **Structure** tab, and **Component Properties** in a sidebar with the
dialog's General / Use / Internet / Fluid / Style tabs. It is read-only:
editing waits on a captured App Designer component save (below). Everything
here was matched against App Designer's component window for `JOB_DATA.GBL`
on HRDMO (PeopleTools 8.62.09).

## Tables

| Table | Rows (HRDMO) | Holds |
|---|---|---|
| `PSPNLGRPDEFN` | 8,363 | One row per component (`PNLGRPNAME`, `MARKET`): description, search records, actions, Internet and Fluid settings |
| `PSPNLGROUP` | 13,325 | One row per page item: `SUBITEMNUM` (order), `PNLNAME`, `ITEMNAME`, `ITEMLABEL`, `FOLDERTABLABEL`, `HIDDEN` |
| `PSPNLGRPDEFNEXT` | 252 | Context search record, search category, real-time and keyword search link messages |
| `PSPNLGRPSCRIPTS` | 4 | Style tab objects (all blank on HRDMO) |

## Definition tab

One row per `PSPNLGROUP` item in `SUBITEMNUM` order: Page Name, Item Name,
Hidden, Item Label, Folder Tab Label. **Allow Deferred Processing** is not a
`PSPNLGROUP` column: it is the page's own `PSPNLDEFN.DEFERPROC`, which matches
App Designer's grid for all twelve JOB_DATA pages.

A row's right-click menu is App Designer's: **View Definition** (also a
double-click) opens the page, **Component Properties** shows the sidebar.
**Cut**, **Copy**, **Paste** and **Delete** are shown disabled until the
component save is captured. (Register Component is not offered.)

## View PeopleCode

App Designer's View > View PeopleCode: the **View PeopleCode** button in the
panel's header, a right-click on the component or a record in the Structure
tab, or *View PeopleCode* on a component in the Definition Browser or a
project. The first step lists the objects -- the component, every record in
the buffer, and each field with component PeopleCode -- marking those with a
program; the second lists the object's events in App Designer's order,
marking those with a program (App Designer's bold), and for a record its
fields with PeopleCode. The program opens as text, read-only:

| Object | Events | Key (`PSPCMPROG` values) |
|---|---|---|
| Component | PostBuild, PreBuild, SavePostChange, SavePreChange, Workflow | component, market, event (`OBJECTID` 10 / 39 / 12) |
| Component record | RowInit, RowInsert, RowDelete, RowSelect, SaveEdit, SavePostChange, SavePreChange, SearchInit, SearchSave | component, market, record, event (10 / 39 / 1 / 12) |
| Component record field | FieldChange, FieldDefault, FieldEdit, PrePopup | component, market, record, field, event (10 / 39 / 1 / 2 / 12) |

These are App Designer's lists and every event HRDMO's component programs
use. Checked against JOB_DATA.GBL: PostBuild, DERIVED_GL RowInit and
DERIVED_GL.GL_DEL_COMBO_PB FieldChange open with App Designer's text.

## Structure tab

The component buffer, built from the pages' `PSPNLFIELD` rows
(`src/model/componentStructure.ts`). For JOB_DATA it gives every record and
scroll App Designer shows, in its order: the search record, the 25 level-0
records, the level-1 scrolls with their records, and the level-2 and level-3
scrolls. The rules, each needed for that match:

- The component's pages in `SUBITEMNUM` order, each page's controls by
  `FIELDNUM`. A subpage (`FIELDTYPE` 11) or secondary page (18) is walked in
  place, its levels offset by the control's `OCCURSLEVEL`.
- A Scroll Bar (10), Grid (19) or Scroll Area (27) starts a scroll at its
  level; the fields after it at that level belong to it. Its primary record is
  the record the control names, else its first non-Derived/Work record.
- Related-display fields (`FIELDUSE` 0x10) are not in the buffer (PERSON,
  PERSON_NAME and the description views are not listed).
- A subpage control naming a record substitutes it for the record the
  subpage is built on, when the named record is not Derived/Work
  (PER_ORG_ASGN_VW -> PER_ORG_ASGN), or when the subpage is built on a
  subrecord (EXCH_RT_WSBR -> EXCH_RT_WRK). A subpage placed on a derived
  record is not substituted (EMPL_MYS_SBP on DERIVED_HR keeps PER_ORG_ASG_FA).
- Scrolls under one parent with the same primary record are one scroll.
- A subpage placed on a non-derived record whose fields are on the subpage's
  own level goes, with that level, to the scroll that record is primary of:
  JOB_JR's subpages placed in a JOB scroll are in the JOB_JR scroll (level 2).
- Records are listed in the order their fields first appear.

The lightning mark is on records with record-level component PeopleCode
(`PSPCMPROG` `OBJECTID1` 10, `OBJECTID3` 1, `OBJECTID4` 12: JOB and DERIVED_GL
on JOB_DATA, as App Designer marks them) and on the component when it has
component PeopleCode (`OBJECTID3` 12: PreBuild, SavePreChange ...).

## Component Properties

| Dialog | Column | JOB_DATA |
|---|---|---|
| General: Description, Comments, Owner Id, Last Updated | `DESCR`, `DESCRLONG`, `OBJECTOWNERID`, `LASTUPDDTTM` / `LASTUPDOPRID` | Job Data, HCR, 03/05/21 9:27:17AM PPLSOFT |
| Use: Search record | `SEARCHRECNAME` | EMPLMT_SRCH_ALL |
| Use: Add search record | `ADDSRCHRECNAME`, shown blank when it is the search record | blank (stored EMPLMT_SRCH_ALL) |
| Use: Force Search Processing | `FORCESEARCH` | off |
| Use: Detail page | `SEARCHPNLNAME` | PERSONAL_DATA1 |
| Use: Context search record | `PSPNLGRPDEFNEXT.PTCTXSEARCHRECNAME` | blank |
| Use: Actions | `ACTIONS` bits 1 Add, 2 Update/Display, 4 Update/Display All, 8 Correction | 14 |
| Use: Disable Saving Page, Include in Navigation | `DISABLESAVE`, `INCLNAVIGATION` | off, on |
| Use: Component Build / Save | `LOADLOC` / `SAVELOC`: 0 Default (application server) | 0, 0 |
| Internet: Primary Action | `PRIMARYACTION`: 1 Search | 1 |
| Internet: Default Search Action | `DFLTACTION`: 1 Update/Display | 1 |
| Internet: Default Search/Lookup Type | `DFLTSRCHTYPE`: 1 Advanced | 1 |
| Internet: Allow Action Mode Selection | `ALLOWACTMODESEL` | on |
| Internet: link and text messages | `ADDLINKMSGSET/NUM`, `SRCHLINKMSGSET/NUM`, `SRCHTEXTMSGSET/NUM`; ext `PTRTSRCHLINKMSG*`, `PTKEYWDSRCHMSG*` | 124/62, 124/63, 124/50; real-time and keyword stored 0/0, shown 124/63 and 124/433 |
| Internet: Processing Mode, Allow Expert Entry, WSRP Compliant | `DEFERPROC`, `EXPENTRYPROC`, `WSRPCOMPLIANT` | Deferred, off, off |
| Internet: Disable Toolbar | `SHOWTBAR` = 0 | 1 (toolbar shown) |
| Fluid: Fluid Mode, Layout Only, Small Form Factor, Component Type | `FLUIDMODE`, `LAYOUTMODE`, `SMALLFFOPT`, `COMP_TYPE` 0 Standard | off, off, off, Standard |

Shown as stored until decoded: `TBARBTNS` (130019, = 0x1FBE3: 13 bits set,
as 13 toolbar boxes are checked), `PNLNAVFLAGS` (11: multi-page navigation
and page bar), `PNLGRPUSE` (1). Codes other than those above (another
`LOADLOC`, `PRIMARYACTION` ...) are shown as their number. The Style tab's
objects are not read yet.

## Editing (proven)

On a Writable connection with an Operator ID, for a component in the write
scope, the panel is an editor: Item Label, Folder Tab Label and Hidden in the
grid; drag a row, or Cut / Copy / Paste / Delete it; **Insert Page...**
(App Designer's Insert > Page into Component: a page that exists and is not
in the component yet, labelled as App Designer labels it -- its name in title
case); General (Description, Comments) and Use (search record, add search
record, Force Search Processing, detail page, Actions, Disable Saving Page,
Include in Navigation); **Save**.

**A component without a search record is never saved.** The panel refuses
("Add a search record (Component Properties > Use) before saving") and the
writer refuses again before anything is written (`componentSaveRefusal`).

The save (`src/providers/componentWriter.ts`), reproduced from nine
controlled App Designer saves of `ZZ_PCODE_LAB_CMP` (results/c01-c08b, all
bracketed afterwards by SCN with `snapshot.ts --as-of scn:NNN`):

| Case | App Designer wrote |
|---|---|
| c01-create | `PSPNLGRPDEFN` default row (DFLTSRCHTYPE 0, PNLNAVFLAGS 3, TBARBTNS 29225763, PNLGRPUSE 0, ADDSRCHRECNAME = the search record, DESCRLONG NULL; no `PSPNLGRPDEFNEXT` row); `PSPNLGROUP` item, ITEMLABEL "Zz Pcode Lab Pg" |
| c02-insert-page | `PSPNLGROUP` item 2 ("Zz Pcode Lab Pg2") |
| c03-item-label | ITEMLABEL, FOLDERTABLABEL |
| c04-hidden | HIDDEN 0 -> 1 |
| c05-reorder | SUBITEMNUM 1 <-> 2 |
| c06-delete-page | the row removed; the survivor renumbered 1 |
| c07-general | DESCR, DESCRLONG |
| c08a-use-add | ACTIONS 2 -> 3, and TBARBTNS + 0x10 (the Add toolbar button) |
| c08b-use-disable-save | DISABLESAVE 0 -> 1, and TBARBTNS - 0x1 (the Save toolbar button) |

Every save: `PSVERSION` / `PSLOCK` 'PGM' + 1 (`PSPNLGRPDEFN.VERSION` = the
new value), `PSVERSION` 'SYS' + 1, `LASTUPDDTTM` / `LASTUPDOPRID`; a save of
an existing component also `PSVERSION` / `PSLOCK` 'MDM' + 1 (not on create).
`PSPNLGROUP` is unique on (component, market, page): a page is in a component
once. App Designer deletes and re-inserts the rows; the writer updates in
place and leaves the same rows. `src/test/componentWriter.test.ts` replays
all nine saves through the writer's plan.

Proven live: `w01-writer-insert-page` (the writer's insert of
ZZ_PCODE_LAB_PG2, identical to c02: same counters, same row) and
`w02-writer-ui-edit` (the panel's own save payload: reorder, label, Hidden,
Comments). A save without a search record was refused live. App Designer (8.62.09) opens ZZ_PCODE_LAB_CMP cleanly
after both writer saves (checked by hand, 2026-10-10).

Creating a component from PeopleSoft Studio has no UI yet (the writer supports it from c01).

## Internet, Fluid and Style tabs (decoded)

Decoded from one App Designer save per control on ZZ_PCODE_LAB_CMP, each
bracketed by its commit SCN (results/i336-i372, x373-x377, f378-f387,
h388-h398, s399-s406), and checked against JOB_DATA's dialog: its 13 checked
toolbar boxes are TBARBTNS 0x1FBE3's 13 bits. `src/model/componentFlags.ts`
holds the map; `src/test/componentWriter.test.ts` replays all 70 saves
through the writer.

| Setting | Stored as |
|---|---|
| Primary Action | `PRIMARYACTION` 0 New, 1 Search |
| Default Search/Lookup Type | `DFLTSRCHTYPE` 0 Basic, 1 Advanced |
| Allow Action Mode Selection, Allow Expert Entry, WSRP Compliant | `ALLOWACTMODESEL`, `EXPENTRYPROC`, `WSRPCOMPLIANT` |
| Processing Mode | `DEFERPROC` 1 Deferred, 0 Interactive |
| Toolbar: Save, Return to List, Next / Previous Page in Component | `TBARBTNS` 0x1, 0x2, 0x4, 0x8 (Save is shown unchecked while Disable Saving Page is on, and the next save clears its bit) |
| Toolbar: Add, Update/Display, Update/Display All, Correction | 0x10, 0x20, 0x40, 0x80 (the action bit x 16; an action brings its button) |
| Toolbar: Next / Previous in List, Refresh | 0x100, 0x200, 0x800 (Allow Expert Entry turns Refresh on and greys it) |
| Toolbar: View / Next / Previous in WorkList, Notify | 0x1000, 0x2000, 0x4000, 0x8000 |
| Toolbar: Cancel, Spell Check, Hide Back Button | 0x10000, 0x20000, 0x10000000 |
| Page Navigation in History / Return to Last Page in History | `TBARBTNS` 0x4000000 / 0x20000000 (the Internet and Fluid tabs share them; Return checks Page Navigation) |
| Header Toolbar Actions: Home, Logout, Back, NavBar, Notifications, Add To | `TBARBTNS` 0x40000, 0x80000, 0x100000, 0x200000, 0x800000, 0x1000000 |
| Display Folder Tabs (top) / Display Hyperlinks (bottom) | `PNLNAVFLAGS` 0x1 / 0x2 |
| Disable Toolbar = Disable All Actions | `SHOWTBAR` 0x1 clear |
| Disable Pagebar | `SHOWTBAR` 0x2 |
| Pagebar Help / Copy URL / New Window / Customize Page Link | `SHOWTBAR` hide bits 0x4 / 0x8 / 0x10 / 0x20 (Help and New Window are also the Fluid header's Help and New Window) |
| Fluid Mode, Layout Only, Small Form Factor | `FLUIDMODE`, `LAYOUTMODE`, `SMALLFFOPT` |
| No System Header Page / No System Side Page | `INCHEADER` / `INCSIDE` 1 |
| Component Type | `COMP_TYPE` 0 Standard, 2 Master/Detail |
| Search Page Type | `INCSEARCH` 0 None, 1 Standard, 2 Master/Detail |
| Enable Configurable Search, header Notify | `PSPNLGRPDEFNEXT.PTS_ENABLECONFSRCH`, `PTENABLENOTIFY` (both cleared when Fluid Mode is turned off, s399) |
| Classic Plus | `PNLGRPUSE` 0x1 |
| Component Style Sheet / JavaScript Objects | `PSPNLGRPSCRIPTS`: PTSCRIPTTYPE `CSS` (freeform style sheets) / `JS` (HTML definitions), PTSCRIPTCATG `DEV`, SEQNO 0, 10, 20 ... per type in list order |

The first edit that needs `PSPNLGRPDEFNEXT` creates App Designer's row for it
(blanks and zeros, i340). The Style tab is shown only when Fluid Mode is off,
as in App Designer. Not edited: Default Search Action, the link / message
numbers, the Custom style lists (no evidence of how they are added).

Proven live: `w03-writer-ui-tabs`, the panel's own payload toggling
controls on all three tabs: exactly the bits and rows planned.

