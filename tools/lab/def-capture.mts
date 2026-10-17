/*
 * A quick before / after capture of one definition's save, for
 * property-mapping runs: the definition's rows, its PeopleCode, its delete
 * markers, and PSVERSION / PSLOCK. Written in snapshot.ts's results format
 * (watch tables with columns / rows; delta.json with inserted / deleted /
 * updated rows by key), so the tests read either. READ ONLY. Use
 * snapshot.ts (full sweep) for a first capture of a new kind of operation.
 *
 *   npx tsx tools/lab/def-capture.mts before|after <menu|ci|msg|chnl|fl> CASE NAME
 *
 * Connection: PSLAB_ACCESSID / PSLAB_ACCESSPSWD, PSLAB_AUDIT_CONNECT
 * (default 127.0.0.1:15210/hrdmo).
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NUMBER];
oracledb.fetchAsBuffer = [oracledb.BLOB];

const [phase, kind, caseName, name] = process.argv.slice(2);
if (!['before', 'after'].includes(phase) || !['menu', 'ci', 'msg', 'chnl', 'fl'].includes(kind) || !caseName || !name) {
  console.error('usage: def-capture.mts before|after <menu|ci|msg|chnl|fl> CASE NAME');
  process.exit(2);
}
const dir = join(process.cwd(), 'tools/corpus/save-protocol/results', caseName);

type Watch = { table: string; key: string[]; where: string };
const PCKEY = ['OBJECTVALUE2', 'OBJECTVALUE3', 'OBJECTVALUE4', 'OBJECTVALUE5', 'OBJECTVALUE6', 'OBJECTVALUE7'];
const pc = (id: number): Watch[] => [
  { table: 'PSPCMPROG', key: [...PCKEY, 'PROGSEQ'], where: `OBJECTID1 = ${id} AND OBJECTVALUE1 = :p` },
  { table: 'PSPCMTXT', key: [...PCKEY, 'PROGSEQ'], where: `OBJECTID1 = ${id} AND OBJECTVALUE1 = :p` },
  { table: 'PSPCMNAME', key: [...PCKEY, 'NAMENUM'], where: `OBJECTID1 = ${id} AND OBJECTVALUE1 = :p` },
  { table: 'PSPCMPROGDEL', key: [...PCKEY, 'VERSION'], where: `OBJECTID1 = ${id} AND OBJECTVALUE1 = :p` }
];
const TABLES: Record<string, Watch[]> = {
  menu: [
    { table: 'PSMENUDEFN', key: ['MENUNAME'], where: 'MENUNAME = :p' },
    { table: 'PSMENUITEM', key: ['MENUNAME', 'BARNAME', 'ITEMNAME'], where: 'MENUNAME = :p' },
    { table: 'PSMENUDEFNLANG', key: ['MENUNAME', 'LANGUAGE_CD'], where: 'MENUNAME = :p' },
    { table: 'PSMENUITEMLANG', key: ['MENUNAME', 'BARNAME', 'ITEMNAME', 'LANGUAGE_CD'], where: 'MENUNAME = :p' },
    { table: 'PSMENUDEL', key: ['MENUNAME', 'VERSION'], where: 'MENUNAME = :p' },
    { table: 'PSMENUORIGIN', key: ['MENUNAME', 'PTORIGINTYPE', 'PTORIGINNAME'], where: 'MENUNAME = :p' },
    { table: 'PSXFERITEM', key: ['MENUNAME', 'ITEMNAME'], where: 'MENUNAME = :p' },
    ...pc(3)
  ],
  ci: [
    { table: 'PSBCDEFN', key: ['BCNAME'], where: 'BCNAME = :p' },
    { table: 'PSBCITEM', key: ['BCNAME', 'BCTYPE', 'BCITEMPARENT', 'BCITEMNAME'], where: 'BCNAME = :p' },
    { table: 'PSBCDEFNLANG', key: ['BCNAME', 'LANGUAGE_CD'], where: 'BCNAME = :p' },
    { table: 'PSBCITEMLANG', key: ['BCNAME', 'BCTYPE', 'BCITEMPARENT', 'BCITEMNAME', 'LANGUAGE_CD'], where: 'BCNAME = :p' },
    { table: 'PSBCDEL', key: ['BCNAME', 'VERSION'], where: 'BCNAME = :p' },
    // SYNCID's counter (ci01).
    { table: 'PSSYSTEMID', key: ['RECNAME'], where: "RECNAME IN ('PSBCITEM', 'PSCISYNCDEFN')" },
    { table: 'PSCISYNCDEFN', key: ['BCNAME'], where: 'BCNAME = :p' },
    { table: 'PSCIREF', key: ['BCNAME', 'BCITEMPARENT', 'BCITEMNAME'], where: 'BCNAME = :p' },
    { table: 'PSCIREFPROPERTY', key: ['BCNAME', 'BCITEMPARENT', 'BCITEMNAME', 'REF_CINAME', 'SRC_CIPROPERTYNAME'], where: 'BCNAME = :p' },
    { table: 'PSCIREFENUM', key: ['BCNAME', 'BCITEMPARENT', 'BCITEMNAME', 'REF_CINAME', 'SEQUENCE_NBR_6'], where: 'BCNAME = :p' },
    { table: 'PSAUTHBUSCOMP', key: ['CLASSID', 'BCNAME', 'BCMETHOD'], where: 'BCNAME = :p' },
    ...pc(74)
  ],
  msg: [
    { table: 'PSMSGDEFN', key: ['MSGNAME'], where: 'MSGNAME = :p' },
    { table: 'PSMSGVER', key: ['MSGNAME', 'APMSGVER'], where: 'MSGNAME = :p' },
    { table: 'PSMSGREC', key: ['MSGNAME', 'APMSGVER', 'RECNAME', 'PRNTRECNAME', 'SEQNO'], where: 'MSGNAME = :p' },
    { table: 'PSMSGFLDOVR', key: ['MSGNAME', 'APMSGVER', 'RECNAME', 'PRNTRECNAME', 'SEQNO', 'FIELDNAME'], where: 'MSGNAME = :p' },
    { table: 'PSSUBDEFN', key: ['MSGNAME', 'SUBNAME'], where: 'MSGNAME = :p' },
    { table: 'PSMSGDEFNLANG', key: ['MSGNAME', 'LANGUAGE_CD'], where: 'MSGNAME = :p' },
    { table: 'PSMSGDEL', key: ['MSGNAME', 'VERSION'], where: 'MSGNAME = :p' },
    ...pc(60)
  ],
  chnl: [
    { table: 'PSCHNLDEFN', key: ['CHNLNAME'], where: 'CHNLNAME = :p' },
    { table: 'PSSUBCHNL', key: ['CHNLNAME', 'FIELDNAME'], where: 'CHNLNAME = :p' },
    { table: 'PSCHNLNODE', key: ['CHNLNAME', 'MSGNODENAME'], where: 'CHNLNAME = :p' },
    { table: 'PSCHNLDEFNLANG', key: ['CHNLNAME', 'LANGUAGE_CD'], where: 'CHNLNAME = :p' },
    { table: 'PSCHNLDEL', key: ['CHNLNAME', 'VERSION'], where: 'CHNLNAME = :p' },
    { table: 'PSMSGDEFN', key: ['MSGNAME'], where: 'CHNLNAME = :p' }
  ],
  fl: [
    { table: 'PSFLDDEFN', key: ['FLDDEFNNAME'], where: 'FLDDEFNNAME = :p' },
    { table: 'PSFLDSEGDEFN', key: ['FLDDEFNNAME', 'FLDSEGNAME'], where: 'FLDDEFNNAME = :p' },
    { table: 'PSFLDFIELDDEFN', key: ['FLDDEFNNAME', 'FLDSEGNAME', 'FLDFIELDNAME'], where: 'FLDDEFNNAME = :p' },
    { table: 'PSFLDDEL', key: ['FLDDEFNNAME', 'VERSION'], where: 'FLDDEFNNAME = :p' },
    // File Layout PeopleCode (project type 59): OBJECTID1 105 is a guess; an empty watch costs nothing.
    ...pc(105)
  ]
};
const common: Watch[] = [
  { table: 'PSVERSION', key: ['OBJECTTYPENAME'], where: '1 = 1' },
  { table: 'PSLOCK', key: ['OBJECTTYPENAME'], where: '1 = 1' }
];

const c = await oracledb.getConnection({
  user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD,
  connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
});
const localIso = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const show = (v: unknown) => (v === null || v === undefined ? null : Buffer.isBuffer(v) ? v.toString('hex') : v instanceof Date ? localIso(v) : String(v));
try {
  await c.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
  await c.execute(`ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF9'`);
  // Tables that do not exist on this release are skipped.
  const exists = new Set(((await c.execute(`SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = 'SYSADM'`)).rows as string[][]).map((r) => r[0]));
  const tables = [...TABLES[kind], ...common].filter((t) => exists.has(t.table));
  const watch: Record<string, { columns: Array<{ name: string }>; key: string[]; rows: Array<Array<string | null>> }> = {};
  for (const t of tables) {
    const binds = t.where.includes(':p') ? { p: name } : {};
    const r = await c.execute(`SELECT * FROM ${t.table} WHERE ${t.where} ORDER BY ${t.key.join(', ')}`, binds);
    const columns = (r.metaData ?? []).map((m: { name: string }) => ({ name: m.name }));
    watch[t.table] = { columns, key: t.key, rows: (r.rows ?? []).map((row: unknown[]) => row.map(show)) };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${phase}.json`), JSON.stringify({ format: 'def-capture/1', kind, phase, case: caseName, name, watch }, null, 1));
  if (phase === 'after') {
    const before = JSON.parse(readFileSync(join(dir, 'before.json'), 'utf8')).watch;
    const delta: Record<string, unknown> = {};
    for (const t of tables) {
      const cols = watch[t.table].columns.map((x) => x.name);
      const obj = (row: Array<string | null>) => Object.fromEntries(cols.map((n, i) => [n, row[i]]));
      const keyOf = (o: Record<string, string | null>) => t.key.map((k) => o[k]).join('\u0000');
      const was = new Map((before[t.table]?.rows ?? []).map((r: Array<string | null>) => obj(r)).map((o: Record<string, string | null>) => [keyOf(o), o]));
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
    writeFileSync(join(dir, 'delta.json'), JSON.stringify({ format: 'def-capture/1', kind, case: caseName, name, watch: delta }, null, 1));
    const brief = (o: Record<string, string | null>) => Object.entries(o)
      .filter(([k, v]) => v !== null && v !== ' ' && v !== '0' && !['LASTUPDDTTM', 'LASTUPDOPRID', 'PROGTXT', 'PCTEXT'].includes(k))
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
