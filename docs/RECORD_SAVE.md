# Saving a record

What App Designer writes when it saves a record definition, and the
evidence for it. HRDMO, PeopleTools 8.62.09, scratch records
`ZZ_PCODE_LAB%`, snapshots by `tools/corpus/save-protocol/snapshot.ts`
(results under `tools/corpus/save-protocol/results/r*`). Saving records
from VS Code is enabled only for what the cases cover; see *The writer*.

## Case r01: reorder fields (Derived/Work record)

`ZZ_PCODE_LAB_T`: `ZZ_PCODE_LAB_KEY`, `ZZ_PCODE_LAB_VAL` reordered to VAL,
KEY and saved. Bracketed retroactively (`before --as-of`, flashback). Every
PeopleTools table was swept; only these rows changed:

| Table | Change |
|---|---|
| `PSRECDEFN` | the row deleted and reinserted: `VERSION` = new `PSVERSION.RDM`, `LASTUPDDTTM` = save time, `LASTUPDOPRID` = operator; every other column unchanged |
| `PSRECFIELD` | every row of the record deleted and reinserted with the new `FIELDNUM`s; each row keeps its own `LASTUPDDTTM` / `LASTUPDOPRID` (an unchanged field is not restamped) |
| `PSRECFIELDDB` | the same, with `RECNAME_PARENT` = the record |
| `PSVERSION` | `RDM` + 1, `SYS` + 1 |
| `PSLOCK` | `RDM` + 1 |

No index, DDL or language rows moved (the record has no keys and no
table).

## Case r02: insert a field (and, in the same window, a new record)

`ZZ_PCODE_LAB_C05` inserted at the end of `ZZ_PCODE_LAB_T`, saved
(17:43:26). The same transaction as r01: `PSRECDEFN` rewritten with
`FIELDCOUNT` 3 and the new `VERSION` / stamp; every `PSRECFIELD` /
`PSRECFIELDDB` row deleted and reinserted. The new field's row is stamped
with the save time and operator; the existing rows keep theirs. RDM + 1.

The window also holds two saves made outside the case, kept as evidence
but not yet isolated:

- **New record** `ZZ_PCODE_LAB_R1` (SQL Table, one field, 17:45:58):
  `PSRECDEFN` inserted (`FIELDCOUNT` 1, `INDEXCOUNT` 0, `DDLCOUNT` 0,
  `BUILDSEQNO` 1, `OPTTRIGFLAG` 'N', blanks elsewhere), its `PSRECFIELD` /
  `PSRECFIELDDB` rows stamped with the save, and a `PSRECTBLSPC` row
  (`DDLSPACENAME` AAAPP, `DBNAME` PSHRDMOB, `TEMPTBLINST` 'N').
- **Project** `ZZ_PCODE_LAB_01` (17:46:05): App Designer inserted the new
  record as an item, and rewrote the existing C03 item row unchanged;
  `PJM` moved by 2 in the window. Needs a clean case before it is relied on.

## Case r03: an SQL Table record gains a key (17:52:35)

`ZZ_PCODE_LAB_R1`: C05 removed; `ZZ_PCODE_LAB_KEY` added first as a
descending key, `ZZ_PCODE_LAB_C02` added as a list box item; saved.

| Table | Change |
|---|---|
| `PSRECDEFN` | rewritten: `FIELDCOUNT` 2, `INDEXCOUNT` 0 → 1, new `VERSION` / stamp |
| `PSRECFIELD`, `PSRECFIELDDB` | the removed field's row gone; the new rows stamped with the save; `USEEDIT` KEY `0x800041` (key, descending), C02 `0x800020` (list box) |
| `PSINDEXDEFN` | index `_` inserted: `INDEXTYPE` 1, `UNIQUEFLAG` 1, `CLUSTERFLAG` 1, `ACTIVEFLAG` 1, `CUSTKEYORDER` 0, `KEYCOUNT` 1, `DDLCOUNT` 0, every `PLATFORM_*` 1, `IDXCOMMENTS` ' ' |
| `PSKEYDEFN` | `_`, `KEYPOSN` 1, the key field, `ASCDESC` 0 |
| `PSRECTBLSPC` | the record's row deleted and reinserted unchanged |
| `PSVERSION` | `RDM` + 1, `PGM` + 1, `SYS` + 1 (one SYS for the save) |
| `PSLOCK` | `RDM` + 1, `PGM` + 1 |

`ASCDESC`: 1 ascending, 0 descending (`ABS_HIST_DET`'s stored keys:
`BEGIN_DT`, `COMMENT_DT` 0). Delivered records also carry alternate-key
indexes (`INDEXTYPE` 3, ids `0`-`9`: the alternate field then the keys,
e.g. `PSOPRDEFN` `0` = USERIDALIAS, OPRID) and custom indexes
(`INDEXTYPE` 4, A, B, ...).

Open: why `PGM` moved (no component row changed) -- the key change, the
list box item, or any SQL Table save.

## App Designer's record grid

Read off App Designer against HRDMO's stored rows (`PSOPRDEFN`,
`ABS_HIST_DET`):

- one row per `PSRECFIELD` row, a subrecord as one `SRec` row;
- Len is `PSDBFIELD.LENGTH` for every type (Date 10, DateTime 26, Long 0);
- Format: `0` on a character field "Upper", `6` "Mixed", `7` "Raw B",
  `12` "Scnds", `0` on other types blank;
- Short / Long Name: the record field's `LABEL_ID` label, else the field's
  default label;
- a field name is bold when the field has Record Field PeopleCode.

## USEEDIT

App Designer's Use display for `ABS_HIST_DET` and `PSOPRDEFN` against the
stored rows:

| Bit | Meaning | Evidence |
|---|---|---|
| `0x1` | Key | EMPLID..COMMENT_DT, OPRID |
| `0x10` | Alternate search key ("Alt") | USERIDALIAS |
| `0x20` | List box item | OPRID, USERIDALIAS, OPRDEFNDESC |
| `0x40` | Descending ("D" in Dir) | BEGIN_DT, COMMENT_DT |

Ordr is the key's position among the record's keys; Dir is shown for keys
and alternate keys. The Edits display (`PSOPRDEFN`) confirms `0x100`
Required ("Req" Yes on LASTPSWDCHANGE), `0x200` translate table ("Xlat",
LANGUAGE_CD) and `0x4000` prompt table ("Prompt", the table in
`EDITTABLE`); its Event column is Yes exactly where a field has Record
Field PeopleCode. `0x800000` is set on every field App Designer inserts and
shown nowhere. `src/model/record.ts` had Descending at `0x200` and Required
at `0x40`; corrected.

Default: `PSRECFIELD.DEFFIELDNAME` holds a constant (shown quoted, 'ENG')
or a system variable (shown as is, %Date); `DEFRECNAME` names the record
of a record.field default.

## Cases r04-r07: one change per save

Made in a row in App Designer, bracketed afterwards (`before` / `after
--as-of`, flashback):

| Case | Change | Rows | Counters |
|---|---|---|---|
| r04 | List Box Item off on C02 (R1) | C02 restamped, `USEEDIT` 0x800020 → 0x800000; KEY untouched; `_` index / key rows and `PSRECTBLSPC` rewritten unchanged | RDM, SYS |
| r05 | KEY descending → ascending (R1) | KEY restamped, 0x800041 → 0x800001; `PSKEYDEFN.ASCDESC` 0 → 1 | RDM, SYS |
| r06 | C02 deleted (R1, SQL Table) | C02's rows gone, KEY unchanged | RDM, **PGM**, SYS |
| r07 | C05 deleted (`ZZ_PCODE_LAB_T`, Derived/Work) | C05's rows gone, the rest unchanged | RDM, **PGM**, SYS |

So: a row is restamped exactly when its values change; `PGM` moves exactly
when a field is removed (also r03; never for r01, r02, r04, r05); `SYS` once
per save. HRDMO's delivered records add: Derived/Work records never carry
an index, even with keys (1,231 of them); every SQL Table with keys has `_`
(19,912); `INDEXCOUNT` is the record's index-row count (21,344 of 21,345);
`KEYCOUNT` its `_` key rows (all 19,970).

## The writer

`planRecordSave` (`src/model/recordEdit.ts`) and `saveRecord`
(`src/providers/recordWriter.ts`). The replay test rebuilds each of r01-r07
from the record's rows before App Designer's save and requires App
Designer's rows after it, column for column, with its index and key rows
and its PGM rule. Native saves bracketed the same way (rd1 reorder, rd2
insert + list box + descending key, rd3 delete) wrote the same shapes; the
writer updates `PSRECDEFN` in place where App Designer deletes and
reinserts it, to the same row.

Scope: scratch records (`ZZ_PCODE_LAB%`) on a Writable connection with an
Operator ID; SQL Table or Derived/Work; no subrecords, not used as one, no
alternate search keys, no index but `_`; an SQL Table keeps at least one
key. Changes: reorder, insert, delete, and the Use settings the cases
exercised: Key, Duplicate Order Key, Descending, Search Key, List Box
Item, From / Through / Default Search Field, Search Edit, Disable Advanced
Search Options, Allow Search Events, Audit Field Add / Change / Delete,
System Maintained, Do Not Trace Value. A key index with a custom key order is refused. One
transaction, refused if the record's `VERSION` moved since it was opened;
verified before and after COMMIT.

## Snapshot tool

`after --as-of` closes a window in the past, so a run of saves can be
bracketed one by one afterwards. Changed rows are found by flashback
version query (`VERSIONS BETWEEN SCN`): the earlier block-based diff missed
a delete whose block was emptied (the index rewrite in rd2 / rd3).

## Cases r08 / r09: one setting per field

`ZZ_PCODE_LAB_R1` with eight fields; a different Use setting on each,
saved (r08: KEY and C01; r09: C02-C07). Each field's `USEEDIT` change
(beyond the 0x800000 every field carries) names its bit:

| Field | Setting | Bit | `src/model/record.ts` had |
|---|---|---|---|
| KEY | Search Key | `0x800` | `0x800` |
| C01 | Duplicate Order Key | `0x2` (and no Key bit) | `0x2` |
| C02 | From Search Field | `0x40000` | `0x4000` |
| C03 | Through Search Field | `0x80000` | `0x8000` |
| C04 | Audit Field Add | `0x8` | `0x8` |
| C05 | Audit Field Change | `0x80` | `0x1000` |
| C06 | Audit Field Delete | `0x400` | `0x2000` |
| C07 | System Maintained | `0x4` | `0x4` |

A duplicate order key is a key of the key index: r08 made `_` two keys
(`KEYCOUNT` 2, C01 at `KEYPOSN` 2) and non-unique (`UNIQUEFLAG` 1 → 0).
Search Key changed no index row. Every delivered SQL Table without
subrecords agrees (17,961): `KEYCOUNT` = its Key and Duplicate Order Key
fields, `UNIQUEFLAG` 0 exactly when one is a duplicate order key; the key
rows follow field order with `ASCDESC` from the Descending bit (64,008 of
64,057 rows; the rest belong to `CUSTKEYORDER` 1 indexes, which the writer
refuses). Delivered fields never combine Key with Duplicate Order Key (809
duplicate order keys), Search Key without Key (1 of 53,054), or Descending
without a key; the editor keeps the same combinations.

Native save rd4 (System Maintained off on C07, Audit Field Add on C03) wrote
the r09 shape: the two changed rows restamped, `_` and its two key rows
rewritten unchanged.

## Cases r10-r14: the search options and Do Not Trace

Same method on `ZZ_PCODE_LAB_R1` (now ten fields), each save bracketed
afterwards from the record's flashback versions:

| Case | Field | Setting | Stored |
|---|---|---|---|
| r12 | KEY (a search key) | Search Edit | `USEEDIT 0x10000000` |
| r11 | C01 | Default Search Field | `USEEDIT 0x1000000` (the save also cleared C01's Duplicate Order Key: `_` went back to unique, one key) |
| r13 | C02 | Disable Advanced Search Options | `USEEDIT 0x200000` |
| r14 | C03 | Allow Search Events for Prompt Dialogs | `USEEDIT 0x8000000` |
| r10 | C04 | Do Not Trace Value | `USEEDIT2 0x800000` |

Delivered fields agree: Search Edit only with Search Key (135 of 135);
Do Not Trace on 513 fields. In r10 App Designer also restamped
`LASTUPDDTTM`'s row with no value changed (Auto-Update had been tried
there) -- the writer restamps only changed rows, so r10 is not replayed.
Auto-Update stored nothing; `0x8000` is set almost only on DateTime fields
(61, against 4 Date and 1 Number) and is the candidate, unconfirmed. In
Memory, Smart Drop-Down and Smart Prompt were not available on these
fields.

Native save rd5 (Do Not Trace on C05, Default Search Field on C06) wrote
the same shape.

## Cases r15 / r16: the Edits tab, defaults, label, Smart options

One save, one setting per field of `ZZ_PCODE_LAB_R1` (r15), and a second
(r16) in which the Yes/No field also took both Smart options:

| Field | Setting | Stored |
|---|---|---|
| KEY | Required | `USEEDIT +0x100` |
| C01 | Prompt Table Edit, PSOPRDEFN | `USEEDIT +0x4000`, `EDITTABLE` PSOPRDEFN |
| C02 | Prompt Table with No Edit, PSOPRDEFN | `EDITTABLE` PSOPRDEFN, no bit |
| C03 | Yes/No Table Edit | `USEEDIT +0x2000` |
| C07 | Smart Drop-Down (with a prompt edit) | `USEEDIT2 0x2000000` |
| VAL | Smart Prompt (with a prompt edit) | `USEEDIT2 0x1000000` |
| C04 | Default constant X | `DEFFIELDNAME` X, `DEFRECNAME` blank |
| C05 | Default ZZ_PCODE_LAB_T.ZZ_PCODE_LAB_KEY | `DEFRECNAME`, `DEFFIELDNAME` |
| C06 | Default Page Control | `DEFGUICONTROL` 99 → 5 |
| LASTUPDDTTM | Record Field Label ID DATE/TIME | `LABEL_ID` DATE/TIME, and `USEEDIT 0x800000` cleared |

`0x800000` is "Use Default Label": set exactly when `LABEL_ID` is blank
(495,108 of 495,111 delivered blank-label fields; 19,790 of 19,891 labelled
ones lack it). Choosing a prompt table makes App Designer tick the Smart
options by default. Prompt Table with No Edit is `EDITTABLE` without the
prompt bit (2,211 delivered fields). Native save rd6 (Required off, No Edit,
default cleared, System Default, default label, Smart off) wrote the same
shape.

## Cases r17-r25: the App Designer re-save, Record Properties

- **r17, re-save check**: App Designer re-saved `ZZ_PCODE_LAB_R1`, last
  written by the writer, after List Box Item was ticked and unticked on C01.
  Every row came back identical but C01's stamp: App Designer takes the
  writer's rows as its own.
- **r18, General**: `RECDESCR`, `DESCRLONG` (Record Definition),
  `OBJECTOWNERID` (an owner ID is a translate value of OBJECTOWNERID).
- **r19, Use**: Set Control Field `SETCNTRLFLD`, Parent `PARENTRECNAME`,
  Related Language `RELLANGRECNAME`, Query Security `QRYSECRECNAME`,
  Analytic Delete `OPTDELRECNAME`, Audit record `AUDITRECNAME`, Timestamp
  Field `TIMESTAMPFIELDNAME`. App Designer also set `RECUSE` 15 (every audit
  option), `OPTTRIGFLAG` Y, and on the timestamp field `USEEDIT 0x4000000`
  -- Auto-Update -- without restamping it (10 of 11 delivered timestamp
  fields carry it).
- **r20-r23, audit options** (`RECUSE`): Add 1, Change 2, Delete 4,
  Selective 8. Delivered records set RECUSE only with an audit record.
- **r24 / r25**: Tools Table `AUXFLAGMASK 0x10000`, Managed `0x20000`.

The writer changes the plain Record Properties (description, definition up
to 4,000 characters, owner ID, set control field, parent / related language
/ query security / analytic delete records) and Tools Table / Managed; it
does not change the audit record or options or the system ID / timestamp
fields, which App Designer couples to other settings. r18 is replayed;
native save rd7 wrote the same shape (record row only).

## Cases r26-r31: record types, Save As (Round 2, part A)

On `ZZ_PCODE_LAB_T`, one change per save, bracketed afterwards:

| Case | Change | Rows |
|---|---|---|
| r26 | Derived/Work -> SQL Table, no key | `RECTYPE` 0, `INDEXCOUNT` 0, no `_` index; a `PSRECTBLSPC` row inserted (AAAPP / PSHRDMOB) |
| r27 | Non-Standard SQL Table Name | `SQLTABLENAME` PS_ZZ_PCODE_LAB_TX |
| r28 | -> SQL View, Build Sequence 2, SQL text | `RECTYPE` 1, `BUILDSEQNO` 2; `PSRECTBLSPC` row deleted; `PSSQLDEFN` (SQLTYPE 2, VERSION = new SRM), `PSSQLDESCR` (GBL, ' ', 1900-01-01), `PSSQLHASH` (HASH_SIGNATURE: the PSPCMTXT algorithm over the text), `PSSQLTEXTDEFN`; PSVERSION RDM, **SRM** and SYS + 1 |
| r29 | Materialized View | `AUXFLAGMASK 0x1000000`; a `PSPTMATVWDEFN` row; two `PSRECTBLSPC` rows (PSMATVW, and PTAPPE with DBTYPE 1); the SQL rows rewritten, SRM + 1 |
| r30 | Save As ZZ_PCODE_TMP, Temporary Table | a new `PSRECDEFN` (`RECTYPE` 7), its field rows, the source's tablespace rows |
| r31 | Save As ZZ_PCODE_TM, GTT | as r30, `AUXFLAGMASK 0x400000` |

The Temporary Table change on T itself was refused by App Designer: the
record name plus the TAO suffix is too long, so r30 / r31 are Save As.
T was left an SQL View.

**Referring records.** Every save of T also set `ZZ_PCODE_LAB_R1`'s
`VERSION` to the new RDM, without restamping it. R1 refers to T as its
Related Language and Analytic Delete record. Which reference causes it is
not settled, so the writer refuses to save a record that another record
refers to (parent, related language, query security, analytic delete,
audit).

**SQL definitions.** The earlier SQL-definition save wrote no PSSQLHASH,
omitted the NOT NULL MARKET / DBTYPE columns, and moved a "SQL" counter
HRDMO does not have (App Designer moves SRM). It was replaced by the SQL
writer below (r33, r34).

## Cases r32-r37: referring records, SQL, Save As, rename, translates (Round 2, part B)

| Case | Change | What App Designer wrote |
|---|---|---|
| r32 | R1 refers to T by Related Language only; T saved | R1's `VERSION` set to T's new one, unstamped: the **Related Language** reference does it |
| r33 | new SQL definition ZZ_PCODE_LAB_SQL | `PSSQLDEFN` (VERSION = new SRM), `PSSQLDESCR`, `PSSQLHASH`, `PSSQLTEXTDEFN` (GBL, ' ', 1900-01-01, SEQNUM 0); SRM, SYS, PSLOCK SRM + 1 |
| r34 | its text changed | `PSSQLDEFN`, `PSSQLDESCR`, `PSSQLTEXTDEFN` deleted and reinserted, `PSSQLHASH` updated; SRM, SYS, PSLOCK SRM + 1 |
| r35 | Save As R1 -> ZZ_PCODE_LAB_R2 | the record, field, index, key and tablespace rows copied |
| r36 | Rename R2 -> R3 | every row of the record updated in place, `PSRECDEL` and `PSOBJCHNG` rows, and ~20 counters moved (pages, components, PeopleCode, projects, queries, App Engine, menus ...): not reproduced |
| r37 | translate value A on ZZ_PCODE_LAB_C01 | `PSXLATDEFN` (VERSION = new XTM), `PSXLATITEM` (SYNCID = `PSSYSTEMID.PTNEXTSYSTEMID` + 1, which moves too); PDM, XTM, SYS + 1 |

The record writer now does r32: records whose Related Language record is
the one saved take its new `VERSION` (native case rd9: ZZ_PCODE_LAB_R3).

## Cases r38-r44: translates, a record deleted, Analytic Delete

| Case | Change | What App Designer wrote |
|---|---|---|
| r38 | C01's value A renamed | `PSXLATITEM` restamped (`SYNCID` kept), `PSXLATDEFN` deleted and reinserted with VERSION = new XTM; PDM, XTM, SYS, PSLOCK PDM / XTM + 1 |
| r39 | C01's last value deleted | `PSXLATITEM` and `PSXLATDEFN` deleted, `PSXLATDEFNDEL` inserted (VERSION = new XTM); the same counters |
| r40 | record ZZ_PCODE_LAB_R3 deleted | every `PSRECDEFN`, `PSRECFIELD`, `PSRECFIELDDB`, `PSINDEXDEFN`, `PSKEYDEFN`, `PSRECTBLSPC` row of it deleted; `PSRECDEL` inserted (VERSION = new RDM); RDM, AEM, SYS, PSLOCK RDM / AEM + 1. R1, its Related Language record, was not touched. The table is not dropped |
| r41 | R1's Analytic Delete Record set to T; T saved | R1 unchanged: an **Analytic Delete** reference does not move the referring record |
| r42 | C01 (deleted in r39) given value A again | r37's rows, and the `PSXLATDEFNDEL` row deleted |
| r43 | value B added beside A | B inserted (next `SYNCID`); A deleted and reinserted unchanged (stamp, `SYNCID` kept); `PSXLATDEFN` deleted and reinserted, VERSION = new XTM |
| r44 | A deleted, B kept | A deleted; B and `PSXLATDEFN` rewritten as in r43; no `PSXLATDEFNDEL`, no `SYNCID` |

The record writer saves a record referred to as an Analytic Delete record
(r41). Parent, query security and audit references still refuse the save.

`deleteRecord` (`src/providers/recordWriter.ts`, the **Delete Record...**
command on a record in the trees) does r40 for scratch SQL Table and
Derived/Work records. It refuses a record that has Record PeopleCode, is a
subrecord of another record, is referred to by another record (any of the
five references), is on a page, is a component's search record, is in a
project (as a record, index or Record PeopleCode), has a materialized view
row, or already has a `PSRECDEL` row. Refusals were checked on HRDMO
(R1: in a project; ZZ_PCODE_TMP: outside the scratch names; T: a view).
Direct case x04 deleted ZZ_PCODE_LAB_R4 (a keyless SQL Table App Designer
created): the r40 rows and counters, `PSRECDEL` VERSION = the new RDM.

`saveTranslate` (`src/providers/translateWriter.ts`, the record editor's
Translates dialog) does r37-r39 and r42-r44: a value added (removing a
`PSXLATDEFNDEL` row), its names or status changed, a value deleted (the
last one leaving `PSXLATDEFNDEL`). App Designer rewrites every row of the
field; the ones it does not change come back identical, so the writer
writes only the changed rows (and updates `PSXLATDEFN.VERSION` in place
where App Designer deletes and reinserts it). Direct cases x01-x03 and
x05-x07 (ZZ_PCODE_LAB_C02) reproduced r37-r39 and r42-r44's end state and
counters. A value's key
(value, effective date) is changed by deleting it and adding another.
From the dialog itself (ZZ_PCODE_LAB_C03, 22:51-22:52): add, change and
delete each wrote the x01-x03 rows, `SYNCID` 63601, and moved PDM, XTM,
SYS and PSLOCK PDM / XTM by one.

The SQL writer (`src/providers/sqlWriter.ts`) does r34 for scratch SQL
definitions with one GBL / 1900-01-01 text row of at most 14,000
characters; lines are stored CRLF (all 46 multi-line delivered texts) and
without trailing whitespace; `HASH_SIGNATURE` is the PSPCMTXT algorithm
(r28, r33, r34 reproduced). Native case rd8 wrote the r34 shape.
It also creates one as r33 did (`PSSQLDEFN` with `ENABLEEFFDT` 'N',
`PSSQLDESCR` with a blank description, `PSSQLHASH`, `PSSQLTEXTDEFN`; SRM,
SYS, PSLOCK SRM + 1): direct case x12 (ZZ_PCODE_LAB_SQL2) wrote those rows,
its `HASH_SIGNATURE` identical to r33's for the same text.

## Creating a record

App Designer's first save of a new record (R1 in r02, created from
scratch; R2 in r35, by Save As) inserts:

- `PSRECDEFN`: VERSION = the new RDM, FIELDCOUNT / INDEXCOUNT, RECTYPE,
  blank names, `BUILDSEQNO` 1 (21,272 of 21,345 SQL Tables, 5,503 of 5,540
  Derived/Work), `OPTTRIGFLAG` 'N', `AUXFLAGMASK` 0, no `DESCRLONG`
- `PSRECFIELD` / `PSRECFIELDDB`: the new-field rows a save inserts
- `PSINDEXDEFN` / `PSKEYDEFN`: the key index, when there are keys
- `PSRECTBLSPC` for an SQL Table (all 21,345 have one, no Derived/Work
  record does): App Designer gave R1 and R4 AAAPP / PSHRDMOB, the first
  entry of the tablespace catalog `PSTBLSPCCAT` (82 entries, by name); R4 again
  when re-created (r47). ZZ_FIELD_REC's AALARGE (f06) was chosen in App
  Designer, not its default
- PSVERSION RDM, SYS + 1; PSLOCK RDM + 1

The record writer creates scratch SQL Table and Derived/Work records this
way (`createRecord`); direct case x13 (ZZ_PCODE_LAB_R5, a key and a field)
wrote those rows and counters. A name with a `PSRECDEL` row (deleted
before) is refused: how App Designer re-creates one is not established.

In VS Code: *New Definition... > Record* asks for the type and name and
opens the record editor with no fields; Insert Field, set keys, and the
first save creates the record.

## Record Type

`RECTYPE` 5 is Dynamic View (all 1,828 have view SQL), 6 Query View (all
74 have a query of the same name), 7 Temporary Table (the *_TMP records);
`src/model/record.ts` had 6, 7, 8. The Record Type tab shows each type's
controls as App Designer does: Build Sequence No (`BUILDSEQNO`) for views
and query views, the SQL for views and dynamic views (Click to open SQL
Editor opens it read-only), the query of a query view. Materialized View
(`AUXFLAGMASK 0x1000000`, r29) and Global Temporary Table (`0x400000`, r31)
show their stored state. Changing a record's type is not offered.

**Editing the Record Type tab.** The record writer saves the changes r26-r28
show, in the record's one transaction:

- Derived/Work -> SQL Table (r26): `RECTYPE` 0, a `PSRECTBLSPC` row (the
  catalog's first entry), and the key index if it has keys;
- SQL Table -> SQL View (r28): `RECTYPE` 1, the `PSRECTBLSPC` row deleted,
  the key index removed (views have none: 20,163 of 20,167 keyed SQL Views),
  the view SQL inserted (`PSSQLDEFN` SQLTYPE 2 with VERSION = new SRM,
  `PSSQLDESCR`, `PSSQLHASH`, `PSSQLTEXTDEFN`; SRM + 1);
- Derived/Work -> SQL View: r28 without a tablespace row to delete;
- Non-Standard SQL Table Name (r27, `SQLTABLENAME`, at most 18), Build
  Sequence No (r28, `BUILDSEQNO`);
- a view's SQL changed: its rows rewritten, SRM + 1 (as r29 rewrote them;
  a view saved without SQL changes leaves them, r32).

SQL Views and Dynamic Views are editable (fields, properties, SQL) unless
materialized or indexed. Direct cases x22-x25 (ZZ_PCODE_LAB_R7 Derived/Work
-> SQL Table -> SQL View -> new SQL; R5's SQL Table Name) wrote those rows
and counters; x23's `HASH_SIGNATURE` equals r28's for the same SQL. Other
type changes (to Derived/Work, from a view, to a SubRecord, Temporary Table
or Query View) are not observed and are refused.
## Record Field Properties

The dialog shows a check's state only where its bit is confirmed (every
bit in `UseEdit`); the rest (Search Edit, Default Search Field, Disable
Advanced Search Options, Allow Search Events, Auto-Update, Do Not Trace
Value, In Memory, Smart Drop-Down, Smart Prompt) show "–", and any stored
bit no check accounts for is listed. Editable: every setting r03-r16 exercised -- the Use checks, Required,
Prompt Table Edit / Prompt Table with No Edit / Yes/No Table Edit, label ID,
default value, and Default Page Control among the values seen (99, 5). `DEFGUICONTROL` 99 is "System Default" (a new
field's value, as App Designer showed it for ZZ_PCODE_LAB_C01).

## Still to capture

- alternate search keys (index type 3); In Memory; the System ID Field
- type changes from a view; materialized views; Query Views; SubRecords;
  Temporary Tables
- whether parent / query security / audit references move the referring
  record's VERSION (an audit record's save with R4 referring to it)
- SQL text over 14,000 characters
- a record containing a subrecord, and a subrecord used by other records
  (whether their `PSRECFIELDDB` rows are rewritten)

## Build Script

`src/model/recordDdl.ts` writes App Designer's Build > Create Tables script
for an SQL Table (never run): the Oracle DDL model's Create Table and Create
Index statements (`PSDDLMODEL` platform 2), filled with the record's and
its key index's parameters (`PSRECDDLPARM`, `PSIDXDDLPARM`) over the
defaults (`PSDDLDEFPARMS`), laid out as App Designer lays them out. It is
byte-identical to App Designer's scripts for ZZ_PCODE_LAB_R1 (Character
and DateTime columns, a unique key) and ZZ_PCODE_LAB_R6 (every column type,
a descending key, a duplicate order key):

- Character `VARCHAR2(n)` (the database is CHAR length semantics); Long
  Character `vARCHAR2(n)` up to 1,333, else `CLOB`; Number `SMALLINT` (up
  to 4), `INTEGER` (up to 9), `DECIMAL(n)`, `DECIMAL(n-1, d)`; Signed
  Number `SMALLINT` (up to 5), `INTEGER` (up to 11), `DECIMAL(n-1)`,
  `DECIMAL(n-2, d)`; Date `DATE`; Time `TIMESTAMP`; DateTime `tIMESTAMP`.
  The lowercase first letters are App Designer's (`iNDEX` too).
- NOT NULL: always for character and number columns; for Long, Date, Time
  and DateTime only when Required.
- CLOB and BLOB columns last, in field order.
- The key index: keys and duplicate order keys in field order, `UNIQUE`
  unless there is a duplicate order key, never `DESC` (none of HRDMO's
  172,848 index columns is, though 6,272 key fields are descending);
  `PARALLEL NOLOGGING`, then `ALTER INDEX ... NOPARALLEL LOGGING`.
- Lines of at most 70 characters, a moved word keeping its space; columns
  three spaces in; `/` after each statement.

## Cases r45-r53: last key, to Derived/Work, a deleted name, audit, timestamp, subrecord

Retroactive captures (Oracle flashback) of App Designer saves on HRDMO:

| Case | Change | What App Designer wrote |
|---|---|---|
| r45 | R5's last key removed | `PSINDEXDEFN` / `PSKEYDEFN` deleted, `INDEXCOUNT` 0; the field restamped |
| r46 | R5 SQL Table -> Derived/Work | `RECTYPE` 2, `SQLTABLENAME` cleared, `PSRECTBLSPC` deleted |
| r47 | ZZ_PCODE_LAB_R4 created again after its delete | the `PSRECDEL` row deleted, then the rows of a new record |
| r48 | LASTUPDDTTM added to view T | a field insert, as on a table |
| r49 | R4's audit record T, option Add | `AUDITRECNAME`, `RECUSE` 1, nothing else |
| r50 | LASTUPDDTTM inserted into R4 | a field insert |
| r51 | R4's Timestamp Field LASTUPDDTTM | `TIMESTAMPFIELDNAME`; the field's `USEEDIT` + Auto-Update (0x4000000), **not restamped** |
| r53 | subrecord ABS_HIST_BELSBR inserted into R5 (and Use changes) | one `PSRECFIELD` row (`SUBRECORD` 'Y', `USEEDIT` 0); `PSRECFIELDDB` gains the subrecord's fields, `RECNAME_PARENT` the subrecord, numbered on |

All moved RDM, SYS and PSLOCK RDM by one. The writer now does r45, r46,
r47, r49 and r51 (Record Properties' Use tab edits the audit record and
options and the Timestamp Field); direct cases x26-x30 (ZZ_PCODE_LAB_R2
re-created, audited, timestamped, keyless, Derived/Work) wrote the same
rows. The System ID Field is not captured.

**Subrecords** (r53). A Derived/Work record takes a subrecord as one
`PSRECFIELD` row (`SUBRECORD` 'Y', `USEEDIT` 0, the new-row values,
stamped); its `PSRECFIELDDB` holds the subrecord's own rows in its place,
`RECNAME_PARENT` the subrecord, numbered straight through (fields after a
subrecord continue the numbering, as ADHOC_SALCHG_WK's do after
SS_PROC_SBR); `FIELDCOUNT` counts the `PSRECFIELD` rows. The record editor
inserts subrecords into Derived/Work records (Insert Subrecord), and edits
records holding them; direct cases x35 (ABS_HIST_BELSBR into
ZZ_PCODE_LAB_R2) and x36 (R5 reordered around it) wrote those rows.
Refused, as not captured: subrecords in other record types, removing a
subrecord, nested subrecords. An alternate search key no longer stops a
Derived/Work record or view from being edited: only an SQL Table indexes
it (r53 saved R5 with one).

## Translate Table Edit

Set and cleared from the Edits tab: the translate bit (`USEEDIT 0x200`)
alone with a blank `EDITTABLE`, as 52,857 of HRDMO's 52,909 translate-edited
record fields store it, and only for a field with translate values (all
52,909 have them; the save checks). The 52 that also carry a prompt table
are shown, not changed. ZZ_PCODE_LAB_R5 took one (`ZZ_PCODE_LAB_C02`,
`USEEDIT 0x800200`); C03, which has no values, was refused.

## Default Page Control

`DEFGUICONTROL`, as App Designer names it (read off fields storing each
value): 99 System Default, 4 Edit Box, 5 Dropdown List, 7 Check Box, 8
Radio Button, 9 Image (image fields, not choosable). Subrecord rows store
0 and have no such setting. The editor offers 99, 4, 5, 7 and 8.
