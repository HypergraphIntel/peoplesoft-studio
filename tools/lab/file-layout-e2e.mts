/*
 * The File Layout writer end to end on HRDMO: ZZ_FL_E2E1 and ZZ_FL_E2E2 are built through DatabaseProvider
 * with the edits App Designer made to ZZ_FL_N1 (fl01-fl06) and ZZ_FL_N2 (fl07-fl11), one save per step,
 * and their stored rows compared with App Designer's own layouts column for column (name and stamp aside).
 * Each save must move FLM and SYS by one and stamp VERSION with the new FLM. Then Save As, Rename and
 * Delete on ZZ_FL_E2E3/4.
 *
 * WRITES. HRDMO only; ZZ_FL_E2E* only. Leaves ZZ_FL_E2E1 and ZZ_FL_E2E2 for App Designer to open
 * (rerun after deleting them, or with --cleanup to remove them).
 *
 *   npx tsx tools/lab/file-layout-e2e.mts [--cleanup]
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import {
  copyLayout, deleteField, insertField, insertRecord, insertSegment, moveField, newLayout, setFieldProperties, setLayoutProperties, setSegmentProperties,
  type FileLayoutDocument
} from '../../src/model/fileLayoutDocument';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_FL_E2E');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { DESCRLONG: { type: oracledb.STRING } } })).rows ?? []) as Array<Record<string, unknown>>;
const counters = async () => Object.fromEntries((await q("SELECT OBJECTTYPENAME T, VERSION V FROM PSVERSION WHERE OBJECTTYPENAME IN ('FLM','PJM','SYS')")).map((r) => [String(r.T).trim(), Number(r.V)]));
const norm = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() === '' ? ' ' : String(v).replace(/\s+$/, ''));
const SKIP = new Set(['FLDDEFNNAME', 'VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
async function rowsOf(name: string) {
  const shape = (rows: Array<Record<string, unknown>>) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !SKIP.has(k)).sort().map((k) => [k, norm(r[k])]))).sort();
  return {
    layout: shape(await q('SELECT * FROM PSFLDDEFN WHERE FLDDEFNNAME = :n', { n: name })),
    segments: shape(await q('SELECT * FROM PSFLDSEGDEFN WHERE FLDDEFNNAME = :n', { n: name })),
    fields: shape(await q('SELECT * FROM PSFLDFIELDDEFN WHERE FLDDEFNNAME = :n', { n: name }))
  };
}
async function remove(name: string) {
  const r = await p.readFileLayoutDocument(name);
  if (r) await p.deleteFileLayoutDefinition(name, r.token, operatorId);
}
for (const n of ['ZZ_FL_E2E1', 'ZZ_FL_E2E2', 'ZZ_FL_E2E3', 'ZZ_FL_E2E4']) await remove(n);
if (process.argv.includes('--cleanup')) { console.log('removed ZZ_FL_E2E*'); process.exit(0); }

/** One save of the document as the editor would make it; FLM and SYS + 1, VERSION the new FLM. */
async function save(doc: FileLayoutDocument, token: string, what: string): Promise<string> {
  const k0 = await counters();
  const r = await p.saveFileLayoutDocument({ doc, openedToken: token, operatorId });
  const k1 = await counters();
  check(`${what}: written, FLM and SYS + 1, VERSION = FLM`, r.written && k1.FLM === k0.FLM + 1 && k1.SYS === k0.SYS + 1 && k1.PJM === k0.PJM && r.version === k1.FLM,
    JSON.stringify({ written: r.written, k0, k1, version: r.version }));
  return r.token;
}
const reopen = async (name: string) => { const r = await p.readFileLayoutDocument(name); if (!r) throw new Error(`${name} is missing`); return r; };

// Lab records of delivered fields (ZZ_FL_REC_A has a time and a datetime field: App Designer adds 5 to their length).
const A = await p.fileLayoutRecordFields('ZZ_FL_REC_A');
const B = await p.fileLayoutRecordFields('ZZ_FL_REC_B');
check('record fields read from PSRECFIELDDB / PSDBFIELD', A.length === 12 && B.length === 11);

// ZZ_FL_E2E1: App Designer's ZZ_FL_N1, fl01-fl06.
let d = newLayout('ZZ_FL_E2E1');
insertRecord(d, 'ZZ_FL_REC_A', A);
let token = await save(d, 'absent', 'E2E1 create (fl01)');
const steps1: Array<[string, (x: FileLayoutDocument) => void]> = [
  ['fl02', (x) => setLayoutProperties(x, { format: 1, description: 'FL lab N1', comments: 'lab comments' })],
  ['fl03', (x) => setLayoutProperties(x, { qualifierOptional: true, convertTabs: true, interpretBackslash: true, stripWhiteSpace: true, backslashQuote: true })],
  ['fl04', (x) => setSegmentProperties(x, 'ZZ_FL_REC_A', { recordId: '1', idLength: 1, qualifier: "'", delimiterType: 4, delimiter: '|', description: 'seg desc', shiftStarts: 1 })],
  ['fl05', (x) => setFieldProperties(x, 'ZZ_FL_REC_A', 'EMPLID', { length: 15, trimSpaces: true, padField: true, upperCase: true, stripCharacters: '-', defaultValue: 'X', description: 'emp' })],
  ['fl06', (x) => { insertSegment(x, 'TRAILER', { after: 'ZZ_FL_REC_A' }); insertSegment(x, 'DETAIL', { parent: 'TRAILER' }); insertField(x, 'DETAIL', 'REC_COUNT', { type: 2, length: 6 }); }]
];
for (const [what, edit] of steps1) {
  const r = await reopen('ZZ_FL_E2E1');
  edit(r.doc);
  token = await save(r.doc, r.token, `E2E1 ${what}`);
}
const [a1, b1] = [await rowsOf('ZZ_FL_E2E1'), await rowsOf('ZZ_FL_N1')];
check('ZZ_FL_E2E1 = App Designer\'s ZZ_FL_N1, every column', JSON.stringify(a1) === JSON.stringify(b1),
  ['layout', 'segments', 'fields'].map((k) => `${k}: ${JSON.stringify((a1 as never)[k]) === JSON.stringify((b1 as never)[k])}`).join(' '));

// ZZ_FL_E2E2: App Designer's ZZ_FL_N2, fl07-fl11.
d = newLayout('ZZ_FL_E2E2');
insertRecord(d, 'ZZ_FL_REC_B', B);
await save(d, 'absent', 'E2E2 create (fl07)');
const steps2: Array<[string, (x: FileLayoutDocument) => void]> = [
  ['fl08', (x) => setFieldProperties(x, 'ZZ_FL_REC_B', 'EMPLID', { length: 15 })],
  ['fl09', (x) => setFieldProperties(x, 'ZZ_FL_REC_B', 'PLAN_TYPE', { propagate: 4 })],
  ['fl10', (x) => deleteField(x, 'ZZ_FL_REC_B', 'EFF_STATUS')],
  ['fl11', (x) => moveField(x, 'ZZ_FL_REC_B', 'COMPANY', -1)]
];
for (const [what, edit] of steps2) {
  const r = await reopen('ZZ_FL_E2E2');
  edit(r.doc);
  await save(r.doc, r.token, `E2E2 ${what}`);
}
check('ZZ_FL_E2E2 = App Designer\'s ZZ_FL_N2, every column', JSON.stringify(await rowsOf('ZZ_FL_E2E2')) === JSON.stringify(await rowsOf('ZZ_FL_N2')));

// A stale token is refused.
let refused = false;
try { const r = await reopen('ZZ_FL_E2E1'); setLayoutProperties(r.doc, { description: 'stale' }); await p.saveFileLayoutDocument({ doc: r.doc, openedToken: 'not-the-token', operatorId }); }
catch (e) { refused = /changed in the database/.test(String(e)); }
check('a stale token is refused', refused);

// Save As, Rename, Delete.
const e2 = await reopen('ZZ_FL_E2E2');
await save(copyLayout(e2.doc, 'ZZ_FL_E2E3'), 'absent', 'Save As E2E3 (fl12)');
check('Save As copies every row', JSON.stringify(await rowsOf('ZZ_FL_E2E3')) === JSON.stringify(await rowsOf('ZZ_FL_E2E2')));
let k0 = await counters();
const e3 = await reopen('ZZ_FL_E2E3');
const renamed = await p.renameFileLayoutDefinition('ZZ_FL_E2E3', 'ZZ_FL_E2E4', e3.token, operatorId);
let k1 = await counters();
const del3 = await q("SELECT VERSION FROM PSFLDDEL WHERE FLDDEFNNAME = 'ZZ_FL_E2E3'");
check('Rename: FLM, PJM, SYS + 1; PSFLDDEL at the new FLM; rows re-keyed (fl13)',
  k1.FLM === k0.FLM + 1 && k1.PJM === k0.PJM + 1 && k1.SYS === k0.SYS + 1 && renamed.version === k1.FLM && del3.some((r) => Number(r.VERSION) === k1.FLM)
  && JSON.stringify(await rowsOf('ZZ_FL_E2E4')) === JSON.stringify(await rowsOf('ZZ_FL_E2E2')) && !(await p.readFileLayoutDocument('ZZ_FL_E2E3')));
k0 = await counters();
await p.deleteFileLayoutDefinition('ZZ_FL_E2E4', (await reopen('ZZ_FL_E2E4')).token, operatorId);
k1 = await counters();
const del4 = await q("SELECT VERSION FROM PSFLDDEL WHERE FLDDEFNNAME = 'ZZ_FL_E2E4'");
check('Delete: rows gone, PSFLDDEL at the new FLM, FLM and SYS + 1 (fl14)',
  !(await p.readFileLayoutDocument('ZZ_FL_E2E4')) && k1.FLM === k0.FLM + 1 && k1.SYS === k0.SYS + 1 && k1.PJM === k0.PJM && del4.some((r) => Number(r.VERSION) === k1.FLM));

await p.dispose?.();
await raw.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
