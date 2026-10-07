# Saving a style sheet

How App Designer stores a style sheet, decoded from controlled saves on
HRDMO (PeopleTools 8.62.09), and what `src/providers/styleSheetWriter.ts`
writes. Snapshots: `tools/corpus/save-protocol/results/s*` (App Designer)
and `x10` (the writer).

## Storage

Every style sheet has a `PSSTYLSHEETDEFN` row; `STYLESHEETTYPE` says which
kind (HRDMO: 603):

| Type | Kind | Count | Stored as |
|---|---|---|---|
| 0 | Style Sheet | 53 | style classes (`PSSTYLECLASS`, 118 attribute columns each) |
| 1 | Sub Style Sheet | 39 | style classes |
| 2 | Freeform Style Sheet | 510 | text: `PSCONTDEFN` `CONTTYPE` 9 and `PSCONTENT`, stored exactly as HTML definitions are (docs/HTML_SAVE.md): UTF-16LE, CRLF, NUL-terminated, 32,000-byte chunks |

The 510 freeform style sheets are exactly the 510 `CONTTYPE` 9 rows; none
has style classes or a parent. A `PSSTYLECLASS` row with `SUBSTYLESHEET` 1
names an included sub style sheet rather than a class (270 of 3,490). In a
project a style sheet is `OBJECTTYPE` 50, `OBJECTID1` 94 (295 on HRDMO).

The description is `PSSTYLSHEETDEFN.DESCR`; the `PSCONTDEFN` row's stays
blank (s03).

## Cases

| Case | Change | What App Designer wrote |
|---|---|---|
| s01 | ZZ_PCODE_LAB_CSS created, freeform | `PSSTYLSHEETDEFN` inserted (type 2, VERSION = new SSM 55, blanks); `PSCONTDEFN` inserted (CONTTYPE 9, the HTML defaults, VERSION 11 = CRM + 1); `PSCONTENT` one row; PSVERSION SSM, SYS + 1, PSLOCK SSM + 1. **CRM did not move** |
| s02 | a value changed | all three deleted and reinserted: `PSSTYLSHEETDEFN` VERSION = new SSM (56), `PSCONTDEFN` VERSION 11 -> 12 (its own + 1), text replaced; the same counters |
| s03 | description "ZZ Lab Stylesheet" | as s02, `PSSTYLSHEETDEFN.DESCR` set; `PSCONTDEFN` 12 -> 13 |
| s04 | ZZ_PCODE_LAB_CSS2 created, after CRM was moved to 11 by an HTML save | as s01: SSM 59; `PSCONTDEFN` VERSION **14**, not CRM + 1 (12) |

`PSCONTDEFN.VERSION` follows a counter App Designer keeps for the session:
it read CRM (10) once and used 11, 12, 13, 14 for its four content saves,
never writing CRM back, so the HTML save that moved CRM in between went
unseen. Nothing in the database reproduces that number. The version only
tells caches that the content changed, so the writer uses the readings the
database supports, which always increase: CRM + 1 on create, the row's own
+ 1 on a save.

App Designer stamps `PSSTYLSHEETDEFN` and `PSCONTDEFN` separately, some
microseconds apart; the writer stamps both with one timestamp.

## The writer

`saveStyleSheet` creates (no opened version) or saves (the version it was
opened at) a scratch (`ZZ_PCODE_LAB%`) freeform style sheet:

- create: `PSSTYLSHEETDEFN` (type 2, VERSION = new SSM) and `PSCONTDEFN`
  (CONTTYPE 9, VERSION = CRM + 1, CRM unchanged) inserted, the text inserted
- save: both rows' VERSION and stamp updated in place (SSM; content + 1),
  the text replaced
- PSVERSION SSM, SYS + 1; PSLOCK SSM + 1; verified in the transaction and
  again after COMMIT (CRM checked unchanged)

Direct cases x10 (an edit of ZZ_PCODE_LAB_CSS) and x11 (ZZ_PCODE_LAB_CSS3
created) wrote s02's and s01 / s04's rows and counters.

Refused: names outside the scratch scope; an existing name, or leftover
rows (including a `PSSTYLSHEETDEL` marker), on create; a classic or sub
style sheet; style classes or language rows; the text cases HTML refuses.

In VS Code: Style Sheets are a type in the Open Definition dialog, with a
Properties panel and Insert Into Project. A freeform style sheet opens as
CSS and saves with Ctrl+S on a Writable connection; *PeopleSoft: New Style
Sheet...* opens an empty editor that the first save creates. A classic or
sub style sheet opens read-only as a summary of its classes and sub style
sheets. Changing the description is not offered yet.
