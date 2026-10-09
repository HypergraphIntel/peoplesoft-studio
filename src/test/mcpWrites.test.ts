import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageLayout } from '../model/pageLayout.js';
import { applyPageOperations, PageOperationError, pageLayoutForAgent } from '../model/pageOperations.js';
import { applyRecordOperations } from '../model/recordOperations.js';
import { RecordSaveRefusedError, type RecordEditState } from '../model/recordEdit.js';
import { RecordType, UseEdit } from '../model/record.js';
import type { PageView, Row } from '../model/uiDefinitions.js';
import { describeOperation, textChangeSummary } from '../mcp/writeSummary.js';

/* The MCP's write tools (mcp/writeTools.ts) turn an agent's operations into the editors' own saves. */

const field = (over: Partial<Record<string, unknown>>): Row => ({
  FIELDNUM: 1, OCCURSLEVEL: 0, FIELDTYPE: 4, FIELDUSE: 0, LBLTYPE: 3, LBLTEXT: '', RECNAME: ' ', FIELDNAME: ' ',
  FIELDLEFT: 0, FIELDTOP: 0, FIELDRIGHT: 0, FIELDBOTTOM: 0, EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0,
  FIELDSIZETYPE: 0, SECUREINVISIBLE: 0, PNLFLDID: Number(over.FIELDNUM ?? 1), PNLFIELDNAME: '', ...over
});
const page = (fields: Row[]) => buildPageLayout('ZZ_PG', {
  page: { PNLTYPE: 0, VERSION: 9, DESCR: 'Lab', DESCRLONG: '', PANELRIGHT: 600, PANELBOTTOM: 400, PNLUSE: 11 }, fields, components: []
} as PageView);

test('page operations: a move shifts a sized control and its stored label, as the editor does', () => {
  const layout = page([
    field({ FIELDNUM: 1, PNLFLDID: 4, FIELDTYPE: 2, FIELDLEFT: 100, FIELDTOP: 112, FIELDRIGHT: 400, FIELDBOTTOM: 268 }), // relative label
    field({ FIELDNUM: 2, PNLFLDID: 7, FIELDLEFT: 64, FIELDTOP: 120, EDITLBLLEFT: 10, EDITLBLTOP: 120, EDITLBLRIGHT: 60, EDITLBLBOTTOM: 136 })
  ]);
  const { controls } = applyPageOperations(layout, [{ op: 'move', id: 4, left: 110, top: 117 }, { op: 'move', id: 7, left: 74, top: 130 }]);
  const gb = controls.find((c) => c.pnlFldId === 4)!, eb = controls.find((c) => c.pnlFldId === 7)!;
  assert.deepEqual([gb.fieldLeft, gb.fieldTop, gb.fieldRight, gb.fieldBottom], [110, 117, 410, 273]);
  assert.deepEqual([gb.editLblLeft, gb.editLblTop, gb.editLblRight, gb.editLblBottom], [0, 0, 0, 0]);
  assert.deepEqual([eb.fieldRight, eb.fieldBottom], [0, 0]); // auto-sized stays auto-sized
  assert.deepEqual([eb.editLblLeft, eb.editLblTop, eb.editLblRight, eb.editLblBottom], [20, 130, 70, 146]);
});

test('page operations: add, resize, label, use, delete and properties make the editor\'s save', () => {
  const layout = page([field({ FIELDNUM: 1, PNLFLDID: 3 }), field({ FIELDNUM: 2, PNLFLDID: 5, LBLTEXT: 'X' })]);
  const { controls, properties } = applyPageOperations(layout, [
    { op: 'add', kind: 'editBox', left: 20, top: 40, record: 'person', field: 'emplid' },
    { op: 'add', kind: 'groupBox', left: 10, top: 10 },
    { op: 'resize', id: 3, width: 120, height: 20 },
    { op: 'set_label', id: 5, text: 'Name', labelType: 1 },
    { op: 'set_use', id: 5, displayOnly: true, invisible: true },
    { op: 'delete', id: 3 },
    { op: 'set_properties', description: 'Edited', width: 800 }
  ]);
  assert.deepEqual(controls.map((c) => c.pnlFldId), [5, -1, -2]);
  const added = controls[1];
  assert.deepEqual(added.add, { kind: 'editBox', recName: 'PERSON', fieldName: 'EMPLID' });
  assert.deepEqual([added.fieldLeft, added.fieldTop, added.fieldRight, added.fieldBottom, added.fieldSizeType], [20, 40, 0, 0, 0]);
  assert.deepEqual([controls[2].fieldRight, controls[2].fieldBottom], [310, 166]); // group box: App Designer's 300 x 156
  assert.equal(controls[0].lblText, 'Name');
  assert.equal(controls[0].lblType, 1);
  assert.equal(controls[0].fieldUse, 3);
  assert.equal(controls[0].secureInvisible, 1);
  assert.deepEqual(properties, { description: 'Edited', comments: '', sizeWidth: 800, sizeHeight: 400 });
  assert.throws(() => applyPageOperations(layout, [{ op: 'move', id: 99, left: 0, top: 0 }]), PageOperationError);
});

test('page operations: the agent\'s view of a layout carries the ids it edits by', () => {
  const v = pageLayoutForAgent(page([field({ FIELDNUM: 1, PNLFLDID: 7, RECNAME: 'JOB', FIELDNAME: 'EMPLID', LBLTEXT: 'ID' })]));
  assert.equal(v.version, 9);
  assert.deepEqual((v.controls as Array<Record<string, unknown>>)[0],
    { id: 7, order: 1, level: 0, type: 'Edit Box', fieldType: 4, left: 0, top: 0, right: 0, bottom: 0, autoSized: true,
      labelType: 3, label: 'ID', record: 'JOB', field: 'EMPLID', displayOnly: false, invisible: false });
});

const record = (): RecordEditState => ({
  recname: 'ZZ_REC', recordType: RecordType.Table, openedVersion: 4,
  fields: [{ name: 'A', useEdit: UseEdit.Key, isNew: false }, { name: 'B', useEdit: 0, isNew: false }, { name: 'C', useEdit: 0, isNew: false }]
});

test('record operations: fields by name, through the record editor\'s rules', () => {
  const s = applyRecordOperations(record(), RecordType.Table, [
    { op: 'insert_field', field: 'd', after: 'A' },
    { op: 'move_field', field: 'C' },
    { op: 'remove_field', field: 'B' },
    { op: 'set_use', field: 'A', searchKey: true }
  ]);
  assert.deepEqual(s.fields.map((f) => f.name), ['C', 'A', 'D']);
  assert.ok((s.fields[1].useEdit & UseEdit.SearchKey) !== 0);
  // A move after a later field lands after it.
  assert.deepEqual(applyRecordOperations(record(), RecordType.Table, [{ op: 'move_field', field: 'A', after: 'C' }]).fields.map((f) => f.name), ['B', 'C', 'A']);
  assert.throws(() => applyRecordOperations(record(), RecordType.Table, [{ op: 'remove_field', field: 'NOPE' }]), RecordSaveRefusedError);
  // Search Key needs Key, as App Designer keeps it.
  assert.throws(() => applyRecordOperations(record(), RecordType.Table, [{ op: 'set_use', field: 'B', searchKey: true }]));
});

test('the approval dialog shows where a text changes', () => {
  assert.equal(textChangeSummary('', 'a\nb'), 'New: 2 lines.');
  assert.equal(textChangeSummary('a\nb', 'a\nb'), 'No change to the text.');
  assert.equal(textChangeSummary('a\nb\nc', 'a\nX\nc'), '3 -> 3 lines; lines 2-2 now read:\n  X');
  assert.equal(textChangeSummary('a\nb\nc', 'a\nc'), '3 -> 2 lines; lines 2-2 removed.');
  assert.equal(describeOperation({ op: 'move', id: 7, left: 1, top: 2 }), '  move id=7 left=1 top=2');
});
