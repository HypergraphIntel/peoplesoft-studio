# Oracle, SQL Server and DB2

PeopleSoft Studio connects to a PeopleSoft database on Oracle, Microsoft SQL
Server or DB2 (Linux, UNIX and Windows, or z/OS). The PeopleTools tables are
the same on every platform, so one provider (`src/providers/database.ts`)
reads and writes them all; what differs is in `src/db/`.

## Connecting

*PeopleSoft: Add Connection* asks for the type, then:

| Type | Connect string | Notes |
|---|---|---|
| Oracle | `host:1521/SERVICE`, or a TNS alias | node-oracledb Thin mode; Thick with `peoplesoft.oracle.thickModeLibDir` |
| SQL Server | `host[\instance][:port]/database`, e.g. `sqlhost:1433/HCM92` | SQL Server authentication; the driver ships with the extension |
| DB2 | `host[:port]/database`, e.g. `db2host:50000/HCM92` | z/OS: the database is the location name. Needs the DB2 driver (below) |

**Schema.** Empty, it is read from `PSDBOWNER` (the row for this database),
else the platform's default: Oracle `SYSADM`; SQL Server the login's default
schema; DB2 the user's. Oracle and DB2 set it as the session's current schema;
SQL Server has none, so when the PeopleTools schema is not the login's
default every statement names it (`dbo.PSRECDEFN`).

**Access, Operator ID, writes.** As on Oracle: a connection is Read-only
until it is set Writable, with a PeopleSoft operator that exists there.

### The DB2 driver

DB2 connections use IBM's `ibm_db` with its CLI driver, which is about 85 MB
and specific to the operating system, so it is not in the extension.
*PeopleSoft: Install DB2 Driver* installs it with npm into the extension's
storage (npm must be on the path); or set `peoplesoft.db2.driverPath` to a
directory holding `node_modules/ibm_db`. Reconnect afterwards.

- **DB2 for z/OS** is reached through DB2 Connect: its license file goes in
  the driver's `clidriver/license` folder.
- **Linux:** IBM's CLI driver needs `libxml2.so.2`. Distributions on a newer
  libxml2 (`libxml2.so.16`, e.g. Arch) need their compatibility package.

## How one provider serves three platforms

The provider's SQL is Oracle's -- Oracle was proven first and stays the
reference. `src/db/sqlTranslate.ts` rewrites each statement for SQL Server or
DB2 on its way to the driver, and refuses what it does not know
(`UntranslatableSqlError`) rather than pass Oracle SQL on:

| Oracle | SQL Server | DB2 |
|---|---|---|
| `a \|\| b` | `CONCAT(a, b)` | `a \|\| b` |
| `FETCH FIRST n ROWS ONLY` | `OFFSET 0 ROWS FETCH NEXT n ROWS ONLY` (`ORDER BY (SELECT NULL)` when there is none) | as is, the count written in |
| `SELECT ... FOR UPDATE` | `WITH (UPDLOCK, ROWLOCK)` on each table | `WITH RS USE AND KEEP UPDATE LOCKS` |
| `FROM DUAL` | dropped | `FROM SYSIBM.SYSDUMMY1` |
| `SYSTIMESTAMP` | `GETDATE()` (DATETIME databases) or `SYSDATETIME()` | `CURRENT TIMESTAMP` |
| `TO_CHAR` / `TO_DATE` / `TO_TIMESTAMP` with the provider's formats | `CONVERT` / `FORMAT` | `VARCHAR_FORMAT` / `DATE` / `TIMESTAMP` |
| `NVL(TRIM(x), y)` | `COALESCE(NULLIF(LTRIM(RTRIM(x)), ''), y)` | `COALESCE(NULLIF(TRIM(x), ''), y)` |
| `DBMS_LOB.SUBSTR` / `GETLENGTH`, `SUBSTR`, `RPAD`, `LENGTH` | `SUBSTRING`, `CAST AS NCHAR`, `LEN(x + 'x') - 1` | `SUBSTRING ... CODEUNITS16`, `CAST AS CHAR`, `LENGTH` |
| `:name` binds | `@name` | `?`, in order |

Oracle's empty string is NULL; `TRIM` of blanks is NULL, which `NVL(TRIM(..))`
relies on -- hence `NULLIF(.., '')`. The data dictionary (`ALL_TAB_COLUMNS`,
`ALL_TABLES`) is a per-platform catalog (`INFORMATION_SCHEMA`, `SYSCAT`).

Each connection is one transaction, begun at its first statement and ended
by the writers' COMMIT -- node-oracledb's behaviour. Build's DDL commits
statement by statement on every platform.

**SQL Server's datetimes.** Whether PeopleSoft's datetime columns are
`DATETIME` (1/300 s) or `DATETIME2` is read from `PSPCMPROG.LASTUPDDTTM` when
connecting. On `DATETIME`, timestamps bound as text are converted to it and
"now" is `GETDATE()`, so a stamp written and compared back matches exactly.

## Build

Build... uses the platform's own DDL model (PSDDLMODEL / PSDDLDEFPARMS /
PSRECDDLPARM by PLATFORMID: 2 Oracle, 7 SQL Server, 4 DB2 LUW, 1 DB2 z/OS)
and the record's table space row for the platform (PSRECTBLSPC.DBTYPE, else
the default). Column types follow PeopleTools' platform mapping:

| Field | Oracle | SQL Server | DB2 LUW | DB2 z/OS |
|---|---|---|---|---|
| Character | `VARCHAR2(n)` | `NVARCHAR(n)` | `VARGRAPHIC(n)` | `VARCHAR(n)` |
| Long Character | `vARCHAR2(n)` up to 1,333, else `CLOB` | `NVARCHAR(MAX)` | `DBCLOB` | `CLOB` |
| Long, Raw Binary; Image | `BLOB` | `VARBINARY(MAX)` | `BLOB` | `BLOB` |
| Number, Signed Number | `SMALLINT` / `INTEGER` / `DECIMAL(p, s)` | same | same | same |
| Date | `DATE` | `DATE` | `DATE` | `DATE` |
| Time | `TIMESTAMP` | `DATETIME` | `TIME` | `TIME` |
| DateTime | `tIMESTAMP` | `DATETIME` | `TIMESTAMP` | `TIMESTAMP` |

Scripts end each statement with `/` (Oracle), `go` (SQL Server) or `;` (DB2).
Oracle's scripts are App Designer's own, checked byte for byte. SQL Server's
and DB2's follow PeopleBooks' type mapping (Application Designer: field
definitions -- SQL Server `NVARCHAR(n)`, `NVARCHAR(MAX)`, `VARBINARY(MAX)`;
DB2 Unicode `VARGRAPHIC` / `DBCLOB`) and HRDMO's PSDDLMODEL rows; no App
Designer script for them has been captured, so their layout is this
extension's. DB2 z/OS table spaces and databases are named in the model
(`**OWNER**.[TBNAME] ... IN [DBNAME].[TBSPCNAME]`) and must exist.

## Evidence

No SQL Server or DB2 PeopleSoft database was available, so the lab is two
containers (SQL Server 2022 Developer, Db2 Community 12.1 LUW) loaded with the
124 PeopleTools tables the extension uses, copied row for row from HRDMO
(Oracle, PeopleTools 8.62; 4.49 million rows) with PeopleTools' column types
for each platform (`tools/lab/load-fixture.mts`).

- **Reading:** every definition type, 150 of each (5,105 outputs, the
  PeopleCode decoded), renders byte for byte as it does from Oracle on SQL
  Server and on DB2. The only differences: the sub-second part of raw
  timestamps in the Properties rows (SQL Server's DATETIME keeps 1/300 s),
  and on DB2 seven records whose DB2 table space row differs from the
  default (PSRECTBLSPC DBTYPE 4), as intended. SQL Server was also checked
  with a login whose default schema is not the PeopleTools one (every table
  qualified): 1,413 of 1,413 identical. DB2's schema came from PS.PSDBOWNER.
- **Writing:** `tools/lab/writer-roundtrip.mts` runs every writer -- project
  create and items, field create and save, translate add / change / delete,
  record create, build and delete, SQL, HTML and style sheet create and save,
  Application Package, Application Class and Record PeopleCode -- on each
  platform, each one verified in its transaction and again after COMMIT. The
  rows read back match Oracle's run of the same script on HRDMO, apart from
  version counters, timestamps and the platform's DDL; Build's scripts run
  on all three (on DB2 once the record's table spaces exist).
- **Oracle:** 5,095 of 5,105 outputs are byte for byte as before the
  change; the other ten are the fixes in 0.7.7 (the platform's table space
  row; reference, portal folder and node property lists in a fixed order).

**What is not proven:** no App Designer save has been captured on SQL Server
or DB2, so their writes are the same rows Oracle's captures proved, written
through each platform's driver -- **Experimental**. DB2 z/OS is assumed to
behave as DB2 LUW (the SQL used is common to both); it has not been run.

## Known differences

- SQL Server's DATETIME keeps 1/300 s; timestamps shown to the second are
  unaffected.
- `ibm_db` delivers its results at the event loop's next turn; while a DB2
  call is outstanding the adapter keeps the loop turning (`db2Call`),
  otherwise a call could wait seconds when another connection is open.
- `ibm_db`'s array insert crashes the process on LOB columns; the extension
  does not use it (the lab loader inserts LOB rows one at a time).

## Two-tier sign-on (2 Tier)

*Add Connection* also offers **2 Tier (Oracle)**, **2 Tier (MS SQL)** and
**2 Tier (DB2)**, like App Designer's two-tier sign-on. A two-tier connection
holds two accounts:

- a **Connect ID** -- the database login (e.g. `people` / `peop1e`) that is the
  proxy for everything: it opens the connection and runs every query and write;
- a **PeopleSoft operator** (OPRID, e.g. `PS`) -- the acting identity, recorded
  as `LASTUPDOPRID` when a definition is saved.

At connect the operator is verified against `PSOPRDEFN` through the proxy
login: it must exist and not be locked (`ACCTLOCK` 0), or sign-on fails as it
does in App Designer. The operator password is stored in the OS secret store;
its existence and lock state are checked, not the password hash.

**The access-profile lookup is never done.** App Designer, after the operator
signs on, reads and decrypts the access ID and password from `PSACCESSPRFL` and
reconnects as that access ID. This extension does not: the Connect ID you enter
is the login that reaches the PeopleTools tables, so it must have the read (and,
for writes, write) access the work needs. In many databases the delivered
`people` Connect ID has only sign-on access -- give the connection a login that
can read the tables (often the schema owner), or grant the Connect ID access.

Everything else is the same as a direct connection: schema detection, Access
(Read-only / Writable), and the writers. Because the operator is part of
sign-on, a writable two-tier connection needs no separately configured
Operator ID.
