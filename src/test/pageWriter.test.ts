import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPageProperties, planPageSave, PageSaveRefusedError, type EditedControl, type StoredControl } from '../providers/pageWriter.js';

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
  assert.deepEqual(planPageSave(stored, [edit(stored[0])]), { deletes: [], updates: [], inserts: [], fieldCount: 1, maxPnlFldId: 1 });
});

test('an existing control not on the stored page is refused (an added one carries `add`)', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 })];
  assert.throws(() => planPageSave(stored, [edit(stored[0]), edit(control({ pnlFldId: 99 }))]), PageSaveRefusedError);
});

test('an added control takes MAXPNLFLDID + 1 and is numbered after the survivors (02-add-edit shape)', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 })];
  const added = { ...edit(control({ pnlFldId: -1, fieldLeft: 64, fieldTop: 120 })), add: { kind: 'editBox' as const, recName: 'PERSON', fieldName: 'EMPLID' } };
  const plan = planPageSave(stored, [edit(stored[0]), added], 1);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].pnlFldId, 2);
  assert.equal(plan.inserts[0].fieldNum, 2);
  assert.equal(plan.fieldCount, 2);
  assert.equal(plan.maxPnlFldId, 2);
});

test('deleted ids are never reused: adds start above the high-water mark', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 }), control({ pnlFldId: 5, fieldNum: 2 })];
  const add = (k: 'groupBox' | 'pushButton') => ({ ...edit(control({ pnlFldId: -1 })), add: { kind: k, recName: '', fieldName: '' } });
  // Control 5 deleted; MAXPNLFLDID is 6 from an earlier delete.
  const plan = planPageSave(stored, [edit(stored[0]), add('groupBox'), add('pushButton')], 6);
  assert.deepEqual(plan.deletes, [5]);
  assert.deepEqual(plan.inserts.map((i) => [i.pnlFldId, i.fieldNum]), [[7, 2], [8, 3]]);
  assert.equal(plan.maxPnlFldId, 8);
  assert.equal(plan.fieldCount, 3);
});

test('a blank label sent as \'\' is the stored \' \', not a change (and is written as \' \')', () => {
  const stored = [control({ pnlFldId: 5, fieldNum: 1, lblType: 1, lblText: ' ' }), control({ pnlFldId: 6, fieldNum: 2, lblText: 'X' })];
  const plan = planPageSave(stored, [{ ...edit(stored[0]), lblText: '' }, { ...edit(stored[1]), lblText: '' }]);
  assert.deepEqual(plan.updates, [{ pnlFldId: 6, columns: { LBLTEXT: ' ' } }]);
});

test('page properties write only what changed, as App Designer stores it (19-props-descr shape)', () => {
  const stored = { DESCR: ' ', DESCRLONG: null };
  assert.deepEqual(planPageProperties(stored, undefined), {});
  assert.deepEqual(planPageProperties(stored, { description: '', comments: '' }), {});
  assert.deepEqual(planPageProperties(stored, { description: 'Lab Custom Page', comments: 'Comment Here' }),
    { DESCR: 'Lab Custom Page', DESCRLONG: 'Comment Here' });
  // Clearing: DESCR is NOT NULL (' '), DESCRLONG goes back to NULL.
  assert.deepEqual(planPageProperties({ DESCR: 'Lab Custom Page', DESCRLONG: 'Comment Here' }, { description: '', comments: ' ' }),
    { DESCR: ' ', DESCRLONG: null });
  assert.deepEqual(planPageProperties({ DESCR: 'Lab Custom Page', DESCRLONG: 'Comment Here' }, { description: 'Lab Custom Page', comments: 'Comment Here' }), {});
});

test('a new page size writes PANELRIGHT/BOTTOM and makes the Page Size choice Custom (14-props-use shape)', () => {
  const props = { description: 'D', comments: '' };
  const stored = { DESCR: 'D', DESCRLONG: null, PANELRIGHT: 570, PANELBOTTOM: 330, PNLUSE: 32 };
  // App Designer: Custom + dragged edge took PNLUSE 32 -> 11, 570x330 -> 959x988.
  assert.deepEqual(planPageProperties(stored, { ...props, sizeWidth: 959, sizeHeight: 988 }), { PANELRIGHT: 959, PANELBOTTOM: 988, PNLUSE: 11 });
  // The low byte is the size choice; the other bits are kept.
  assert.deepEqual(planPageProperties({ ...stored, PNLUSE: 16643 }, { ...props, sizeWidth: 800, sizeHeight: 600 }), { PANELRIGHT: 800, PANELBOTTOM: 600, PNLUSE: 16651 });
  // Already Custom: only the size.
  assert.deepEqual(planPageProperties({ ...stored, PNLUSE: 267 }, { ...props, sizeWidth: 900, sizeHeight: 330 }), { PANELRIGHT: 900, PANELBOTTOM: 330 });
  // Unchanged or not sent: nothing.
  assert.deepEqual(planPageProperties(stored, { ...props, sizeWidth: 570, sizeHeight: 330 }), {});
  assert.deepEqual(planPageProperties(stored, props), {});
  assert.throws(() => planPageProperties(stored, { ...props, sizeWidth: 0, sizeHeight: 10 }), PageSaveRefusedError);
});
