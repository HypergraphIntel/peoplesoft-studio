# App Engine definitions

How PeopleTools stores an Application Engine program, and how App Designer
writes it -- the source of truth for PeopleSoft Studio's App Engine
reader, designer, writer and MCP tools.

Evidence, in order of authority:

1. **Controlled App Designer saves** (PeopleTools 8.62.09, HRDMO, 2026-10-11):
   about 95 single-change saves of the scratch programs `ZZ_AE_LAB01..03`,
   each bracketed by before / after snapshots
   (`tools/corpus/save-protocol/results/{ae,ap,as,at,aa,ax,ao,ad,ar}*`;
   `tools/lab/ae-capture.mts` for the program's rows, `snapshot.ts` with a
   flashback sweep of every PeopleTools table for each first-of-a-kind
   operation). App Designer was driven on the lab VM.
2. **HRDMO's 2,747 delivered programs**: value censuses of every column.
3. PeopleBooks (*PeopleTools: Application Engine*) for runtime meaning
   (`docs/APP_ENGINE_SEMANTICS.md`), never for storage.

Case names in brackets below (`[ap08]`) are the captures that prove a rule.
Programs created in the lab are named `ZZ_AE_*`: App Engine names are at
most 12 characters, so the `ZZ_PCODE_LAB` scratch prefix does not fit.

## The tables

| Table | One row per | Key | Notes |
|---|---|---|---|
| `PSAEAPPLDEFN` | program | `AE_APPLID` | properties, `VERSION` (= AEM), stamp, `LICENSE_CODE`, `DESCRLONG` |
| `PSAEAPPLSTATE` | state record | program, `AE_STATE_RECNAME` | `AE_DEFAULT_STATE` Y on exactly one |
| `PSAEAPPLTEMPTBL` | temporary table | program, `RECNAME` | |
| `PSAEAPPLLANG` | related-language description | program, `LANGUAGE_CD` | empty on HRDMO; App Designer never wrote it |
| `PSAESECTDEFN` | section | program, `AE_SECTION` | `AE_SECTION_TYPE`, `AE_PUBLIC_SW`, `VERSION` (= AES), stamp |
| `PSAESECTDTLDEFN` | section variant | + `MARKET`, `DBTYPE`, `EFFDT` | `EFF_STATUS`, `DESCR`, `AE_AUTO_COMMIT`, `DESCRLONG` (section comment) |
| `PSAESTEPDEFN` | step | + `AE_STEP` | `AE_SEQ_NUM` 1..n, step settings, and the settings of its SQL, PeopleCode, Call Section and Log Message actions |
| `PSAESTMTDEFN` | action | + `AE_STMT_TYPE` | `AE_REUSE_STMT`, `AE_DO_SELECT_TYPE`, `SQLID`, `DESCR`, `DESCRLONG` (action comment) |
| `PSAESTEPMSGDEFN` | Log Message action | step key | `AE_MESSAGE_PARMS` |
| `PSSQLDEFN` / `PSSQLDESCR` / `PSSQLTEXTDEFN` / `PSSQLHASH` | an action's SQL or XSLT text | `SQLID`, `SQLTYPE` (+ variant for text) | `SQLTYPE` 1 SQL, 6 XSLT |
| `PSPCMPROG` / `PSPCMTXT` / `PSPCMNAME` | a PeopleCode action's program | 66/77/39/20/21/78/12 | compiled as the existing PeopleCode writer compiles |
| `PSAEAPPLDEL`, `PSAESECTDEL`, `PSSQLDEL`, `PSPCMPROGDEL` | a deleted key | key + `VERSION` | tombstones (see *Deletes and renames*) |
| `PSVERSION` / `PSLOCK` | counters | `OBJECTTYPENAME` | `AEM` programs, `AES` sections, `SRM` SQL, `PCM` PeopleCode, `PJM`, `SYS` |

A step holds at most one action of each type (the type is in the key).
Every HRDMO step's set fits App Designer's order, and no step holds both SQL
and Call Section.

### Columns no App Designer dialog writes

`INROOTELEMENT`, `INMSGNAME`, `INMSGVERSION`, `OUTROOTELEMENT`,
`OUTMSGNAME`, `OUTMSGVERSION` (4 HRDMO transform programs), `AE_DATE_OVERRIDE`
(`N`; one program `Y`), `ASOF_DT`, `AE_MESSAGE_SET_FLD` /
`AE_MESSAGE_NBR_FLD` (16 steps), `PTAE_LOGGING_SQL` (`N` on every step).
App Designer keeps them as they are; so does PeopleSoft Studio. Their
creation values: blank, `N`, `ASOF_DT` NULL until the first re-save, which
sets `1900-01-01` [ap01], `PTAE_LOGGING_SQL` `N`.

## Program

| App Designer (Program Properties) | Column | Values | Case |
|---|---|---|---|
| General: Description | `DESCR` | 30 characters; blank `' '` | ap01 |
| General: Comments | `DESCRLONG` | CLOB; NULL when never set | ap02 |
| General: Owner ID | `OBJECTOWNERID` | PSXLATITEM `OBJECTOWNERID` code; blank `' '` | ap03 |
| State Records | `PSAEAPPLSTATE` | the list offers records whose name ends `AET`; one default | ap11-ap14 |
| Temp Tables | `PSAEAPPLTEMPTBL` | the list offers Temporary Table records (RECTYPE 7) | ap15 |
| Temp Tables: Instance Count | `TEMPTBLINSTANCES` | number | ap10 |
| Temp Tables: Runtime Abort (else Continue) | `RECUSE` bit 0x1 | | ap09 |
| Advanced: Batch Only | `RECUSE` bit 0x2 | | ap06 |
| Temp Tables: Share Tables in Online Mode | `RECUSE` bit 0x4 | | ap07 |
| Temp Tables: Use Delete for Truncate Table | `RECUSE` bit 0x8 | | ap08 |
| Advanced: Disable Restart | `AE_DISABLE_RESTART` | Y / N | ap04 |
| Advanced: Application Library | `AE_APPLLIBRARY` | Y / N; see below | ap05, ap19 |
| Advanced: Message Set | `MESSAGE_SET_NBR` | editable number | ap16 |
| Advanced: Program Type | `AEPROGTYPE` | 0 Standard, 1 Upgrade Only, 2 Import Only, 3 Daemon Only, 4 Transform Only (list order) | ap17, ap18, ap20 |

Adding a temp table makes App Designer ask *Insert updated Temp Table list
into Project?* -- a project operation, not part of the definition.

**Application Library.** Checking it renames MAIN (a library has no entry
point): App Designer warns *This request will rename Section 'MAIN'* and
renames it `Section1` (the next free `SectionN`) [ap05]. Unchecking it adds
a new, empty MAIN (no steps, Public) [ap19].

**LICENSE_CODE** is 32 bytes, base64: an 8-byte-block cipher text
(blocks 2 and 3 are equal in 2,491 of 2,747 programs), not a hash of the
name or content. App Designer writes it when it creates a program
(`Save As` writes a new one [ae13]) and never changes it on a re-save. It
cannot be derived; PeopleSoft Studio writes `' '` on create, as its page
writer does for PSPNLDEFN.LICENSE_CODE (App Designer fills a blank code at
its next save of the definition -- proven for pages; see *Native checks*).

## Sections

| App Designer (section bar) | Column | Values | Case |
|---|---|---|---|
| Section name | `AE_SECTION` | 8 characters | ae11 |
| Description | `PSAESECTDTLDEFN.DESCR` | new: `<name> description` | as01 |
| Market | `MARKET` (key) | PSXLATITEM MARKET codes; new: `GBL` | as02 |
| Platform | `DBTYPE` (key) | default `' '`, DB2 `1`, Oracle `2`, Microsoft `7`; App Designer 8.62 offers only these four (Informix 3, DB2/UNIX 4, AllBase 5, Sybase 6 exist in old data) | as03 |
| Effective Date | `EFFDT` (key) | new: 1900-01-01 | as04 |
| Effective Status | `EFF_STATUS` | A Active, I Inactive | as05 |
| Section Type | `AE_SECTION_TYPE` | P Prepare Only, C Critical Updates | as06 |
| Auto Commit: After Step | `AE_AUTO_COMMIT` | Y / N (`M` in PSXLATITEM, never offered) | as07 |
| Access: Public | `AE_PUBLIC_SW` | Y / N; **MAIN: always Y, the box disabled** | as08 |
| Comment (Show Comment) | `PSAESECTDTLDEFN.DESCRLONG` | CLOB, NULL when never set | as09 |

Inserted section [ae10]: the next free `SectionN` name, Private (N), Prepare
Only, GBL / default / 1900-01-01, Active, Auto Commit N, no steps. A new
program's MAIN is Public with one step `Step01` and no action [ae01]. MAIN
cannot be deleted (its Delete is disabled). App Designer lists MAIN first,
then the other sections by name (case-sensitive) on load. Paste of a section
is disabled within its own program.

Changing Market, Platform or Effective Date re-keys the variant: its
detail, step, action and message rows are deleted and reinserted under the
new key; its actions' SQL text rows (`PSSQLTEXTDEFN`, `PSSQLDESCR`) move to
the new variant key under the same SQLID, `PSSQLDEFN.VERSION` moves; its
PeopleCode moves to the new key, the old key tombstoned in `PSPCMPROGDEL`
[as02-as04, ae18, ae19]. (App Designer leaves `PSSQLHASH.MARKET` behind and
corrects it at a later save [ax43]; PeopleSoft Studio moves it with the text.)

## Steps

| App Designer (step row) | Column | Values | Case |
|---|---|---|---|
| Step name | `AE_STEP` | 8 characters | ar01 |
| Description | `DESCR` | new: `<name> description` | at01 |
| sequence (shown 001) | `AE_SEQ_NUM` | 1..n, contiguous | ao01, ao02 |
| Commit After | `AE_COMMIT_AFTER` | D Default, N Later, Y After Step | at02, at03 |
| Frequency (enabled only with a Do Select) | `AE_COMMIT_FREQ` | number | ax24 |
| On Error | `AE_ABEND_ACTION` | A Abort, I Ignore, S Suppress (B Break in PSXLATITEM, never offered) | at04, at05 |
| Active | `AE_ACTIVE_STATUS` | A / I | at06 |
| Comment | `DESCRLONG` | CLOB | at07 |

New step [aa01, ax26, ao01]: name = the step above's name with its number
incremented (`Step01` -> `Step02`, `Init` -> `Init2`), the next free one;
Active, Abort, Default, Frequency 0, On No Rows C, On Return blank, Dynamic
N, Message 0/0, logging N; `Insert Step/Action` also inserts an SQL action.
It goes after the selected step; the steps below are renumbered. Paste goes
after the target step; a duplicate name is renamed the same way (*Section
'Init' was renamed 'Init3' to avoid duplicate entry*) [ao03]. A copy is the
source's rows verbatim under the new name. Moving a step (Cut / Paste)
rewrites only `AE_SEQ_NUM` [ao02].

## Actions

`AE_STMT_TYPE`, in App Designer's (and the runtime's) order:

| Code | Action | Settings (column) | Content |
|---|---|---|---|
| `H` | Do When | ReUse Statement (`AE_REUSE_STMT` N/Y) | SQL |
| `W` | Do While | ReUse Statement (N/Y) | SQL |
| `D` | Do Select | ReUse Statement (N/Y/I), Do Select Type (`AE_DO_SELECT_TYPE` F Select/Fetch, R Reselect, Y Restartable) | SQL |
| `P` | PeopleCode | On Return (step `AE_PC_ON_FALSE` A Abort, B Break, S Skip Step) | PeopleCode |
| `S` | SQL | ReUse Statement (I Bulk Insert, N No, Y Yes), No Rows (step `AE_ON_NOROWS` A Abort, B Section Break, C Continue, S Skip Step) | SQL |
| `C` | Call Section | Section Name, Program ID, Dynamic (step `AE_DO_SECTION`, `AE_DO_APPL_ID`, `AE_DYNAMIC_DO`) | |
| `M` | Log Message | Message Set, Number (step `MESSAGE_SET_NBR`, `MESSAGE_NBR`), Parameters (`PSAESTEPMSGDEFN.AE_MESSAGE_PARMS`) | |
| `N` | Do Until | ReUse Statement (N/Y) | SQL |
| `X` | XSLT | Graphical Mapper (`AE_REUSE_STMT`: **N = Yes**, I = No) [ax40, ax41] | XSLT |

Every action has a description (`DESCR`, new: `<Type> description`) and a
comment (`DESCRLONG`). `AE_DO_SELECT_TYPE` is `F` on every P, M and C action
and blank on H, W, S, N and X ones (HRDMO, all 64,000) -- App Designer
writes it so [ax13-ax16]. `SQLID` is set on SQL-bearing actions (H, W, D, S,
N, X) only: the program padded to 12, the section to 8, the step to 8, the
type letter (39,027 of 39,027) -- whether or not the action has text yet.

**Inserting actions** (`Insert Action`) adds the first type the step does
not have yet, skipping Call Section when the step has SQL and SQL when it has
Call Section [ax08-ax17]; it even adds XSLT to a Standard program, though
the type list of a Standard program does not offer XSLT and *View XSLT* is
disabled there. Inserted defaults: ReUse N; Do Select Type F; a PeopleCode
action sets the step's On Return to **A**; a Log Message action adds a
`PSAESTEPMSGDEFN` row with parameters `' '`; a Call Section action stores
the program's own name in `AE_DO_APPL_ID` ("(current)") [ax27].

**Changing an action's type** (the type list) deletes the action row and
inserts one of the new type with its defaults; the description resets
[ax27]. A PeopleCode action made this way sets On Return to **S** [ax31].

**Call Section** [ax28-ax30]: Section Name lists the chosen program's
sections; Program ID lists every App Engine program, "(current)" storing
the program's own name (8,262 HRDMO steps; blank only with Dynamic). Dynamic
clears both section and program (326 HRDMO steps: blank + Y).

**Deleting** an action asks *Are you sure you want to remove Action 'X'?*,
then *Related SQL / PeopleCode object(s) will be deleted at Save time.*
Deleting PeopleCode resets the step's On Return to blank [ad01]; deleting
SQL leaves No Rows as it was [ad02].

### SQL text

The action's SQL definition: `PSSQLDEFN` (SQLTYPE 1; XSLT 6), `PSSQLDESCR`
(DESCR `' '`, DESCRLONG NULL), `PSSQLTEXTDEFN` (one row per 14,000
characters, `SEQNUM` 0..), `PSSQLHASH` (`base64(SHA-1(UTF-16LE text) || 0x00)`,
the PSPCMTXT algorithm) -- all keyed by the section variant's MARKET /
DBTYPE / EFFDT. An action with no text has no SQL rows [aa01].

**App Designer stores App Engine SQL on one line** -- every one of HRDMO's
39,054 SQLTYPE 1 texts has no line break. Its SQL editor shows the text
formatted (keywords upper-cased, one clause per line) but saves what the
editor holds, flattened [aa02-aa10]:

1. each line, outside `'...'` literals (`''` escapes a quote), has every run
   of spaces collapsed to one space -- leading and trailing runs included;
   double-quoted text and comments are not literals;
2. the lines are joined with one space (a line break inside a literal
   becomes one space too);
3. tabs become spaces (inside literals too) -- after the collapse, so two
   tabs are two spaces;
4. trailing whitespace is removed; leading whitespace is kept.

`flattenAeSql` (`src/model/aeDocument.ts`) implements this; its tests
replay every capture. **XSLT text is stored verbatim** -- line breaks
(CR LF), indentation and trailing spaces kept [ax43].

| Save | PSSQLDEFN | other rows | counters |
|---|---|---|---|
| text created | inserted: VERSION = new SRM, `ENABLEEFFDT` **Y**, OBJECTOWNERID `' '` | DESCR, TEXT, HASH inserted | SRM +1, SYS +1 [aa02] |
| text changed | VERSION = new SRM, restamped | TEXT, HASH updated | SRM +1, SYS +1, **AES +1 and the section restamped** [aa03-aa10] |
| SQLID changes (step / section / program renamed) | old row deleted, new row inserted with `ENABLEEFFDT` **N** | moved; `PSSQLDEL` (old SQLID, new SRM) | SRM +1 [ar01, ae11] |
| action deleted | deleted | deleted; `PSSQLDEL` (SQLID, new SRM) | SRM +1 [ad02] |
| SQLID re-created | | its `PSSQLDEL` rows deleted | [ae17] |

### PeopleCode

The program keyed 66 program / 77 section / 39 market / 20 platform
(`default` for DBTYPE `' '`, else `DB2`, `ORACLE`, `MICROSFT`, ...) / 21
effective date / 78 step / 12 `OnExecute`. A save writes exactly what a
record PeopleCode save writes -- PSPCMTXT, PSPCMPROG (VERSION = new PCM),
PSPCMNAME, PCM +1, SYS +1 [ap-pc01, ap-pc02] -- compiled with no record or
field (3,549 of 3,549 HCDEV App Engine programs encode exactly that way).
A PeopleCode-only save touches no PSAE row. Moving, renaming or deleting
writes `PSPCMPROGDEL` (old key, new PCM) [ar01, ae11, ad01, ae18]; a
re-created key's `PSPCMPROGDEL` row is deleted [ae17].

## Counters and stamps

`PSAEAPPLDEFN.VERSION` is the new AEM; a section's `VERSION` the new AES;
each stamped with `LASTUPDDTTM` / `LASTUPDOPRID` of the save.

| Save | AEM | AES | SRM | PCM | PJM | SYS | Cases |
|---|---|---|---|---|---|---|---|
| create program | +1 | +1 | (+1 with SQL) | (+1 with PeopleCode) | | +1 | ae01 |
| program properties only | +1 | | | | | +1 | ap01-ap20 |
| a section's properties, steps or actions | +1 | +1 (that section restamped) | | | | +1 | as*, at*, ax*, ao* |
| SQL text only | | (+1 on change) | +1 | | | +1 | aa02-aa10 |
| PeopleCode only | | | | +1 | | +1 | ap-pc01/02 |
| step renamed, variant re-keyed | +1 | +2 | +1 | +1 | | +2 | ar01, ae18 |
| section renamed | +1 | +2 (tombstone at +1) | +1 | +1 | +1 | +2 | ae11 |
| section deleted | +1 | +1 (tombstone) | +1 | +1 | | +1 | ae16 |
| Save As | +1 (new program) | +1 (every section) | +1 | +1 | | +1 | ae13 |
| rename program | +1 | +2 | +2 | +2 | +1 | +1 | ae14 |
| delete program | +2 | +2 | +2 | +2 | | +1 | ae15 |

(SRM / PCM move only when the program has SQL / PeopleCode to move.) Every
counter that moves is moved in PSVERSION and PSLOCK alike, except SYS
(PSVERSION only).

## Deletes and renames (tombstones)

| Table | Written when | VERSION |
|---|---|---|
| `PSAEAPPLDEL` (program) | the program is deleted or renamed | new AEM |
| `PSAESECTDEL` (program, section) | a section is deleted or renamed, or its program is | new AES (the first increment) |
| `PSSQLDEL` (SQLID, SQLTYPE) | an SQL definition is deleted or its SQLID changes | new SRM |
| `PSPCMPROGDEL` (7-part key) | a PeopleCode program is deleted or its key changes | new PCM |

Re-creating a key deletes its tombstone (MAIN re-added [ap19]; SQL and
PeopleCode re-created [ae17]).

## Physical write order

App Designer deletes and re-inserts the program's PSAEAPPLDEFN,
PSAEAPPLSTATE and PSAEAPPLTEMPTBL rows and the touched sections' rows on
every definition save (the flashback sweep sees new ROWIDs with identical
values); a program rename updates keys in place [ae14]. Only the resulting
values matter to App Designer and the runtime: PeopleSoft Studio writes the
logical difference (insert / update / delete by key) in one transaction.

## Native checks App Designer makes

*Edit Validation*, written to the output window at every save (warnings;
the save goes ahead):

- `Step: Warning -- No actions in step <variant>.<step>.`
- `Action: Warning -- No SQL defined for <variant>.<step>.<Action>.` (SQL,
  Do When, Do While, Do Select, Do Until)
- `Action: Warning -- No PeopleCode defined for <variant>.<step>.PeopleCode.`
- `Action: Warning -- No XSLT defined for <variant>.<step>.XSLT.`

Dialog-level rules: MAIN cannot be deleted and stays Public; State Records
lists only `*AET` records, Temp Tables only Temporary Tables; XSLT is
offered only in Transform programs; a step cannot take two actions of a
type, nor SQL with Call Section; renaming a program needs every definition
closed (78,6).

## Projects

| OBJECTTYPE | Item | OBJECTIDs | OBJECTVALUEs |
|---|---|---|---|
| 33 | program | 66 | program |
| 34 | section | 66, 77 | program, section |
| 43 | PeopleCode | 66, 77, 78, 12 | program, **section (8) + market (3) + platform (9) + effective date**, step, `OnExecute` |

The PeopleCode item packs four key parts in one value:
`CRNRPKG GBLdefault  1900-01-01` (`unpackPeopleCodeKey`).

## HRDMO census

`AE_STMT_TYPE`: H 4,263; W 132; D 3,006; P 12,610; S 31,572; C 10,042;
X 43 (Transform programs; one Standard); M 3,361; N 11. `AEPROGTYPE`: 0
2,585; 4 94; 1 60; 2 5; 3 3. `RECUSE`: 0 2,679; 1 30; 2 30; 3 1; 4 4.
`AE_ON_NOROWS`: C 47,556; S 1,139; B 557; A 138. `AE_PC_ON_FALSE`: S 11,798;
A 620; B 192. `AE_REUSE_STMT`: N 59,256; Y 5,665; I 119. 169 of 11,247
sections have more than one variant. 28 steps have no action.

## In PeopleSoft Studio

- `src/model/appEngine.ts` reads a program into the display model;
  `src/model/aeDocument.ts` is the editable document (every column, lossless),
  its operations (App Designer's defaults above) and `flattenAeSql`;
  `src/model/aeValidation.ts` the validator; `src/model/aeSemantics.ts` the
  execution-flow and dependency analysis.
- `src/providers/appEngineWriter.ts` plans and performs saves, creates,
  renames and deletes as above, verifying in the transaction and after
  COMMIT; PeopleCode actions go through the PeopleCode writer.
- The App Engine Designer (`src/editors/aeDesigner*.ts`) and the MCP tools
  (`src/mcp/appEngineTools.ts`) share these.

## Verification

- **Replay**: every capture's edit, applied to the program as it was before
  App Designer's save, gives App Designer's rows (`aeDocument.test.ts`), and
  the writer's plan moves App Designer's counters and tombstones
  (`appEngineWriter.test.ts`). Compiled PeopleCode equals App Designer's bytes
  (`savePlan.test.ts` over the App Engine captures).
- **Live**: `tools/lab/ae-replay.mts` replays 88 captures through the writer
  on HRDMO: 85 identical row for row; the other 3 differ only in PSSQLHASH's
  market, which App Designer leaves stale after a variant re-key
  (`results/ae-replay-report.txt`). Found on the way: stored SQL must be
  written as it is -- flattening is not idempotent (`"\n  x"` stores two
  spaces) -- so it is flattened only when edited (`editedText`).
- **MCP**: `tools/lab/ae-mcp-e2e.mts`, the real server over HTTP: 21 of 21.
- **Native**: App Designer opens what the writer and the MCP created
  (Definition view, PeopleCode editor), edits it and saves it, changing only
  the edit -- and filling the blank LICENSE_CODE (`nae01`). That save also
  removed stale tombstones of an earlier delete of the name, which the writer
  now removes on create as well. App Designer 8.62 displays an SQL action's
  No Rows *Abort* as "Out of available memory." on reopen, for delivered
  programs too: a display quirk, not stored data.

The implementation matrix -- every object and property with its mapping,
implementation, test and native-verification status -- is
`docs/APP_ENGINE_MATRIX.md`.


## Scheduler workflow (0.9.8 development)

The saved, clean designer exposes **Run and Monitor** for selecting an existing
process/run control and reviewing an exact runtime request. Native operator
sign-in, confirmation, status and report access are separate from metadata
editing and Change Review. Real installed scheduler acceptance remains pending;
see [Process Scheduler runtime](PROCESS_SCHEDULER_RUNTIME.md).
