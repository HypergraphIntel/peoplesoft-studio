# App Engine definitions

How PeopleTools stores an Application Engine program, mapped from HRDMO
(PeopleTools 8.62.09, 2,747 programs) by querying the tables, and what
PeopleSoft Studio reads from them (`src/model/appEngine.ts`). Read-only: no
App Designer save of an App Engine program has been captured yet.

## The tables

| Table | One row per | Key | Notes |
|---|---|---|---|
| `PSAEAPPLDEFN` | program | `AE_APPLID` | description, `AEPROGTYPE`, `AE_DISABLE_RESTART`, `AE_APPLLIBRARY`, `MESSAGE_SET_NBR`, `TEMPTBLINSTANCES`, `VERSION`, owner, stamp, `DESCRLONG` |
| `PSAEAPPLSTATE` | state record | program, `AE_STATE_RECNAME` | `AE_DEFAULT_STATE` 'Y' on the default; 1,027 programs have none |
| `PSAEAPPLTEMPTBL` | temporary table | program, `RECNAME` | |
| `PSAESECTDEFN` | section | program, `AE_SECTION` | `AE_SECTION_TYPE`, `AE_PUBLIC_SW` (Access), `VERSION` |
| `PSAESECTDTLDEFN` | section variant | + `MARKET`, `DBTYPE`, `EFFDT` | `EFF_STATUS`, description, `AE_AUTO_COMMIT`; 169 of 11,247 sections have more than one variant |
| `PSAESTEPDEFN` | step | + `AE_STEP` | `AE_SEQ_NUM` (1..n without gaps in all 11,540 variants), status, On Error, commit, Call Section target, message, On No Rows / On Return |
| `PSAESTMTDEFN` | action | + `AE_STMT_TYPE` | `SQLID`, `AE_REUSE_STMT`, `AE_DO_SELECT_TYPE`, description |
| `PSAESTEPMSGDEFN` | Log Message parameters | step key | `AE_MESSAGE_PARMS` |
| `PSAEAPPLDEL`, `PSAESECTDEL`, `PSAEAPPLLANG`, `PSAESQLTIMINGS` | | | empty on HRDMO |

Every program and section on HRDMO is at `VERSION` 1; PSVERSION has `AEM`
(4) and `AES` (1). Which counters a save moves is not established.

## Actions

`AE_STMT_TYPE`, with PSXLATITEM's labels and HRDMO's counts:

| Code | Action | Count | Its content |
|---|---|---|---|
| `H` | Do When | 4,263 | SQL |
| `W` | Do While | 132 | SQL |
| `D` | Do Select | 3,006 | SQL; `AE_DO_SELECT_TYPE` |
| `P` | PeopleCode | 12,610 | a PeopleCode program |
| `S` | SQL | 31,572 | SQL |
| `C` | Call Section | 10,042 | the step's `AE_DO_SECTION`, `AE_DO_APPL_ID`, `AE_DYNAMIC_DO` |
| `X` | XSLT | 43 | text, `SQLTYPE` 6 |
| `M` | Log Message | 3,361 | the step's `MESSAGE_SET_NBR` / `MESSAGE_NBR`, `PSAESTEPMSGDEFN` |
| `N` | Do Until | 11 | SQL |

A step holds at most one action of each type (the type is in the key), never
both SQL and Call Section, and XSLT alone -- every HRDMO step. App Designer
lists them in the order above; every step's set fits it. 28 steps have no
action.

### SQL text

An action's `SQLID` is the program padded to 12, the section to 8, the step
to 8, then the type letter: `AEMINITEST  MAIN    Step01  S` (39,027 of
39,027). The text is `PSSQLTEXTDEFN` `SQLTYPE` 1 (XSLT: 6), keyed by the
variant's `MARKET` / `DBTYPE` / `EFFDT` (38,978 of 39,027 exactly; the
others are XSLT texts, which are stored under `SQLTYPE` 6), in rows of
14,000 characters by `SEQNUM` (10 texts on HRDMO are two rows).

### PeopleCode

`PSPCMPROG` keyed 66 program / 77 section / 39 market / 20 platform / 21
effective date / 78 step / 12 `OnExecute`. The platform is `default` for
`DBTYPE` ' ' (12,567 programs), else `DB2`, `ORACLE`, `INFORMIX`,
`DB2UNIX`, `SYBASE`, `MICROSFT`. 87 programs belong to steps whose
PeopleCode action has since been replaced; App Designer does not show them. No stored PeopleCode
names AllBase (`DBTYPE` 5): the PeopleCode actions of UPGPT848VA's and
VACONVERT2's AllBase sections show as not read.

Every App Engine program on HRDMO (2,747) renders without an error.

### Projects

| OBJECTTYPE | Item | OBJECTIDs | OBJECTVALUEs |
|---|---|---|---|
| 33 | program | 66 | program |
| 34 | section | 66, 77 | program, section |
| 43 | PeopleCode | 66, 77, 78, 12 | program, **section (8) + market (3) + platform (9) + effective date**, step, `OnExecute` |

The PeopleCode item packs four key parts in one value:
`CRNRPKG GBLdefault  1900-01-01`. The reader unpacks it
(`unpackPeopleCodeKey`).

## Codes

Labels from PSXLATITEM where the database has them; the rest are App
Designer's names for the values, **not yet checked against its dialogs**
(marked *).

| Column | Values |
|---|---|
| `AE_SECTION_TYPE` | P Preparation Only (10,893), C Critical Updates (354) |
| `AE_PUBLIC_SW` * | Y Public (4,600), N Private (6,647) |
| `AE_AUTO_COMMIT` | N No Auto Commit (8,777), Y After Step (2,769), M Conditionally (none) |
| `EFF_STATUS` / `AE_ACTIVE_STATUS` | A Active, I Inactive (964 steps) |
| `AE_ABEND_ACTION` (On Error) | A Abort (49,213), I Ignore (112), S Suppress (65), B Break (none) |
| `AE_COMMIT_AFTER` | D Default (47,020), Y After Step (2,183), N Later (187) |
| `AE_ON_NOROWS` (SQL's No Rows) | C Continue (47,556; App Designer: BEN110), S Skip Step (1,139), B Break (557), A Abort (138) |
| `AE_PC_ON_FALSE` (PeopleCode's On Return) | ' ' (36,780: no PeopleCode), S Skip Step (11,798; App Designer: BEN110), A Abort (620), B Break (192) |
| `AE_DO_SELECT_TYPE` | F Select/Fetch (28,821), R Re-Select (25), Y Restartable * (172), ' ' (not a Do Select) |
| `AE_REUSE_STMT` | N No (59,256), Y Yes (5,665), I Bulk Insert * (119), S Save Stmt (none) |
| `AEPROGTYPE` * | 0 Standard (2,585), 4 Transform Only (94), 1 Upgrade Only (60), 2 Import Only (5), 3 Daemon Only (3) |
| `DBTYPE` | ' ' Default; 1 DB2, 2 Oracle, 3 Informix, 4 DB2/UNIX, 5 AllBase, 6 Sybase, 7 Microsoft |
| `AE_APPLLIBRARY`, `AE_DISABLE_RESTART`, `AE_DYNAMIC_DO` | Y / N |

## In PeopleSoft Studio

Opening an App Engine program, or a section from a project, shows it in a
panel with App Designer's two views (`src/editors/appEngineHtml.ts`):

- **Definition**: each section variant as a bar labelled
  `MAIN.GBL.default.1900-01-01` (section, market, platform, effective date),
  its steps below it -- number (001), Commit After, Frequency (only on a step
  with a Do Select, as App Designer shows it), On Error, Active -- and each
  step's actions with their own settings (ReUse Statement, No Rows, Do Select
  Type, On Return, the called section, the message). Checked against App
  Designer's Definition view of BEN110: the same boxes and values, which also
  confirmed No Rows C Continue, On Return S Skip Step and Do Select Type F
  Select/Fetch.
- **Program Flow**: each step's actions with their SQL, decoded PeopleCode
  and Message Catalog text.

The text form (the program as text, in Program Flow order) remains for the
MCP tools. A PeopleCode item from a project opens as PeopleCode. Read-only.

## Still to establish

- The codes marked * above, from App Designer's dialogs.
- Everything a save writes: App Designer saves of a scratch program
  (create, a step added, an action changed, a section added), bracketed
  with snapshots -- the version counters (`AEM`, `AES`), `PSAEAPPLDEL` /
  `PSAESECTDEL`, and the SQL definitions an action's text lives in.
