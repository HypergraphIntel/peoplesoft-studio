/*
 * Cycle 185: before / after snapshots of a native PeopleTools save, to
 * characterize the save transaction PeopleSoft Studio must reproduce
 * (docs/PEOPLECODE_WRITEBACK.md, docs/CONTROLLED_COMPILE_LAB.md).
 *
 * STRICTLY READ ONLY. The lab account is SYSADM itself, so nothing at the
 * database level stops a write; this tool only ever runs SELECTs inside a
 * READ ONLY transaction, which it rolls back.
 *
 *   before --case NAME   marker (SCN + timestamp), full watch-set rows,
 *                        row counts of every in-scope table
 *   (save in App Designer)
 *   after  --case NAME   the same again, a change sweep of every in-scope
 *                        table, and delta.json:
 *     - watch-set delta, keyed by each table's unique index: inserted,
 *       deleted and updated rows (column-level before / after);
 *     - every other in-scope table with a changed row: flashback diff of
 *       the touched blocks (AS OF SCN before vs now), by ROWID, as inserts,
 *       deletes and updates;
 *     - a transition summary per changed ZZ_PCODE_LAB definition.
 *
 * Watch set: PSPCMTXT / PSPCMPROG / PSPCMNAME rows under ZZ_PCODE_LAB%,
 * the scratch package, class and project definitions, and all of PSVERSION
 * and PSLOCK. Scope: PeopleTools tables (PS% but not PS_%) plus any non-PS
 * table; --scope all adds the application tables (PS_%).
 *
 * Values: NUMBER as exact decimal strings; DATE / TIMESTAMP as ISO strings
 * with full fractional seconds; BLOB / RAW as lowercase hex; CLOB / LONG
 * as text. Each table's column types are recorded once.
 *
 * Connection: PSLAB_ACCESSID / PSLAB_ACCESSPSWD, PSLAB_AUDIT_CONNECT
 * (default 127.0.0.1:15210/hrdmo). The database must be HRDMO (--database
 * to override); protected institutional databases are refused.
 *
 *   npx tsx tools/corpus/save-protocol/snapshot.ts before --case 01-create
 *   npx tsx tools/corpus/save-protocol/snapshot.ts after  --case 01-create
 *
 * --omit-nonlab-rows retains scoped watch rows and global table/count observations,
 * but never reads or retains unrelated swept row values (including authentication
 * maintenance). It does not certify unknown nonlab side effects.
 *
 * A save made before "before" ran can still be bracketed while undo covers
 * it: `before --as-of 'YYYY-MM-DD HH24:MI:SS'` (or `--as-of scn:NNN`) reads the watch set and the
 * counts AS OF that time (flashback). `after --as-of` closes the window at a
 * past time the same way, so several saves made in a row can each be
 * bracketed afterwards. Snapshots so taken record `retroactive`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import oracledb from 'oracledb';

import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import { predictSourceSignature } from '../../../src/peoplecode/sourceSignature';
import { ibSecretColumn } from '../../../src/model/ibOperations';

const FORMAT = 'save-protocol-snapshot/1';
const SCRATCH_LIKE = `'ZZ\\_PCODE\\_LAB%' ESCAPE '\\'`;
/** App Engine program names are at most 12 characters: their scratch prefix is ZZ_AE_. */
const SCRATCH_AE_LIKE = `'ZZ\\_AE\\_%' ESCAPE '\\'`;
const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');
/** Rows recorded per swept table; a noisy log table must not swamp the delta. */
const SWEEP_ROW_CAP = 500;

// --------------------------------------------------------------------------
// Types

interface Column { name: string; type: string; length: number; nullable: boolean }
type Value = string | null;
interface TableRows { columns: Column[]; key: string[]; rows: Value[][] }

interface Marker { scn: string; timestamp: string }

interface Snapshot {
  format: typeof FORMAT;
  phase: 'before' | 'after';
  case: string;
  database: string;
  peopleToolsRelease: string;
  scope: 'tools' | 'all';
  marker: Marker;
  /** Read AS OF the marker by flashback, after the fact. */
  retroactive?: boolean;
  watch: Record<string, TableRows & { filter: string }>;
  counts: Record<string, number>;
}

interface RowChange { key: Record<string, Value>; changes: Record<string, { before: Value; after: Value }> }
interface TableDelta {
  columns: Column[];
  inserted: Record<string, Value>[];
  deleted: Record<string, Value>[];
  updated: RowChange[];
  truncated?: boolean;
  note?: string;
}

// --------------------------------------------------------------------------
// Session

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Session {
  connection: oracledb.Connection;
  select<T = Record<string, unknown>>(sql: string, binds?: oracledb.BindParameters): Promise<T[]>;
  database: string;
  release: string;
}

async function open(expected: string): Promise<Session> {
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const user = process.env.PSLAB_ACCESSID;
  const password = process.env.PSLAB_ACCESSPSWD;
  if (!user || !password) throw new Error('PSLAB_ACCESSID and PSLAB_ACCESSPSWD must be set.');

  // Exact values: numbers as strings, CLOB as text, BLOB as bytes. Dates and
  // timestamps are converted in SQL (see selectList): thin mode renders a
  // timestamp fetched as a string through Date.toString(), losing the
  // microseconds and the zone.
  const asString = new Set<unknown>([
    oracledb.DB_TYPE_NUMBER, oracledb.DB_TYPE_BINARY_FLOAT, oracledb.DB_TYPE_BINARY_DOUBLE,
    oracledb.DB_TYPE_CLOB, oracledb.DB_TYPE_NCLOB
  ]);
  oracledb.fetchTypeHandler = (meta) => {
    if (asString.has(meta.dbType)) return { type: oracledb.STRING };
    if (meta.dbType === oracledb.DB_TYPE_BLOB) return { type: oracledb.BUFFER };
    return undefined;
  };

  const connection = await oracledb.getConnection({
    user, password, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
  });
  try {
    await connection.execute(`ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF9'`);
    await connection.execute(`ALTER SESSION SET NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM'`);
    await connection.execute(`ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS'`);
    await connection.execute('SET TRANSACTION READ ONLY');
    const select = async <T>(sql: string, binds: oracledb.BindParameters = {}) =>
      ((await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as T[];
    const [identity] = await select<{ DB: string; TOOLSREL: string; PTPATCHREL: string }>(
      `SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB, TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS`);
    const database = String(identity?.DB ?? '').trim();
    if (PROTECTED_DATABASE_PATTERN.test(database)) throw new Error(`Connected to ${database}, a protected institutional database: refusing.`);
    if (database.toUpperCase() !== expected.toUpperCase()) throw new Error(`Connected to ${database}, not ${expected}: refusing.`);
    return {
      connection, select, database,
      release: `${String(identity?.TOOLSREL).trim()}.${String(identity?.PTPATCHREL).trim().padStart(2, '0')}`
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    await connection.close();
    throw error;
  }
}

async function close(session: Session): Promise<void> {
  await session.connection.rollback();
  await session.connection.close();
}

/**
 * The marker: an SCN no later than the snapshot's own read point, and the
 * database clock. TIMESTAMP_TO_SCN may round down, which only widens the
 * window the after-sweep looks at -- never narrows it.
 */
async function marker(session: Session): Promise<Marker> {
  const [row] = await session.select<{ SCN: string; TS: string }>(
    `SELECT TO_CHAR(TIMESTAMP_TO_SCN(SYSTIMESTAMP)) AS SCN,
            TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM') AS TS FROM DUAL`);
  return { scn: row.SCN, timestamp: row.TS };
}

/**
 * A past marker, for a retroactive before / after: the SCN at that
 * database-clock time, or an exact SCN given as scn:NNN -- for saves too close
 * together for TIMESTAMP_TO_SCN's few-second granularity (find their commit
 * SCNs with a VERSIONS BETWEEN query).
 */
async function markerAt(session: Session, at: string): Promise<Marker> {
  const exact = /^scn:(\d+)$/.exec(at);
  if (exact) {
    const [row] = await session.select<{ TS: string }>(
      `SELECT TO_CHAR(SCN_TO_TIMESTAMP(TO_NUMBER(:scn)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') || TO_CHAR(SYSTIMESTAMP, 'TZH:TZM') AS TS FROM DUAL`,
      { scn: exact[1] });
    return { scn: exact[1], timestamp: row.TS };
  }
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,9})?$/.test(at)) {
    throw new Error(`--as-of must be 'YYYY-MM-DD HH24:MI:SS[.FF]' on the database clock, not ${JSON.stringify(at)}.`);
  }
  const [row] = await session.select<{ SCN: string; TS: string }>(
    `SELECT TO_CHAR(TIMESTAMP_TO_SCN(TO_TIMESTAMP(:at, 'YYYY-MM-DD HH24:MI:SS.FF'))) AS SCN,
            TO_CHAR(FROM_TZ(TO_TIMESTAMP(:at, 'YYYY-MM-DD HH24:MI:SS.FF'), TO_CHAR(SYSTIMESTAMP, 'TZH:TZM')),
                    'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM') AS TS FROM DUAL`, { at: at.includes('.') ? at : `${at}.0` });
  return { scn: row.SCN, timestamp: row.TS };
}

// --------------------------------------------------------------------------
// Values and tables

function encode(value: unknown, _column: Column): Value {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

async function columnsOf(session: Session, table: string): Promise<Column[]> {
  const rows = await session.select<{ C: string; T: string; L: string; N: string }>(
    `SELECT COLUMN_NAME AS C, DATA_TYPE AS T, DATA_LENGTH AS L, NULLABLE AS N
       FROM ALL_TAB_COLUMNS WHERE OWNER = 'SYSADM' AND TABLE_NAME = :t ORDER BY COLUMN_ID`, { t: table });
  return rows.map((r) => ({ name: r.C, type: r.T, length: Number(r.L), nullable: r.N === 'Y' }));
}

/** The table's unique-index columns: PeopleTools keys every table this way. Empty when it has none. */
async function keyOf(session: Session, table: string): Promise<string[]> {
  const rows = await session.select<{ I: string; C: string }>(
    `SELECT ic.INDEX_NAME AS I, ic.COLUMN_NAME AS C
       FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS ic ON ic.INDEX_OWNER = i.OWNER AND ic.INDEX_NAME = i.INDEX_NAME
      WHERE i.TABLE_OWNER = 'SYSADM' AND i.TABLE_NAME = :t AND i.UNIQUENESS = 'UNIQUE'
      ORDER BY ic.INDEX_NAME, ic.COLUMN_POSITION`, { t: table });
  const first = rows[0]?.I;
  return rows.filter((r) => r.I === first).map((r) => r.C);
}

/** A column as selected: dates and timestamps as exact ISO text, everything else as is. */
function selectExpression(c: Column, alias: string): string {
  const col = `${alias}.${quote(c.name)}`;
  if (c.type === 'DATE') return `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS') AS ${quote(c.name)}`;
  if (/^TIMESTAMP\(\d\) WITH (LOCAL )?TIME ZONE$/.test(c.type)) {
    return `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM') AS ${quote(c.name)}`;
  }
  if (/^TIMESTAMP/.test(c.type)) return `TO_CHAR(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${quote(c.name)}`;
  return col;
}

const selectList = (columns: Column[], alias = 't') =>
  columns.map((c) => selectExpression(c, alias)).join(', ');

async function readRows(session: Session, table: string, columns: Column[], where: string, asOfScn?: string): Promise<Value[][]> {
  const rows = await session.select(
    `SELECT ${selectList(columns)} FROM SYSADM.${quote(table)}${asOfScn ? ' AS OF SCN :asof' : ''} t ${where}`,
    asOfScn ? { asof: asOfScn } : {});
  return rows.map((r) => columns.map((c) => encode(r[c.name], c)));
}

// --------------------------------------------------------------------------
// Watch set

/** Tables captured in full (or their scratch rows), with the filter that scopes them. */
const WATCH: Array<{ table: string; scratchColumn?: string }> = [
  { table: 'PSPCMTXT', scratchColumn: 'OBJECTVALUE1' },
  { table: 'PSPCMPROG', scratchColumn: 'OBJECTVALUE1' },
  { table: 'PSPCMNAME', scratchColumn: 'OBJECTVALUE1' },
  { table: 'PSPACKAGEDEFN', scratchColumn: 'PACKAGEROOT' },
  { table: 'PSAPPCLASSDEFN', scratchColumn: 'PACKAGEROOT' },
  { table: 'PSPROJECTDEFN', scratchColumn: 'PROJECTNAME' },
  { table: 'PSPROJECTITEM', scratchColumn: 'PROJECTNAME' },
  // Page save capture (docs/PAGE_SAVE.md): the scratch page's definition and
  // its controls, keyed PNLNAME / (PNLNAME, PNLFLDID). The page version
  // counter is PSVERSION/PSLOCK 'PDM' (proven, 01-09). Anything else a save
  // touches is caught by the scope sweep's flashback diff.
  { table: 'PSPNLDEFN', scratchColumn: 'PNLNAME' },
  { table: 'PSPNLFIELD', scratchColumn: 'PNLNAME' },
  { table: 'PSPNLFIELDEXT', scratchColumn: 'PNLNAME' },
  // Component save capture (docs/COMPONENTS.md): the scratch component's
  // definition, its page items, its extension and style objects, keyed
  // (PNLGRPNAME, MARKET).
  { table: 'PSPNLGRPDEFN', scratchColumn: 'PNLGRPNAME' },
  { table: 'PSPNLGROUP', scratchColumn: 'PNLGRPNAME' },
  { table: 'PSPNLGRPDEFNEXT', scratchColumn: 'PNLGRPNAME' },
  { table: 'PSPNLGRPSCRIPTS', scratchColumn: 'PNLGRPNAME' },
  // App Engine save capture (docs/APP_ENGINE.md): the scratch program's
  // definition rows, keyed by AE_APPLID, and its actions' SQL definitions
  // (SQLID starts with the program name padded to 12).
  { table: 'PSAEAPPLDEFN', scratchColumn: 'AE_APPLID' },
  { table: 'PSAEAPPLSTATE', scratchColumn: 'AE_APPLID' },
  { table: 'PSAEAPPLTEMPTBL', scratchColumn: 'AE_APPLID' },
  { table: 'PSAEAPPLLANG', scratchColumn: 'AE_APPLID' },
  { table: 'PSAEAPPLDEL', scratchColumn: 'AE_APPLID' },
  { table: 'PSAESECTDEFN', scratchColumn: 'AE_APPLID' },
  { table: 'PSAESECTDEL', scratchColumn: 'AE_APPLID' },
  { table: 'PSAESECTDTLDEFN', scratchColumn: 'AE_APPLID' },
  { table: 'PSAESTEPDEFN', scratchColumn: 'AE_APPLID' },
  { table: 'PSAESTMTDEFN', scratchColumn: 'AE_APPLID' },
  { table: 'PSAESTEPMSGDEFN', scratchColumn: 'AE_APPLID' },
  { table: 'PSSQLDEFN', scratchColumn: 'SQLID' },
  { table: 'PSSQLDESCR', scratchColumn: 'SQLID' },
  { table: 'PSSQLTEXTDEFN', scratchColumn: 'SQLID' },
  { table: 'PSSQLHASH', scratchColumn: 'SQLID' },
  { table: 'PSSQLDEL', scratchColumn: 'SQLID' },
  { table: 'PSSQLLANG', scratchColumn: 'SQLID' },
  { table: 'PSCONTDEFN', scratchColumn: 'CONTNAME' },
  { table: 'PSCONTENT', scratchColumn: 'CONTNAME' },
  { table: 'PSCONTDEFNLANG', scratchColumn: 'CONTNAME' },
  { table: 'PSCONTENTLANG', scratchColumn: 'CONTNAME' },
  { table: 'PSCONTDEL', scratchColumn: 'CONTNAME' },
  { table: 'PSSTYLSHEETDEFN', scratchColumn: 'STYLESHEETNAME' },
  { table: 'PSSTYLSHEETDEL', scratchColumn: 'STYLESHEETNAME' },
  { table: 'PSSTYLECLASS', scratchColumn: 'STYLESHEETNAME' },
  // Menu save capture (docs/MENUS.md): the scratch menu's rows.
  { table: 'PSMENUDEFN', scratchColumn: 'MENUNAME' },
  { table: 'PSMENUITEM', scratchColumn: 'MENUNAME' },
  { table: 'PSMENUDEFNLANG', scratchColumn: 'MENUNAME' },
  { table: 'PSMENUITEMLANG', scratchColumn: 'MENUNAME' },
  { table: 'PSMENUDEL', scratchColumn: 'MENUNAME' },
  { table: 'PSMENUORIGIN', scratchColumn: 'MENUNAME' },
  { table: 'PSXFERITEM', scratchColumn: 'MENUNAME' },
  { table: 'PSVERSION' },
  { table: 'PSLOCK' }
];

async function captureWatch(session: Session, asOfScn?: string): Promise<Snapshot['watch']> {
  const out: Snapshot['watch'] = {};
  // Query/project deletion may touch ancillary tables beyond the writer's
  // modeled scope. Capture every base-table row keyed by these lab identities,
  // without retaining unrelated values from the global change survey.
  const keyed = await session.select<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    `SELECT T.TABLE_NAME, C.COLUMN_NAME FROM ALL_TABLES T JOIN ALL_TAB_COLUMNS C
       ON C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME
      WHERE T.OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA')
        AND SUBSTR(T.TABLE_NAME,1,2)='PS' AND SUBSTR(T.TABLE_NAME,3,1)<>'_'
        AND C.COLUMN_NAME IN ('QRYNAME','PROJECTNAME','IB_SERVICENAME','IB_OPERATIONNAME') ORDER BY T.TABLE_NAME,C.COLUMN_NAME`);
  const extra = keyed.filter((row, i) => !WATCH.some(w => w.table === row.TABLE_NAME) && keyed.findIndex(r => r.TABLE_NAME === row.TABLE_NAME) === i).map(row => ({ table: row.TABLE_NAME, scratchColumn: row.COLUMN_NAME }));
  // REST operation lifecycle also removes the routing PIA generated for it: watch
  // the named routings (--routings) in every routing-keyed table not already covered.
  const routings = (argument('routings') ?? '').split(',').filter(Boolean);
  for (const r of routings) if (!/^(~GENERATED~[0-9]+|ZZ_PCODE_LAB[A-Z0-9_]*)$/.test(r)) throw new Error(`Invalid routing ${JSON.stringify(r)}.`);
  const routingTables = routings.length ? (await session.select<{ TABLE_NAME: string }>(
    `SELECT T.TABLE_NAME FROM ALL_TABLES T JOIN ALL_TAB_COLUMNS C ON C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME
      WHERE T.OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND SUBSTR(T.TABLE_NAME,1,2)='PS' AND SUBSTR(T.TABLE_NAME,3,1)<>'_'
        AND C.COLUMN_NAME='ROUTINGDEFNNAME' ORDER BY T.TABLE_NAME`)).map(r => r.TABLE_NAME)
    .filter(t => !WATCH.some(w => w.table === t) && !extra.some(w => w.table === t)) : [];
  for (const table of routingTables) {
    const columns = (await columnsOf(session, table)).filter(c => !ibSecretColumn(c.name) && !['PROPVALUE','DATACHUNK','MESSAGEDATA'].includes(c.name));
    // Named routings (already deleted ones included) plus any routing a lab operation owns now, so a
    // routing generated during the window appears as an insertion.
    const filter = `WHERE (t.${quote('ROUTINGDEFNNAME')} IN (${routings.map(r => `'${r}'`).join(',')}) OR t.${quote('ROUTINGDEFNNAME')} IN
      (SELECT R.ROUTINGDEFNNAME FROM PSIBRTNGDEFN R WHERE R.IB_OPERATIONNAME LIKE ${SCRATCH_LIKE}))`;
    out[table] = { columns, key: await keyOf(session, table), filter, rows: await readRows(session, table, columns, filter, asOfScn) };
  }
  for (const w of [...WATCH, ...extra]) {
    // Never retain a project's target login/account material, even in a lab
    // capture. Those columns are outside the reviewed noncredential scope.
    const ib = keyed.some(r => r.TABLE_NAME === w.table && ['IB_SERVICENAME','IB_OPERATIONNAME'].includes(r.COLUMN_NAME));
    const columns = (await columnsOf(session, w.table)).filter(c => (w.table !== 'PSPROJECTDEFN' || !['TGTOPRID','TGTOPRACCT'].includes(c.name)) && (!ib || !ibSecretColumn(c.name) && !['PROPVALUE','DATACHUNK','MESSAGEDATA'].includes(c.name)));
    if (columns.length === 0) continue;
    if (w.scratchColumn && !columns.some((c) => c.name === w.scratchColumn)) {
      throw new Error(`${w.table} has no ${w.scratchColumn} column; the watch-set filter needs updating.`);
    }
    const scratchColumns = w.scratchColumn ? [...new Set([w.scratchColumn, ...keyed.filter(r => r.TABLE_NAME === w.table).map(r => r.COLUMN_NAME)])] : [];
    const filter = scratchColumns.length
      ? `WHERE (${scratchColumns.map(column => `(t.${quote(column)} LIKE ${SCRATCH_LIKE} OR t.${quote(column)} LIKE ${SCRATCH_AE_LIKE})`).join(' OR ')})` : '';
    const key = await keyOf(session, w.table);
    out[w.table] = { columns, key, filter, rows: await readRows(session, w.table, columns, filter, asOfScn) };
  }
  return out;
}

// --------------------------------------------------------------------------
// Scope and sweep

async function scopeTables(session: Session, scope: 'tools' | 'all'): Promise<string[]> {
  const rows = await session.select<{ T: string }>(
    `SELECT TABLE_NAME AS T FROM ALL_TABLES
      WHERE OWNER = 'SYSADM' AND TEMPORARY = 'N' AND NESTED = 'NO' AND IOT_TYPE IS NULL
        ${scope === 'tools' ? `AND NOT (TABLE_NAME LIKE 'PS\\_%' ESCAPE '\\')` : ''}
      ORDER BY TABLE_NAME`);
  return rows.map((r) => r.T);
}

function progress(label: string, i: number, n: number): void {
  if (process.stderr.isTTY && (i % 50 === 0 || i === n)) process.stderr.write(`\r${label} ${i}/${n}`);
  if (process.stderr.isTTY && i === n) process.stderr.write('\n');
}

async function countAll(session: Session, tables: string[], asOfScn?: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let i = 0;
  for (const table of tables) {
    progress('counting', ++i, tables.length);
    try {
      const [r] = await session.select<{ N: string }>(
        `SELECT COUNT(*) AS N FROM SYSADM.${quote(table)}${asOfScn ? ' AS OF SCN :asof' : ''}`,
        asOfScn ? { asof: asOfScn } : {});
      counts[table] = Number(r.N);
    } catch {
      counts[table] = -1; // unreadable (e.g. an external table); reported as such
    }
  }
  return counts;
}

/** Tables with a row changed since `scn`, and each table's count now. */
async function sweep(session: Session, tables: string[], scn: string): Promise<{ counts: Record<string, number>; touched: string[] }> {
  const counts: Record<string, number> = {};
  const touched: string[] = [];
  let i = 0;
  for (const table of tables) {
    progress('sweeping', ++i, tables.length);
    try {
      const [r] = await session.select<{ N: string; C: string }>(
        `SELECT COUNT(*) AS N, NVL(SUM(CASE WHEN ORA_ROWSCN > :scn THEN 1 ELSE 0 END), 0) AS C FROM SYSADM.${quote(table)}`,
        { scn });
      counts[table] = Number(r.N);
      if (Number(r.C) > 0) touched.push(table);
    } catch {
      counts[table] = -1;
    }
  }
  return { counts, touched };
}

const BLOCK = (alias: string) =>
  `DBMS_ROWID.ROWID_RELATIVE_FNO(${alias}.ROWID), DBMS_ROWID.ROWID_BLOCK_NUMBER(${alias}.ROWID)`;

/**
 * Flashback diff of one table between `scn` and now, by ROWID: the rows of
 * every block a change touched, before and after. A table whose count
 * changed with no touched block left (every row of a block deleted) is
 * diffed by its whole ROWID set instead.
 */
async function diffTable(session: Session, table: string, scn: string, wholeTable: boolean, afterScn?: string): Promise<TableDelta> {
  const columns = (await columnsOf(session, table))
    .filter((c) => c.type !== 'LONG' && c.type !== 'LONG RAW'); // not selectable AS OF
  const list = selectList(columns);
  // The rows changed in the window, by flashback version query: every row
  // version a transaction in (scn, afterScn] wrote, deletes included, wherever
  // the row lives. Each such ROWID is then read AS OF both ends. Where the
  // version query is unavailable, fall back to the blocks changed since `scn`
  // (a superset; it can miss a delete whose block was later emptied).
  const ridsOf = async (): Promise<string[] | undefined> => {
    try {
      const rows = await session.select<{ RID__: string }>(
        `SELECT DISTINCT ROWIDTOCHAR(t.ROWID) AS RID__ FROM SYSADM.${quote(table)}
           VERSIONS BETWEEN SCN :scn AND ${afterScn ? ':at' : 'MAXVALUE'} t
          WHERE t.VERSIONS_OPERATION IS NOT NULL
            AND (t.VERSIONS_STARTSCN > :scn OR t.VERSIONS_OPERATION = 'D')
            ${afterScn ? 'AND (t.VERSIONS_STARTSCN IS NULL OR t.VERSIONS_STARTSCN <= :at)' : ''}`,
        afterScn ? { scn, at: afterScn } : { scn });
      return rows.map((r) => String(r.RID__)).filter((rid) => /^[A-Za-z0-9+/]+$/.test(rid));
    } catch {
      return undefined;
    }
  };
  const rids = wholeTable ? undefined : await ridsOf();
  const read = async (at: string | undefined) => {
    const source = `SYSADM.${quote(table)}${at ? ' AS OF SCN :at' : ''} t`;
    if (rids) {
      const out = new Map<string, Value[]>();
      for (let i = 0; i < rids.length; i += 500) {
        const chunk = rids.slice(i, i + 500).map((rid) => `CHARTOROWID('${rid}')`).join(', ');
        const rows = await session.select(`SELECT ROWIDTOCHAR(t.ROWID) AS RID__, ${list} FROM ${source} WHERE t.ROWID IN (${chunk})`,
          at ? { at } : {});
        for (const r of rows) out.set(String(r.RID__), columns.map((c) => encode(r[c.name], c)));
      }
      return out;
    }
    const where = wholeTable ? '' :
      `WHERE (${BLOCK('t')}) IN (SELECT ${BLOCK('c')} FROM SYSADM.${quote(table)} c WHERE ORA_ROWSCN > :scn)`;
    const binds: Record<string, string> = {};
    if (at) binds.at = at;
    if (!wholeTable) binds.scn = scn;
    const rows = await session.select(`SELECT ROWIDTOCHAR(t.ROWID) AS RID__, ${list} FROM ${source} ${where}`, binds);
    return new Map(rows.map((r) => [String(r.RID__), columns.map((c) => encode(r[c.name], c))]));
  };
  const before = await read(scn);
  const after = await read(afterScn);

  const named = (values: Value[]) => Object.fromEntries(columns.map((c, i) => [c.name, values[i]]));
  const delta: TableDelta = { columns, inserted: [], deleted: [], updated: [] };
  for (const [rid, values] of after) {
    const old = before.get(rid);
    if (!old) delta.inserted.push(named(values));
    else {
      const changes: RowChange['changes'] = {};
      columns.forEach((c, i) => { if (old[i] !== values[i]) changes[c.name] = { before: old[i], after: values[i] }; });
      if (Object.keys(changes).length > 0) delta.updated.push({ key: { ROWID: rid }, changes });
    }
  }
  for (const [rid, values] of before) if (!after.has(rid)) delta.deleted.push(named(values));

  for (const list of [delta.inserted, delta.deleted, delta.updated] as unknown[][]) {
    if (list.length > SWEEP_ROW_CAP) { list.length = SWEEP_ROW_CAP; delta.truncated = true; }
  }
  return delta;
}

// --------------------------------------------------------------------------
// Watch-set delta and the transition summary

function keyed(t: TableRows): Map<string, Value[]> {
  const indexes = (t.key.length > 0 ? t.key : t.columns.map((c) => c.name))
    .map((k) => t.columns.findIndex((c) => c.name === k));
  return new Map(t.rows.map((r) => [JSON.stringify(indexes.map((i) => r[i])), r]));
}

function diffWatch(before: TableRows, after: TableRows): TableDelta {
  const b = keyed(before);
  const a = keyed(after);
  const named = (values: Value[]) => Object.fromEntries(after.columns.map((c, i) => [c.name, values[i]]));
  const delta: TableDelta = { columns: after.columns, inserted: [], deleted: [], updated: [] };
  for (const [k, values] of a) {
    const old = b.get(k);
    if (!old) { delta.inserted.push(named(values)); continue; }
    const changes: RowChange['changes'] = {};
    after.columns.forEach((c, i) => { if (old[i] !== values[i]) changes[c.name] = { before: old[i], after: values[i] }; });
    if (Object.keys(changes).length > 0) {
      const keyCols = after.key.length > 0 ? after.key : [];
      delta.updated.push({ key: Object.fromEntries(keyCols.map((kc) => [kc, values[after.columns.findIndex((c) => c.name === kc)]])), changes });
    }
  }
  for (const [k, values] of b) if (!a.has(k)) delta.deleted.push(named(values));
  if (after.key.length === 0) delta.note = 'no unique index: rows keyed by all columns, so an update shows as delete + insert';
  return delta;
}

function definitionKey(row: Record<string, Value>): string {
  return [1, 2, 3, 4, 5, 6, 7]
    .map((n) => [row[`OBJECTID${n}`], (row[`OBJECTVALUE${n}`] ?? '').trim()])
    .filter(([id]) => id !== '0')
    .map(([id, v]) => `${id}:${v}`).join(' / ');
}

function rowsOf(t: TableRows | undefined): Record<string, Value>[] {
  if (!t) return [];
  return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])));
}

/** Per changed scratch definition: what the save left behind, checked against the model so far. */
function transitions(before: Snapshot, after: Snapshot, watchDelta: Record<string, TableDelta>,
  otherTables: Record<string, TableDelta> = {}) {
  const changed = new Set<string>();
  // Physical changes count too: a re-save deletes and re-inserts identical rows.
  for (const t of ['PSPCMTXT', 'PSPCMPROG', 'PSPCMNAME']) {
    const d = otherTables[t];
    if (!d) continue;
    for (const r of [...d.inserted, ...d.deleted]) {
      if ((r.OBJECTVALUE1 ?? '').startsWith('ZZ_PCODE_LAB')) changed.add(definitionKey(r));
    }
  }
  for (const t of ['PSPCMTXT', 'PSPCMPROG', 'PSPCMNAME']) {
    const d = watchDelta[t];
    if (!d) continue;
    for (const r of [...d.inserted, ...d.deleted]) changed.add(definitionKey(r));
    for (const u of d.updated) changed.add(definitionKey(u.key));
  }

  const window = { from: before.marker.timestamp, to: after.marker.timestamp };
  const out = [];
  for (const def of [...changed].sort()) {
    const pick = (snap: Snapshot, t: string) =>
      rowsOf(snap.watch[t]).filter((r) => definitionKey(r) === def)
        .sort((x, y) => Number(x.PROGSEQ ?? x.NAMENUM) - Number(y.PROGSEQ ?? y.NAMENUM));
    const txt = pick(after, 'PSPCMTXT');
    const prog = pick(after, 'PSPCMPROG');
    const names = pick(after, 'PSPCMNAME');
    const text = txt.map((r) => r.PCTEXT ?? '').join('');
    const programBytes = prog.reduce((n, r) => n + (r.PROGTXT ? r.PROGTXT.length / 2 : 0), 0);
    const delta = (t: string) => {
      const d = watchDelta[t];
      const mine = (r: Record<string, Value>) => definitionKey(r) === def;
      return d ? {
        inserted: d.inserted.filter(mine).length,
        deleted: d.deleted.filter(mine).length,
        updated: d.updated.filter((u) => definitionKey(u.key) === def).map((u) => Object.keys(u.changes))
      } : undefined;
    };
    const physical = (t: string) => {
      const d = otherTables[t];
      const mine = (r: Record<string, Value>) => definitionKey(r) === def;
      return d ? { deleted: d.deleted.filter(mine).length, inserted: d.inserted.filter(mine).length, updated: d.updated.length } : undefined;
    };
    out.push({
      definition: def,
      /** ROWID-level changes (flashback sweep): a delete + insert of the same key is a replace. */
      physical: { PSPCMTXT: physical('PSPCMTXT'), PSPCMPROG: physical('PSPCMPROG'), PSPCMNAME: physical('PSPCMNAME') },
      rows: {
        PSPCMTXT: { before: pick(before, 'PSPCMTXT').length, after: txt.length, ...delta('PSPCMTXT') },
        PSPCMPROG: { before: pick(before, 'PSPCMPROG').length, after: prog.length, ...delta('PSPCMPROG') },
        PSPCMNAME: { before: pick(before, 'PSPCMNAME').length, after: names.length, ...delta('PSPCMNAME') }
      },
      checks: {
        hashSignatures: [...new Set(txt.map((r) => r.HASH_SIGNATURE))],
        hashMatchesPrediction: txt.length > 0 && txt.every((r) => r.HASH_SIGNATURE === predictSourceSignature(text)),
        programBytes,
        proglen: [...new Set(prog.map((r) => r.PROGLEN))],
        namecount: [...new Set(prog.map((r) => r.NAMECOUNT))],
        nameRows: names.length,
        version: {
          before: [...new Set(pick(before, 'PSPCMPROG').map((r) => r.VERSION))],
          after: [...new Set(prog.map((r) => r.VERSION))]
        },
        lastupddttm: [...new Set(prog.map((r) => r.LASTUPDDTTM))],
        lastupddttmInWindow: prog.length > 0 && prog.every((r) =>
          r.LASTUPDDTTM !== null && r.LASTUPDDTTM >= window.from.slice(0, 26) && r.LASTUPDDTTM <= window.to.slice(0, 26)),
        lastupdoprid: [...new Set(prog.map((r) => r.LASTUPDOPRID))],
        pttoolsrel: [...new Set(prog.map((r) => r.PTTOOLSREL))]
      }
    });
  }
  return { window, definitions: out };
}

function counterDelta(before: Snapshot, after: Snapshot, table: 'PSVERSION' | 'PSLOCK') {
  const read = (s: Snapshot) => new Map(rowsOf(s.watch[table]).map((r) => [String(r.OBJECTTYPENAME).trim(), Number(r.VERSION)]));
  const b = read(before);
  const a = read(after);
  const out: Record<string, { before: number | null; after: number | null; delta: number | null }> = {};
  for (const name of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(name) ?? null;
    const y = a.get(name) ?? null;
    if (x !== y) out[name] = { before: x, after: y, delta: x !== null && y !== null ? y - x : null };
  }
  return out;
}

// --------------------------------------------------------------------------
// Phases

function caseDir(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`Invalid case name ${JSON.stringify(name)}.`);
  return path.join(RESULTS, name);
}

const write = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);

async function before(session: Session, name: string, scope: 'tools' | 'all', asOf?: string): Promise<void> {
  const dir = caseDir(name);
  mkdirSync(dir, { recursive: true });
  const mark = asOf ? await markerAt(session, asOf) : await marker(session);
  const asOfScn = asOf ? mark.scn : undefined;
  const watch = await captureWatch(session, asOfScn);
  const counts = await countAll(session, await scopeTables(session, scope), asOfScn);
  const snapshot: Snapshot = {
    format: FORMAT, phase: 'before', case: name, database: session.database,
    peopleToolsRelease: session.release, scope, marker: mark,
    ...(asOf ? { retroactive: true } : {}), watch, counts
  };
  write(path.join(dir, 'before.json'), snapshot);
  console.log(`before: SCN ${mark.scn} at ${mark.timestamp}; ${Object.keys(counts).length} tables counted; ` +
    `${watch.PSPCMPROG?.rows.length ?? 0} scratch PSPCMPROG rows. Save in App Designer, then run "after".`);
}

async function after(session: Session, name: string, asOf?: string, omitNonLabRows = false): Promise<void> {
  const dir = caseDir(name);
  const beforeFile = path.join(dir, 'before.json');
  if (!existsSync(beforeFile)) throw new Error(`No ${beforeFile}; run "before" first.`);
  const prior = JSON.parse(readFileSync(beforeFile, 'utf8')) as Snapshot;
  if (prior.format !== FORMAT || prior.database !== session.database) throw new Error(`${beforeFile} is not a ${FORMAT} snapshot of ${session.database}.`);

  const mark = asOf ? await markerAt(session, asOf) : await marker(session);
  const afterScn = asOf ? mark.scn : undefined;
  if (afterScn && BigInt(afterScn) <= BigInt(prior.marker.scn)) throw new Error(`--as-of ${asOf} is not after the before marker.`);
  const watch = await captureWatch(session, afterScn);
  const tables = await scopeTables(session, prior.scope);
  const swept0 = await sweep(session, tables, prior.marker.scn);
  // Retroactive: the counts as of the window's end; the touched set from now
  // (a superset of the window's).
  const counts = afterScn ? await countAll(session, tables, afterScn) : swept0.counts;
  const touched = swept0.touched;

  const snapshot: Snapshot = {
    format: FORMAT, phase: 'after', case: name, database: session.database,
    peopleToolsRelease: session.release, scope: prior.scope, marker: mark,
    ...(asOf ? { retroactive: true } : {}), watch, counts
  };
  write(path.join(dir, 'after.json'), snapshot);

  const watchDelta: Record<string, TableDelta> = {};
  for (const table of Object.keys(watch)) {
    if (!prior.watch[table]) continue;
    const d = diffWatch(prior.watch[table], watch[table]);
    if (d.inserted.length + d.deleted.length + d.updated.length > 0) watchDelta[table] = d;
  }

  const countChanged = tables.filter((t) => (prior.counts[t] ?? -1) !== counts[t]);
  // Tables captured whole are already diffed exactly. Tables watched only for
  // their scratch rows are swept too: a save touching a non-scratch row there
  // (the Cycle 178 failure) must show up.
  const capturedWhole = new Set(WATCH.filter((w) => !w.scratchColumn).map((w) => w.table));
  const swept = [...new Set([...touched, ...countChanged])].filter((t) => !capturedWhole.has(t)).sort();
  const otherTables: Record<string, TableDelta> = {};
  // Lab captures often overlap unrelated authentication/scheduler maintenance.
  // Keep its table/count evidence without reading or retaining those row values.
  const outsideWatch = omitNonLabRows ? Object.fromEntries(swept.map(table => [table, {
    beforeCount: prior.counts[table], afterCount: counts[table], touched: touched.includes(table)
  }])) : undefined;
  let i = 0;
  for (const table of omitNonLabRows ? [] : swept) {
    progress('diffing', ++i, swept.length);
    try {
      const whole = !touched.includes(table);
      let d = await diffTable(session, table, prior.marker.scn, whole, afterScn);
      // A delete that empties a block leaves no current row there to find it
      // by, so the block diff misses it. When inserts minus deletes do not
      // account for the count change, diff the whole table instead.
      const countDelta = (counts[table] ?? 0) - (prior.counts[table] ?? 0);
      if (!whole && counts[table] >= 0 && d.inserted.length - d.deleted.length !== countDelta && !d.truncated) {
        d = await diffTable(session, table, prior.marker.scn, true, afterScn);
      }
      if (d.inserted.length + d.deleted.length + d.updated.length > 0) otherTables[table] = d;
      else if (countChanged.includes(table)) otherTables[table] = { ...d, note: 'count changed but no row difference was recovered' };
    } catch (error) {
      otherTables[table] = {
        columns: [], inserted: [], deleted: [], updated: [],
        note: `diff failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
      };
    }
  }

  const delta = {
    format: 'save-protocol-delta/1',
    case: name,
    database: session.database,
    peopleToolsRelease: session.release,
    scope: prior.scope,
    ...(omitNonLabRows ? { nonLabRowsOmitted: true } : {}),
    markers: { before: prior.marker, after: mark },
    summary: {
      transitions: transitions(prior, snapshot, watchDelta, otherTables),
      psversion: counterDelta(prior, snapshot, 'PSVERSION'),
      pslock: counterDelta(prior, snapshot, 'PSLOCK'),
      watchTablesChanged: Object.fromEntries(Object.entries(watchDelta).map(([t, d]) =>
        [t, { inserted: d.inserted.length, deleted: d.deleted.length, updated: d.updated.length }])),
      otherTablesChanged: Object.fromEntries(Object.entries(otherTables).map(([t, d]) =>
        [t, { inserted: d.inserted.length, deleted: d.deleted.length, updated: d.updated.length, ...(d.truncated ? { truncated: true } : {}), ...(d.note ? { note: d.note } : {}) }])),
      unreadableTables: tables.filter((t) => counts[t] === -1),
      ...(outsideWatch ? { outsideWatch } : {}),
      /** Tables whose delta is not complete: a failed flashback diff, or rows over the cap. */
      incomplete: Object.entries(otherTables)
        .filter(([, d]) => d.truncated || d.note?.startsWith('diff failed'))
        .map(([t, d]) => ({ table: t, reason: d.truncated ? `more than ${SWEEP_ROW_CAP} rows` : d.note }))
    },
    watch: watchDelta,
    otherTables
  };
  write(path.join(dir, 'delta.json'), delta);
  console.log(JSON.stringify(delta.summary, null, 1));
  if (delta.summary.incomplete.length > 0) {
    console.log(`WARNING: ${delta.summary.incomplete.length} table(s) have an incomplete delta: ` +
      delta.summary.incomplete.map((x) => x.table).join(', ') + '. Rerun the case with less time between before and after.');
  }
  console.log(`Written: ${dir}/{before,after,delta}.json`);
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  const name = argument('case');
  if ((phase !== 'before' && phase !== 'after') || !name) {
    throw new Error('Usage: snapshot.ts before|after --case NAME [--scope tools|all] [--as-of TIMESTAMP|scn:NNN] [--database HRDMO] [--omit-nonlab-rows] [--routings NAME,NAME]');
  }
  const scope = argument('scope') === 'all' ? 'all' : 'tools';
  const session = await open(argument('database') ?? 'HRDMO');
  try {
    if (phase === 'before') await before(session, name, scope, argument('as-of'));
    else await after(session, name, argument('as-of'), process.argv.includes('--omit-nonlab-rows'));
  } finally {
    await close(session);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
