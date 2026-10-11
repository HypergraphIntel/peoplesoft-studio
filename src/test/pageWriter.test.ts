import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyControlRows, FLUID_USETEMP2, FLUID_USETMP, fluidClassSlots, NEW_PAGE_LICENSE_CODE, planNewPage, planPageProperties, planPageSave, PageSaveRefusedError, type EditedControl, type StoredControl } from '../providers/pageWriter.js';

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

test('rebinding a control writes RECNAME / FIELDNAME, and only what changed (Record tab)', () => {
  const stored = [control({ pnlFldId: 2, fieldNum: 1, recName: 'JOB', fieldName: 'EMPLID', deferProc: true })];
  // Only the field changed: RECNAME stays, FIELDNAME is written.
  assert.deepEqual(planPageSave(stored, [{ ...edit(stored[0]), fieldName: 'DEPTID' }]).updates[0].columns, { FIELDNAME: 'DEPTID' });
  // Both change.
  assert.deepEqual(planPageSave(stored, [{ ...edit(stored[0]), recName: 'PERSONAL_DATA', fieldName: 'BIRTHDATE' }]).updates[0].columns,
    { RECNAME: 'PERSONAL_DATA', FIELDNAME: 'BIRTHDATE' });
  // Unchanged binding plans nothing.
  assert.deepEqual(planPageSave(stored, [edit(stored[0])]).updates, []);
});

test('toggling Allow Deferred Processing writes DEFERPROC (default 1)', () => {
  const stored = [control({ pnlFldId: 1, deferProc: true })];
  assert.deepEqual(planPageSave(stored, [{ ...edit(stored[0]), deferProc: false }]).updates[0].columns, { DEFERPROC: 0 });
  assert.deepEqual(planPageSave(stored, [edit(stored[0])]).updates, []);
});

test('a Grid / Scroll Area Options tab writes OCCURSCOUNT1 and the grid display flags', () => {
  const stored = [control({ pnlFldId: 1, occursCount1: 5, gridShowColHdg: 1, gridShowRowHdg: 0, gridAllowColSort: 1 })];
  assert.deepEqual(planPageSave(stored, [{ ...edit(stored[0]), occursCount1: 10, gridAllowColSort: 0 }]).updates[0].columns,
    { OCCURSCOUNT1: 10, GRDALLOWCOLSORT: 0 });
  assert.deepEqual(planPageSave(stored, [edit(stored[0])]).updates, []);
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
  assert.deepEqual(planPageSave(stored, [edit(stored[0])]), { deletes: [], updates: [], extUpdates: [], inserts: [], fieldCount: 1, maxPnlFldId: 1 });
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
  // Already Custom: only the size column that changed.
  assert.deepEqual(planPageProperties({ ...stored, PNLUSE: 267 }, { ...props, sizeWidth: 900, sizeHeight: 330 }), { PANELRIGHT: 900 });
  // Unchanged or not sent: nothing.
  assert.deepEqual(planPageProperties(stored, { ...props, sizeWidth: 570, sizeHeight: 330 }), {});
  assert.deepEqual(planPageProperties(stored, props), {});
  assert.throws(() => planPageProperties(stored, { ...props, sizeWidth: 0, sizeHeight: 10 }), PageSaveRefusedError);
});

test('the Order tab\'s order renumbers FIELDNUM; an order that is not the page\'s is refused', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1 }), control({ pnlFldId: 2, fieldNum: 2 }), control({ pnlFldId: 3, fieldNum: 3 })];
  const plan = planPageSave(stored, stored.map(edit), 3, [3, 1, 2]);
  assert.deepEqual(plan.updates, [{ pnlFldId: 3, columns: { FIELDNUM: 1 } }, { pnlFldId: 1, columns: { FIELDNUM: 2 } }, { pnlFldId: 2, columns: { FIELDNUM: 3 } }]);
  assert.throws(() => planPageSave(stored, stored.map(edit), 3, [3, 1]), PageSaveRefusedError);
  assert.throws(() => planPageSave(stored, stored.map(edit), 3, [3, 1, 1]), PageSaveRefusedError);
});

test('a reorder across a grid or scroll (a level change) is refused; within one it is not', () => {
  const stored = [control({ pnlFldId: 1, fieldNum: 1, fieldType: 4 }), control({ pnlFldId: 2, fieldNum: 2, fieldType: 19 }),
    control({ pnlFldId: 3, fieldNum: 3, fieldType: 4 }), control({ pnlFldId: 4, fieldNum: 4, fieldType: 4 })];
  assert.throws(() => planPageSave(stored, stored.map(edit), 4, [3, 1, 2, 4]), /grid or scroll/);
  assert.deepEqual(planPageSave(stored, stored.map(edit), 4, [1, 2, 4, 3]).updates.map((u) => u.pnlFldId), [4, 3]);
});

/** A capture's PSPNLDEFN row for ZZ_PCODE_LAB_PG, before or after the save, by column name. */
function pageRow(capture: string, phase: 'before' | 'after'): Record<string, string> {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, `${phase}.json`), 'utf8')).watch.PSPNLDEFN;
  const row = t.rows.find((r: string[]) => r[0] === 'ZZ_PCODE_LAB_PG');
  return Object.fromEntries(t.columns.map((c: { name: string }, i: number) => [c.name, row[i]]));
}

test('the captured General / Use settings plan exactly App Designer\'s columns (g01, u01-u05)', () => {
  const cases: Array<[string, (a: Record<string, string>) => Partial<Parameters<typeof planPageProperties>[1] & object>]> = [
    ['g01-page-owner', (a) => ({ ownerId: a.OBJECTOWNERID })],
    ['u01-page-stylesheet', (a) => ({ styleSheet: a.STYLESHEETNAME })],
    ['u02-page-background', (a) => ({ background: a.PNLSTYLE })],
    ['u03-page-deferred-off', (a) => ({ deferProc: a.DEFERPROC === '1' })],
    ['u04-page-adjust-layout', (a) => ({ adjustLayout: (Number(a.PNLUSE) & 0x100) !== 0 })],
    ['u05-page-popup', (a) => ({ popupMenu: a.POPUPMENU })]
  ];
  for (const [capture, edit] of cases) {
    const before = pageRow(capture, 'before'), after = pageRow(capture, 'after');
    const planned = planPageProperties(before, { description: before.DESCR, comments: before.DESCRLONG ?? '', ...edit(after) });
    // App Designer's changes, the stamp (VERSION, LASTUPDDTTM) aside.
    const changed = Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k] && !['VERSION', 'LASTUPDDTTM'].includes(k))
      .map((k) => [k, /^(DEFERPROC|PNLUSE)$/.test(k) ? Number(after[k]) : after[k]]));
    assert.deepEqual(planned, changed, capture);
  }
});

test('blank names are stored as \' \'; unchanged settings plan nothing', () => {
  const stored = { DESCR: 'D', DESCRLONG: null, OBJECTOWNERID: 'HCR', STYLESHEETNAME: ' ', PNLSTYLE: ' ', DEFERPROC: 1, POPUPMENU: 'X', PNLUSE: 267 };
  assert.deepEqual(planPageProperties(stored, { description: 'D', comments: '', ownerId: 'hcr', styleSheet: '', deferProc: true, adjustLayout: true }), {});
  assert.deepEqual(planPageProperties(stored, { description: 'D', comments: '', ownerId: '', popupMenu: '', adjustLayout: false }),
    { OBJECTOWNERID: ' ', POPUPMENU: ' ', PNLUSE: 11 });
  // Adjust Layout and a new size together: both bits land in the one PNLUSE.
  assert.deepEqual(planPageProperties({ ...stored, PNLUSE: 32, PANELRIGHT: 570, PANELBOTTOM: 330 }, { description: 'D', comments: '', adjustLayout: true, sizeWidth: 600, sizeHeight: 400 }),
    { PNLUSE: 0x100 | 11, PANELRIGHT: 600, PANELBOTTOM: 400 });
});

/** The topmost control's top in a capture's PSPNLFIELD rows (before the save). */
function minTop(capture: string): number {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'before.json'), 'utf8')).watch.PSPNLFIELD;
  const pn = t.columns.findIndex((c: { name: string }) => c.name === 'PNLNAME'), top = t.columns.findIndex((c: { name: string }) => c.name === 'FIELDTOP');
  return Math.min(...t.rows.filter((r: string[]) => r[pn] === 'ZZ_PCODE_LAB_PG').map((r: string[]) => Number(r[top])));
}

test('page type and a secondary page\'s options plan exactly App Designer\'s columns (u08-u12)', () => {
  const cases: Array<[string, (a: Record<string, string>) => Record<string, unknown>]> = [
    ['u08-page-type-secondary', () => ({ pageType: 2 })],
    ['u09-page-okcancel-off', () => ({ okCancel: false })],
    ['u10-page-closebox-off', () => ({ closeBox: false })],
    ['u11-page-modal-on', () => ({ disableModal: true })],
    ['u12-page-type-standard', () => ({ pageType: 0 })]
  ];
  for (const [capture, edit] of cases) {
    const before = pageRow(capture, 'before'), after = pageRow(capture, 'after');
    const planned = planPageProperties(before, { description: before.DESCR, comments: before.DESCRLONG ?? '', ...edit(after) }, { minTop: minTop(capture) });
    const changed = Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k] && !['VERSION', 'LASTUPDDTTM'].includes(k))
      .map((k) => [k, Number(after[k])]));
    assert.deepEqual(planned, changed, capture);
  }
  // Other page-type changes are refused; the buttons are a secondary page's only.
  assert.throws(() => planPageProperties({ PNLTYPE: 0, PNLUSE: 11 }, { description: 'D', comments: '', pageType: 12 }), PageSaveRefusedError);
  assert.deepEqual(planPageProperties({ DESCR: 'D', PNLTYPE: 0, PNLUSE: 11 }, { description: 'D', comments: '', okCancel: true, closeBox: true, disableModal: true }), {});
});

test('a secondary page sized Custom keeps its button bits (0x08 with 0x01 / 0x02 as they were)', () => {
  assert.deepEqual(planPageProperties({ DESCR: 'D', PNLTYPE: 2, PNLUSE: 0x2011, PANELRIGHT: 848, PANELBOTTOM: 778 }, { description: 'D', comments: '', sizeWidth: 400, sizeHeight: 300 }),
    { PANELRIGHT: 400, PANELBOTTOM: 300, PNLUSE: 0x2009 });
});

test('Fluid Page and the Fluid tab plan exactly App Designer\'s columns (u13, f01-f06, u14)', () => {
  const cases: Array<[string, (a: Record<string, string>) => Record<string, unknown>]> = [
    ['u13-page-fluid-on', () => ({ fluidPage: true })],
    ['f01-page-style-classes', (a) => ({ fluid: { styleClasses: a.FFSTYLEDESKTOP } })],
    ['f02-page-style-small', (a) => ({ fluid: { small: a.FFSTYLEPHONE } })],
    ['f03-page-style-medium', (a) => ({ fluid: { medium: a.FFSTYLEMEDIUM } })],
    ['f04-page-style-large', (a) => ({ fluid: { large: a.FFSTYLETABLET } })],
    ['f05-page-style-xlarge', (a) => ({ fluid: { extraLarge: a.FFSTYLEEXLARGE } })],
    ['f06-page-suppress-classes', () => ({ suppressClasses: true })],
    ['u14-page-fluid-off', () => ({ fluidPage: false })]
  ];
  for (const [capture, edit] of cases) {
    const before = pageRow(capture, 'before'), after = pageRow(capture, 'after');
    const planned = planPageProperties(before, { description: before.DESCR, comments: before.DESCRLONG ?? '', ...edit(after) });
    const changed = Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k] && !['VERSION', 'LASTUPDDTTM'].includes(k))
      .map((k) => [k, /^(PNLUSE|PNLUSETEMP)$/.test(k) ? Number(after[k]) : after[k]]));
    assert.deepEqual(planned, changed, capture);
  }
  // Classes keep their case; blank is ' '; other PNLUSETEMP bits stay.
  const stored = { DESCR: 'D', FFSTYLEDESKTOP: 'zz-sc', PNLUSETEMP: 26 };
  assert.deepEqual(planPageProperties(stored, { description: 'D', comments: '', fluid: { styleClasses: '' }, suppressClasses: true }), { FFSTYLEDESKTOP: ' ', PNLUSETEMP: 27 });
  assert.throws(() => planPageProperties(stored, { description: 'D', comments: '', fluid: { small: 'x'.repeat(101) } }), PageSaveRefusedError);
});

type Row = Record<string, string | number | null>;
/** A capture's rows of a watch-set table for one page (before / after), by column name. */
function captureRows(capture: string, phase: 'before' | 'after', table: string, page = 'ZZ_PCODE_LAB_PG'): Row[] {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, `${phase}.json`), 'utf8')).watch[table];
  return t.rows.filter((r: string[]) => r[0] === page).map((r: string[]) => Object.fromEntries(t.columns.map((c: { name: string }, i: number) => [c.name, r[i]])));
}
const inserted = (capture: string, table: string): Row[] =>
  JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'delta.json'), 'utf8')).watch[table].inserted;
const asStored = (r: Row): StoredControl => ({
  pnlFldId: Number(r.PNLFLDID), fieldNum: Number(r.FIELDNUM), fieldType: Number(r.FIELDTYPE),
  fieldLeft: Number(r.FIELDLEFT), fieldTop: Number(r.FIELDTOP), fieldRight: Number(r.FIELDRIGHT), fieldBottom: Number(r.FIELDBOTTOM),
  editLblLeft: Number(r.EDITLBLLEFT), editLblTop: Number(r.EDITLBLTOP), editLblRight: Number(r.EDITLBLRIGHT), editLblBottom: Number(r.EDITLBLBOTTOM),
  fieldSizeType: Number(r.FIELDSIZETYPE), lblType: Number(r.LBLTYPE), lblText: String(r.LBLTEXT ?? ''), fieldUse: Number(r.FIELDUSE), secureInvisible: Number(r.SECUREINVISIBLE)
});
/** What the editor sends for a pasted copy of `src` that App Designer stored as `row`: an auto-sized 0 corner stays 0 in the editor. */
const pasted = (src: Row, row: Row, page = 'ZZ_PCODE_LAB_PG'): EditedControl => {
  const s = edit(asStored(row));
  const dx = Number(row.FIELDLEFT) - Number(src.FIELDLEFT), dy = Number(row.FIELDTOP) - Number(src.FIELDTOP);
  return { ...s, pnlFldId: -1, fieldRight: Number(src.FIELDRIGHT) ? Number(src.FIELDRIGHT) + dx : 0,
    fieldBottom: Number(src.FIELDBOTTOM) ? Number(src.FIELDBOTTOM) + dy : 0, copy: { pnlName: page, pnlFldId: Number(src.PNLFLDID) } };
};
const sameRow = (a: Row, b: Row, skip: string[] = []) => {
  const diff = Object.keys(b).filter((k) => !skip.includes(k) && String(a[k] ?? null) !== String(b[k] ?? null)).map((k) => `${k}: ${a[k]} vs ${b[k]}`);
  assert.deepEqual(diff, []);
};

test('a tab order change writes only the moved controls\' FIELDNUM (o01)', () => {
  const before = captureRows('o01-page-order-drag', 'before', 'PSPNLFIELD').map(asStored);
  const after = captureRows('o01-page-order-drag', 'after', 'PSPNLFIELD');
  const order = [...after].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM)).map((r) => Number(r.PNLFLDID));
  const plan = planPageSave(before, before.map(edit), 21, order, 'ZZ_PCODE_LAB_PG');
  assert.deepEqual(plan.updates.sort((a, b) => a.pnlFldId - b.pnlFldId), [{ pnlFldId: 10, columns: { FIELDNUM: 6 } }, { pnlFldId: 14, columns: { FIELDNUM: 5 } }]);
});

test('a paste copies its source\'s rows, moved by the paste offset, after the source in tab order (c02)', () => {
  const capture = 'c02-page-paste-groupbox';
  const rows = captureRows(capture, 'before', 'PSPNLFIELD'), exts = captureRows(capture, 'before', 'PSPNLFIELDEXT');
  const [gb, st] = ['23', '24'].map((id) => inserted(capture, 'PSPNLFIELD').find((r) => String(r.PNLFLDID) === id)!);
  const src = (id: string) => rows.find((r) => String(r.PNLFLDID) === id)!;
  const controls = [...rows.map((r) => edit(asStored(r))), pasted(src('9'), gb), pasted(src('21'), st)];
  const plan = planPageSave(rows.map(asStored), controls, 22, undefined, 'ZZ_PCODE_LAB_PG');
  assert.deepEqual(plan.inserts.map((i) => [i.pnlFldId, i.fieldNum]), [[23, 14], [24, 22]]);
  // The survivors after group box 9 move down one, as App Designer's did.
  const shifted = Object.fromEntries(JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'delta.json'), 'utf8'))
    .watch.PSPNLFIELD.updated.map((u: { key: { PNLFLDID: string }; changes: { FIELDNUM: { after: string } } }) => [u.key.PNLFLDID, Number(u.changes.FIELDNUM.after)]));
  assert.deepEqual(Object.fromEntries(plan.updates.map((u) => [String(u.pnlFldId), u.columns.FIELDNUM])), shifted);
  // Every column of both copies, PSPNLFIELD and PSPNLFIELDEXT.
  for (const [ins, from] of [[23, '9'], [24, '21']] as const) {
    const i = plan.inserts.find((x) => x.pnlFldId === ins)!;
    const rowsOut = copyControlRows({ field: src(from), ext: exts.find((r) => String(r.PNLFLDID) === from)! }, 'ZZ_PCODE_LAB_PG', ins, i.fieldNum, i.control);
    sameRow(rowsOut.field, inserted(capture, 'PSPNLFIELD').find((r) => String(r.PNLFLDID) === String(ins))!);
    sameRow(rowsOut.ext, inserted(capture, 'PSPNLFIELDEXT').find((r) => String(r.PNLFLDID) === String(ins))!);
  }
});

test('a pasted auto-sized Edit Box: its 0 RIGHT moves too, its hidden label does not (c01); onto another page (n01)', () => {
  const c01 = 'c01-page-paste-editbox';
  const src = captureRows(c01, 'before', 'PSPNLFIELD').find((r) => r.PNLFLDID === '14')!;
  const ext = captureRows(c01, 'before', 'PSPNLFIELDEXT').find((r) => r.PNLFLDID === '14')!;
  const [row] = inserted(c01, 'PSPNLFIELD');
  const out = copyControlRows({ field: src, ext }, 'ZZ_PCODE_LAB_PG', 22, Number(row.FIELDNUM), pasted(src, row));
  sameRow(out.field, row);
  sameRow(out.ext, inserted(c01, 'PSPNLFIELDEXT')[0]);
  // n01 pasted the same control onto the new page, before it had a name ("$0"); a named page is "<page>$0".
  const n01 = 'n01-page-new';
  const nsrc = captureRows(n01, 'before', 'PSPNLFIELD').find((r) => r.PNLFLDID === '14')!;
  const next = captureRows(n01, 'before', 'PSPNLFIELDEXT').find((r) => r.PNLFLDID === '14')!;
  const [nrow] = inserted(n01, 'PSPNLFIELD');
  const nout = copyControlRows({ field: nsrc, ext: next }, 'ZZ_PCODE_LAB_NP1', 1, 1, pasted(nsrc, nrow));
  sameRow(nout.field, nrow);
  sameRow(nout.ext, inserted(n01, 'PSPNLFIELDEXT')[0], ['PARENTPNLFLDID', 'PAGEPNLFLDID']);
  assert.deepEqual([nout.ext.PARENTPNLFLDID, nout.ext.PAGEPNLFLDID], ['ZZ_PCODE_LAB_NP1$0', 'ZZ_PCODE_LAB_NP1$0']);
});

test('New Page: App Designer\'s fresh PSPNLDEFN row (n01); a writer-created page carries LICENSE_CODE \' \'', () => {
  const [row] = inserted('n01-page-new', 'PSPNLDEFN');
  const defn = planNewPage('ZZ_PCODE_LAB_NP1', 112, 'JARED', undefined, 1);
  sameRow(defn, row, ['LICENSE_CODE', 'LASTUPDDTTM']);
  assert.equal(defn.LICENSE_CODE, NEW_PAGE_LICENSE_CODE);
  // Properties set before the first save: a typed size is Custom (32 -> 11), as 14-props-use.
  const sized = planNewPage('ZZ_PCODE_LAB_NP1', 112, 'JARED', undefined, 1, { description: 'New', comments: '', sizeWidth: 600, sizeHeight: 400 });
  assert.deepEqual([sized.DESCR, sized.PANELRIGHT, sized.PANELBOTTOM, sized.PNLUSE], ['New', 600, 400, 11]);
});

test('New Page Fluid: the Layout Page\'s row, renamed, standard, Owner ID blank (n02 from PSL_APPS_CONTENT)', () => {
  // PSL_APPS_CONTENT on HRDMO (PNLTYPE 7), as read when n02 was captured.
  const template = { PNLNAME: 'PSL_APPS_CONTENT', VERSION: 1, PNLTYPE: 7, FIELDCOUNT: 1, MAXPNLFLDID: 1, GRIDHORZ: 1, GRIDVERT: 1, HELPCONTEXTNUM: 0,
    PANELTOP: 0, PANELLEFT: 0, PANELRIGHT: 570, PANELBOTTOM: 600, PNLSTYLE: ' ', STYLESHEETNAME: ' ', FFSTYLESHEETNAME: 'ACE_SS1', PNLUSE: 16395,
    DEFERPROC: 0, DESCR: 'Default Layout Page', POPUPMENU: ' ', LICENSE_CODE: '/8xH82fnRnCZdB9IClrK8Zl0H0gKWsrxkh1bfqiy9MM=', LASTUPDOPRID: 'PPLSOFT',
    OBJECTOWNERID: 'PPT', FFSTYLEDESKTOP: ' ', FFSTYLEPHONE: ' ', FFSTYLETABLET: ' ', PNLUSETEMP: 0, FFSTYLEMEDIUM: ' ', FFSTYLEEXLARGE: ' ',
    DESCRLONG: 'Single container for apps content (ps_apps_content)' };
  const [row] = inserted('n02-page-new-fluid', 'PSPNLDEFN');
  sameRow(planNewPage('ZZ_PCODE_LAB_NPF1', 113, 'JARED', { defn: template }, 1), row, ['LICENSE_CODE', 'LASTUPDDTTM']);
});

test('every page type change plans exactly App Designer\'s columns (t01-t11, r01-r06)', () => {
  const cases = ['t01-type-std-subpage', 't02-type-subpage-popup', 't04-type-popup-header', 't05-type-header-side1', 't06-type-side1-footer',
    't07-type-footer-layout', 't08-type-layout-search', 't09-type-search-prompt', 't10-type-prompt-mdtarget', 't11-type-mdtarget-side2',
    'r01-type-side2-std', 'r02-type-std-header', 'r03-type-header-subpage', 'r04-type-subpage-std', 'r05-type-std-popup', 'r06-type-popup-std'];
  for (const capture of cases) {
    const before = npRow(capture, 'before');
    const after = npRow(capture, 'after');
    // An Auto-size page's rectangle is what App Designer measured: given here as the editor would send what it draws.
    const autoSizeExtent = { left: Number(after.PANELLEFT), top: Number(after.PANELTOP), right: Number(after.PANELRIGHT), bottom: Number(after.PANELBOTTOM) };
    const planned = planPageProperties(before, { description: before.DESCR, comments: before.DESCRLONG ?? '', pageType: Number(after.PNLTYPE), autoSizeExtent });
    const changed = Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k] && !['VERSION', 'LASTUPDDTTM'].includes(k))
      .map((k) => [k, Number(after[k])]));
    assert.deepEqual(planned, changed, capture);
  }
});

function npRow(capture: string, phase: 'before' | 'after'): Record<string, string> {
  const t = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, `${phase}.json`), 'utf8')).watch.PSPNLDEFN;
  const row = t.rows.find((r: string[]) => r[0] === 'ZZ_PCODE_LAB_NP2');
  return Object.fromEntries(t.columns.map((c: { name: string }, i: number) => [c.name, row[i]]));
}

test('each Page Size choice plans exactly App Designer\'s columns (s01-s08)', () => {
  const cases: Array<[string, string]> = [
    ['s01-size-640x480', '640x480'], ['s02-size-800x600-windows', '800x600'], ['s03-size-800x600-noportal', '800x600-noportal'],
    ['s03b-size-800x600-portal', '800x600-portal'], ['s03c-size-800x600-noportal', '800x600-noportal'], ['s04-size-1024x768-portal', '1024x768-portal'],
    ['s05-size-1024x768-noportal', '1024x768-noportal'], ['s06-size-240xvar', '240xvar'], ['s07-size-490xvar', '490xvar'], ['s08-size-custom', 'custom']
  ];
  for (const [capture, pageSize] of cases) {
    const before = npRow(capture, 'before'), after = npRow(capture, 'after');
    const planned = planPageProperties(before, { description: before.DESCR, comments: before.DESCRLONG ?? '', pageSize });
    const changed = Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k] && !['VERSION', 'LASTUPDDTTM'].includes(k))
      .map((k) => [k, Number(after[k])]));
    assert.deepEqual(planned, changed, capture);
  }
  // Leaving 1024x768 inside portal (0x800, above the low byte) for another type clears it too.
  assert.equal(planPageProperties({ DESCR: 'D', PNLTYPE: 0, PNLUSE: 0x4803, PANELRIGHT: 760, PANELBOTTOM: 498 }, { description: 'D', comments: '', pageType: 4 }).PNLUSE, 0x4023);
  // Only a standard page has the list.
  assert.throws(() => planPageProperties({ DESCR: 'D', PNLTYPE: 1, PNLUSE: 0x13 }, { description: 'D', comments: '', pageSize: '800x600' }), PageSaveRefusedError);
});

test('a frame\'s Properties dialog: each setting plans exactly App Designer\'s columns (fr01-fr07)', () => {
  const edits: Array<[string, (c: EditedControl) => EditedControl]> = [
    ['fr01-frame-label', (c) => ({ ...c, lblText: 'ZZ Frame' })],
    ['fr02-frame-style', (c) => ({ ...c, fieldStyle: 'EDGE' })],
    ['fr03-frame-hide-border', (c) => ({ ...c, fieldUse: c.fieldUse | 0x4000000 })],
    ['fr04-frame-adjust-layout', (c) => ({ ...c, adjustHidden: 1 })],
    ['fr05-frame-multicurrency', (c) => ({ ...c, fieldUse: c.fieldUse | 0x20 })],
    ['fr06-frame-page-field-name', (c) => ({ ...c, pageFieldName: 'zz_frame1' })],
    ['fr07-frame-anchor', (c) => ({ ...c, anchor: 1 })]
  ];
  for (const [capture, change] of edits) {
    const exts = new Map(captureRows(capture, 'before', 'PSPNLFIELDEXT').map((r) => [Number(r.PNLFLDID), r.FFSTYLELONG]));
    const stored = captureRows(capture, 'before', 'PSPNLFIELD').map((r) => ({ ...asStored(r), fieldStyle: String(r.FIELDSTYLE), pageFieldName: String(r.PNLFIELDNAME),
      adjustHidden: Number(r.PTADJHIDDENFIELDS), anchor: Number(r.ENABLEASANCHOR), ffStyleLong: exts.get(Number(r.PNLFLDID)) as string | null }));
    const controls = stored.map((c) => (c.pnlFldId === 16 ? change(edit(c)) : edit(c)));
    const plan = planPageSave(stored, controls, 25, undefined, 'ZZ_PCODE_LAB_PG');
    const delta = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'delta.json'), 'utf8')).watch;
    const cols = (t: string) => (delta[t]?.updated ?? []).map((u: { key: { PNLFLDID: string }; changes: Record<string, { after: string }> }) =>
      ({ pnlFldId: Number(u.key.PNLFLDID), columns: Object.fromEntries(Object.entries(u.changes).map(([k, v]) => [k, /^[0-9]+$/.test(v.after) ? Number(v.after) : v.after])) }));
    assert.deepEqual(plan.updates, cols('PSPNLFIELD'), capture);
    assert.deepEqual(plan.extUpdates, cols('PSPNLFIELDEXT'), capture);
  }
});

test('a changed Page Field Name must be free on the page; names already stored are left alone', () => {
  const stored = [control({ pnlFldId: 1, pageFieldName: 'DUP' }), control({ pnlFldId: 2, pageFieldName: 'DUP' }), control({ pnlFldId: 3, pageFieldName: ' ' })];
  // Delivered pages repeat names: saving them unchanged is fine.
  assert.deepEqual(planPageSave(stored, stored.map(edit)).updates, []);
  assert.throws(() => planPageSave(stored, [edit(stored[0]), edit(stored[1]), { ...edit(stored[2]), pageFieldName: 'dup' }]), /already named DUP/);
  assert.throws(() => planPageSave(stored, [edit(stored[0]), edit(stored[1]), { ...edit(stored[2]), pageFieldName: 'A-B' }]), /not a page field name/);
  assert.deepEqual(planPageSave(stored, [edit(stored[0]), edit(stored[1]), { ...edit(stored[2]), pageFieldName: '1of10' }]).updates, [{ pnlFldId: 3, columns: { PNLFIELDNAME: '1OF10' } }]);
});

test('a frame\'s Fluid tab: each setting plans exactly App Designer\'s columns (fr08-fr20)', () => {
  const slots = (c: EditedControl, i: number, v: string) => { const s = fluidClassSlots((c as StoredControl).ffStyleLong); s[i] = v; return s; };
  const edits: Array<[string, (c: EditedControl) => EditedControl]> = [
    ['fr08-frame-style-classes', (c) => ({ ...c, fluidClasses: slots(c, 0, 'zz-fc') })],
    ['fr09-frame-small', (c) => ({ ...c, fluidClasses: slots(c, 1, 'zz-fs') })],
    ['fr10-frame-medium', (c) => ({ ...c, fluidClasses: slots(c, 2, 'zz-fm') })],
    ['fr11-frame-large', (c) => ({ ...c, fluidClasses: slots(c, 3, 'zzfl') })],
    ['fr12-frame-xlarge', (c) => ({ ...c, fluidClasses: slots(c, 4, 'zz-fx') })],
    ['fr13-frame-suppress-classes', (c) => ({ ...c, fieldUseTmp: (c.fieldUseTmp ?? 0) | FLUID_USETMP.suppressClasses })],
    ['fr14-frame-suppress-small', (c) => ({ ...c, fieldUseTmp: (c.fieldUseTmp ?? 0) | FLUID_USETMP.suppressSmall })],
    ['fr15-frame-suppress-medium', (c) => ({ ...c, fieldUseTemp2: (c.fieldUseTemp2 ?? 0) | FLUID_USETEMP2.suppressMedium })],
    ['fr16-frame-suppress-large', (c) => ({ ...c, fieldUseTmp: (c.fieldUseTmp ?? 0) | FLUID_USETMP.suppressLarge })],
    ['fr17-frame-suppress-xlarge', (c) => ({ ...c, fieldUseTemp2: (c.fieldUseTemp2 ?? 0) | FLUID_USETEMP2.suppressExtraLarge })],
    ['fr18-frame-label-after', (c) => ({ ...c, fieldUseTmp: (c.fieldUseTmp ?? 0) | FLUID_USETMP.labelAfter })],
    ['fr19-frame-labels-in-grid', (c) => ({ ...c, fieldUseTemp2: (c.fieldUseTemp2 ?? 0) | FLUID_USETEMP2.labelsInGridCells })],
    ['fr20-frame-structure-basic', (c) => ({ ...c, fieldUseTmp: (c.fieldUseTmp ?? 0) | FLUID_USETMP.structureBasic })]
  ];
  for (const [capture, change] of edits) {
    const exts = new Map(captureRows(capture, 'before', 'PSPNLFIELDEXT').map((r) => [Number(r.PNLFLDID), r]));
    const stored: StoredControl[] = captureRows(capture, 'before', 'PSPNLFIELD').map((r) => ({ ...asStored(r), fieldStyle: String(r.FIELDSTYLE),
      pageFieldName: String(r.PNLFIELDNAME), adjustHidden: Number(r.PTADJHIDDENFIELDS), anchor: Number(r.ENABLEASANCHOR), fieldUseTmp: Number(r.FIELDUSETMP),
      ffStyleLong: (exts.get(Number(r.PNLFLDID))?.FFSTYLELONG ?? null) as string | null, fieldUseTemp2: Number(exts.get(Number(r.PNLFLDID))?.FIELDUSETEMP2 ?? 0) }));
    const controls = stored.map((c) => (c.pnlFldId === 16 ? change({ ...edit(c), ffStyleLong: c.ffStyleLong } as EditedControl) : edit(c)));
    const plan = planPageSave(stored, controls, 25, undefined, 'ZZ_PCODE_LAB_PG');
    const delta = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'delta.json'), 'utf8')).watch;
    const cols = (t: string) => (delta[t]?.updated ?? []).map((u: { key: { PNLFLDID: string }; changes: Record<string, { after: string }> }) =>
      ({ pnlFldId: Number(u.key.PNLFLDID), columns: Object.fromEntries(Object.entries(u.changes).map(([k, v]) => [k, /^[0-9]+$/.test(v.after) ? Number(v.after) : v.after])) }));
    assert.deepEqual(plan.updates, cols('PSPNLFIELD'), capture);
    assert.deepEqual(plan.extUpdates, cols('PSPNLFIELDEXT'), capture);
  }
});

/** A capture's before PSPNLFIELD row for a control → a full StoredControl (all editable columns). */
function storedFull(capture: string, pnlFldId: number): StoredControl {
  const r = captureRows(capture, 'before', 'PSPNLFIELD', 'ZZ_PCODE_LAB_CT').find((x) => Number(x.PNLFLDID) === pnlFldId)!;
  const ext = captureRows(capture, 'before', 'PSPNLFIELDEXT', 'ZZ_PCODE_LAB_CT').find((x) => Number(x.PNLFLDID) === pnlFldId);
  return { ...asStored(r), fieldNum: 1, fieldType: Number(r.FIELDTYPE), fieldStyle: String(r.FIELDSTYLE), pageFieldName: String(r.PNLFIELDNAME),
    adjustHidden: Number(r.PTADJHIDDENFIELDS), anchor: Number(r.ENABLEASANCHOR), fieldUseTmp: Number(r.FIELDUSETMP),
    dsplFormat: Number(r.DSPLFORMAT), contName: String(r.CONTNAME), grdLblMsgSet: Number(r.GRDLBLMSGSET), grdLblMsgNum: Number(r.GRDLBLMSGNUM),
    onValue: String(r.ONVALUE), offValue: String(r.OFFVALUE), lblLoc: Number(r.LBLLOC),
    ffStyleLong: (ext?.FFSTYLELONG ?? null) as string | null, fieldUseTemp2: Number(ext?.FIELDUSETEMP2 ?? 0) };
}
/** The after value of one PSPNLFIELD column for a control in a capture. */
const afterCol = (capture: string, pnlFldId: number, col: string) =>
  captureRows(capture, 'after', 'PSPNLFIELD', 'ZZ_PCODE_LAB_CT').find((x) => Number(x.PNLFLDID) === pnlFldId)![col];
const afterExt = (capture: string, pnlFldId: number, col: string) =>
  captureRows(capture, 'after', 'PSPNLFIELDEXT', 'ZZ_PCODE_LAB_CT').find((x) => Number(x.PNLFLDID) === pnlFldId)![col];

test('Static Text / Static Image / Check Box single-column property edits plan exactly App Designer\'s columns', () => {
  const page = 'ZZ_PCODE_LAB_CT';
  // [capture, pnlFldId, edit-field, value-from-after-column]
  const cases: Array<[string, number, keyof EditedControl, (c: string, id: number) => unknown]> = [
    ['st02-static-msgset', 1, 'grdLblMsgSet', (c, i) => Number(afterCol(c, i, 'GRDLBLMSGSET'))],
    ['st03-static-msgnum', 1, 'grdLblMsgNum', (c, i) => Number(afterCol(c, i, 'GRDLBLMSGNUM'))],
    ['st04-static-explanation', 1, 'dsplFormat', (c, i) => Number(afterCol(c, i, 'DSPLFORMAT'))],
    ['st05-static-style', 1, 'fieldStyle', (c, i) => String(afterCol(c, i, 'FIELDSTYLE'))],
    ['st06-static-centered', 1, 'dsplFormat', (c, i) => Number(afterCol(c, i, 'DSPLFORMAT'))],
    ['st07-static-right', 1, 'dsplFormat', (c, i) => Number(afterCol(c, i, 'DSPLFORMAT'))],
    ['si01-static-image-id', 2, 'contName', (c, i) => String(afterCol(c, i, 'CONTNAME'))],
    ['si02-image-type-text', 2, 'lblType', (c, i) => Number(afterCol(c, i, 'LBLTYPE'))],
    ['si07-image-scale', 2, 'dsplFormat', (c, i) => Number(afterCol(c, i, 'DSPLFORMAT'))],
    ['cb-dcf', 3, 'fieldUse', (c, i) => Number(afterCol(c, i, 'FIELDUSE'))],
    ['cb-display-only', 3, 'fieldUse', (c, i) => Number(afterCol(c, i, 'FIELDUSE'))],
    ['cb-invisible', 3, 'fieldUse', (c, i) => Number(afterCol(c, i, 'FIELDUSE'))],
    ['cb-multicurrency', 3, 'fieldUse', (c, i) => Number(afterCol(c, i, 'FIELDUSE'))],
    ['cb-set-comp-changed-off', 3, 'fieldUseTmp', (c, i) => Number(afterCol(c, i, 'FIELDUSETMP'))],
    ['cb-wrap-long-words', 3, 'fieldUseTmp', (c, i) => Number(afterCol(c, i, 'FIELDUSETMP'))]
  ];
  for (const [capture, id, field, value] of cases) {
    const stored = storedFull(capture, id);
    const e = { ...edit(stored), [field]: value(capture, id) } as EditedControl;
    const plan = planPageSave([stored], [e], 50, undefined, page);
    const want = (JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', capture, 'delta.json'), 'utf8')).watch.PSPNLFIELD.updated ?? [])
      .map((u: { changes: Record<string, { after: string }> }) => Object.fromEntries(Object.keys(u.changes).map((k) => [k, /^-?[0-9]+$/.test(u.changes[k].after) ? Number(u.changes[k].after) : u.changes[k].after])));
    assert.deepEqual(plan.updates.map((u) => u.columns), want, capture);
  }
});

test('Static Text Paragraph and Static Image dims use the right ext/geometry columns', () => {
  // Paragraph → PSPNLFIELDEXT.FIELDUSETEMP2
  const st = storedFull('st08-static-paragraph', 1);
  const plan = planPageSave([st], [{ ...edit(st), fieldUseTemp2: Number(afterExt('st08-static-paragraph', 1, 'FIELDUSETEMP2')) }], 50, undefined, 'ZZ_PCODE_LAB_CT');
  assert.deepEqual(plan.extUpdates, [{ pnlFldId: 1, columns: { FIELDUSETEMP2: Number(afterExt('st08-static-paragraph', 1, 'FIELDUSETEMP2')) } }]);
  assert.deepEqual(plan.updates, []);
});

test('a pasted control into a scroll uses the drop-point OCCURSLEVEL; without it, the source\'s level', () => {
  const src = { PNLNAME: 'P', PNLFLDID: 14, FIELDNUM: 5, FIELDTYPE: 4, FIELDLEFT: 10, FIELDTOP: 10, FIELDRIGHT: 0, FIELDBOTTOM: 0, OCCURSLEVEL: 0,
    EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0, FIELDSIZETYPE: 0, LBLTYPE: 3, LBLTEXT: 'X', FIELDUSE: 0, SECUREINVISIBLE: 0 } as Record<string, number | string>;
  const ext = { PNLNAME: 'P', PNLFLDID: 14, PARENTPNLFLDID: 'P$0', PAGEPNLFLDID: 'P$0' } as Record<string, number | string>;
  const e = (occursLevel?: number): EditedControl => ({ pnlFldId: -1, fieldLeft: 40, fieldTop: 40, fieldRight: 0, fieldBottom: 0, editLblLeft: 0, editLblTop: 0, editLblRight: 0, editLblBottom: 0,
    fieldSizeType: 0, lblType: 3, lblText: 'X', fieldUse: 0, secureInvisible: 0, copy: { pnlName: 'P', pnlFldId: 14 }, ...(occursLevel !== undefined ? { occursLevel } : {}) });
  assert.equal(copyControlRows({ field: src, ext }, 'P', 22, 6, e(1)).field.OCCURSLEVEL, 1);
  assert.equal(copyControlRows({ field: src, ext }, 'P', 22, 6, e()).field.OCCURSLEVEL, 0); // source's level
});
