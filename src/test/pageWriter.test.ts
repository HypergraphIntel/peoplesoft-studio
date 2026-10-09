import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPageSave, PageSaveRefusedError, type EditedControl, type StoredControl } from '../providers/pageWriter.js';

const control = (over: Partial<StoredControl> & { pnlFldId: number }): StoredControl => ({
  fieldNum: over.pnlFldId, fieldLeft: 0, fieldTop: 0, fieldRight: 0, fieldBottom: 0,
  editLblLeft: 0, editLblTop: 0, editLblRight: 0, editLblBottom: 0, fieldSizeType: 0,
  lblType: 3, lblText: '', fieldUse: 0, secureInvisible: 0, ...over
});
const edit = (c: StoredControl): EditedControl => { const { fieldNum: _fieldNum, ...rest } = c; return rest; };

test('a move writes only the moved control\'s position columns (03-move shape)', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1, fieldLeft: 72, fieldTop: 68 }),
    control({ pnlFldId: 2, fieldNum: 2, fieldLeft: 64, fieldTop: 120 })];
  const controls = [edit(stored[0]), { ...edit(stored[1]), fieldLeft: 448, fieldTop: 20, editLblLeft: 384, editLblTop: -100, editLblRight: 384, editLblBottom: -100 }];
  const plan = planPageSave(stored, controls);
  assert.deepEqual(plan.deletes, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].pnlFldId, 2);
  assert.deepEqual(plan.updates[0].columns,
    { FIELDLEFT: 448, FIELDTOP: 20, EDITLBLLEFT: 384, EDITLBLTOP: -100, EDITLBLRIGHT: 384, EDITLBLBOTTOM: -100 });
  assert.equal(plan.fieldCount, 2);
});

test('a resize writes RIGHT/BOTTOM and FIELDSIZETYPE (04-resize shape)', () => {
  const stored = [control({ pnlFldId: 2, fieldNum: 1, fieldLeft: 448, fieldTop: 20, fieldRight: 0, fieldBottom: 0, fieldSizeType: 0 })];
  const controls = [{ ...edit(stored[0]), fieldLeft: 360, fieldRight: 536, fieldBottom: 38, fieldSizeType: 2 }];
  const plan = planPageSave(stored, controls);
  assert.deepEqual(plan.updates[0].columns, { FIELDLEFT: 360, FIELDRIGHT: 536, FIELDBOTTOM: 38, FIELDSIZETYPE: 2 });
});

test('a label change writes LBLTYPE and LBLTEXT (05-label shape)', () => {
  const stored = [control({ pnlFldId: 2, fieldNum: 1, lblType: 3, lblText: 'Empl ID' })];
  const controls = [{ ...edit(stored[0]), lblType: 1, lblText: 'My Label' }];
  assert.deepEqual(planPageSave(stored, controls).updates[0].columns, { LBLTYPE: 1, LBLTEXT: 'My Label' });
});

test('use changes write FIELDUSE and SECUREINVISIBLE (09-property shape)', () => {
  const stored = [control({ pnlFldId: 1, fieldUse: 0 }), control({ pnlFldId: 3, fieldNum: 2, fieldUse: 0, secureInvisible: 0 })];
  const controls = [{ ...edit(stored[0]), fieldUse: 1 }, { ...edit(stored[1]), fieldUse: 2, secureInvisible: 1 }];
  const plan = planPageSave(stored, controls);
  assert.deepEqual(plan.updates.find((u) => u.pnlFldId === 1)!.columns, { FIELDUSE: 1 });
  assert.deepEqual(plan.updates.find((u) => u.pnlFldId === 3)!.columns, { FIELDUSE: 2, SECUREINVISIBLE: 1 });
});

test('a delete removes the row and renumbers the survivors (08-delete shape)', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 }), control({ pnlFldId: 4, fieldNum: 2 }),
    control({ pnlFldId: 5, fieldNum: 3 }), control({ pnlFldId: 2, fieldNum: 4 })];
  const plan = planPageSave(stored, [edit(stored[0]), edit(stored[2]), edit(stored[3])]); // drop PNLFLDID 4
  assert.deepEqual(plan.deletes, [4]);
  assert.equal(plan.fieldCount, 3);
  // Survivors 1,5,2 renumber to 1,2,3 -- ids 5 and 2 move up.
  assert.deepEqual(plan.updates.find((u) => u.pnlFldId === 5)!.columns, { FIELDNUM: 2 });
  assert.deepEqual(plan.updates.find((u) => u.pnlFldId === 2)!.columns, { FIELDNUM: 3 });
  assert.equal(plan.updates.find((u) => u.pnlFldId === 1), undefined); // already FIELDNUM 1
});

test('no change yields no updates', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 })];
  assert.deepEqual(planPageSave(stored, [edit(stored[0])]), { deletes: [], updates: [], fieldCount: 1 });
});

test('a control not on the stored page is refused (add is not supported here yet)', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 })];
  assert.throws(() => planPageSave(stored, [edit(stored[0]), edit(control({ pnlFldId: 99 }))]), PageSaveRefusedError);
});
