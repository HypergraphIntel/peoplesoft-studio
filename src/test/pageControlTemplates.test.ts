import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newControlFieldRefusal, newControlDataRows, newControlRows, type FieldInfo, type NewControl, type NewControlKind } from '../providers/pageControlTemplates.js';

/* Each new-control row must be exactly the row App Designer inserted in the captured save. */

type Inserted = Record<string, string | null>;
const captured = (caseDir: string, table: string, pnlFldId: number): Inserted => {
  const delta = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', caseDir, 'delta.json'), 'utf8'));
  const row = (delta.watch[table].inserted as Inserted[]).find((r) => Number(r.PNLFLDID) === pnlFldId);
  assert.ok(row, `${caseDir} inserted ${table} ${pnlFldId}`);
  return row;
};
const asStrings = (row: Record<string, number | string | null>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : String(v)]));

const char = (labelId: string, labelText: string, length = 1): FieldInfo => ({ fieldType: 0, length, labelId, labelText });
const typed = (fieldType: number, labelId: string, labelText: string, length: number): FieldInfo => ({ fieldType, length, labelId, labelText });

const long = (labelId: string, labelText: string, length: number): FieldInfo => ({ fieldType: 1, length, labelId, labelText });

const cases: Array<{ name: string; dir: string; id: number; kind: NewControlKind; rec: string; field: string; info?: FieldInfo; page?: string }> = [
  { name: 'Edit Box', dir: '02-add-edit', id: 2, kind: 'editBox', rec: 'PERSON', field: 'EMPLID', info: char('EMPLID', 'Empl ID', 11) },
  { name: 'Drop-Down List Box', dir: '06-types', id: 3, kind: 'dropDown', rec: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_C01', info: char('ZZ_PCODE_LAB_C01', 'ZZ_PCODE_LAB_C01') },
  { name: 'Check Box', dir: '06-types', id: 4, kind: 'checkBox', rec: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_C02', info: char('ZZ_PCODE_LAB_C02', 'ZZ_PCODE_LAB_C02') },
  { name: 'Push Button', dir: '06-types', id: 5, kind: 'pushButton', rec: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_KEY', info: char('ZZ_PCODE_LAB_KEY', 'Key', 10) },
  // App Designer carried the page's record onto the group box; the editor leaves it blank unless given one.
  { name: 'Group Box', dir: '07-groupbox', id: 6, kind: 'groupBox', rec: 'ZZ_PCODE_LAB_T', field: ' ' },
  { name: 'Static Text', dir: '15-static-text', id: 10, kind: 'staticText', rec: ' ', field: ' ' },
  { name: 'Frame', dir: '16-frame', id: 11, kind: 'frame', rec: ' ', field: ' ' },
  { name: 'Horizontal Rule', dir: '17-hrule', id: 12, kind: 'horizontalRule', rec: ' ', field: ' ' },
  { name: 'Edit Box on a datetime field', dir: '18-number-datetime', id: 13, kind: 'editBox', rec: 'ZZ_PCODE_LAB_T', field: 'LASTUPDDTTM', info: typed(6, 'LASTUPDDTTM', 'Last Update Date/Time', 26) },
  { name: 'Edit Box on a number field', dir: '18-number-datetime', id: 14, kind: 'editBox', rec: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_N1', info: typed(2, 'ZZ_PCODE_LAB_N1', 'Number 4', 4) },
  { name: 'Edit Box on a date field', dir: '22-date-editbox', id: 28, kind: 'editBox', rec: 'ZZ_BNV_RUNCTL', field: 'ASOFDATE', info: typed(4, 'ASOFDATE', 'As Of Date', 10) },
  // Added in 0.8.2 -- captured on ZZ_PCODE_LAB_CT (in01, rb-fresh, le-fresh).
  { name: 'Static Image', dir: 'in01-insert-static-image', id: 2, kind: 'staticImage', rec: ' ', field: ' ', page: 'ZZ_PCODE_LAB_CT' },
  { name: 'Radio Button', dir: 'rb-fresh', id: 8, kind: 'radioButton', rec: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_C01', info: char('ZZ_PCODE_LAB_C01', 'Dummy Name'), page: 'ZZ_PCODE_LAB_CT' },
  { name: 'Long Edit Box', dir: 'le-fresh', id: 9, kind: 'longEdit', rec: 'ZZ_PCODE_LAB_R6', field: 'ZZ_PCODE_LAB_L2', info: long('ZZ_PCODE_LAB_L2', 'Long 254', 254), page: 'ZZ_PCODE_LAB_CT' },
  // An HTML Area on a long-character field (ht-field) and on the record alone (ht-fresh).
  { name: 'HTML Area on a field', dir: 'ht-field', id: 16, kind: 'htmlArea', rec: 'ZZ_PCODE_LAB_R6', field: 'ZZ_PCODE_LAB_L1', info: long('ZZ_PCODE_LAB_L1', 'Long 0', 0), page: 'ZZ_PCODE_LAB_CT' },
  { name: 'HTML Area on a record alone', dir: 'ht-fresh', id: 15, kind: 'htmlArea', rec: 'ZZ_PCODE_LAB_R6', field: ' ', page: 'ZZ_PCODE_LAB_CT' },
  // Scrolls (their level, 1, is planned by the save from the tab order): drawn (sa-fresh, sb-fresh) and dropped with a click (lv02, lv03).
  { name: 'Scroll Area', dir: 'lv02-scroll-area', id: 2, kind: 'scrollArea', rec: ' ', field: ' ', page: 'ZZ_PCODE_LAB_LV' },
  { name: 'Scroll Bar', dir: 'lv03-scroll-bar', id: 4, kind: 'scrollBar', rec: ' ', field: ' ', page: 'ZZ_PCODE_LAB_LV' },
  { name: 'drawn Scroll Area', dir: 'sa-fresh', id: 2, kind: 'scrollArea', rec: ' ', field: ' ', page: 'ZZ_PCODE_LAB_SC' },
  { name: 'drawn Scroll Bar', dir: 'sb-fresh', id: 2, kind: 'scrollBar', rec: ' ', field: ' ', page: 'ZZ_PCODE_LAB_SB' }
];

for (const c of cases) {
  test(`a new ${c.name} is the row App Designer inserted (${c.dir})`, () => {
    const want = captured(c.dir, 'PSPNLFIELD', c.id);
    const placed = {
      fieldLeft: Number(want.FIELDLEFT), fieldTop: Number(want.FIELDTOP), fieldRight: Number(want.FIELDRIGHT), fieldBottom: Number(want.FIELDBOTTOM),
      fieldSizeType: Number(want.FIELDSIZETYPE), lblType: Number(want.LBLTYPE), lblText: '', fieldUse: Number(want.FIELDUSE), secureInvisible: Number(want.SECUREINVISIBLE),
      occursLevel: Number(want.OCCURSLEVEL)
    };
    const rows = newControlRows(c.page ?? 'ZZ_PCODE_LAB_PG', c.id, Number(want.FIELDNUM), { kind: c.kind, recName: c.rec, fieldName: c.field }, placed, c.info);
    // The label rectangle is wherever it was dragged before the save (14's was); a fresh one is all zero.
    for (const k of ['EDITLBLLEFT', 'EDITLBLTOP', 'EDITLBLRIGHT', 'EDITLBLBOTTOM']) rows.field[k] = Number(want[k]);
    assert.deepEqual(asStrings(rows.field), want);
    assert.deepEqual(asStrings(rows.ext), captured(c.dir, 'PSPNLFIELDEXT', c.id));
  });
}

// 0.8.3 -- the eight kinds App Designer's Insert menu still lacked, captured on ZZ_PCODE_LAB_IN. "after" rows are the control
// as App Designer saved it after its dialog bound it (an Image or Chart on a field, a Tree with levels).
const IN = 'ZZ_PCODE_LAB_IN';
const savedRow = (caseDir: string, table: string, pnlFldId: number): Inserted => {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', caseDir, 'after.json'), 'utf8')).watch[table];
  const r = (t.rows as Array<Array<string | null>>).find((x) => Number(x[(t.columns as Array<{ name: string }>).findIndex((c) => c.name === 'PNLFLDID')]) === pnlFldId)!;
  return Object.fromEntries((t.columns as Array<{ name: string }>).map((c, i) => [c.name, r[i]]));
};
const image = (labelId: string, labelText: string): FieldInfo => ({ fieldType: 8, length: 0, labelId, labelText });
const newKinds: Array<{ name: string; dir: string; id: number; add: NewControl; info?: FieldInfo; saved?: boolean }> = [
  { name: 'Image', dir: 'im-fresh', id: 2, add: { kind: 'image', recName: ' ', fieldName: ' ' } },
  { name: 'Image on an image field', dir: 'im-field', id: 2, add: { kind: 'image', recName: 'EMPL_PHOTO', fieldName: 'EMPLOYEE_PHOTO' }, info: image('EMPLOYEE_PHOTO', 'Employee Photograph'), saved: true },
  { name: 'Tree', dir: 'tr-fresh', id: 3, add: { kind: 'tree', recName: 'EMPL_PHOTO', fieldName: ' ' } },
  { name: 'Tree with a root and a level', dir: 'tr-nodes', id: 3, saved: true, info: char('ZZ_PCODE_LAB_VAL', 'Value', 30),
    add: { kind: 'tree', recName: 'ZZ_PCODE_LAB_T', fieldName: 'ZZ_PCODE_LAB_VAL', treeLevels: [{ recName: 'ZZ_PCODE_LAB_R6', fieldName: 'ZZ_PCODE_LAB_C08' }] } },
  { name: 'Chart', dir: 'ch-fresh', id: 4, add: { kind: 'chart', recName: 'EMPL_PHOTO', fieldName: ' ' } },
  { name: 'Chart on a field', dir: 'ch-field', id: 4, add: { kind: 'chart', recName: 'ZZ_PCODE_LAB_R6', fieldName: 'ZZ_PCODE_LAB_C08' }, info: char('ZZ_PCODE_LAB_C08', 'ZZ Lab C08', 8), saved: true },
  { name: 'Secondary Page', dir: 'sp-fresh', id: 5, add: { kind: 'secondaryPage', recName: ' ', fieldName: ' ', subPage: 'ZZ_PCODE_LAB_SEC' } },
  { name: 'Subpage', dir: 'sbp-fresh', id: 6, add: { kind: 'subpage', recName: ' ', fieldName: ' ', subPage: 'ZZ_PCODE_LAB_SUB' } },
  { name: 'Subpage with a record substitution', dir: 'sb-subst', id: 7, add: { kind: 'subpage', recName: 'ZZ_PCODE_LAB_T', fieldName: ' ', subPage: 'PHONE_SBP' } },
  { name: 'Grid', dir: 'gd-fresh', id: 8, add: { kind: 'grid', recName: 'ZZ_PCODE_LAB_R6', fieldName: ' ' } },
  { name: 'Tab Separator', dir: 'ts-fresh', id: 10, add: { kind: 'tabSeparator', recName: ' ', fieldName: ' ', intoGrid: 8 } },
  { name: 'Analytic Grid', dir: 'ag-fresh', id: 11, add: { kind: 'analyticGrid', recName: 'PTACEVWRGRDREC', fieldName: ' ', analytic: { model: 'PTACEDUMMODEL', collection: 'DUMMYCC1', axes: [{ fieldName: 'PTACEGRIDFLD01', axis: 2 }] } } },
  { name: 'Edit Box column of an Analytic Grid', dir: 'ag-fresh', id: 12, add: { kind: 'editBox', recName: 'PTACEVWRGRDREC', fieldName: 'PTACEGRIDFLD01', intoGrid: 11 }, info: char('PTACEGRIDFLD01', 'ACE Grid Field 02', 30) }
];

for (const c of newKinds) {
  test(`a new ${c.name} is the row App Designer wrote (${c.dir})`, () => {
    const want = c.saved ? savedRow(c.dir, 'PSPNLFIELD', c.id) : captured(c.dir, 'PSPNLFIELD', c.id);
    const placed = {
      fieldLeft: Number(want.FIELDLEFT), fieldTop: Number(want.FIELDTOP), fieldRight: Number(want.FIELDRIGHT), fieldBottom: Number(want.FIELDBOTTOM),
      fieldSizeType: Number(want.FIELDSIZETYPE), lblType: Number(want.LBLTYPE), lblText: '', fieldUse: Number(want.FIELDUSE), secureInvisible: Number(want.SECUREINVISIBLE),
      occursLevel: Number(want.OCCURSLEVEL)
    };
    const rows = newControlRows(IN, c.id, Number(want.FIELDNUM), c.add, placed, c.info);
    // A grid's column count is the save's (its columns follow it); a new one has none of its own yet.
    if (Number(want.GRDCOLUMNCOUNT)) rows.field.GRDCOLUMNCOUNT = Number(want.GRDCOLUMNCOUNT);
    assert.deepEqual(asStrings(rows.field), want);
    assert.deepEqual(asStrings(rows.ext), c.saved ? savedRow(c.dir, 'PSPNLFIELDEXT', c.id) : captured(c.dir, 'PSPNLFIELDEXT', c.id));
  });
}

test('a new Grid\'s, Analytic Grid\'s and Tree\'s own rows are App Designer\'s (gd-fresh, ag-fresh, tr-nodes)', () => {
  const g = newControlDataRows(IN, 8, 'grid', newKinds[9].add);
  assert.deepEqual(asStrings(g.controlData!), captured('gd-fresh', 'PSPNLCNTRLDATA', 8));
  assert.deepEqual(g.buttons, []);
  const a = newControlDataRows(IN, 11, 'analyticGrid', newKinds[11].add);
  assert.deepEqual(asStrings(a.controlData!), captured('ag-fresh', 'PSPNLCNTRLDATA', 11));
  assert.deepEqual(asStrings(a.aceData!), captured('ag-fresh', 'PSPNLACEGRDDATA', 11));
  assert.deepEqual(a.aceAxes!.map(asStrings), [captured('ag-fresh', 'PSPNLACEGRDAXIS', 11)]);
  const t = newControlDataRows(IN, 3, 'tree', newKinds[3].add, 2);
  const nodes = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results/tr-nodes/delta.json'), 'utf8')).watch.PSPNLTREECTRL.inserted;
  assert.deepEqual(t.treeNodes!.map(asStrings), nodes);
});

test('an edited label replaces the default label text but keeps the label id', () => {
  const rows = newControlRows('P', 9, 1, { kind: 'editBox', recName: 'PERSON', fieldName: 'EMPLID' },
    { fieldLeft: 1, fieldTop: 2, fieldRight: 0, fieldBottom: 0, fieldSizeType: 0, lblType: 1, lblText: 'Person', fieldUse: 0, secureInvisible: 0 },
    char('EMPLID', 'Empl ID', 11));
  assert.equal(rows.field.LBLTEXT, 'Person');
  assert.equal(rows.field.LABEL_ID, 'EMPLID');
  assert.equal(rows.field.LBLTYPE, 1);
});

test('new controls are refused on fields the captures do not cover', () => {
  assert.equal(newControlFieldRefusal('groupBox', '', '', undefined), undefined);
  assert.equal(newControlFieldRefusal('editBox', 'PERSON', 'EMPLID', char('EMPLID', 'Empl ID', 11)), undefined);
  assert.match(newControlFieldRefusal('editBox', 'PERSON', '', undefined)!, /needs a record field/);
  assert.match(newControlFieldRefusal('editBox', 'PERSON', 'NOPE', undefined)!, /not a field of record PERSON/);
  assert.equal(newControlFieldRefusal('editBox', 'R', 'N1', typed(2, 'N1', 'N', 4)), undefined); // number: 18
  assert.equal(newControlFieldRefusal('editBox', 'R', 'DT', typed(6, 'DT', 'D', 26)), undefined); // datetime: 18
  assert.equal(newControlFieldRefusal('editBox', 'JOB', 'EFFDT', typed(4, 'EFFDT', 'Eff Date', 10)), undefined); // date: 22-date-editbox
  assert.match(newControlFieldRefusal('editBox', 'R', 'TM', typed(5, 'TM', 'Time', 15))!, /is a time field; .* character, number, date, datetime fields/);
  assert.match(newControlFieldRefusal('dropDown', 'R', 'N1', typed(2, 'N1', 'N', 4))!, /is a number field/);
  assert.equal(newControlFieldRefusal('staticText', ' ', ' ', undefined), undefined);
  assert.match(newControlFieldRefusal('checkBox', 'PERSON', 'EMPLID', char('EMPLID', 'Empl ID', 11))!, /one-character field/);
  // An HTML Area needs a record; its field is optional, and only a long-character one so far (ht-field).
  assert.match(newControlFieldRefusal('htmlArea', ' ', ' ', undefined)!, /needs a record\./);
  assert.equal(newControlFieldRefusal('htmlArea', 'R', ' ', undefined), undefined);
  assert.equal(newControlFieldRefusal('htmlArea', 'R', 'L1', long('L1', 'Long', 0)), undefined);
  assert.match(newControlFieldRefusal('htmlArea', 'R', 'C1', char('C1', 'C'))!, /is a character field; .* long character fields/);
  assert.match(newControlFieldRefusal('htmlArea', 'R', 'NOPE', undefined)!, /not a field of record R/);
});

test('a control added inside a scroll takes its OCCURSLEVEL (default 0 outside)', () => {
  const placed = (occursLevel?: number) => ({ fieldLeft: 10, fieldTop: 10, fieldRight: 0, fieldBottom: 0, fieldSizeType: 0, lblType: 1, lblText: 'X', fieldUse: 0, secureInvisible: 0, ...(occursLevel !== undefined ? { occursLevel } : {}) });
  assert.equal(newControlRows('P', 9, 1, { kind: 'editBox', recName: 'PERSON', fieldName: 'EMPLID' }, placed(), char('EMPLID', 'Empl ID', 11)).field.OCCURSLEVEL, 0);
  assert.equal(newControlRows('P', 9, 1, { kind: 'editBox', recName: 'PERSON', fieldName: 'EMPLID' }, placed(2), char('EMPLID', 'Empl ID', 11)).field.OCCURSLEVEL, 2);
});

test('a new Scroll Area\'s PSPNLCNTRLDATA and PSPNLBTNDATA rows are App Designer\'s (lv19: ZZ_PCODE_LAB_LV\'s scroll area as App Designer wrote it)', () => {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results/lv19-ad-scroll-data/before.json'), 'utf8')).watch;
  const read = (table: string) => (t[table].rows as Array<Array<string | null>>).map((r) => Object.fromEntries((t[table].columns as Array<{ name: string }>).map((c, i) => [c.name, r[i]])));
  const rows = newControlDataRows('ZZ_PCODE_LAB_LV', 2, 'scrollArea');
  assert.deepEqual([asStrings(rows.controlData!)], read('PSPNLCNTRLDATA'));
  assert.deepEqual(rows.buttons.map(asStrings), read('PSPNLBTNDATA'));
  assert.deepEqual(newControlDataRows('P', 4, 'scrollBar'), { buttons: [] });
});
