# Creating definitions

What App Designer's first save of a new definition writes, decoded from
controlled saves on HRDMO (PeopleTools 8.62.09), and what *New
Definition...* writes. Snapshots: `tools/corpus/save-protocol/results/c*`
(App Designer) and `x14`-`x17` (the writers). Records, SQL, HTML and style
sheets are in docs/RECORD_SAVE.md, docs/HTML_SAVE.md and
docs/STYLESHEET_SAVE.md.

Every create is limited to scratch names (`ZZ_PCODE_LAB%`) on a Writable
connection with an Operator ID, refuses a name already in use, and is
verified before COMMIT.

## Field (c01, ZZ_PCODE_LAB_C08)

| Table | Row |
|---|---|
| `PSDBFIELD` | VERSION = new RDM; FIELDTYPE, LENGTH, DECIMALPOS; FORMAT 0, DEFCNTRYYR 50, the other columns 0 / blank, no DESCRLONG |
| `PSDBFLDLABL` | the label, DEFAULT_LABEL 1 |
| counters | PSVERSION RDM, SYS + 1; PSLOCK RDM + 1 |

FORMAT 0 and DEFCNTRYYR 50 are every field type's most common values on
HRDMO. Date, Time and DateTime have fixed lengths (10, 15, 26: all of
them), Image Reference 30 (368 of 373, IMAGE_FMT 0: ZZ_PCODE_LAB_IR, created
so, matches them column for column); Image fields vary in IMAGE_FMT and
length and are not created yet; the other limits are HRDMO's longest (Character 256, Long Character
32,767, Number 32, Signed Number 33). `fieldWriter.ts`; direct case x14
(ZZ_PCODE_LAB_C09) wrote c01's rows and counters.

### Saving a field (f02-f06, ZZ_FIELD_1)

Retroactive captures of App Designer's field saves:

| Case | Change | What App Designer wrote |
|---|---|---|
| f02 | length 1 -> 5 | `PSDBFIELD` rewritten, VERSION = new RDM, restamped; the labels rewritten unchanged |
| f03 | a second label, then it made the default (two saves) | `PSDBFLDLABL` row added; `DEFAULT_LABEL` moved; `PSDBFIELD` VERSION / stamp each time |
| f04 | Description | `PSDBFIELD.DESCRLONG` |
| f06 | length 5 -> 50, the field in ZZ_FIELD_REC | as f02, and **ZZ_FIELD_REC's VERSION = the new RDM, not restamped** |

Every field save moved PSVERSION RDM, **PDM** and SYS by one, and PSLOCK
RDM and PDM. (f01, a create, also wrote a `PSXLATDEFNDEL` row and moved
XTM; c01 did neither, so the create here keeps c01's rows.)

`saveField` (`fieldWriter.ts`) does these in one transaction: `PSDBFIELD`
(length, decimals, description, version, stamp), the labels as edited
(exactly one default; a label a record field uses is kept), the records
holding the field at the new RDM, and the counters. Refused: fields outside
`ZZ_PCODE_LAB%`, a change of type, a field held through a subrecord or by a
non-scratch record. The Field editor offers Change Length, Add Label, Edit
Label, Set Default Label and Change Description on Writable connections,
each saved at once.

## Project (c02, ZZ_PCODE_LAB_02)

One `PSPROJECTDEFN` row: VERSION = new PJM, KEEPTGT 31, COMPARETYPE 1,
COMMITLIMIT 50, REPORTFILTER 16232832, the rest blank / 0 / null (the 7
projects created in App Designer on HRDMO agree; delivered ones carry
their import settings). PSVERSION PJM, SYS + 1; PSLOCK PJM + 1.
`projectWriter.ts createProject`; direct case x15 (ZZ_PCODE_LAB_03) wrote
c02's row and counters. Items are then added with Insert Into Project.

## Application Package (c03, ZZ_PCODE_LAB_PK2)

One `PSPACKAGEDEFN` row: PACKAGEID = PACKAGEROOT = the name, QUALIFYPATH
'.', PACKAGELEVEL 0, blanks, VERSION = new APM. PSVERSION APM, SYS + 1;
PSLOCK APM + 1. `packageWriter.ts`; direct case x16 (ZZ_PCODE_LAB_PK3).

## Application Class (c04, ZZ_PCODE_LAB_PK2:Hello)

| Table | Row |
|---|---|
| `PSAPPCLASSDEFN` | APPCLASSID, PACKAGEROOT, QUALIFYPATH ':', APPCLASSREF / DESCR ' ' |
| `PSPACKAGEDEFN` | the root package rewritten, VERSION = new APM, restamped |
| `PSPCMPROG` / `PSPCMNAME` / `PSPCMTXT` | the program, as any PeopleCode save writes it (key 104 / 107 / 12, OnExecute) |
| counters | PSVERSION PCM, APM + 1, SYS + 1 per transaction; PSLOCK PCM, APM + 1 |

App Designer stored the source with a signature comment it adds itself
(`/+ Returns String +/` after `method Greet`), and compiled that: 242
bytes against 211 for the source as typed. Our compiler re-encodes its
stored program exactly. The writer compiles what is in the editor and adds
no comments, as it does when saving an existing class; App Designer adds
them the next time it saves the class. Direct case x17 created
ZZ_PCODE_LAB_PK3:Hello from App Designer's stored source: the same rows,
counters and `HASH_SIGNATURE`, and a program identical but for the package
name it embeds (`ZZ_PCODE_LAB_PK3:Hello`).

c04's SYS moved by 2 because it was two saves (the package at 10:17:50,
the program at 10:17:55); one transaction moves it once (c05, c06).

## A class in a subpackage (c05, c06; ZZ_PCODE_LAB_PK2:SUB1)

| Case | Change | What App Designer wrote |
|---|---|---|
| c05 | subpackage SUB1 and its class Inner, one save | `PSPACKAGEDEFN` SUB1 inserted (PACKAGELEVEL 1, QUALIFYPATH ':', VERSION = new APM); the root row rewritten with the same VERSION; `PSAPPCLASSDEFN` Inner (QUALIFYPATH 'SUB1'); the program keyed 104 / 105 / 107 / 12; APM, PCM, SYS + 1 |
| c06 | class Second in SUB1 | **every** package row of the root (root and SUB1) rewritten with VERSION = new APM, restamped; `PSAPPCLASSDEFN` Second; the program; APM, PCM, SYS + 1 |

App Designer also deletes and reinserts the package's other class rows
unchanged. Paths, as HRDMO stores them (at most two levels): a level-1
subpackage's QUALIFYPATH is ':', a level-2 one's its parent's ID
(ADS_DMW:UI:Widgets is 'UI'); a class's is ':' in the root, else the
subpackage path ('SUB1', 'UI:Widgets'); the program key adds 105 and 106
for the subpackages.

The writer creates a class at any of those paths in one transaction: the
missing subpackages, the class row, every package row of the root at the
new APM, the program. Direct cases x20 / x21 replayed c05 / c06 on
ZZ_PCODE_LAB_PK3 with App Designer's stored source: the same rows and
counters, `HASH_SIGNATURE`s equal, programs identical but for the package
name they embed. Creating a level-2 subpackage follows HRDMO's layout; no
App Designer capture has shown one yet.

## In VS Code

*New Definition...* (Projects and Definition Browser): Field asks for the
type, name, length (and decimals) and label and creates it at once;
Project creates the empty project and opens it in Projects; Application
Package creates the package and offers to add a class; Application Class
opens the class's declaration, and the first save creates it.
