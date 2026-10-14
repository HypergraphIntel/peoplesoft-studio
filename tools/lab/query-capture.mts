/**
 * Read-only, HRDMO-only snapshots for Windows Query property calibrations.
 * Use the full save-protocol snapshot tool for new operation families: this
 * narrower tool covers query-keyed tables and counters, not unrelated tables.
 *
 * npx tsx tools/lab/query-capture.mts before|after CASE QUERY OWNER
 * Credentials: PSLAB_ACCESSID / PSLAB_ACCESSPSWD, PSLAB_AUDIT_CONNECT.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import oracledb from 'oracledb';

const [phase, caseName, queryName, owner] = process.argv.slice(2);
if (!['before', 'after'].includes(phase) || !caseName || !/^[a-zA-Z0-9_-]+$/.test(caseName)
  || !queryName?.startsWith('ZZ_QRY_') || owner === undefined) {
  throw new Error('usage: query-capture.mts before|after CASE ZZ_QRY_NAME OWNER (blank owner for public)');
}
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NUMBER];
type Row = Record<string, string | null>;
interface Snapshot {
  format: string; database: string; release: string; query: string; owner: string;
  marker: Row; tables: Record<string, Row[]>;
}
const dir = join('tools', 'corpus', 'save-protocol', 'results', caseName);
mkdirSync(dir, { recursive: true });
const output = join(dir, `${phase}.json`);
if (existsSync(output)) throw new Error(`Capture already exists: ${output}`);
const c = await oracledb.getConnection({
  user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD,
  connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
});
try {
  await c.execute('SET TRANSACTION READ ONLY');
  const select = async (sql: string, binds: oracledb.BindParameters = {}): Promise<Row[]> => {
    const rows = (await c.execute<Record<string, unknown>>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [];
    return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) =>
      [k, v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v)])));
  };
  const [identity] = await select("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB_NAME FROM DUAL");
  if (identity.DB_NAME?.toUpperCase() !== 'HRDMO') throw new Error('Expected HRDMO: refusing capture');
  const [status] = await select('SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS');
  const [marker] = await select("SELECT TO_CHAR(TIMESTAMP_TO_SCN(SYSTIMESTAMP)) AS SCN, TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF6TZH:TZM') AS CAPTURED_AT FROM DUAL");
  const catalog = await select(`SELECT T.TABLE_NAME FROM ALL_TABLES T WHERE T.OWNER='SYSADM'
    AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS C WHERE C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME AND C.COLUMN_NAME='QRYNAME')
    AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS C WHERE C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME AND C.COLUMN_NAME='OPRID')
    ORDER BY T.TABLE_NAME`);
  const tables: Record<string, Row[]> = {};
  for (const t of catalog) {
    const table = t.TABLE_NAME!;
    if (!/^[A-Z0-9_]+$/.test(table)) throw new Error('Invalid catalog identifier');
    const columns = await select(`SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
      WHERE OWNER='SYSADM' AND TABLE_NAME=:t ORDER BY COLUMN_ID`, { t: table });
    const projection = columns.map(col => {
      const name = col.COLUMN_NAME!;
      if (!/^[A-Z0-9_]+$/.test(name)) throw new Error('Invalid catalog column');
      return /^(DATE|TIMESTAMP)/.test(col.DATA_TYPE!)
        ? `TO_CHAR(CAST(T.${name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${name}`
        : `T.${name}`;
    }).join(', ');
    tables[table] = await select(`SELECT ROWIDTOCHAR(T.ROWID) AS CAPTURE_ROWID, ${projection} FROM SYSADM.${table} T WHERE QRYNAME=:n AND OPRID=:o`,
      { n: queryName, o: owner.trim() || ' ' });
  }
  for (const table of ['PSVERSION', 'PSLOCK']) {
    tables[table] = await select(`SELECT OBJECTTYPENAME, VERSION FROM SYSADM.${table} ORDER BY OBJECTTYPENAME`);
  }
  const snapshot: Snapshot = {
    format: 'query-property-capture/1', database: identity.DB_NAME!,
    release: `${status.TOOLSREL}.${String(status.PTPATCHREL).padStart(2, '0')}`,
    query: queryName, owner: owner.trim(), marker, tables
  };
  if (phase === 'after') {
    const before = JSON.parse(readFileSync(join(dir, 'before.json'), 'utf8')) as Snapshot;
    if (before.format !== snapshot.format || before.database !== snapshot.database || before.release !== snapshot.release
      || before.query !== snapshot.query || before.owner !== snapshot.owner) throw new Error('Before/after identity mismatch');
    const delta: Record<string, unknown> = {};
    const key = (r: Row) => r.CAPTURE_ROWID ?? r.OBJECTTYPENAME;
    for (const table of new Set([...Object.keys(before.tables), ...Object.keys(tables)])) {
      const a = new Map((before.tables[table] ?? []).map(r => [key(r), r]));
      const b = new Map((tables[table] ?? []).map(r => [key(r), r]));
      const inserted = [...b].filter(([k]) => !a.has(k)).map(([, r]) => r);
      const deleted = [...a].filter(([k]) => !b.has(k)).map(([, r]) => r);
      const updated = [...b].filter(([k, r]) => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(r))
        .map(([k, r]) => ({ before: a.get(k), after: r }));
      if (inserted.length || deleted.length || updated.length) delta[table] = { inserted, deleted, updated };
    }
    writeFileSync(join(dir, 'delta.json'), JSON.stringify({
      format: snapshot.format, database: snapshot.database, release: snapshot.release, query: queryName, owner: snapshot.owner,
      markers: { before: before.marker, after: marker }, tables: delta
    }, null, 2) + '\n');
    console.log(`Changed: ${Object.keys(delta).join(', ')}`);
  }
  writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${phase}: ${snapshot.database} ${snapshot.release}, ${queryName}; ${Object.keys(tables).length} tables`);
} finally {
  await c.rollback();
  await c.close();
}
