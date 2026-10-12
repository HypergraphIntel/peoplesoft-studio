import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addField, addKey, addScroll, CI_COLLECTION, CI_FIND_KEY, CI_PROPERTY, CI_ROOT, ciFromBuffer, copyCi, deleteItem, setCi, setItem, setMethods, setSync,
  type CiDocument, type Row
} from '../model/ciDocument.js';
import { planCiSave, type Counters } from '../providers/ciWriter.js';
import { bufferOf, ciCaptureExists, counters, rowsOf, storedCi, storedDocument, systemIds } from './ciCaptures.js';

/*
 * Every captured App Designer Component Interface save (docs/COMPONENT_INTERFACES.md)
 * replayed through the planner: the document App Designer saved -- made from
 * the component, or the stored interface with the window's edit -- planned
 * against the rows before, and the rows, counters and PSSYSTEMID it plans
 * compared with the rows after.
 */

const ORA = { CLOB: 2017, STRING: 2001, BLOB: 2019 } as never;
const COUNTERS = ['BCM', 'CLM', 'MPM', 'PCM', 'PJM', 'SYS'] as const;
const STAMP = new Set(['LASTUPDDTTM', 'LASTUPDOPRID']);
const norm = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() === '' ? ' ' : String(v).trim());
const rowKey = (r: Row) => [r.BCTYPE, r.BCITEMPARENT, r.BCITEMNAME].map(norm).join('|');
const comparable = (r: Row) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, norm(r[k])]));

function replay(caseName: string, ci: string, doc: CiDocument, opts: { ignoreSyncIds?: boolean; syncCounter?: number; skipCounters?: string[] } = {}) {
  const before = storedCi(caseName, 'before', ci);
  const c0 = counters(caseName, 'before'), c1 = counters(caseName, 'after');
  const all = (c: Record<string, number>): Counters => Object.fromEntries(COUNTERS.map((n) => [n, c[n] ?? 0])) as unknown as Counters;
  const plan = planCiSave(before, doc, { operatorId: 'JARED', lastupddttm: '2026-10-11-00.00.00.000000', counters: all(c0), systemIds: { ...systemIds(caseName, 'before'), ...(opts.syncCounter ? { PSCISYNCDEFN: opts.syncCounter } : {}) }, oracledb: ORA });
  // Rows
  const want = new Map(rowsOf(caseName, 'after', 'PSBCITEM', ci).map((r) => [rowKey(r), r]));
  const got = new Map(plan.desired.items.map((r) => [rowKey(r), r]));
  assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort(), `${caseName}: the items`);
  for (const [k, r] of want) {
    const g = { ...got.get(k)! }, w = { ...r };
    if (opts.ignoreSyncIds) { delete g.SYNCID; delete w.SYNCID; }
    assert.equal(comparable(g), comparable(w), `${caseName}: ${k}`);
  }
  const [defn] = rowsOf(caseName, 'after', 'PSBCDEFN', ci);
  for (const col of Object.keys(plan.desired.defn)) if (!STAMP.has(col)) assert.equal(norm(plan.desired.defn[col]), norm(defn[col]), `${caseName}: PSBCDEFN.${col}`);
  assert.deepEqual(plan.desired.sync.map(comparable), rowsOf(caseName, 'after', 'PSCISYNCDEFN', ci).map(comparable), `${caseName}: PSCISYNCDEFN`);
  // Counters and PSSYSTEMID
  for (const n of COUNTERS) if (c0[n] !== undefined && c1[n] !== undefined && !opts.skipCounters?.includes(n)) assert.equal(plan.counters[n], c1[n], `${caseName}: ${n}`);
  if (!opts.ignoreSyncIds && !opts.syncCounter) assert.deepEqual(plan.systemIds, { ...systemIds(caseName, 'before'), ...Object.fromEntries(Object.entries(systemIds(caseName, 'after')).filter(([, v]) => v)) }, `${caseName}: PSSYSTEMID`);
  return plan;
}

const skip = (...cases: string[]) => cases.some((c) => !ciCaptureExists(c));

test('a new interface defaulted from its component is App Designer\'s, item for item, SYNCIDs and names (ci01-ci04)', (t) => {
  for (const [c, ci] of [['ci01-create', 'ZZ_PCODE_LAB_CI'], ['ci02-create-keys', 'ZZ_PCODE_LAB_CI2'], ['ci03-create-names', 'ZZ_PCODE_LAB_CI3'], ['ci04-create-work', 'ZZ_PCODE_LAB_CI4']]) {
    if (skip(c)) { t.diagnostic(`${c} not captured`); continue; }
    replay(c, ci, ciFromBuffer(ci, bufferOf(c)));
  }
});

test('"No" to defaulting: the key items only, and the name made again leaves PSBCDEL (ci28)', () => {
  if (skip('ci28-create-no')) return;
  const plan = replay('ci28-create-no', 'ZZ_PCODE_LAB_CI6', ciFromBuffer('ZZ_PCODE_LAB_CI6', bufferOf('ci28-create-no'), false));
  assert.ok(plan.statements.some((s) => /DELETE FROM PSBCDEL/.test(s.sql)));
});

test('Definition Properties: General, Standard Methods (CLM), Synchronization (ci05-ci10)', () => {
  const CI = 'ZZ_PCODE_LAB_CI2';
  const doc = (c: string) => storedDocument(c, 'before', CI, 'ci02-create-keys');
  if (!skip('ci05-props')) replay('ci05-props', CI, setCi(doc('ci05-props'), { description: 'Lab CI two', comments: 'Lab comments', owner: 'HTAC', menu: 'ADMINISTER_WORKFORCE_(GBL)' }));
  if (!skip('ci06-methods')) assert.equal(replay('ci06-methods', CI, setMethods(doc('ci06-methods'), { Find: false }, 2)).increments.CLM, 1);
  // ci07 was captured before PSSYSTEMID PSCISYNCDEFN was watched: it was 8 (its row took 9).
  if (!skip('ci07-sync')) replay('ci07-sync', CI, setSync(doc('ci07-sync'), { conflict: 2, messageSet: 1000, upload: 'N' }), { syncCounter: 8 });
  if (!skip('ci08-sync-custom')) replay('ci08-sync-custom', CI, setSync(doc('ci08-sync-custom'), { conflict: 3, upload: 'Y' }));
  if (!skip('ci09-sync-retain')) replay('ci09-sync-retain', CI, setSync(doc('ci09-sync-retain'), { conflict: 1, upload: 'D' }));
  if (!skip('ci10-sync-off')) replay('ci10-sync-off', CI, setSync(doc('ci10-sync-off'), undefined));
});

test('Edit Property: a rename keeps the SYNCID; Comment and Read Only (ci11, ci12)', () => {
  const CI = 'ZZ_PCODE_LAB_CI2';
  if (!skip('ci11-edit-prop')) replay('ci11-edit-prop', CI, setItem(storedDocument('ci11-edit-prop', 'before', CI, 'ci02-create-keys'), { type: CI_PROPERTY, parent: 'DRIVERS_LIC', name: 'STATE' }, { name: 'STATE_CD' }));
  if (!skip('ci12-prop-comment-ro')) replay('ci12-prop-comment-ro', CI, setItem(storedDocument('ci12-prop-comment-ro', 'before', CI, 'ci02-create-keys'), { type: CI_PROPERTY, parent: 'DRIVERS_LIC', name: 'COUNTRY' }, { comment: 'Lab comment', readOnly: true }));
});

test('Delete: a property, a key, a collection with everything under it (ci13, ci16, ci19)', () => {
  const CI = 'ZZ_PCODE_LAB_CI2';
  const d = (c: string) => storedDocument(c, 'before', CI, 'ci02-create-keys');
  if (!skip('ci13-delete-prop')) replay('ci13-delete-prop', CI, deleteItem(d('ci13-delete-prop'), { type: CI_PROPERTY, parent: 'DRIVERS_LIC', name: 'VIOLATIONS' }));
  if (!skip('ci16-delete-key')) replay('ci16-delete-key', CI, deleteItem(d('ci16-delete-key'), { type: CI_FIND_KEY, parent: CI_ROOT, name: 'NAME_AC' }));
  if (!skip('ci19-delete-coll')) replay('ci19-delete-coll', CI, deleteItem(d('ci19-delete-coll'), { type: CI_COLLECTION, parent: CI_ROOT, name: 'DRIVERS_LIC' }));
});

test('Drag: a field takes its buffer number and the next SYNCID; a key; a Long Edit field (ci14, ci15, ci17)', () => {
  const CI = 'ZZ_PCODE_LAB_CI2';
  if (skip('ci14-add-prop')) return;
  const buffer = bufferOf('ci02-create-keys');
  replay('ci14-add-prop', CI, addField(storedDocument('ci14-add-prop', 'before', CI, 'ci02-create-keys'), buffer, '00-00-01-00', 'DRIVERS_LIC', 'VIOLATIONS'));
  // ci15: App Designer gave the item added in its previous save (no SYNCID in its window) a new one too -- a session quirk; the rest is the same.
  replay('ci15-add-long', CI, addField(storedDocument('ci15-add-long', 'before', CI, 'ci02-create-keys'), buffer, '00-00-01-00', 'DRIVERS_LIC', 'COMMENTS'), { ignoreSyncIds: true });
  replay('ci17-add-key', CI, addKey(storedDocument('ci17-add-key', 'before', CI, 'ci02-create-keys'), buffer, CI_FIND_KEY, 'NAME_AC'));
  assert.throws(() => addKey(storedDocument('ci17-add-key', 'after', CI, 'ci02-create-keys'), buffer, 1, 'NAME'), /cannot be a GETKEYS/); // ci18
});

test('Drag: a scroll, with its child scrolls, push buttons, invisible fields; merged into its collection (ci20-ci23)', () => {
  if (skip('ci20-add-coll', 'ci21-add-coll-ctl')) return;
  replay('ci20-add-coll', 'ZZ_PCODE_LAB_CI2', addScroll(storedDocument('ci20-add-coll', 'before', 'ZZ_PCODE_LAB_CI2', 'ci02-create-keys'), bufferOf('ci02-create-keys'), '00-00-01-00'));
  const buffer = bufferOf('ci04-create-work');
  const CI = 'ZZ_PCODE_LAB_CI4';
  replay('ci21-add-coll-ctl', CI, addScroll(storedDocument('ci21-add-coll-ctl', 'before', CI, 'ci04-create-work'), buffer, '00-00-01-03'));
  replay('ci22-add-coll-mixed', CI, addScroll(storedDocument('ci22-add-coll-mixed', 'before', CI, 'ci04-create-work'), buffer, '00-00-01-15'));
  replay('ci23-add-coll-invis', CI, addScroll(storedDocument('ci23-add-coll-invis', 'before', CI, 'ci04-create-work'), buffer, '00-00-01-13'));
});

test('Save As: a copy whose every item takes a new SYNCID in the window\'s order (ci25)', () => {
  if (skip('ci25-saveas', 'ci24-pc-method')) return;
  replay('ci25-saveas', 'ZZ_PCODE_LAB_CI5', copyCi(storedDocument('ci24-pc-method', 'after', 'ZZ_PCODE_LAB_CI2', 'ci02-create-keys'), 'ZZ_PCODE_LAB_CI5'),
    { skipCounters: ['PCM'] }); // the PeopleCode copy (PCM + 1) is saveCi's, not the plan's
});

test('an interface saved unchanged plans nothing', () => {
  if (skip('ci05-props')) return;
  const before = storedCi('ci05-props', 'before', 'ZZ_PCODE_LAB_CI2');
  const plan = planCiSave(before, storedDocument('ci05-props', 'before', 'ZZ_PCODE_LAB_CI2', 'ci02-create-keys'),
    { operatorId: 'JARED', lastupddttm: 'x', counters: { BCM: 1, CLM: 1, MPM: 1, PCM: 1, PJM: 1, SYS: 1 }, systemIds: { PSBCITEM: 1, PSCISYNCDEFN: 1 }, oracledb: ORA });
  assert.equal(plan.empty, true);
  assert.equal(plan.statements.length, 0);
});
