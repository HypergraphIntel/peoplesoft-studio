# Menus

How a menu is stored and how App Designer's Menu Designer saves it,
PeopleTools 8.62.09 on HRDMO. Every rule below was proven by a controlled
App Designer save driven on the lab VM and bracketed by before / after reads
(`tools/lab/def-capture.mts`, or the full sweep `tools/corpus/save-protocol/snapshot.ts`
for renames and deletes); the case is in brackets, its rows in
`tools/corpus/save-protocol/results/<case>`. The Menu Designer
(`src/editors/menuDesignerPanel.ts`), the MCP's `psft_menu_*` tools and the
writer (`src/providers/menuWriter.ts`) implement them.

## Tables

| Table | Key | Holds |
|---|---|---|
| PSMENUDEFN | MENUNAME | The menu: VERSION (= PSVERSION MDM at its last save), MENUGROUP, INSTALLED, GROUPORDER, MENUORDER, GROUPSEP, MENUSEP, MENULABEL, MENUTYPE (0 Standard, 1 Popup), DESCR, OBJECTOWNERID, LASTUPDDTTM / OPRID, DESCRLONG (Comments, CLOB; NULL when empty) |
| PSMENUITEM | MENUNAME, BARNAME, ITEMNAME | One row per item: ITEMNUM (1..n across the **whole menu**, bars in order), ITEMTYPE (5 Component, 8 Separator, 9 PeopleCode, 12 Transfer), PNLGRPNAME / MARKET (the component, or a PeopleCode item's enabling component), BARLABEL (repeated on every item of the bar), ITEMLABEL, XFERCOUNT (1 on a transfer), SEARCHRECNAME (Search Rec Override) |
| PSXFERITEM | MENUNAME, ITEMNAME | A popup's transfer: XFERTYPE (1 new window), KEYSEARCH (use data from current page), XFERPORTALNAME (blank: Use Current), XFERNODENAME (blank: LOCAL), XFERMENUNAME, XFERPNLGRPNAME, XFERMKTNAME, XFERPNLITEMNAME, XFERACTION (0 Add, 1 Update/Display, 2 Update/Display All, 3 Correction -- the bit's position in PSPNLGRPDEFN.ACTIONS) |
| PSMENUORIGIN | MENUNAME, PTORIGINTYPE, PTORIGINNAME | C: copied from (Save As); R: renamed from (Rename, when the menu has no origin yet) |
| PSMENUDEL | MENUNAME, VERSION | Delete marker (at the new MDM) of a deleted or renamed-away menu; removed when the name is created again [mn19] |
| PSMENUDEFNLANG, PSMENUITEMLANG | + LANGUAGE_CD | Translations (none on HRDMO): kept, re-keyed with their item |
| PSPCMPROG / TXT / NAME | 3 menu, 4 bar, 5 item, 12 `ItemSelected` | A PeopleCode item's program; deleted keys in PSPCMPROGDEL |

A bar exists only through its items: an empty bar is not stored and is
dropped at the save [mi14]. Bar order is the order of their first ITEMNUM.
A popup menu's items are stored under one bar named `MENUITEM1` with a blank
BARLABEL [mp01].

## App Designer's new menu

File > New > Menu asks Standard or Popup. A standard menu's MENULABEL and
MENUGROUP are its name title-cased (`ZZ_PCODE_LAB_MENU` -> `Zz Pcode Lab
Menu`), MENUORDER / GROUPORDER 9999 (Alphabetical order), separators off,
INSTALLED 1 [mn01]; a popup's label and group are blank, orders 0 [mp01].
Save is disabled until the menu has an item. Default names are `MENUITEMn`,
the smallest n free -- items counted against items, bars against bars; a
separator keeps its default name [mi04, mi05, mb01].

## Dialogs, as captured

- **Menu Properties > General**: Description [mn02], Comments [mn03], Owner ID [mn04].
- **Use**: Menu Label [mn05]; Menu Group [mn06]; Menu Order sequence /
  Alphabetical (9999) / Add separator after [mn07, mn08]; Menu Group Order and
  its separator [mn09, mn10]; Menu installed [mn11, mn21, mn22]. A popup's Use
  tab has only Menu Label [mp11].
- **Group-wide**: GROUPORDER and GROUPSEP are the group's. Saving them writes
  every standard menu of the group (`UPDATE ... WHERE MENUGROUP`), each taking
  the new MDM as VERSION, none restamped [mn13, mn14, mn20]. Choosing a group
  in the list shows its order and separator.
- **Bar Item Properties**: Name (a rename) and Label [mb02, mb05].
- **Menu Item Properties**: Name, Label, Type, Component / Market (Select...),
  Search Rec Override [mi01-mi03, mi05]. PeopleCode items of a standard menu
  need an enabling component; popup PeopleCode items have none.
- **Transfer Properties** (Define Transfer...): Portal, Node, Menu, Component,
  Market, Component Item, Action, Transfer Type, Use data [mp02-mp08]. Setting
  Portal or Node clears Menu and what follows; Menu clears Component; Component
  clears Market, page and Action; without a component the search-dialog option
  is off and greyed. App Designer saves a transfer with no menu.
- **View PeopleCode** only on PeopleCode items: `menu.bar.item.ItemSelected`
  [mi06, mb04, mp10]. The PeopleCode editor and `psft_save_peoplecode` save it
  the same way (PCM +1, SYS +1, the menu row untouched) and refuse a key that
  is not a PeopleCode item's.
- **Drag** reorders items within a bar and bars along the menu bar
  [mi07, mb06]; another bar takes **Cut** (which asks "Delete X? (40,6)") and
  **Paste** [mi14].

## App Designer's checks

- Save is refused without an item.
- "Component name is required. (43,4)": a component item, or a standard menu's
  PeopleCode item, without a component [mi05].
- "Component name X not unique. (43,5)": two component items on one component
  (a PeopleCode item may share its enabling component) [mb01].
- "Menu must be saved after a rename has taken place. Continue? (43,27)":
  renaming an item or bar saves at once [mi08, mb05].

## The save

| What | Rows | Counters |
|---|---|---|
| Create | PSMENUDEFN (VERSION new MDM), items, transfers; its PSMENUDEL removed | MDM +1, SYS +1 (PCM +1 with PeopleCode) |
| Menu properties, items, bars, transfers | Changed rows; PSMENUDEFN restamped (VERSION, LASTUPDDTTM, OPRID) | MDM +1, SYS +1 |
| Menu Group | | MDM +2, SYS +2 [mn06] |
| Group order / separator alone | Every menu of the group (VERSION only) | MDM +1 (GROUPSEP alone +2) [mn09, mn10, mn20] |
| ItemSelected PeopleCode | PSPCMPROG/TXT/NAME; the menu row untouched | PCM +1, SYS +1 [mi06] |
| An item (not a separator) or bar deleted, or an item cut | Rows deleted; PeopleCode deleted with PSPCMPROGDEL at the new PCM | CLM +1 (and PCM +1 with PeopleCode) [mi10, mi12, mb07] |
| Item or bar renamed | Re-keyed; PeopleCode moved (VERSION the PCM before the save), old key in PSPCMPROGDEL at the new PCM; permission-list items (PSAUTHITEM) renamed | MDM +2, SYS +2, CLM +2, PCM +1 [mi08, mi09, mb05] |
| File > Rename | Every row re-keyed in place, the menu row restamped; origin rows renamed, or an R row; PSXFERITEM.XFERMENUNAME repointed in every menu; PeopleCode moved (VERSION new PCM) with markers; PSMENUDEL for the old name | TSTM, ACM, CLM, MDM, PCM, PJM, SYS, TSM each +1 [mn16, mn17] |
| File > Delete | Every row; PeopleCode with markers; PSMENUDEL at the new MDM; transfers naming it left as they are | MDM, CLM, SYS +1 [mn18] |
| Save As | A copy with a C origin; App Designer asks whether to copy the PeopleCode | MDM +1, SYS +1 [mn12] |

PSLOCK takes the new PSVERSION value for every counter but SYS (App Designer
sets it, it does not add to it [mi08]).

Menu installed moved MDM by 2 or 3 in some App Designer sessions and by 1 in
another [mn11, mn15, mn21, mn22]: session noise, not data. The writer moves it
by 1. App Designer refuses its own next save of a menu whose group another
save rewrote ("updated by another user (3,1)") until it is reopened.

Permission-list items (PSAUTHITEM) follow a renamed item or bar and go with a
deleted one -- inferred from App Designer moving CLM (the permission-list
cache) on exactly those saves; the lab menus are on no permission list, so no
row was seen to move.

## Verification

- `src/test/menuWriter.test.ts`: every captured save (51) replayed through the
  planner -- rows, counters, PeopleCode bytes and versions, tombstones, the
  group's menus; a stored menu saved unchanged plans nothing.
- `src/test/menuModel.test.ts`: defaults, names, checks, transfers, specs.
- `tools/lab/menu-replay.mts`: the captures replayed live through the writer on
  scratch copies -- 52 of 55 identical to App Designer's rows
  (`results/menu-replay-report.txt`); the other three are the Menu installed
  counter noise above.
- `tools/lab/menu-e2e.mts`: the MCP's path (create from specs, edit with renames
  and Cut / Paste, copy, rename, delete, refusals) on HRDMO, 16 of 16.
- Native: App Designer opened the menu and popup the writer created, showed the
  moved PeopleCode and the transfer as written, and saved an edit of it,
  changing only the label [nme01].

## Not built

- Register Menu Item (the portal registration wizard).
- Translations (PSMENU*LANG) are kept, not edited.
