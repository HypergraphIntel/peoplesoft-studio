import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { componentBuffer, pageStructure, peopleCodeAccess, type RecordInfo, type StructureControl } from '../model/bufferStructure.js';
import { buildComponentStructure, type StructureField } from '../model/componentStructure.js';
import { buildPageLayout } from '../model/pageLayout.js';
import { applyPageOperations } from '../model/pageOperations.js';
import { planPageSave, type StoredControl } from '../providers/pageWriter.js';

/** A capture's stored PSPNLFIELD rows of a page, in tab order. */
function rows(capture: string, page: string): Array<Record<string, string>> {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'after.json'), 'utf8')).watch.PSPNLFIELD;
  const cols: string[] = t.columns.map((c: { name: string }) => c.name);
  return (t.rows as string[][]).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))).filter((r) => r.PNLNAME === page)
    .sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
}
// The lab records (mkrecs on HRDMO): each level keyed by the level above's keys and one of its own.
const info = new Map<string, RecordInfo>([
  ['ZZ_R_L0_A', { type: 0, keys: ['ZZ_KEY0'] }], ['ZZ_R_L0_B', { type: 0, keys: ['ZZ_KEY0'] }],
  ['ZZ_R_L1_A', { type: 0, keys: ['ZZ_KEY0', 'ZZ_KEY1'] }], ['ZZ_R_L2_A', { type: 0, keys: ['ZZ_KEY0', 'ZZ_KEY1', 'ZZ_KEY2'] }],
  ['DERIVED_ADDRESS', { type: 2, keys: [] }]
]);
const controls = (capture: string, page: string): StructureControl[] => rows(capture, page).map((r) => ({
  id: Number(r.PNLFLDID), typeName: r.FIELDTYPE, fieldType: Number(r.FIELDTYPE), occursLevel: Number(r.OCCURSLEVEL), fieldUse: Number(r.FIELDUSE),
  recName: r.RECNAME, fieldName: r.FIELDNAME, label: r.LBLTEXT, assocFieldNum: Number(r.ASSOCFIELDNUM), recType: info.get(r.RECNAME.trim())?.type ?? -1
}));

test('a page\'s scroll tree: primary records, their keys split by the level above, the controls\' scrolls (ZZ_PCODE_LAB_LV, lv18)', () => {
  const s = pageStructure('ZZ_PCODE_LAB_LV', controls('lv18-derived-in-scroll', 'ZZ_PCODE_LAB_LV'), info);
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.level0.records, ['ZZ_R_L0_A', 'ZZ_R_L0_B']);
  const [l1] = s.scrolls;
  assert.deepEqual([l1.level, l1.primary, l1.parentKeys, l1.rowKeys], [1, 'ZZ_R_L1_A', ['ZZ_KEY0'], ['ZZ_KEY1']]);
  assert.deepEqual(l1.records, [{ name: 'ZZ_R_L1_A', type: 'SQL Table', pageFields: ['ZZ_KEY1', 'ZZ_KEY0'] }]);
  const [l2] = l1.scrolls;
  assert.deepEqual([l2.level, l2.primary, l2.parentKeys, l2.rowKeys], [2, 'ZZ_R_L2_A', ['ZZ_KEY0', 'ZZ_KEY1'], ['ZZ_KEY2']]);
  assert.deepEqual(l2.records.map((r) => `${r.name} ${r.type}`), ['ZZ_R_L2_A SQL Table', 'DERIVED_ADDRESS Derived/Work']);
  // ZZ_R_L1_A.ZZ_KEY0 after the Set to Level 1 rule is back in the Scroll Area (id 2); ZZ_R_L0_B after Set to Level 0 is in no scroll.
  const byField = (rec: string, field: string) => s.controls.find((c) => c.record === rec && c.field === field)!;
  assert.deepEqual([byField('ZZ_R_L1_A', 'ZZ_KEY0').level, byField('ZZ_R_L1_A', 'ZZ_KEY0').scroll], [1, 2]);
  assert.deepEqual([byField('ZZ_R_L2_A', 'ZZ_KEY2').scroll, byField('ZZ_R_L0_B', 'ZZ_KEY0').scroll], [4, null]);
});

test('the component buffer of ZZ_PCODE_LAB_LVC is App Designer\'s Structure tab, with keys and PeopleCode paths', () => {
  const pages: Record<string, StructureField[]> = {
    ZZ_PCODE_LAB_LV: rows('lv18-derived-in-scroll', 'ZZ_PCODE_LAB_LV') as unknown as StructureField[],
    ZZ_PCODE_LAB_LW: rows('wlw-fix', 'ZZ_PCODE_LAB_LW') as unknown as StructureField[]
  };
  const structure = buildComponentStructure(['ZZ_PCODE_LAB_LV', 'ZZ_PCODE_LAB_LW'], 'ZZ_R_L0_A', (p) => pages[p], (r) => info.get(r)?.type ?? -1);
  const b = componentBuffer(structure, info);
  assert.deepEqual(b.searchRecord, { name: 'ZZ_R_L0_A', type: 'SQL Table', keys: ['ZZ_KEY0'] });
  assert.deepEqual(b.level0.records.map((r) => r.name), ['ZZ_R_L0_A', 'ZZ_R_L0_B']);
  // App Designer: Level 1 ZZ_R_L1_A (Level 2 ZZ_R_L2_A with DERIVED_ADDRESS), then Level 1 ZZ_R_L2_A from the second page.
  assert.deepEqual(b.scrolls.map((s) => [s.level, s.primary, s.scrolls.map((c) => [c.level, c.primary, c.records.map((r) => r.name)])]),
    [[1, 'ZZ_R_L1_A', [[2, 'ZZ_R_L2_A', ['ZZ_R_L2_A', 'DERIVED_ADDRESS']]]], [1, 'ZZ_R_L2_A', []]]);
  assert.deepEqual([b.scrolls[1].parentKeys, b.scrolls[1].rowKeys], [['ZZ_KEY0'], ['ZZ_KEY1', 'ZZ_KEY2']]);
  assert.match(b.notes[0], /^ZZ_R_L2_A is the primary record of 2 scrolls/);
  assert.equal(b.scrolls[0].scrolls[0].peopleCode.rowset, 'GetLevel0()(1).GetRowset(Scroll.ZZ_R_L1_A)(&i1).GetRowset(Scroll.ZZ_R_L2_A)');
});

test('PeopleCode paths for a scroll: the object path and the built-in scroll paths', () => {
  const a = peopleCodeAccess(['JOB', 'JOB_JR'], 'JOB_JR', 'EMPLID');
  assert.equal(a.fieldValue, 'GetLevel0()(1).GetRowset(Scroll.JOB)(&i1).GetRowset(Scroll.JOB_JR)(&i2).GetRecord(Record.JOB_JR).GetField(Field.EMPLID).Value');
  assert.deepEqual(a.builtIns.slice(0, 2), ['ActiveRowCount(Scroll.JOB, &i1, Scroll.JOB_JR)', 'FetchValue(Scroll.JOB, &i1, Scroll.JOB_JR, &i2, JOB_JR.EMPLID)']);
});

test('a child record not keyed by the level above is noted; one with no key of its own too', () => {
  const s = pageStructure('P', [
    { id: 1, typeName: 'Edit Box', fieldType: 4, occursLevel: 0, fieldUse: 0, recName: 'PARENT', fieldName: 'ID', label: '', recType: 0 },
    { id: 2, typeName: 'Scroll Area', fieldType: 27, occursLevel: 1, fieldUse: 0, recName: ' ', fieldName: ' ', label: 'Scroll Area', recType: -1 },
    { id: 3, typeName: 'Edit Box', fieldType: 4, occursLevel: 0, fieldUse: 0, recName: 'CHILD', fieldName: 'SEQ', label: '', recType: 0 }
  ], new Map([['PARENT', { type: 0, keys: ['ID'] }], ['CHILD', { type: 0, keys: ['SEQ'] }]]));
  assert.match(s.scrolls[0].notes[0], /^CHILD is not keyed by ID \(keyed above it\)/);
});

test('psft_edit_page scroll operations: Occurs Level, Set to Level, the tab order -- and the save assigns the levels (lv04, lv06, lv14)', () => {
  const r = rows('lv16-reorder-back', 'ZZ_PCODE_LAB_LV');
  const layout = buildPageLayout('ZZ_PCODE_LAB_LV', { page: { PNLTYPE: 0, VERSION: 1 }, fields: r, components: [] });
  const stored: StoredControl[] = layout.controls.map((c) => ({ pnlFldId: c.pnlFldId, fieldNum: c.num, fieldType: c.type, occursLevel: c.level, ...c.columns,
    recName: c.recName, fieldName: c.fieldName }));
  const save = (ops: Parameters<typeof applyPageOperations>[1]) => {
    const { controls, order } = applyPageOperations(layout, ops);
    return Object.fromEntries(planPageSave(stored, controls, 9, order, 'ZZ_PCODE_LAB_LV').updates.map((u) => [u.pnlFldId, u.columns]));
  };
  // The scroll bar (4) at level 1 takes ZZ_KEY2 (5) with it, up to the Set to Level rule (lv09).
  assert.deepEqual(save([{ op: 'set_occurs_level', id: 4, level: 1 }]), { 4: { OCCURSLEVEL: 1 }, 5: { OCCURSLEVEL: 1 } });
  // Clearing rule 6's Set to Level puts it and ZZ_R_L1_A.ZZ_KEY0 (7) at the running level 2 (lv11).
  assert.deepEqual(save([{ op: 'set_level', id: 6, level: null }]), { 6: { FIELDUSE: 0, SECUREINVISIBLE: 0, OCCURSLEVEL: 2 }, 7: { OCCURSLEVEL: 2 } });
  // ZZ_R_L0_B (9) moved to second: still level 0 (lv14).
  assert.deepEqual(save([{ op: 'set_order', order: [1, 9, 2, 3, 4, 5, 6, 7, 8] }])[9], { FIELDNUM: 2 });
});
