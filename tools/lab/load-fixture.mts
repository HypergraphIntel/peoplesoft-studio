/*
 * Loads a SQL Server or DB2 lab database with PeopleTools tables copied from
 * an Oracle PeopleSoft database (read-only there: SELECTs only), so the
 * provider can be run against the same definitions on each platform and its
 * output compared with Oracle's.
 *
 *   npx tsx tools/lab/load-fixture.mts <mssql|db2> [TABLE ...]
 *
 * Environment: PSLAB_ACCESSID / PSLAB_ACCESSPSWD (Oracle source, HRDMO at
 * PSLAB_ORACLE or 127.0.0.1:15210/hrdmo), PSLAB_MSSQL_PASSWORD (sa at
 * 127.0.0.1:15433), PSLAB_DB2_PASSWORD (db2inst1 at 127.0.0.1:15500/PSFT; tables in schema PSFT).
 * DB2 needs IBM's CLI driver's libxml2.so.2 on LD_LIBRARY_PATH.
 *
 * Column types follow PeopleTools' platform mapping (PeopleBooks, Application
 * Designer: field definitions): Character NVARCHAR(n) / VARGRAPHIC(n), Long
 * Character NVARCHAR(MAX) / DBCLOB, Image and raw binary VARBINARY(MAX) /
 * BLOB, numbers SMALLINT / INTEGER / DECIMAL by the field's length, Date DATE,
 * DateTime DATETIME (SQL Server) / TIMESTAMP (DB2), Time DATETIME / TIME.
 * The table list is every PS table the extension's source names.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

// ibm_db's async results wait for the event loop's next turn (src/db/db2.ts db2Call): keep it turning.
setInterval(() => { /* turn the loop */ }, 1).unref();

const target = process.argv[2] as 'mssql' | 'db2';
if (target !== 'mssql' && target !== 'db2') throw new Error('usage: load-fixture.mts <mssql|db2> [TABLE ...]');
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

// ---------------------------------------------------------------------------
// Source

const ora = await oracledb.getConnection({
  user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo'
});
await ora.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const q = async <T,>(sql: string, binds: Record<string, unknown> = {}) => ((await ora.execute(sql, binds)).rows ?? []) as T[];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sources(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const named = new Set(sources(path.join(ROOT, 'src')).flatMap((f) => readFileSync(f, 'utf8').match(/\bPS_?[A-Z0-9_#$]{2,}\b/g) ?? []));
const tables = (await q<{ T: string }>(`SELECT TABLE_NAME AS T FROM ALL_TABLES WHERE OWNER = 'SYSADM' AND TABLE_NAME LIKE 'PS%' ORDER BY 1`))
  .map((r) => r.T).filter((t) => named.has(t) && (only.length === 0 || only.includes(t)));

interface Col { name: string; type: string; charLen: number; precision: number | null; scale: number | null; nullable: boolean }
const trace = (what: string) => { if (process.env.PSLAB_VERBOSE) console.log(`${new Date().toISOString()} ${what}`); };
trace(`${tables.length} tables`);
const fieldInfo = new Map((await q<{ F: string; T: number; L: number; D: number }>(
  `SELECT FIELDNAME AS F, FIELDTYPE AS T, LENGTH AS L, DECIMALPOS AS D FROM PSDBFIELD`)).map((r) => [r.F.trim(), r]));

function targetType(c: Col): string {
  const ms = target === 'mssql';
  const f = fieldInfo.get(c.name);
  switch (c.type) {
    case 'VARCHAR2': case 'NVARCHAR2': return ms ? `NVARCHAR(${c.charLen})` : `VARGRAPHIC(${c.charLen})`;
    case 'CHAR': case 'NCHAR': return ms ? `NCHAR(${c.charLen})` : `GRAPHIC(${c.charLen})`;
    case 'CLOB': case 'NCLOB': case 'LONG': return ms ? 'NVARCHAR(MAX)' : 'DBCLOB(100M)';
    case 'BLOB': case 'LONG RAW': case 'RAW': return ms ? 'VARBINARY(MAX)' : 'BLOB(100M)';
    case 'DATE': return 'DATE';
    case 'NUMBER':
      if (c.precision !== null) return `DECIMAL(${c.precision},${c.scale ?? 0})`;
      if (c.scale === 0) {
        // SMALLINT / INTEGER as PeopleTools declares them: by the field's length.
        if (f && (f.T === 2 || f.T === 3)) {
          const digits = f.T === 3 ? f.L - 1 : f.L;
          return digits <= 4 ? 'SMALLINT' : digits <= 9 ? 'INTEGER' : `DECIMAL(${digits},0)`;
        }
        return 'INTEGER';
      }
      return 'DECIMAL(31,8)';
    default:
      if (c.type.startsWith('TIMESTAMP')) return f?.T === 5 ? (ms ? 'DATETIME' : 'TIME') : ms ? 'DATETIME' : 'TIMESTAMP';
      throw new Error(`No mapping for ${c.name} ${c.type}`);
  }
}

// ---------------------------------------------------------------------------
// Target

interface Target {
  exec(sql: string): Promise<void>;
  insert(table: string, cols: Col[], types: string[], rows: unknown[][]): Promise<void>;
  count(table: string): Promise<number>;
  close(): Promise<void>;
}

async function mssqlTarget(): Promise<Target> {
  const sql = require('mssql');
  const base = { server: '127.0.0.1', port: 15433, user: 'sa', password: process.env.PSLAB_MSSQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, useUTC: false }, requestTimeout: 600_000 };
  const master = await new sql.ConnectionPool({ ...base, database: 'master' }).connect();
  await master.request().query(`IF DB_ID('PSFT') IS NULL CREATE DATABASE PSFT COLLATE Latin1_General_BIN2`);
  await master.close();
  const pool = await new sql.ConnectionPool({ ...base, database: 'PSFT', pool: { max: 2 } }).connect();
  const sqlType = (t: string) => {
    const m = /^(\w+)(?:\((\w+)(?:,(\d+))?\))?$/.exec(t)!;
    const [name, a, b] = [m[1], m[2], m[3]];
    switch (name) {
      case 'NVARCHAR': return a === 'MAX' ? sql.NVarChar(sql.MAX) : sql.NVarChar(Number(a));
      case 'NCHAR': return sql.NChar(Number(a));
      case 'VARBINARY': return sql.VarBinary(sql.MAX);
      case 'DATE': return sql.Date;
      case 'DATETIME': return sql.DateTime;
      case 'SMALLINT': return sql.SmallInt;
      case 'INTEGER': return sql.Int;
      case 'DECIMAL': return sql.Decimal(Number(a), Number(b ?? 0));
      default: throw new Error(t);
    }
  };
  return {
    async exec(s) { await pool.request().query(s); },
    async insert(table, cols, types, rows) {
      const t = new sql.Table(table);
      t.create = false;
      cols.forEach((c, i) => t.columns.add(c.name, sqlType(types[i]), { nullable: c.nullable }));
      for (const r of rows) t.rows.add(...r.map((v, i) => toMssql(v, types[i])));
      await pool.request().bulk(t);
    },
    async count(table) { return Number((await pool.request().query(`SELECT COUNT(*) AS N FROM ${table}`)).recordset[0].N); },
    async close() { await pool.close(); }
  };
}

/** DATETIME holds 1/300 s: keep a value's second, which rounding .998+ would move. */
function toMssql(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'DATE') { const [y, m, d] = String(v).split('-').map(Number); return new Date(y, m - 1, d); }
  if (type === 'DATETIME') {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(String(v))!;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.min(997, +m[7]));
  }
  return v;
}

async function db2Target(): Promise<Target> {
  const ibmdb = require('ibm_db');
  const db = await ibmdb.open(`DATABASE=PSFT;HOSTNAME=127.0.0.1;PORT=15500;PROTOCOL=TCPIP;UID=db2inst1;PWD=${process.env.PSLAB_DB2_PASSWORD};`);
  // Created once; checked in the catalog first (a CREATE BUFFERPOOL for one that exists can hang).
  const has = async (sql: string) => ((await db.query(sql)) as unknown[]).length > 0;
  if (!(await has(`SELECT 1 FROM SYSCAT.BUFFERPOOLS WHERE BPNAME = 'BP32K'`))) await db.query(`CREATE BUFFERPOOL BP32K SIZE AUTOMATIC PAGESIZE 32K`);
  if (!(await has(`SELECT 1 FROM SYSCAT.TABLESPACES WHERE TBSPACE = 'PSTOOLS'`))) await db.query(`CREATE TABLESPACE PSTOOLS PAGESIZE 32K BUFFERPOOL BP32K`);
  if (!(await has(`SELECT 1 FROM SYSCAT.TABLESPACES WHERE TBSPACE = 'PSTEMP32'`))) await db.query(`CREATE SYSTEM TEMPORARY TABLESPACE PSTEMP32 PAGESIZE 32K BUFFERPOOL BP32K`);
  // DB2 reserves schema names beginning SYS: PeopleSoft owner IDs there are named otherwise.
  if (!(await has(`SELECT 1 FROM SYSCAT.SCHEMATA WHERE SCHEMANAME = 'PSFT'`))) await db.query(`CREATE SCHEMA PSFT`);
  if (!(await has(`SELECT 1 FROM SYSCAT.SCHEMATA WHERE SCHEMANAME = 'PS'`))) await db.query(`CREATE SCHEMA PS`);
  await db.query(`SET SCHEMA PSFT`);
  return {
    async exec(s) { await db.query(s); },
    async insert(table, cols, types, rows) {
      const sqlText = `INSERT INTO ${table} (${cols.map((c) => c.name).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const params = (r: unknown[]) => r.map((v, i) => toDb2(v, types[i]));
      if (!types.some((t) => /LOB/.test(t))) {
        // Row-wise array insert: one round trip for the batch.
        await db.query({ sql: sqlText, rows: rows.map(params) });
        return;
      }
      // ibm_db's array insert crashes the process on LOB columns (a SIGSEGV in
      // libdb2's LOB array input), and a multi-row VALUES with thousands of
      // markers compiles for tens of seconds: one prepared row at a time.
      const stmt = await db.prepare(sqlText);
      await db.beginTransaction();
      try {
        for (const r of rows) await stmt.executeNonQuery(params(r));
        await db.commitTransaction();
      } catch (e) {
        await db.rollbackTransaction().catch(() => undefined);
        throw e;
      } finally {
        stmt.closeSync(1);
      }
    },
    async count(table) { return Number((await db.query(`SELECT COUNT(*) AS N FROM ${table}`))[0].N); },
    async close() { await db.close(); }
  };
}

function toDb2(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type.startsWith('BLOB')) return { ParamType: 'INPUT', DataType: 'BLOB', Data: v };
  if (type.startsWith('DBCLOB')) return { ParamType: 'INPUT', DataType: 'CLOB', Data: v };
  if (type === 'TIME') return String(v).slice(11, 19);
  // ibm_db's array insert cannot infer a scale for a fractional number (CLI0135E): DB2 converts the text exactly.
  if (type.startsWith('DECIMAL') && typeof v === 'number') return String(v);
  return v;
}

trace('fields read');
const dst = target === 'mssql' ? await mssqlTarget() : await db2Target();
trace('target ready');

// ---------------------------------------------------------------------------
// Copy

const owner = target === 'mssql' ? 'dbo' : 'PSFT';
const started = Date.now();
let total = 0;
for (const table of tables) {
  const cols = (await q<{ N: string; T: string; L: number; P: number | null; S: number | null; NU: string }>(
    `SELECT COLUMN_NAME AS N, DATA_TYPE AS T, CHAR_LENGTH AS L, DATA_PRECISION AS P, DATA_SCALE AS S, NULLABLE AS NU
       FROM ALL_TAB_COLUMNS WHERE OWNER = 'SYSADM' AND TABLE_NAME = :t ORDER BY COLUMN_ID`, { t: table }))
    .map((r): Col => ({ name: r.N, type: r.T, charLen: Number(r.L), precision: r.P, scale: r.S, nullable: r.NU === 'Y' }));
  const types = cols.map(targetType);
  // Already loaded, completely: left as it is (a rerun picks up where one stopped).
  if (process.argv.includes('--resume')) {
    const [{ N: source }] = await q<{ N: number }>(`SELECT COUNT(*) AS N FROM ${table}`);
    const loaded = await dst.count(table).catch(() => -1);
    if (loaded === Number(source)) { total += loaded; console.log(`${table}: ${loaded} rows (already loaded)`); continue; }
  }
  if (process.env.PSLAB_VERBOSE) console.log(`  ${table}: creating`);
  const drop = target === 'mssql' ? `IF OBJECT_ID('${table}') IS NOT NULL DROP TABLE ${table}` : undefined;
  if (drop) await dst.exec(drop);
  else await dst.exec(`BEGIN IF EXISTS (SELECT 1 FROM SYSCAT.TABLES WHERE TABSCHEMA = 'PSFT' AND TABNAME = '${table}') THEN EXECUTE IMMEDIATE 'DROP TABLE PSFT.${table}'; END IF; END`);
  await dst.exec(`CREATE TABLE ${table} (${cols.map((c, i) => `${c.name} ${types[i]}${c.nullable ? '' : ' NOT NULL'}`).join(', ')})${target === 'db2' ? ' IN PSTOOLS' : ''}`);

  // Dates and timestamps as text, exactly; LOBs whole.
  const list = cols.map((c) => c.type === 'DATE' ? `TO_CHAR(${c.name}, 'YYYY-MM-DD') AS ${c.name}`
    : c.type.startsWith('TIMESTAMP') ? `TO_CHAR(${c.name}, 'YYYY-MM-DD HH24:MI:SS.FF6') AS ${c.name}` : c.name).join(', ');
  if (process.env.PSLAB_VERBOSE) console.log(`  ${table}: created; copying`);
  const rs = (await ora.execute(`SELECT ${list} FROM ${table}`, {}, { resultSet: true, fetchArraySize: 2000 })).resultSet;
  let n = 0;
  let fetchMs = 0;
  let insertMs = 0;
  for (;;) {
    let t = Date.now();
    const batch = await rs.getRows(2000) as Record<string, unknown>[];
    fetchMs += Date.now() - t;
    if (batch.length === 0) break;
    t = Date.now();
    await dst.insert(table, cols, types, batch.map((r) => cols.map((c) => r[c.name])));
    insertMs += Date.now() - t;
    n += batch.length;
    if (process.env.PSLAB_VERBOSE) console.log(`  ${table} ${n}: fetch ${fetchMs} ms, insert ${insertMs} ms`);
  }
  await rs.close();

  // The same indexes as on Oracle (function-based ones skipped).
  const idx = await q<{ I: string; U: string; C: string; P: number }>(
    `SELECT I.INDEX_NAME AS I, I.UNIQUENESS AS U, C.COLUMN_NAME AS C, C.COLUMN_POSITION AS P
       FROM ALL_INDEXES I JOIN ALL_IND_COLUMNS C ON C.INDEX_OWNER = I.OWNER AND C.INDEX_NAME = I.INDEX_NAME
      WHERE I.OWNER = 'SYSADM' AND I.TABLE_NAME = :t AND I.INDEX_TYPE = 'NORMAL' ORDER BY 1, 4`, { t: table });
  for (const name of [...new Set(idx.map((x) => x.I))]) {
    const ic = idx.filter((x) => x.I === name);
    if (ic.some((x) => !cols.some((c) => c.name === x.C))) continue;
    try {
      await dst.exec(`CREATE ${ic[0].U === 'UNIQUE' ? 'UNIQUE ' : ''}INDEX ${name} ON ${table} (${ic.map((x) => x.C).join(', ')})`);
    } catch (e) {
      console.warn(`  index ${name} on ${table}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  const copied = await dst.count(table);
  if (copied !== n) throw new Error(`${table}: read ${n}, ${copied} in ${target}`);
  total += n;
  console.log(`${table}: ${n} rows (${Math.round((Date.now() - started) / 1000)} s)`);
}

// PS.PSDBOWNER, as PeopleSoft records the database's owner ID.
if (only.length === 0) {
  if (target === 'mssql') {
    await dst.exec(`IF OBJECT_ID('PSDBOWNER') IS NOT NULL DROP TABLE PSDBOWNER`);
    await dst.exec(`CREATE TABLE PSDBOWNER (DBNAME NVARCHAR(8) NOT NULL, OWNERID NVARCHAR(8) NOT NULL)`);
    await dst.exec(`INSERT INTO PSDBOWNER VALUES ('PSFT', '${owner}')`);
  } else {
    await dst.exec(`BEGIN IF EXISTS (SELECT 1 FROM SYSCAT.TABLES WHERE TABSCHEMA = 'PS' AND TABNAME = 'PSDBOWNER') THEN EXECUTE IMMEDIATE 'DROP TABLE PS.PSDBOWNER'; END IF; END`);
    await dst.exec(`CREATE TABLE PS.PSDBOWNER (DBNAME VARCHAR(8) NOT NULL, OWNERID VARCHAR(8) NOT NULL)`);
    await dst.exec(`INSERT INTO PS.PSDBOWNER VALUES ('PSFT', '${owner}')`);
  }
}
console.log(`${tables.length} tables, ${total} rows into ${target} in ${Math.round((Date.now() - started) / 1000)} s`);
await dst.close();
await ora.close();
