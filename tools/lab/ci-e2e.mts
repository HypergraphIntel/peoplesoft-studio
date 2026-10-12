/*
 * The Component Interface writer end to end on HRDMO (what the CI Designer
 * and the MCP's psft_ci_* tools run): interfaces made from components as
 * App Designer makes them (compared, row for row, with App Designer's own
 * captures ci02 and ci04 -- SYNCIDs as their order), edited by the window's
 * edits, their Methods PeopleCode saved, copied with it (Save As), renamed
 * and deleted -- each saved through DatabaseProvider and read back.
 *
 * WRITES. HRDMO only; interfaces ZZ_CI_E2E* only. Leaves ZZ_CI_E2E1 and
 * ZZ_CI_E2E4 for App Designer to open.
 *
 *   npx tsx tools/lab/ci-e2e.mts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import {
  addField, addKey, addScroll, CI_COLLECTION, CI_FIND_KEY, CI_PROPERTY, CI_ROOT, copyCi, deleteItem, rowsFromDocument, setCi, setItem, setMethods, setSync, type Row
} from '../../src/model/ciDocument';
import { makeKey, DefinitionType } from '../../src/model/definitions';
import { fingerprint } from '../../src/peoplecode/writeback/savePlan';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_CI_E2E');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const raw = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
await raw.execute('ALTER SESSION SET CURRENT_SCHEMA = SYSADM');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const q1 = async (sql: string, b: Record<string, unknown> = {}) => ((await raw.execute(sql, b, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Row[];
const t = (v: unknown) => String(v ?? '').trim();

/** Items comparable with a capture: SYNCIDs as their rank, the interface's name out. */
function shape(rows: Row[]): string[] {
  const ids = rows.map((r) => Number(r.SYNCID)).sort((a, b) => a - b);
  return rows.map((r) => [r.BCTYPE, r.BCITEMPARENT, r.BCITEMNAME, r.SEQUENCE_NBR_6, r.BCACCESS, r.BCSCROLL, r.BCSCROLLNUM, r.BCSCROLLNAME, r.RECNAME, r.FIELDNAME,
    r.COMMENTSHORT, ids.indexOf(Number(r.SYNCID))].map(t).join('|')).sort();
}
function captured(caseName: string): Row[] {
  const w = JSON.parse(readFileSync(join('tools/corpus/save-protocol/results', caseName, 'after.json'), 'utf8')).watch.PSBCITEM;
  return w.rows.map((r: unknown[]) => Object.fromEntries(w.columns.map((c: { name: string }, i: number) => [c.name, r[i]])));
}

// Clean slate.
for (const n of (await q1(`SELECT BCNAME FROM PSBCDEFN WHERE BCNAME LIKE 'ZZ\\_CI\\_E2E%' ESCAPE '\\'`)).map((r) => t(r.BCNAME))) {
  const r = await p.readCiDocument(n);
  if (r) await p.deleteCiDefinition(n, r.token, operatorId);
}

try {
  // ---- made from components, as App Designer makes them
  for (const [name, component, cap] of [['ZZ_CI_E2E1', 'DRIVERS_LICENSE', 'ci02-create-keys'], ['ZZ_CI_E2E4', 'HCSC_ADH_NOTIFY_FL', 'ci04-create-work']]) {
    const { doc } = await p.newCiDocument(name, component, 'GBL', true);
    const r = await p.saveCiDocument({ doc, openedToken: 'absent', operatorId });
    check(`${name} made from ${component} (BCM +1, SYS +1)`, r.written && r.plan.increments.BCM === 1 && r.plan.increments.SYS === 1, JSON.stringify(r.plan.increments));
    const mine = shape(await q1(`SELECT * FROM PSBCITEM WHERE BCNAME = :n`, { n: name }));
    const theirs = shape(captured(cap));
    const missing = theirs.filter((x) => !mine.includes(x)), extra = mine.filter((x) => !theirs.includes(x));
    check(`${name}'s items are App Designer's (${cap})`, !missing.length && !extra.length, `missing ${missing.slice(0, 3).join(' ; ')} extra ${extra.slice(0, 3).join(' ; ')}`);
  }

  // ---- the window's edits on ZZ_CI_E2E1
  let read = (await p.readCiDocument('ZZ_CI_E2E1'))!;
  let doc = setCi(read.doc, { description: 'CI end to end', comments: 'Lab comments', owner: 'HTAC', menu: 'ADMINISTER_WORKFORCE_(GBL)' });
  doc = setMethods(doc, { Find: false }, 2);
  doc = setSync(doc, { conflict: 2, messageSet: 1000, upload: 'N' });
  doc = setItem(doc, { type: CI_PROPERTY, parent: 'DRIVERS_LIC', name: 'STATE' }, { name: 'STATE_CD' });
  doc = setItem(doc, { type: CI_PROPERTY, parent: 'DRIVERS_LIC', name: 'COUNTRY' }, { comment: 'Lab comment', readOnly: true });
  doc = deleteItem(doc, { type: CI_PROPERTY, parent: 'DRIVERS_LIC', name: 'VIOLATIONS' });
  doc = deleteItem(doc, { type: CI_FIND_KEY, parent: CI_ROOT, name: 'NAME_AC' });
  doc = addField(doc, read.buffer!, '00-00-01-00', 'DRIVERS_LIC', 'COMMENTS');
  const e = await p.saveCiDocument({ doc, openedToken: read.token, operatorId });
  check('edits saved: BCM +1, CLM +1 (Find taken away), SYS +1', e.plan.increments.BCM === 1 && e.plan.increments.CLM === 1 && e.plan.increments.SYS === 1, JSON.stringify(e.plan.increments));
  const [defn] = await q1(`SELECT DESCR, MENUNAME, BCSTDMETHODS, OBJECTOWNERID FROM PSBCDEFN WHERE BCNAME = 'ZZ_CI_E2E1'`);
  check('the properties dialog\'s columns', t(defn.DESCR) === 'CI end to end' && t(defn.MENUNAME) === 'ADMINISTER_WORKFORCE_(GBL)' && Number(defn.BCSTDMETHODS) === 25 && t(defn.OBJECTOWNERID) === 'HTAC', JSON.stringify(defn));
  const sync = await q1(`SELECT * FROM PSCISYNCDEFN WHERE BCNAME = 'ZZ_CI_E2E1'`);
  check('synchronizable: its row with a SYNCID from PSSYSTEMID', sync.length === 1 && Number(sync[0].CONFLICTRESOLUTION) === 2 && t(sync[0].MPDEVICEPERSIST) === 'N' && Number(sync[0].SYNCID) > 0, JSON.stringify(sync));
  const items = await q1(`SELECT * FROM PSBCITEM WHERE BCNAME = 'ZZ_CI_E2E1'`);
  const item = (parent: string, name: string) => items.find((r) => t(r.BCITEMPARENT) === parent && t(r.BCITEMNAME) === name);
  check('renamed, commented, read only, deleted, added', !!item('DRIVERS_LIC', 'STATE_CD') && !item('DRIVERS_LIC', 'STATE') && t(item('DRIVERS_LIC', 'COUNTRY')?.COMMENTSHORT) === 'Lab comment' &&
    Number(item('DRIVERS_LIC', 'COUNTRY')?.BCACCESS) === 2 && !item('DRIVERS_LIC', 'VIOLATIONS') && Number(item('DRIVERS_LIC', 'COMMENTS')?.SEQUENCE_NBR_6) === 22);

  read = (await p.readCiDocument('ZZ_CI_E2E1'))!;
  doc = deleteItem(read.doc, { type: CI_COLLECTION, parent: CI_ROOT, name: 'DRIVERS_LIC' });
  await p.saveCiDocument({ doc, openedToken: read.token, operatorId });
  read = (await p.readCiDocument('ZZ_CI_E2E1'))!;
  check('a collection deleted with everything under it', !read.doc.items.some((i) => i.parent === 'DRIVERS_LIC' || i.name === 'DRIVERS_LIC'));
  doc = addScroll(addKey(read.doc, read.buffer!, CI_FIND_KEY, 'NAME_AC'), read.buffer!, '00-00-01-00');
  await p.saveCiDocument({ doc, openedToken: read.token, operatorId });
  read = (await p.readCiDocument('ZZ_CI_E2E1'))!;
  const coll = read.doc.items.filter((i) => i.parent === 'DRIVERS_LIC').map((i) => i.name).sort().join(',');
  check('a scroll dragged back: its every field but the parent\'s keys, its child scroll', coll === 'COMMENTS,COUNTRY,DRIVERS_LIC_NBR,DRIVER_LTYP,EXPIRATN_DT,HCSCM_MASK_DL,ISSUED_BY_FRA,ISSUE_DEST_FRA,LIC_SUSPENDED_SW,NUMBER_OF_PTS,STATE,VALID_FROM_DT,VIOLATIONS', coll);

  // ---- Methods PeopleCode through the PeopleCode writer, Save As with it, rename, delete
  const pcKey = makeKey(DefinitionType.ComponentInterfacePeopleCode, 'ZZ_CI_E2E1', 'Methods');
  const saved = await p.savePeopleCode(pcKey, { source: 'Function ZzLabMethod() Returns string\n   Return "lab";\nEnd-Function;\n', openedFingerprint: fingerprint(undefined), operatorId });
  check('Methods PeopleCode created (74 / 12)', saved.kind === 'saved');
  read = (await p.readCiDocument('ZZ_CI_E2E1'))!;
  const copy = await p.saveCiDocument({ doc: copyCi(read.doc, 'ZZ_CI_E2E2'), openedToken: 'absent', operatorId, copyPeopleCodeFrom: 'ZZ_CI_E2E1' });
  const pc2 = await q1(`SELECT VERSION FROM PSPCMPROG WHERE OBJECTID1 = 74 AND OBJECTVALUE1 = 'ZZ_CI_E2E2'`);
  check('Save As with the PeopleCode: the copy\'s program at the new PCM', copy.written && pc2.length === 1 && Number(pc2[0].VERSION) === copy.plan.counters.PCM, JSON.stringify(pc2));
  const ids = (await q1(`SELECT SYNCID FROM PSBCITEM WHERE BCNAME IN ('ZZ_CI_E2E1', 'ZZ_CI_E2E2')`)).map((r) => Number(r.SYNCID));
  check('the copy\'s items have SYNCIDs of their own', new Set(ids).size === ids.length);
  const c2 = (await p.readCiDocument('ZZ_CI_E2E2'))!;
  await p.renameCiDefinition('ZZ_CI_E2E2', 'ZZ_CI_E2E3', c2.token, operatorId);
  check('rename: PSBCDEL for the old name, the PeopleCode moved, a PSPCMPROGDEL marker',
    (await q1(`SELECT 1 FROM PSBCDEL WHERE BCNAME = 'ZZ_CI_E2E2'`)).length === 1 &&
    (await q1(`SELECT 1 FROM PSPCMPROG WHERE OBJECTID1 = 74 AND OBJECTVALUE1 = 'ZZ_CI_E2E3'`)).length === 1 &&
    (await q1(`SELECT 1 FROM PSPCMPROGDEL WHERE OBJECTID1 = 74 AND OBJECTVALUE1 = 'ZZ_CI_E2E2'`)).length === 1);
  const c3 = (await p.readCiDocument('ZZ_CI_E2E3'))!;
  await p.deleteCiDefinition('ZZ_CI_E2E3', c3.token, operatorId);
  check('delete: gone, PSBCDEL, the PeopleCode gone with a marker', !(await p.readCiDocument('ZZ_CI_E2E3')) &&
    (await q1(`SELECT 1 FROM PSBCDEL WHERE BCNAME = 'ZZ_CI_E2E3'`)).length === 1 &&
    (await q1(`SELECT 1 FROM PSPCMPROG WHERE OBJECTID1 = 74 AND OBJECTVALUE1 = 'ZZ_CI_E2E3'`)).length === 0);

  // ---- refusals
  let refused = '';
  try { await p.saveCiDocument({ doc: read.doc, openedToken: 'stale', operatorId }); } catch (err) { refused = String(err); }
  check('a stale token refused', /changed in the database/.test(refused), refused);
  refused = '';
  try { await p.saveCiDocument({ doc: copyCi(read.doc, 'ZZ_CI_E2E4'), openedToken: 'absent', operatorId }); } catch (err) { refused = String(err); }
  check('an existing name refused', /already exists/.test(refused), refused);
  refused = '';
  try { await p.saveCiDocument({ doc: copyCi(read.doc, 'ZZ_PCODE_LAB_CIX'), openedToken: 'absent', operatorId }); } catch (err) { refused = String(err); }
  check('a name outside the write scope refused', refused.length > 0, refused);
  check('rows from the document re-read are the stored ones', rowsFromDocument(read.doc).items.length === Number((await q1(`SELECT ITEMCOUNT FROM PSBCDEFN WHERE BCNAME = 'ZZ_CI_E2E1'`))[0].ITEMCOUNT));
} finally {
  await p.dispose();
  await raw.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
