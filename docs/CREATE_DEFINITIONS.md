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
them); the other limits are HRDMO's longest (Character 256, Long Character
32,767, Number 32, Signed Number 33). `fieldWriter.ts`; direct case x14
(ZZ_PCODE_LAB_C09) wrote c01's rows and counters.

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
| counters | PSVERSION PCM, APM + 1, **SYS + 2**; PSLOCK PCM, APM + 1 |

App Designer stored the source with a signature comment it adds itself
(`/+ Returns String +/` after `method Greet`), and compiled that: 242
bytes against 211 for the source as typed. Our compiler re-encodes its
stored program exactly. The writer compiles what is in the editor and adds
no comments, as it does when saving an existing class; App Designer adds
them the next time it saves the class. Direct case x17 created
ZZ_PCODE_LAB_PK3:Hello from App Designer's stored source: the same rows,
counters and `HASH_SIGNATURE`, and a program identical but for the package
name it embeds (`ZZ_PCODE_LAB_PK3:Hello`).

Scope: a class directly in a root package; subpackages are not created
here yet.

## In VS Code

*New Definition...* (Projects and Definition Browser): Field asks for the
type, name, length (and decimals) and label and creates it at once;
Project creates the empty project and opens it in Projects; Application
Package creates the package and offers to add a class; Application Class
opens the class's declaration, and the first save creates it.
