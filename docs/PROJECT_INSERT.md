# Saving a project

What a project save writes (*Insert Into Project...* is a save that adds
one item), and the evidence for it. HRDMO,
PeopleTools 8.62.09, `ZZ_PCODE_LAB_01`, snapshots by
`tools/corpus/save-protocol/snapshot.ts` (results under
`tools/corpus/save-protocol/results/p*`).

## The transaction

Case **p01** — App Designer: open field `ZZ_PCODE_LAB_C02`, *Insert Current
Definition into Project* (F7), save the project. Every PeopleTools table was
swept; only these rows changed:

| Table | Change |
|---|---|
| `PSPROJECTITEM` | one row inserted; the project's other items untouched |
| `PSPROJECTDEFN` | `VERSION` = new `PSVERSION.PJM`, `LASTUPDDTTM` = save time, `LASTUPDOPRID` = operator (App Designer deletes and reinserts the row; every other column is unchanged) |
| `PSVERSION` | `PJM` + 1, `SYS` + 1 |
| `PSLOCK` | `PJM` + 1 |

The inserted item: `OBJECTTYPE 2`, `OBJECTID1 6` / `OBJECTVALUE1 ZZ_PCODE_LAB_C02`,
other slots `0` / `' '`, `NODETYPE 0`, `SOURCESTATUS 0`, `TARGETSTATUS 0`,
`UPGRADEACTION 0`, `TAKEACTION 1`, `COPYDONE 0`.

Case **p02** — the writer (`src/providers/projectWriter.ts`, through
`tools/corpus/save-protocol/direct-insert.ts`) inserting field
`ZZ_PCODE_LAB_C03`: the same item row, the same project-row values and
counter moves, nothing else changed. It updates the project row in place
rather than deleting and reinserting it; the stored row is the same.

The writer runs in one transaction: lock the project row; check the
operator (`PSOPRDEFN`), that the definition exists, and that the item is
not already in the project (`PS_PSPROJECTITEM` is unique on the project,
`OBJECTTYPE` and the `OBJECTVALUE`s); lock the counters; take one database
timestamp; write; re-read and verify; commit; verify again on another
connection. Any refusal writes nothing.

## Item layouts

`OBJECTTYPE` and the `OBJECTID` of each key slot belong to the project item
layout, not to the definition (a field is `OBJECTID 6` here, `2` in a
PeopleCode key). Each layout used is one HRDMO's delivered project items use:

| Definition | OBJECTTYPE | OBJECTIDs | Values |
|---|---|---|---|
| Record | 0 | 1 | RECNAME |
| Field | 2 | 6 | FIELDNAME |
| Page | 5 | 9 | PNLNAME |
| Menu | 6 | 3 | MENUNAME |
| Component | 7 | 10, 39 | PNLGRPNAME, MARKET |
| Record PeopleCode | 8 | 1, 2, 12 | RECNAME, FIELDNAME, event |
| SQL definition | 30 | 65, 81 | SQLID, SQLTYPE (0) |
| App Engine program | 33 | 66 | AE_APPLID |
| HTML definition | 51 | 90, 95 | CONTNAME, CONTTYPE |
| Application Package | 57 | 104, 116, 117 | PACKAGEID, PACKAGEROOT, QUALIFYPATH |
| Application Class | 58 | 104, (105, 106,) 107 | root, sub-packages, class (no event) |

Other types are refused. HRDMO's `PSPROJECTITEM` has four key slots; a key
needing more is refused.

## Scope

Any project, on a connection whose Access is **Writable**, recorded under
its **Operator ID**. The row is fixed by the definition's key; there is no
source to reproduce.

## Project save

`saveProject` (`src/providers/projectWriter.ts`) applies a change set to one
project in one transaction and stamps the project once, however many
changes it carries. A request may present the project `VERSION` its changes
were made against (`openedVersion`); if the project was saved since, in
App Designer or here, the save is refused and nothing is written (checked
on HRDMO: a save presenting version 41 against version 44 was refused).

| Change | Status |
|---|---|
| Add items | Proven: p01 (App Designer), p02 (writer) |
| Save with no changes | Proven: p03 — App Designer's Save Project with nothing changed writes nothing (no project row, item or counter moved); the writer refuses an empty save |
| Remove items | Needs a case: remove an item in App Designer, save the project |
| Project properties (description, comments) | Needs a case: edit them, save |
| Create a project | Needs a case: new project, insert one definition, save |

A change without a case is refused before anything is read for writing.
