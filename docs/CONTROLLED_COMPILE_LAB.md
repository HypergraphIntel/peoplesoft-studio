# Controlled-compile lab (specification)

Cycle 171. What a writable PeopleTools environment must provide to settle
the encoder's last source-indistinguishable cases, and the exact
experiments to run there. Nothing here has been run: no writable
environment exists today (HCDEV is read-only; HCTST refuses the HCDEV
credentials; there is no scratch database).

## Milestone this lab follows

**CORPUS_RECOVERABLE_FRONTIER_CLOSED** (Cycle 171): against the HCDEV
corpus (30,209 programs, PeopleTools 8.61.15) the encoder is EXACT on
30,131. The 78 that are not:

| Class | Count | Programs |
|---|---:|---|
| Lossy source (HCDEV `PSPCMTXT.PCTEXT` holds 0xBF for characters outside WE8ISO8859P15; the compiled program has the real text) | 71 | DECODE_SOURCE_MISMATCH |
| Historical compiler variant (per-method row reopening, no source discriminator) | 4 | 29797 29883 30170 30179 |
| Needs a controlled compile (no corpus sibling, no decisive native path) | 3 | 30124 10860 15598 |

This does not claim compiler equivalence. It means the corpus, the
captured App Class metadata and static analysis of the PeopleTools
binaries justify no further production rule; the remaining three need
compiled experiments.

## Environment

Ranked:

1. A personal PeopleSoft lab (PUM image or DPK install) with a writable
   database.
2. A dedicated scratch database (Oracle, non-Unicode WE8ISO8859P15 to
   match HCDEV) built from the 8.61.15 DPK.
3. An authorized scratch namespace in a non-production environment.
4. HCTST only with explicit write authorization.

HCDEV stays read-only.

Requirements:

- **PeopleTools 8.61.15** (HCDEV's patch: `PSSTATUS.PTPATCHREL = 15`).
  8.61.07 is acceptable for structural comparison only; differences from
  HCDEV stored output are not authoritative for patch 15.
  - Available locally: the 8.61.15 DPK
    (`/mnt/ou_network/peoplesoft_dev/ps86115/dpk/archives/pt-pshome8.61.15.tgz`,
    `pt-oracleclient-19.3.0.0.tgz`) and the full Windows infrastructure
    DPK (`PT-INFRA-DPK-WIN-8.61-260617_{1,2}of2.zip`); an installed
    8.61.07 client in a Wine bottle
    (`~/.local/share/wine-bottles/peopletools/drive_c/PT8.61.07_Client_ORA`).
- **Application Designer 8.61.15** (`pside.exe`, sha256 `e1d1b610…`), on a
  **Windows** host (Wine is untested for saving PeopleCode).
- **Database connectivity:** two-tier (Oracle client 19c) to the scratch
  database; a three-tier connection also works for App Designer.
- **Operator:** a developer operator id with Application Designer access
  and the right to create / save / delete Application Packages and
  Record PeopleCode in a scratch project.
- **Read access** for the capture tooling: `SYSADM.PSPCMPROG`,
  `PSPCMNAME`, `PSPCMTXT`, `PSPACKAGEDEFN`, `PSSTATUS` (the corpus
  tooling's existing read-only queries).

## Scratch naming

- Application Packages: `ZZ_PCODE_LAB` (root), classes `ZZ_PCODE_LAB:<Case>`.
- Record PeopleCode: a scratch record `ZZ_PCODE_LAB` with fields
  `ZZ_CASE_01 ...`, FieldFormula event.
- One project `ZZ_PCODE_LAB` holding every object, deleted after capture.
- Never reuse an existing application definition.

For each case: create, save (compile), capture PSPCMPROG + PSPCMNAME +
PSPCMTXT by key, decode with this repository's decoder, then delete.

## Experiments

Each matrix varies one condition at a time. The discriminating
observation is named per row.

### 30124 -- `Local A &x = create B(...)` row order

Stored 30124 opens A's row before B's; 28754 the opposite. Base, in an App
Class method body: `Local PKG:A &x = create PKG:B();` (B extends A).

| Case | Variation | Observe |
|---|---|---|
| H1 | base, A and B named-imported, neither used before | PACKAGE row order A / B |
| H2 | H1 with A used earlier in the method | order |
| H3 | H1 with B used earlier in the method | order |
| H4 | A declared in the class header (instance) | order |
| H5 | B declared in the class header | order |
| H6 | wildcard import of the package instead of named | order |
| H7 | A and B in different packages | order |
| H8 | constructor with arguments | order |
| H9 | statement in the leading unit vs after an executable statement | order |

### 10860 / 15598 -- members after GetRow / GetRecord in a Function

10860 writes no RECORD / FIELD rows where the encoder expects them;
15598 keeps a member inline where 10860's shape suggests a FIELD row.
Ordinary program, Record PeopleCode:

| Case | Variation | Observe |
|---|---|---|
| G1 | `Function F1` declares `Local Rowset &x`; `Function F2` uses `&x.GetRow(1).REC.FIELD.Value` | RECORD / FIELD rows vs inline names in F2 |
| G2 | G1, but F1 assigns `&x` without declaring it | same |
| G3 | G1, F2 redeclares `Local Rowset &x` | same |
| G4 | `&x.GetRecord(1).FIELD` instead of GetRow | FIELD row vs inline |
| G5 | `&x.GetRow(1).GetRecord(1).FIELD` | same |
| G6 | root never declared anywhere (late bound) | same |
| G7 | `Local Rowset &x = GetLevel0()(1).GetRowset(Scroll.X)` | same |

The pair separates name-existence lifetime, declared-type lifetime and
chain-derived type.

### Confirmations of Cycle 171 rules (optional)

| Case | Source | Expected (rule) |
|---|---|---|
| C1 | Function `Returns PKG:Cls`, blank line, `Local` | `2D 4F 44` |
| C2 | as C1 with `Returns string` | `2D 4F 44` |
| C3 | interface ending `end-interface` at EOF | `71 07`, self-only directory, slots kept |
| C4 | as C3 with `end-interface;` | `71 15 2D 07`, method record present |
| C5 | App Designer refuses to save C3 | the shape is historical-only |
