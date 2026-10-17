# App Engine runtime semantics

What an Application Engine program *does* when it runs -- the knowledge the
validator (`src/model/aeValidation.ts`), the flow analysis
(`src/model/aeSemantics.ts`) and the MCP tools use to design, explain and
check programs. `docs/APP_ENGINE.md` is how programs are *stored*.

**Source.** PeopleBooks, *PeopleTools: Application Engine* (8.5x-8.62), and
the structure of HRDMO's 2,747 delivered programs. PeopleSoft Studio does
not run programs: nothing below has been verified by executing a program
(see *What is not verified*).

## Entry and control flow

- A program runs from its **MAIN** section (an Application Library has no
  MAIN and is only called). The section variant that runs is the one for the
  run's market and database platform with the latest effective date on or
  before the run's as-of date; an Inactive variant does not run.
- A section runs its **steps in sequence** (`AE_SEQ_NUM`); an Inactive step
  is skipped. When the last step ends, control returns to the caller (or the
  program ends, after MAIN).
- In a step the **actions run in a fixed order**, whatever order they were
  inserted in: Do When, Do While, Do Select, PeopleCode, SQL or Call Section,
  Log Message, Do Until. (XSLT runs in Transform programs.)

## Actions

| Action | What it does |
|---|---|
| **Do When** | Runs its SELECT once. A row: the rest of the step runs. No row: the step's other actions are skipped. The SELECT **must** put its column into the state record with `%Select(field)` (or call a `%Sql()` that does) -- see below. |
| **Do While** | Runs its SELECT before each pass; while it returns a row the rest of the step (the actions after it) runs, then the step loops. |
| **Do Select** | Runs its SELECT and, for each row, puts the selected values into the state record (`%Select(...)`) and runs the rest of the step's actions for that row. **Select/Fetch**: one cursor, fetched row by row (no commits inside the loop while restart is enabled). **Reselect**: re-opens the SELECT after each iteration and takes the first row -- the step must change the data so processed rows drop out. **Restartable**: Select/Fetch that may commit inside the loop; on restart the SELECT must skip what was already processed (key it, e.g. on a processed flag or the last key in the state record). |
| **PeopleCode** | Runs the OnExecute program. Returning `False` (`Exit(1)`) triggers **On Return**: Abort the program, Break out of the section, or Skip Step (the rest of the step). The state record's fields are the `RECORD.FIELD` values; `%This` is not available. |
| **SQL** | Runs its statement (INSERT / UPDATE / DELETE, or a SELECT with `%Select` that fills the state record from the first row). **No Rows** -- when it affects or returns no row: Abort, Section Break (leave the section), Continue, or Skip Step. |
| **Call Section** | Runs another section, of this program or (Public sections only) another program, then continues the step. **Dynamic**: the section and program come from the state record's `AE_SECTION` / `AE_APPLID` at run time. A called program's own state records are separate unless they share the record name. |
| **Log Message** | Writes a Message Catalog entry (set, number) to the message log, with its parameters (`%Bind` values or literals) substituted for `%1`, `%2`, ... |
| **Do Until** | After the step's other actions, runs its SELECT; while it returns **no** row the step loops; a row ends the loop. |
| **XSLT** | Transforms the program's input message (Transform Only programs). |

**ReUse Statement**: Yes keeps the statement compiled with bind variables
between executions (faster in loops; meta-SQL is resolved once); Bulk Insert
also buffers INSERTs and writes them in batches (only for INSERT ... VALUES
with binds). No re-compiles each time.

## State records, binds and meta-SQL

- A program's state records hold its variables between actions; the
  **default** state record is the one unqualified `%Bind(FIELD)` and
  `%Select(FIELD)` use; others are named `%Bind(REC.FIELD)`.
- A state record that is an SQL table (keyed `PROCESS_INSTANCE`) is saved at
  each commit -- what restart resumes from. A Derived/Work state record is
  memory only and is lost on abend.
- `%Select(F1, F2) SELECT ...` puts a SELECT's first row (Do Select: each
  row) into F1, F2 of the state record. `%SelectInit` first blanks them.
- `%Bind(F)` substitutes the state record value (as a bind variable;
  `%Bind(F, NOQUOTES)` as literal text, e.g. a table name).
- `%Table(REC)` names a record's table -- a temporary table's instance
  assigned to this run. `%TruncateTable`, `%InsertSelect`, `%Join`,
  `%DateIn` / `%DateOut`, `%CurrentDateIn`, `%Execute` and the other
  meta-SQL resolve per platform.

## Commits and restart

- **Commit After**: Default -- the section's Auto Commit decides (After Step
  commits after each step; otherwise no automatic commit); After Step;
  Later -- not after this step, even with Auto Commit.
- **Frequency** (a step with a Do Select): commit every n iterations.
- **Restart** (unless the program's Disable Restart is on): at each commit
  the state records (table type) and the position (section, step, Do Select
  iteration) are saved in PS_AERUNCONTROL; a failed run, restarted, resumes
  after the last commit. So: commit only after a unit of work is complete,
  key Restartable / Reselect selects so done rows are not selected again, and
  keep loop counters in a table state record.
- Process Scheduler runs a program as the AE process type; the run control
  (`OPRID`, `RUN_CNTL_ID`) reaches it through the state record fields of
  those names (`%Bind(OPRID)`), as delivered programs read their run
  control in MAIN's first step.

## Temporary tables

A program's temporary tables (RECTYPE 7) get **instances**: Instance Count
copies per program (`PS_REC1` .. `PS_RECn` plus the base table); a batch run
locks one instance and `%Table(REC)` names it. When none is free: Continue
(use the base table, shared) or Abort (the Runtime setting). Online runs
share the base table unless *Share Tables in Online Mode* is off. *Use
Delete for Truncate Table* clears an instance with DELETE rather than
TRUNCATE (no implicit commit).

## Errors

**On Error** (a step's SQL or PeopleCode fails): Abort -- the program ends
in error (rollback to the last commit); Ignore -- log and continue with the
next step; Suppress -- continue without logging.

## Design guidance (how the MCP tools build programs)

- Read the run control in MAIN's first step: an SQL action
  `%Select(...) SELECT ... FROM PS_<RUNCNTL> WHERE OPRID = %Bind(OPRID) AND RUN_CNTL_ID = %Bind(RUN_CNTL_ID)`.
- Row-by-row business rules: a **Do Select** (Restartable, with commits) over
  the driving rows, the rules in a **PeopleCode** action of the same step,
  the results written by an **SQL** action -- or, faster, set-based SQL
  (INSERT ... SELECT) into a temporary table, then one UPDATE / INSERT.
- Loops that end on a condition: **Do While** (test first) or **Do Until**
  (test after). Conditional steps: **Do When**.

### A Do When without %Select abends with `RC = ?`

`Do When`, `Do While` and `Do Until` select a column, and Application Engine
needs somewhere to put it. Written without `%Select`, the program builds the
statement, never sends it to the database, and abends:

```text
Process 606883 ABENDED at Step ZZ_BENEFITS.INIT.DOPAYCAL (Do When) -- RC = ?
```

There is no SQL error and no Oracle code, because the statement never ran. The
tell is the pair of trace files: the statement appears in the `.AET` (step)
trace and never in the `.trc` (SQL) trace. `RC = ?` rather than a number is the
signature.

Correct:

```sql
%Select(TEMP_FLD) SELECT 'X' FROM PS_INSTALLATION WHERE %Bind(ZZ_BNV_FILETYPE) = 'CONTRIB'
```

`TEMP_FLD` is the delivered convention: a 1-character work field added to the
state record purely as the landing place. Census of the local snapshot: of
4,285 delivered Do When / Do While / Do Until actions, 4,255 begin `%Select(`
and the remaining 30 call `%Sql()`, which supplies it. None has neither.

Studio refuses the save (`do-when-select-into`, `src/model/aeValidation.ts`).
- Reusable logic: a Public section, Call Section'ed; a library program for
  sections shared between programs.
- Commit in long loops (Frequency) only with Restartable selects and table
  state records; otherwise commit after the set-based steps.

## What is not verified

PeopleSoft Studio reads, writes and validates definitions; it does not run
them. Everything above is from PeopleBooks and the delivered programs'
structure, not from executing programs. Running a program (Process Scheduler
or `psae`) is a separate, explicitly authorized operation that is not part of
this work.
