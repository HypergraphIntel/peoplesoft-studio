import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RecordType, UseEdit2 } from '../model/record.js';
import {
  editStateFor, inMemoryMode, insertField, planRecordSave, setInMemory, setUse, type InMemoryMode, type RecordEditState, type Row, type StoredRecord
} from '../model/recordEdit.js';

const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');
const s = (v: unknown) => String(v ?? '').trim();

interface Case { stored: StoredRecord; before: Row[]; after: Row[]; defnAfter: Row }

/** ZZ_PCODE_LAB_R1's rows before and after an App Designer save. */
function load(dir: string): Case | undefined {
  const file = path.join(RESULTS, dir, 'delta.json');
  if (!existsSync(file)) return undefined;
  const d = JSON.parse(readFileSync(file, 'utf8')) as { otherTables: Record<string, { inserted: Row[]; deleted: Row[] }> };
  const of = (table: string, kind: 'inserted' | 'deleted') =>
    (d.otherTables[table]?.[kind] ?? []).filter((r) => s(r.RECNAME) === 'ZZ_PCODE_LAB_R1').sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
  const [defnBefore] = of('PSRECDEFN', 'deleted');
  const [defnAfter] = of('PSRECDEFN', 'inserted');
  const before = of('PSRECFIELD', 'deleted');
  return {
    stored: { recname: 'ZZ_PCODE_LAB_R1', recordType: RecordType.Table, version: Number(defnBefore.VERSION), defn: defnBefore, fields: before, indexes: [] },
    before, after: of('PSRECFIELD', 'inserted'), defnAfter
  };
}

const context = (c: Case, column: (n: string) => string = () => '') =>
  ({ stored: inMemoryMode(Number(c.stored.defn!.AUXFLAGMASK)), storedType: RecordType.Table, column });

/** The plan's field rows: USEEDIT2 and whether the save stamped them. */
const fieldsOf = (rows: Row[], before: Row[]) => rows.map((r) => [s(r.FIELDNAME), Number(r.USEEDIT2),
  String(before.find((b) => s(b.FIELDNAME) === s(r.FIELDNAME))?.LASTUPDDTTM) === String(r.LASTUPDDTTM) ? 'kept' : 'stamped']);

test('In Memory, All Fields: the record bit, every field marked, none restamped (r67)', (t) => {
  const c = load('r67-inmemory-all');
  if (!c) return t.skip('case not present');
  const e = setInMemory(editStateFor(c.stored), 'all', context(c));
  const plan = planRecordSave(c.stored, e, { ts: 'NOW', operatorId: 'J' });
  assert.equal(plan.recordColumns.AUXFLAGMASK, Number(c.defnAfter.AUXFLAGMASK)); // 0x10010000: Tools Table kept
  // App Designer set USEEDIT2 to 0x80000 outright, losing Do Not Trace Value (C04, C05), Smart Drop-Down (C07)
  // and Smart Prompt (VAL); the plan keeps them. Otherwise its rows.
  const kept = UseEdit2.DoNotTraceValue | UseEdit2.SmartPrompt | UseEdit2.SmartDropDown;
  const expected = c.after.map((r, i) => ({ ...r, USEEDIT2: Number(r.USEEDIT2) | (Number(c.before[i].USEEDIT2) & kept) }));
  assert.deepEqual(fieldsOf(plan.fields, c.before), fieldsOf(expected, c.before));
  assert.ok(fieldsOf(plan.fields, c.before).every(([, , stamp]) => stamp === 'kept'));
});

test('In Memory off: the bits cleared, other USEEDIT2 bits kept, nothing restamped (r70)', (t) => {
  const c = load('r70-inmemory-off');
  if (!c) return t.skip('case not present');
  const plan = planRecordSave(c.stored, setInMemory(editStateFor(c.stored), 'off', context(c)), { ts: 'NOW', operatorId: 'J' });
  assert.equal(plan.recordColumns.AUXFLAGMASK, 0);
  assert.deepEqual(fieldsOf(plan.fields, c.before), fieldsOf(c.after, c.before));
});

test('In Memory, Selective Fields: the record bit alone (r71), then fields chosen one by one, restamped (r72)', (t) => {
  const c71 = load('r71-inmemory-selective');
  const c72 = load('r72-inmemory-fields');
  if (!c71 || !c72) return t.skip('case not present');
  const p71 = planRecordSave(c71.stored, setInMemory(editStateFor(c71.stored), 'selective', context(c71)), { ts: 'NOW', operatorId: 'J' });
  assert.equal(p71.recordColumns.AUXFLAGMASK, 0x20000000);
  assert.deepEqual(fieldsOf(p71.fields, c71.before), fieldsOf(c71.after, c71.before));

  let e: RecordEditState = editStateFor(c72.stored);
  e.fields.forEach((f, i) => { if (f.name !== 'ZZ_PCODE_LAB_C01') e = setUse(e, i, { inMemory: true }); });
  const p72 = planRecordSave(c72.stored, e, { ts: 'NOW', operatorId: 'J' });
  assert.equal(p72.recordColumns.AUXFLAGMASK, undefined);
  assert.deepEqual(fieldsOf(p72.fields, c72.before), fieldsOf(c72.after, c72.before));
});

const R6: StoredRecord = {
  recname: 'ZZ_PCODE_LAB_R6', recordType: RecordType.Table, version: 1, defn: { AUXFLAGMASK: 0 }, indexes: [],
  fields: ['KEY', 'L1', 'L2'].map((n, i) => ({ RECNAME: 'ZZ_PCODE_LAB_R6', FIELDNAME: `ZZ_PCODE_LAB_${n}`, FIELDNUM: i + 1, USEEDIT: 0x800000, USEEDIT2: 0, SUBRECORD: 'N' }))
};
const r6Columns = (n: string): string => (n === 'ZZ_PCODE_LAB_L1' ? 'CLOB' : n === 'ZZ_PCODE_LAB_L2' ? 'vARCHAR2(254)' : 'VARCHAR2(10)');
const r6 = (stored: InMemoryMode = 'off', column = r6Columns) => ({ stored, storedType: RecordType.Table, column });

test('All Fields leaves a CLOB out, and the record is stored as Selective Fields (R6, r65)', () => {
  const e = setInMemory(editStateFor(R6), 'all', r6());
  assert.equal(e.properties?.inMemory, 'selective');
  const plan = planRecordSave(R6, e, { ts: 'NOW', operatorId: 'J' });
  assert.equal(plan.recordColumns.AUXFLAGMASK, 0x20000000);
  assert.deepEqual(plan.fields.map((f) => Number(f.USEEDIT2)), [0x80000, 0, 0x80000]);
});

test('In Memory refuses what App Designer has not been seen to save', () => {
  const allOn = { ...R6, defn: { AUXFLAGMASK: 0x10000000 } };
  assert.throws(() => setInMemory(editStateFor(allOn), 'selective', r6('all')), /turn In Memory off/);
  assert.throws(() => setInMemory(editStateFor(R6), 'all', r6('off', (n) => (n === 'ZZ_PCODE_LAB_L1' ? 'BLOB' : ''))), /BLOB/);
  assert.throws(() => setInMemory(editStateFor({ ...R6, recordType: RecordType.DerivedWork }), 'all',
    { ...r6(), storedType: RecordType.DerivedWork }), /only on SQL Tables/);
  // A field is chosen only under Selective Fields.
  assert.throws(() => planRecordSave(allOn, setUse(editStateFor(allOn), 1, { inMemory: true }), { ts: 'NOW', operatorId: 'J' }), /only under Selective/);
  assert.throws(() => planRecordSave(R6, setUse(editStateFor(R6), 0, { inMemory: true }), { ts: 'NOW', operatorId: 'J' }), /only under Selective/);
  assert.throws(() => planRecordSave(allOn, insertField(editStateFor(allOn), 'ZZ_PCODE_LAB_C01', 3), { ts: 'NOW', operatorId: 'J' }), /All Fields/);
  // Unchanged: nothing to do.
  assert.equal(setInMemory(editStateFor(allOn), 'all', r6('all')).properties, undefined);
});
