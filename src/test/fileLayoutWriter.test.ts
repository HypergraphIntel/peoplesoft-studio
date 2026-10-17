import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  copyLayout, deleteField, documentFromRows, insertField, insertRecord, insertSegment, moveField, newLayout, rowsFromDocument, setFieldProperties,
  setLayoutProperties, setSegmentProperties, validateFileLayout, type FileLayoutDocument, type FileLayoutRows, type RecordFieldInfo, type Row
} from '../model/fileLayoutDocument.js';
import { planFileLayoutDelete, planFileLayoutRename, planFileLayoutSave, type Counters, type StoredFileLayout } from '../providers/fileLayoutWriter.js';

/*
 * The File Layout writer replayed against App Designer's own saves on HRDMO
 * (tools/corpus/save-protocol/results/fl01-fl15): from each capture's before
 * rows, the same edit through the document model must give the after rows
 * column for column (the save stamp aside), and the plan the counters
 * App Designer moved.
 */

const RESULTS = join(process.cwd(), 'tools/corpus/save-protocol/results');
type Watch = Record<string, { columns: Array<{ name: string }>; rows: Array<Array<string | null>> }>;
const rowsOf = (w: Watch, t: string): Row[] => (w[t]?.rows ?? []).map((r) => Object.fromEntries(w[t].columns.map((c, i) => [c.name, r[i]])));
function capture(name: string, phase: 'before' | 'after'): FileLayoutRows {
  const w = JSON.parse(readFileSync(join(RESULTS, name, `${phase}.json`), 'utf8')).watch as Watch;
  const [layout = {}] = rowsOf(w, 'PSFLDDEFN');
  return { layout, segments: rowsOf(w, 'PSFLDSEGDEFN'), fields: rowsOf(w, 'PSFLDFIELDDEFN') };
}
function counters(name: string, phase: 'before' | 'after'): Record<string, number> {
  const w = JSON.parse(readFileSync(join(RESULTS, name, `${phase}.json`), 'utf8')).watch as Watch;
  return Object.fromEntries(rowsOf(w, 'PSVERSION').map((r) => [String(r.OBJECTTYPENAME).trim(), Number(r.VERSION)]));
}
const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const norm = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() === '' ? ' ' : String(v).replace(/\s+$/, ''));
const shape = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, norm(r[k])])))
  .sort((a, b) => JSON.stringify([a.FLDSEGNAME, a.FLDFIELDNAME]).localeCompare(JSON.stringify([b.FLDSEGNAME, b.FLDFIELDNAME])));
function same(got: FileLayoutRows, want: FileLayoutRows, what: string): void {
  assert.deepEqual(shape([got.layout]), shape([want.layout]), `${what}: PSFLDDEFN`);
  assert.deepEqual(shape(got.segments), shape(want.segments), `${what}: PSFLDSEGDEFN`);
  assert.deepEqual(shape(got.fields), shape(want.fields), `${what}: PSFLDFIELDDEFN`);
}
const docOf = (c: string, name: string) => documentFromRows(name, capture(c, 'before'));

const c = (name: string, length: number): RecordFieldInfo => ({ name, type: 0, length, decimals: 0 });
const d = (name: string): RecordFieldInfo => ({ name, type: 4, length: 10, decimals: 0 });
const DED_CUR: RecordFieldInfo = { name: 'DED_CUR', type: 3, length: 12, decimals: 2 };
/** PSRECFIELDDB order with PSDBFIELD type / length / decimals, as readRecordFieldInfo reads them on HRDMO (lab records of delivered fields). */
const ZZ_FL_REC_A = [c('EMPLID', 11), c('PLAN_TYPE', 2), c('DED_CLASS', 1), c('RUN_ID', 10), c('DEDCD', 6), DED_CUR, d('CHECK_DT'),
  { name: 'BALANCE_YEAR', type: 2, length: 4, decimals: 0 }, c('COMPANY', 3), d('PROCESS_DT'),
  { name: 'BEGIN_TM', type: 5, length: 15, decimals: 0 }, { name: 'DTTM_STAMP', type: 6, length: 26, decimals: 0 }];
const ZZ_FL_REC_B = [c('EMPLID', 11), c('PLAN_TYPE', 2), d('EFFDT'), c('EFF_STATUS', 1), DED_CUR, d('COVERAGE_BEGIN_DT'), d('COVERAGE_END_DT'),
  c('BENEFIT_PLAN', 6), c('COVRG_CD', 2), c('COMPANY', 3), d('PROCESS_DT')];

const CASES: Array<[string, string, (doc: FileLayoutDocument) => FileLayoutDocument]> = [
  ['fl01-create', 'ZZ_FL_N1', () => { const x = newLayout('ZZ_FL_N1'); insertRecord(x, 'ZZ_FL_REC_A', ZZ_FL_REC_A); return x; }],
  ['fl02-props-csv', 'ZZ_FL_N1', (x) => { setLayoutProperties(x, { format: 1, description: 'FL lab N1', comments: 'lab comments' }); return x; }],
  ['fl03-csv-options', 'ZZ_FL_N1', (x) => {
    setLayoutProperties(x, { qualifierOptional: true, convertTabs: true, interpretBackslash: true, stripWhiteSpace: true, backslashQuote: true }); return x;
  }],
  ['fl04-segment-props', 'ZZ_FL_N1', (x) => {
    setSegmentProperties(x, 'ZZ_FL_REC_A', { recordId: '1', idLength: 1, qualifier: "'", delimiterType: 4, delimiter: '|', description: 'seg desc', shiftStarts: 1 }); return x;
  }],
  ['fl05-field-props', 'ZZ_FL_N1', (x) => {
    setFieldProperties(x, 'ZZ_FL_REC_A', 'EMPLID', { length: 15, trimSpaces: true, padField: true, upperCase: true, stripCharacters: '-', defaultValue: 'X', description: 'emp' }); return x;
  }],
  ['fl06-add-segments', 'ZZ_FL_N1', (x) => {
    insertSegment(x, 'TRAILER', { after: 'ZZ_FL_REC_A' }); insertSegment(x, 'DETAIL', { parent: 'TRAILER' }); insertField(x, 'DETAIL', 'REC_COUNT', { type: 2, length: 6 }); return x;
  }],
  ['fl07-create-fixed', 'ZZ_FL_N2', () => { const x = newLayout('ZZ_FL_N2'); insertRecord(x, 'ZZ_FL_REC_B', ZZ_FL_REC_B); return x; }],
  ['fl08-fixed-length', 'ZZ_FL_N2', (x) => { setFieldProperties(x, 'ZZ_FL_REC_B', 'EMPLID', { length: 15 }); return x; }],
  ['fl09-propagate', 'ZZ_FL_N2', (x) => { setFieldProperties(x, 'ZZ_FL_REC_B', 'PLAN_TYPE', { propagate: 4 }); return x; }],
  ['fl10-delete-field', 'ZZ_FL_N2', (x) => { deleteField(x, 'ZZ_FL_REC_B', 'EFF_STATUS'); return x; }],
  ['fl11-move-field', 'ZZ_FL_N2', (x) => { moveField(x, 'ZZ_FL_REC_B', 'COMPANY', -1); return x; }],
  ['fl15-create-xml', 'ZZ_FL_N5', () => { const x = newLayout('ZZ_FL_N5'); insertRecord(x, 'ZZ_FL_REC_A', ZZ_FL_REC_A); setLayoutProperties(x, { format: 2 }); return x; }]
];

const ORACLE = { CLOB: 2017 } as never;
const opts = (k: Record<string, number>) => ({ operatorId: 'JARED', lastupddttm: '2026-10-15 21:00:00.000000', counters: { FLM: k.FLM, PJM: k.PJM, SYS: k.SYS } as Counters, oracledb: ORACLE });

for (const [name, layout, edit] of CASES) {
  test(`replays App Designer's ${name}`, () => {
    const before = capture(name, 'before'), after = capture(name, 'after');
    const doc = edit(before.layout.FLDDEFNNAME ? docOf(name, layout) : newLayout(layout));
    same(rowsFromDocument(doc), after, name);
    assert.deepEqual(validateFileLayout(doc).filter((p) => p.severity === 'error'), [], `${name} validates`);
    // The plan moves FLM and SYS by one and stamps the layout with the new FLM, as App Designer did.
    const k0 = counters(name, 'before'), k1 = counters(name, 'after');
    const stored: StoredFileLayout | undefined = before.layout.FLDDEFNNAME ? { exists: true, rows: before, tombstones: [] } : undefined;
    const plan = planFileLayoutSave(stored, doc, opts(k0));
    assert.equal(plan.empty, false);
    assert.deepEqual([plan.counters.FLM, plan.counters.SYS, plan.counters.PJM], [k1.FLM, k1.SYS, k1.PJM], `${name} counters`);
    assert.equal(Number(after.layout.VERSION), plan.counters.FLM, `${name} VERSION is the new FLM`);
  });
}

test('an unchanged document plans nothing', () => {
  const rows = capture('fl11-move-field', 'after');
  const doc = documentFromRows('ZZ_FL_N2', rows);
  same(rowsFromDocument(doc), rows, 'round trip');
  assert.equal(planFileLayoutSave({ exists: true, rows, tombstones: [] }, doc, opts(counters('fl11-move-field', 'after'))).empty, true);
});

test('Save As copies every row under the new name [fl12]', () => {
  const after = capture('fl12-save-as', 'after');
  const copy = copyLayout(documentFromRows('ZZ_FL_N2', capture('fl11-move-field', 'after')), 'ZZ_FL_N3');
  same(rowsFromDocument(copy), after, 'fl12');
  const plan = planFileLayoutSave(undefined, copy, opts(counters('fl12-save-as', 'before')));
  assert.equal(plan.counters.FLM, Number(after.layout.VERSION));
});

test('Rename and Delete move the counters App Designer moved and leave PSFLDDEL [fl13, fl14]', () => {
  const k0 = counters('fl13-rename', 'before'), k1 = counters('fl13-rename', 'after');
  const rename = planFileLayoutRename('ZZ_FL_N3', 'ZZ_FL_N4', { exists: false, rows: { layout: {}, segments: [], fields: [] }, tombstones: [] }, opts(k0));
  assert.deepEqual(rename.counters, { FLM: k1.FLM, PJM: k1.PJM, SYS: k1.SYS });
  const del = rename.statements.find((s) => s.sql.startsWith('INSERT INTO PSFLDDEL'))!;
  assert.deepEqual(del.binds, { f: 'ZZ_FL_N3', v: k1.FLM });
  assert.equal(Number(capture('fl13-rename-new', 'after').layout.VERSION), k1.FLM);

  const d0 = counters('fl14-delete', 'before'), d1 = counters('fl14-delete', 'after');
  const drop = planFileLayoutDelete('ZZ_FL_N4', { FLM: d0.FLM, PJM: d0.PJM, SYS: d0.SYS });
  assert.deepEqual(drop.counters, { FLM: d1.FLM, PJM: d1.PJM, SYS: d1.SYS });
  assert.deepEqual(drop.statements.find((s) => s.sql.startsWith('INSERT INTO PSFLDDEL'))!.binds, { n: 'ZZ_FL_N4', v: d1.FLM });
});

test('the model refuses what App Designer refuses', () => {
  const x = newLayout('ZZ_X');
  assert.ok(validateFileLayout(x).some((p) => /at least one segment/.test(p.message)));
  insertRecord(x, 'ZZ_FL_REC_A', ZZ_FL_REC_A);
  assert.throws(() => insertRecord(x, 'ZZ_FL_REC_A', ZZ_FL_REC_A), /already has a segment/);
  assert.throws(() => insertField(x, 'ZZ_FL_REC_A', 'EMPLID'), /already has a field/);
  assert.throws(() => setFieldProperties(x, 'ZZ_FL_REC_A', 'NOPE', {}), /no field NOPE/);
  assert.throws(() => insertSegment(x, '1BAD'), /not a segment name/);
});
