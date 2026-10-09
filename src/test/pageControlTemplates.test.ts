import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newControlFieldRefusal, newControlRows, type FieldInfo, type NewControlKind } from '../providers/pageControlTemplates.js';

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

const cases: Array<{ name: string; dir: string; id: number; kind: NewControlKind; rec: string; field: string; info?: FieldInfo }> = [
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
  { name: 'Edit Box on a number field', dir: '18-number-datetime', id: 14, kind: 'editBox', rec: 'ZZ_PCODE_LAB_T', field: 'ZZ_PCODE_LAB_N1', info: typed(2, 'ZZ_PCODE_LAB_N1', 'Number 4', 4) }
];

for (const c of cases) {
  test(`a new ${c.name} is the row App Designer inserted (${c.dir})`, () => {
    const want = captured(c.dir, 'PSPNLFIELD', c.id);
    const placed = {
      fieldLeft: Number(want.FIELDLEFT), fieldTop: Number(want.FIELDTOP), fieldRight: Number(want.FIELDRIGHT), fieldBottom: Number(want.FIELDBOTTOM),
      fieldSizeType: Number(want.FIELDSIZETYPE), lblType: Number(want.LBLTYPE), lblText: '', fieldUse: 0, secureInvisible: 0
    };
    const rows = newControlRows('ZZ_PCODE_LAB_PG', c.id, Number(want.FIELDNUM), { kind: c.kind, recName: c.rec, fieldName: c.field }, placed, c.info);
    // The label rectangle is wherever it was dragged before the save (14's was); a fresh one is all zero.
    for (const k of ['EDITLBLLEFT', 'EDITLBLTOP', 'EDITLBLRIGHT', 'EDITLBLBOTTOM']) rows.field[k] = Number(want[k]);
    assert.deepEqual(asStrings(rows.field), want);
    assert.deepEqual(asStrings(rows.ext), captured(c.dir, 'PSPNLFIELDEXT', c.id));
  });
}

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
  assert.match(newControlFieldRefusal('editBox', 'JOB', 'EFFDT', typed(4, 'EFFDT', 'Eff Date', 10))!, /is a date field; .* character, number, datetime fields/);
  assert.match(newControlFieldRefusal('dropDown', 'R', 'N1', typed(2, 'N1', 'N', 4))!, /is a number field/);
  assert.equal(newControlFieldRefusal('staticText', ' ', ' ', undefined), undefined);
  assert.match(newControlFieldRefusal('checkBox', 'PERSON', 'EMPLID', char('EMPLID', 'Empl ID', 11))!, /one-character field/);
});
