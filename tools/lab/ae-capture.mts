/*
 * A quick before / after capture of one App Engine program's save, for
 * property-mapping runs (docs/APP_ENGINE.md): the program's PSAE* rows, its
 * actions' SQL definitions (SQLID starts with the program padded to 12),
 * its PeopleCode (PSPCMPROG / PSPCMTXT / PSPCMNAME, OBJECTID1 66), the
 * delete-tracking tables, and PSVERSION / PSLOCK. Written in snapshot.ts's
 * results format (watch tables with columns / rows; delta.json with
 * inserted / deleted / updated rows by key), so the tests read either.
 * READ ONLY. Use snapshot.ts (full sweep) for a first capture of a new kind
 * of operation, to catch any table this list misses.
 *
 *   npx tsx tools/lab/ae-capture.mts before CASE PROGRAM
 *   (save in App Designer)
 *   npx tsx tools/lab/ae-capture.mts after CASE PROGRAM
 *
 * Connection: PSLAB_ACCESSID / PSLAB_ACCESSPSWD, PSLAB_AUDIT_CONNECT
 * (default 127.0.0.1:15210/hrdmo).
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NUMBER];
oracledb.fetchAsBuffer = [oracledb.BLOB];

const [phase, caseName, program] = process.argv.slice(2);
if (!['before', 'after'].includes(phase) || !caseName || !program) {
  console.error('usage: ae-capture.mts before|after CASE PROGRAM');
  process.exit(2);
}
const dir = join(process.cwd(), 'tools/corpus/save-protocol/results', caseName);

const AE = 'AE_APPLID = :p';
const SQL = "SUBSTR(SQLID, 1, 12) = RPAD(:p, 12)";
const PC = "OBJECTID1 = 66 AND OBJECTVALUE1 = :p";
const TABLES: Array<{ table: string; key: string[]; where: string }> = [
  { table: 'PSAEAPPLDEFN', key: ['AE_APPLID'], where: AE },
  { table: 'PSAEAPPLSTATE', key: ['AE_APPLID', 'AE_STATE_RECNAME'], where: AE },
  { table: 'PSAEAPPLTEMPTBL', key: ['AE_APPLID', 'RECNAME'], where: AE },
  { table: 'PSAEAPPLLANG', key: ['AE_APPLID', 'LANGUAGE_CD'], where: AE },
  { table: 'PSAEAPPLDEL', key: ['AE_APPLID', 'VERSION'], where: AE },
  { table: 'PSAESECTDEFN', key: ['AE_APPLID', 'AE_SECTION'], where: AE },
  { table: 'PSAESECTDEL', key: ['AE_APPLID', 'AE_SECTION', 'VERSION'], where: AE },
  { table: 'PSAESECTDTLDEFN', key: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT'], where: AE },
  { table: 'PSAESTEPDEFN', key: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT', 'AE_STEP'], where: AE },
  { table: 'PSAESTMTDEFN', key: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT', 'AE_STEP', 'AE_STMT_TYPE'], where: AE },
  { table: 'PSAESTEPMSGDEFN', key: ['AE_APPLID', 'AE_SECTION', 'MARKET', 'DBTYPE', 'EFFDT', 'AE_STEP'], where: AE },
  { table: 'PSSQLDEFN', key: ['SQLID', 'SQLTYPE'], where: SQL },
  { table: 'PSSQLDESCR', key: ['SQLID', 'SQLTYPE', 'MARKET', 'DBTYPE', 'EFFDT'], where: SQL },
  { table: 'PSSQLTEXTDEFN', key: ['SQLID', 'SQLTYPE', 'MARKET', 'DBTYPE', 'EFFDT', 'SEQNUM'], where: SQL },
  { table: 'PSSQLHASH', key: ['SQLID', 'SQLTYPE', 'MARKET', 'DBTYPE', 'EFFDT'], where: SQL },
  { table: 'PSSQLDEL', key: ['SQLID', 'SQLTYPE', 'VERSION'], where: SQL },
  { table: 'PSSQLLANG', key: ['SQLID', 'SQLTYPE', 'MARKET', 'DBTYPE', 'EFFDT', 'LANGUAGE_CD'], where: SQL },
  { table: 'PSPCMPROG', key: ['OBJECTVALUE2', 'OBJECTVALUE3', 'OBJECTVALUE4', 'OBJECTVALUE5', 'OBJECTVALUE6', 'OBJECTVALUE7', 'PROGSEQ'], where: PC },
  { table: 'PSPCMTXT', key: ['OBJECTVALUE2', 'OBJECTVALUE3', 'OBJECTVALUE4', 'OBJECTVALUE5', 'OBJECTVALUE6', 'OBJECTVALUE7'], where: PC },
  { table: 'PSPCMNAME', key: ['OBJECTVALUE2', 'OBJECTVALUE3', 'OBJECTVALUE4', 'OBJECTVALUE5', 'OBJECTVALUE6', 'OBJECTVALUE7', 'NAMENUM'], where: PC },
  { table: 'PSPCMPROGDEL', key: ['OBJECTVALUE2', 'OBJECTVALUE3', 'OBJECTVALUE4', 'OBJECTVALUE5', 'OBJECTVALUE6', 'OBJECTVALUE7', 'VERSION'], where: PC },
  { table: 'PSVERSION', key: ['OBJECTTYPENAME'], where: '1 = 1' },
  { table: 'PSLOCK', key: ['OBJECTTYPENAME'], where: '1 = 1' }
];

const c = await oracledb.getConnection({
  user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD,
  connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
});
/** A DATE as the database holds it (thin mode hands it back as a local Date). */
const localIso = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const show = (v: unknown) => (v === null || v === undefined ? null : Buffer.isBuffer(v) ? v.toString('hex') : v instanceof Date ? localIso(v) : String(v));
try {
  await c.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
  await c.execute(`ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF9'`);
  await c.execute(`ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS'`);
  oracledb.fetchAsString = [oracledb.CLOB, oracledb.NUMBER];
  const watch: Record<string, { columns: Array<{ name: string }>; key: string[]; rows: Array<Array<string | null>> }> = {};
  for (const t of TABLES) {
    const binds = t.where.includes(':p') ? { p: program } : {};
    const r = await c.execute(`SELECT * FROM ${t.table} WHERE ${t.where} ORDER BY ${t.key.join(', ')}`, binds);
    const columns = (r.metaData ?? []).map((m: { name: string }) => ({ name: m.name }));
    watch[t.table] = { columns, key: t.key, rows: (r.rows ?? []).map((row: unknown[]) => row.map(show)) };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${phase}.json`), JSON.stringify({ format: 'ae-capture/1', phase, case: caseName, program, watch }, null, 1));
  if (phase === 'after') {
    const before = JSON.parse(readFileSync(join(dir, 'before.json'), 'utf8')).watch;
    const delta: Record<string, unknown> = {};
    for (const t of TABLES) {
      const cols = watch[t.table].columns.map((x) => x.name);
      const obj = (row: Array<string | null>) => Object.fromEntries(cols.map((n, i) => [n, row[i]]));
      const keyOf = (o: Record<string, string | null>) => t.key.map((k) => o[k]).join('\u0000');
      const was = new Map(before[t.table].rows.map((r: Array<string | null>) => obj(r)).map((o: Record<string, string | null>) => [keyOf(o), o]));
      const now = new Map(watch[t.table].rows.map(obj).map((o) => [keyOf(o), o]));
      const inserted = [...now].filter(([k]) => !was.has(k)).map(([, o]) => o);
      const deleted = [...was].filter(([k]) => !now.has(k)).map(([, o]) => o);
      const updated = [...now].filter(([k]) => was.has(k)).map(([, o]) => {
        const b = was.get(keyOf(o)) as Record<string, string | null>;
        const changes = Object.fromEntries(cols.filter((n) => b[n] !== o[n]).map((n) => [n, { before: b[n], after: o[n] }]));
        return { key: Object.fromEntries(t.key.map((k) => [k, o[k]])), changes };
      }).filter((u) => Object.keys(u.changes).length > 0);
      delta[t.table] = { columns: watch[t.table].columns, inserted, deleted, updated };
    }
    writeFileSync(join(dir, 'delta.json'), JSON.stringify({ format: 'ae-capture/1', case: caseName, program, watch: delta }, null, 1));
    const brief = (o: Record<string, string | null>) => Object.entries(o)
      .filter(([k, v]) => v !== null && v !== ' ' && v !== '0' && !['LASTUPDDTTM', 'LASTUPDOPRID', 'PROGTXT', 'PCTEXT', 'LICENSE_CODE'].includes(k))
      .map(([k, v]) => `${k}=${String(v).length > 60 ? String(v).slice(0, 60) + '...' : v}`).join(' ');
    for (const [t, v] of Object.entries(delta) as Array<[string, { inserted: Array<Record<string, string | null>>; deleted: Array<Record<string, string | null>>; updated: Array<{ key: Record<string, string>; changes: Record<string, { before: string | null; after: string | null }> }> }]>) {
      for (const r of v.inserted) console.log(`${t} + ${brief(r)}`);
      for (const r of v.deleted) console.log(`${t} - ${brief(r)}`);
      for (const u of v.updated) {
        const ch = Object.entries(u.changes).filter(([k]) => k !== 'LASTUPDDTTM')
          .map(([k, x]) => `${k} ${String(x.before).slice(0, 50)} -> ${String(x.after).slice(0, 50)}`).join('; ');
        if (ch) console.log(`${t} ~ ${Object.values(u.key).join('/')}: ${ch}`);
      }
    }
  }
} finally {
  await c.close();
}
