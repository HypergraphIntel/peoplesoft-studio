import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RecordType, UseEdit } from '../model/record.js';
import {
  editRefusal, editStateFor, insertField, moveField, planRecordSave, RecordSaveRefusedError, removeField, removeFields, setDefault, setEdits,
  insertSubrecord, setLabel, setPageControl, setRecordProperties, setRecordType, setUse,
  type RecordEditState, type Row, type StoredRecord
} from '../model/recordEdit.js';

const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

interface Delta { summary: { psversion: Record<string, { delta: number }> }; otherTables: Record<string, { inserted: Row[]; deleted: Row[] }> }

const s = (v: unknown) => String(v ?? '').trim();

/**
 * Each App Designer record save in the matrix, replayed: the record's rows
 * before (the deleted ones -- App Designer rewrites them all) and the edit
 * that turns them into the rows after. The plan must be App Designer's rows.
 */
const CASES: { dir: string; recname: string }[] = [
  { dir: 'r01-reorder-fields', recname: 'ZZ_PCODE_LAB_T' },
  { dir: 'r02-insert-field', recname: 'ZZ_PCODE_LAB_T' },
  { dir: 'r03-sqltable-key-and-fields', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r04-listbox-off', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r05-key-ascending', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r06-delete-field-sqltable', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r07-delete-field-derived', recname: 'ZZ_PCODE_LAB_T' },
  { dir: 'r08-search-key-dup-order', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r09-search-audit-system', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r11-default-search-field', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r12-search-edit', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r13-disable-advanced-search', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r14-allow-search-events', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r15-edits-defaults-label', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r16-yes-no-smart', recname: 'ZZ_PCODE_LAB_R1' },
  { dir: 'r18-record-general', recname: 'ZZ_PCODE_LAB_R1' }
  // r10 (Do Not Trace on C04) is not replayed: App Designer also restamped
  // LASTUPDDTTM's row, whose values had not changed (its dialog was opened
  // for Auto-Update, which stored nothing). The writer restamps only rows
  // whose values change.
];

for (const { dir, recname } of CASES) {
  test(`a record save plans App Designer's rows: ${dir}`, (t) => {
    const file = path.join(RESULTS, dir, 'delta.json');
    if (!existsSync(file)) return t.skip('case not present');
    const d = JSON.parse(readFileSync(file, 'utf8')) as Delta;
    const of = (table: string, kind: 'inserted' | 'deleted') =>
      (d.otherTables[table]?.[kind] ?? []).filter((r) => s(r.RECNAME) === recname);
    const byNum = (a: Row, b: Row) => Number(a.FIELDNUM) - Number(b.FIELDNUM);
    const [defnBefore] = of('PSRECDEFN', 'deleted');
    const [defnAfter] = of('PSRECDEFN', 'inserted');
    const before = of('PSRECFIELD', 'deleted').sort(byNum);
    const after = of('PSRECFIELD', 'inserted').sort(byNum);

    const stored: StoredRecord = {
      recname, recordType: Number(defnBefore.RECTYPE) as RecordType, version: Number(defnBefore.VERSION),
      defn: defnBefore, fields: before, indexes: of('PSINDEXDEFN', 'deleted')
    };
    const edit: RecordEditState = {
      ...editStateFor(stored),
      fields: after.map((r) => ({
      name: s(r.FIELDNAME), useEdit: Number(r.USEEDIT), useEdit2: Number(r.USEEDIT2),
      editTable: s(r.EDITTABLE), defaultRecord: s(r.DEFRECNAME), defaultField: s(r.DEFFIELDNAME), labelId: s(r.LABEL_ID),
      pageControl: Number(r.DEFGUICONTROL), isNew: !before.some((b) => s(b.FIELDNAME) === s(r.FIELDNAME))
    }))
    };
    // Record Properties as App Designer left them.
    edit.properties = {
      description: s(defnAfter.RECDESCR), definition: String(defnAfter.DESCRLONG ?? '').replace(/\s+$/, ''), ownerId: s(defnAfter.OBJECTOWNERID),
      setControlField: s(defnAfter.SETCNTRLFLD), parentRecord: s(defnAfter.PARENTRECNAME), relatedLanguageRecord: s(defnAfter.RELLANGRECNAME),
      querySecurityRecord: s(defnAfter.QRYSECRECNAME), analyticDeleteRecord: s(defnAfter.OPTDELRECNAME),
      toolsTable: (Number(defnAfter.AUXFLAGMASK) & 0x10000) !== 0, managed: (Number(defnAfter.AUXFLAGMASK) & 0x20000) !== 0
    };
    const ts = String(defnAfter.LASTUPDDTTM);
    const plan = planRecordSave(stored, edit, { ts, operatorId: s(defnAfter.LASTUPDOPRID) });

    // App Designer stamps each changed row with its own SYSTIMESTAMP call; the
    // writer uses one per save. A row is "stamped by the save" when its stamp
    // is not the one it had before.
    const stampOf = (r: Row) => {
      const old = before.find((b) => s(b.FIELDNAME) === s(r.FIELDNAME));
      return old && String(old.LASTUPDDTTM) === String(r.LASTUPDDTTM) ? String(r.LASTUPDDTTM) : 'SAVE';
    };
    const norm = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'LASTUPDDTTM' ? stampOf(r) : s(v)]));
    assert.deepEqual(plan.fields.map(norm), after.map(norm));
    assert.equal(plan.fieldCount, Number(defnAfter.FIELDCOUNT));
    for (const [col, v] of Object.entries(plan.recordColumns)) assert.equal(s(v), s(defnAfter[col]), `PSRECDEFN.${col}`);
    assert.equal(plan.indexCount, Number(defnAfter.INDEXCOUNT));
    const asText = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, s(v)])));
    assert.deepEqual(plan.index ? asText([plan.index.row]) : [], asText(of('PSINDEXDEFN', 'inserted')));
    assert.deepEqual(plan.index ? asText(plan.index.keys) : [], asText(of('PSKEYDEFN', 'inserted').sort((a, b) => Number(a.KEYPOSN) - Number(b.KEYPOSN))));
    assert.equal(plan.bumpPgm, (d.summary.psversion.PGM?.delta ?? 0) > 0, 'PGM moves exactly when a field is removed');
  });
}

const table: StoredRecord = {
  recname: 'ZZ_R', recordType: RecordType.Table, version: 3,
  fields: [
    { RECNAME: 'ZZ_R', FIELDNAME: 'K', FIELDNUM: 1, USEEDIT: 0x800001, SUBRECORD: 'N', LASTUPDDTTM: 'old', LASTUPDOPRID: 'PPLSOFT' },
    { RECNAME: 'ZZ_R', FIELDNAME: 'V', FIELDNUM: 2, USEEDIT: 0x800000, SUBRECORD: 'N', LASTUPDDTTM: 'old', LASTUPDOPRID: 'PPLSOFT' }
  ],
  indexes: [{ RECNAME: 'ZZ_R', INDEXID: '_', KEYCOUNT: 1, UNIQUEFLAG: 1 }]
};

test('edits: move, insert, remove, and the key flags', () => {
  let e = editStateFor(table);
  e = insertField(e, 'zz_new', 1);
  assert.deepEqual(e.fields.map((f) => [f.name, f.isNew]), [['K', false], ['ZZ_NEW', true], ['V', false]]);
  assert.equal(e.fields[1].useEdit, 0x800000);
  assert.throws(() => insertField(e, 'V'), /already in/);
  e = moveField(e, 2, 0);
  assert.deepEqual(e.fields.map((f) => f.name), ['V', 'K', 'ZZ_NEW']);
  e = setUse(e, 0, { key: true, descending: true });
  assert.equal(e.fields[0].useEdit, 0x800041);
  assert.throws(() => setUse(e, 2, { descending: true }), /only a key can be descending/);
  e = setUse(e, 0, { key: false });
  assert.equal(e.fields[0].useEdit & UseEdit.DescendingKey, 0, 'removing the key clears Descending');
  e = removeField(e, 2);
  assert.deepEqual(e.fields.map((f) => f.name), ['V', 'K']);
});

test('the plan restamps only changed and new rows, rebuilds the key index, and bumps PGM on removal', () => {
  const e = setUse(insertField(removeField(editStateFor(table), 1), 'ZZ_NEW'), 1, { key: true, descending: true });
  const plan = planRecordSave(table, e, { ts: 'NOW', operatorId: 'JARED' });
  assert.deepEqual(plan.fields.map((f) => [f.FIELDNAME, f.FIELDNUM, f.LASTUPDDTTM]), [['K', 1, 'old'], ['ZZ_NEW', 2, 'NOW']]);
  assert.equal(plan.fields[1].DEFGUICONTROL, 99);
  assert.deepEqual(plan.index!.keys.map((k) => [k.FIELDNAME, k.KEYPOSN, k.ASCDESC]), [['K', 1, 1], ['ZZ_NEW', 2, 0]]);
  assert.equal(plan.index!.row.KEYCOUNT, 2);
  assert.equal(plan.index!.row.UNIQUEFLAG, 1, 'an existing index keeps its own flags');
  assert.deepEqual(plan.removed, ['V']);
  assert.ok(plan.bumpPgm);
});

test('what the cases do not cover is refused', () => {
  // Removing the last key drops the key index (r45).
  const keyless = planRecordSave(table, setUse(editStateFor(table), 0, { key: false }), { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual([keyless.index, keyless.indexCount], [undefined, 0]);
  // Alternate search keys are modelled now (r55); a user-defined index ('A') is not.
  const withAlt = { ...table, fields: [...table.fields, { FIELDNAME: 'A', USEEDIT: 0x10, SUBRECORD: 'N' }] };
  assert.equal(editRefusal(withAlt), undefined);
  assert.match(editRefusal({ ...table, fields: [{ FIELDNAME: 'S', USEEDIT: 0, SUBRECORD: 'Y' }] })!, /subrecords/);
  assert.match(editRefusal({ ...table, indexes: [...table.indexes, { INDEXID: 'A' }] })!, /other than the key index/);
  // Views are editable now, unless materialized or indexed; other types are not.
  assert.equal(editRefusal({ ...table, recordType: RecordType.View, indexes: [] }), undefined);
  assert.match(editRefusal({ ...table, recordType: RecordType.View })!, /has an index/);
  assert.match(editRefusal({ ...table, recordType: RecordType.View, indexes: [], defn: { AUXFLAGMASK: 0x1000000 } })!, /Materialized/);
  assert.match(editRefusal({ ...table, recordType: RecordType.Subrecord })!, /can be edited yet/);
  // Only the flags the cases exercised may change.
  const e = editStateFor(table);
  e.fields[1] = { ...e.fields[1], useEdit: e.fields[1].useEdit | 0x1000 };
  assert.throws(() => planRecordSave(table, e, { ts: 'NOW', operatorId: 'J' }), RecordSaveRefusedError);
});

test('Use settings keep the combinations delivered fields keep', () => {
  let e = editStateFor(table);
  e = setUse(e, 1, { dupOrder: true, descending: true });
  assert.equal(e.fields[1].useEdit & (UseEdit.DuplicateOrderKey | UseEdit.DescendingKey), UseEdit.DuplicateOrderKey | UseEdit.DescendingKey);
  e = setUse(e, 1, { key: true });
  assert.equal(e.fields[1].useEdit & UseEdit.DuplicateOrderKey, 0, 'Key clears Duplicate Order Key');
  e = setUse(e, 0, { searchKey: true });
  assert.ok(e.fields[0].useEdit & UseEdit.SearchKey);
  e = setUse(e, 0, { dupOrder: true });
  assert.equal(e.fields[0].useEdit & (UseEdit.Key | UseEdit.SearchKey), 0, 'a duplicate order key is neither a key nor a search key');
  assert.throws(() => setUse(editStateFor(table), 1, { searchKey: true }), /only a key can be a search key/);
  e = setUse(editStateFor(table), 1, { auditAdd: true, auditChange: true, auditDelete: true, systemMaintained: true, fromSearch: true, throughSearch: true });
  assert.equal(e.fields[1].useEdit, 0x800000 | 0x8 | 0x80 | 0x400 | 0x4 | 0x40000 | 0x80000);
});

test('a duplicate order key joins the key index and makes it non-unique', () => {
  const e = setUse(editStateFor(table), 1, { dupOrder: true });
  const plan = planRecordSave(table, e, { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual(plan.index!.keys.map((k) => k.FIELDNAME), ['K', 'V']);
  assert.deepEqual([plan.index!.row.KEYCOUNT, plan.index!.row.UNIQUEFLAG], [2, 0]);
  assert.match(editRefusal({ ...table, indexes: [{ INDEXID: '_', CUSTKEYORDER: 1 }] })!, /custom key order/);
});

test('Search Edit, the search options and Do Not Trace (r10-r14)', () => {
  let e = setUse(editStateFor(table), 0, { searchKey: true });
  e = setUse(e, 0, { searchEdit: true });
  assert.ok(e.fields[0].useEdit & UseEdit.SearchEdit);
  e = setUse(e, 0, { searchKey: false });
  assert.equal(e.fields[0].useEdit & UseEdit.SearchEdit, 0, 'clearing Search Key clears Search Edit');
  assert.throws(() => setUse(editStateFor(table), 1, { searchEdit: true }), /only a search key/);
  e = setUse(editStateFor(table), 1, { defaultSearch: true, disableAdvancedSearch: true, allowSearchEvents: true, doNotTrace: true });
  assert.equal(e.fields[1].useEdit, 0x800000 | 0x1000000 | 0x200000 | 0x8000000);
  assert.equal(e.fields[1].useEdit2, 0x800000);
  const plan = planRecordSave({ ...table, fields: table.fields.map((f) => ({ ...f, USEEDIT2: 0 })) }, e, { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual([plan.fields[1].USEEDIT2, plan.fields[1].LASTUPDDTTM], [0x800000, 'NOW']);
});

test('the Edits tab, default value, label and page control (r15, r16)', () => {
  const stored = { ...table, fields: table.fields.map((f) => ({ ...f, USEEDIT2: 0, EDITTABLE: ' ', DEFRECNAME: ' ', DEFFIELDNAME: ' ', LABEL_ID: ' ', DEFGUICONTROL: 99 })) };
  let e = editStateFor(stored);
  e = setEdits(e, 1, { required: true, edit: 'prompt', promptTable: 'psoprdefn' });
  assert.deepEqual([e.fields[1].useEdit & (UseEdit.Required | UseEdit.PromptTable), e.fields[1].editTable], [UseEdit.Required | UseEdit.PromptTable, 'PSOPRDEFN']);
  e = setEdits(e, 1, { edit: 'promptNoEdit', promptTable: 'PSOPRDEFN' });
  assert.equal(e.fields[1].useEdit & UseEdit.PromptTable, 0, 'Prompt Table with No Edit is the table alone');
  e = setEdits(e, 1, { edit: 'yesNo' });
  assert.deepEqual([e.fields[1].useEdit & UseEdit.YesNoTable, e.fields[1].editTable], [UseEdit.YesNoTable, '']);
  assert.throws(() => setEdits(e, 1, { edit: 'prompt', promptTable: '' }), /not a record name/);
  e = setDefault(e, 0, { constant: 'X' });
  e = setDefault(e, 1, { record: 'zz_pcode_lab_t', field: 'zz_pcode_lab_key' });
  e = setLabel(e, 0, 'DATE/TIME');
  assert.equal(e.fields[0].useEdit & UseEdit.UseDefaultLabel, 0, 'a label of its own clears Use Default Label');
  e = setPageControl(e, 0, 5);
  // Check Box (7) is one of App Designer's named controls now; Image (9) is never picked, and 3 is unnamed.
  assert.equal(setPageControl(e, 0, 7).fields[0].pageControl, 7);
  assert.throws(() => setPageControl(e, 0, 9), /not been observed/);
  assert.throws(() => setPageControl(e, 0, 3), /not been observed/);
  e = setUse(e, 1, { smartPrompt: true, smartDropDown: true });
  const plan = planRecordSave(stored, e, { ts: 'NOW', operatorId: 'J' });
  const [k, v] = plan.fields;
  assert.deepEqual([k.DEFRECNAME, k.DEFFIELDNAME, k.LABEL_ID, k.DEFGUICONTROL, k.LASTUPDDTTM], [' ', 'X', 'DATE/TIME', 5, 'NOW']);
  assert.deepEqual([v.DEFRECNAME, v.DEFFIELDNAME, v.EDITTABLE, v.USEEDIT2], ['ZZ_PCODE_LAB_T', 'ZZ_PCODE_LAB_KEY', ' ', 0x3000000]);
  // A translate edit is set and cleared as delivered fields store it: its bit alone, no table.
  const xlat = editStateFor({ ...stored, fields: [{ ...stored.fields[0], USEEDIT: 0x800200 }] });
  assert.equal(setEdits(xlat, 0, { edit: 'none' }).fields[0].useEdit & UseEdit.TranslateTable, 0);
  const set = setEdits(setEdits(xlat, 0, { edit: 'prompt', promptTable: 'PSOPRDEFN' }), 0, { edit: 'translate' }).fields[0];
  assert.deepEqual([set.useEdit & (UseEdit.TranslateTable | UseEdit.PromptTable), set.editTable], [UseEdit.TranslateTable, '']);
});

test('several fields are removed at once (multi-select Delete / Cut)', () => {
  const e = insertField(insertField(editStateFor(table), 'A'), 'B');
  assert.deepEqual(removeFields(e, [1, 3]).fields.map((f) => f.name), ['K', 'A']);
  assert.throws(() => removeFields(e, [9]), /no field at position/);
});

test('Record Properties: names, lengths and the Tools Table / Managed flags', async () => {
  const { setRecordProperties } = await import('../model/recordEdit.js');
  const stored = { ...table, defn: { AUXFLAGMASK: 0x10000, RECDESCR: ' ' } };
  let e = setRecordProperties(editStateFor(stored), { description: ' ZZ lab record ', parentRecord: 'zz_pcode_lab_t', toolsTable: false, managed: true, definition: 'Lab record  ' });
  const plan = planRecordSave(stored, e, { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual(plan.recordColumns, { RECDESCR: 'ZZ lab record', PARENTRECNAME: 'ZZ_PCODE_LAB_T', DESCRLONG: 'Lab record', AUXFLAGMASK: 0x20000 });
  e = setRecordProperties(e, { parentRecord: '' });
  assert.equal(planRecordSave(stored, e, { ts: 'NOW', operatorId: 'J' }).recordColumns.PARENTRECNAME, ' ');
  assert.throws(() => setRecordProperties(e, { description: 'x'.repeat(31) }), /at most 30/);
  assert.throws(() => setRecordProperties(e, { parentRecord: 'not a name' }), /not a valid name/);
  assert.throws(() => setRecordProperties(e, { ownerId: 'TOOLONG' }), /owner ID/);
});

test('an SQL Table that never had a key saves with no key index (r26)', () => {
  const keyless = { ...table, fields: table.fields.map((f) => ({ ...f, USEEDIT: 0x800000 })), indexes: [] };
  const plan = planRecordSave(keyless, editStateFor(keyless), { ts: 'NOW', operatorId: 'J' });
  assert.equal(plan.index, undefined);
  assert.equal(plan.indexCount, 0);
});

test('a new record plans as App Designer created R1 / R2 (r02, r35): new field rows, the key index from its keys', () => {
  const stored = { recname: 'ZZ_PCODE_LAB_R9', recordType: RecordType.Table, version: 0, fields: [], indexes: [] };
  const plan = planRecordSave(stored, {
    recname: 'ZZ_PCODE_LAB_R9', recordType: RecordType.Table, openedVersion: 0, isNew: true,
    fields: [
      { name: 'ZZ_PCODE_LAB_KEY', useEdit: UseEdit.UseDefaultLabel | UseEdit.Key, useEdit2: 0, isNew: true },
      { name: 'ZZ_PCODE_LAB_VAL', useEdit: UseEdit.UseDefaultLabel, useEdit2: 0, isNew: true }
    ]
  }, { ts: '2026-10-07 09:00:00.000000', operatorId: 'JARED' });
  assert.equal(plan.fieldCount, 2);
  assert.equal(plan.indexCount, 1);
  assert.deepEqual(plan.fields.map((f) => [f.FIELDNUM, f.USEEDIT, f.DEFGUICONTROL, f.SUBRECORD]), [[1, 8388609, 99, 'N'], [2, 8388608, 99, 'N']]);
  assert.deepEqual(plan.index!.keys.map((k) => [k.KEYPOSN, k.FIELDNAME]), [[1, 'ZZ_PCODE_LAB_KEY']]);
  assert.equal(plan.index!.row.UNIQUEFLAG, 1);
  assert.deepEqual(plan.removed, []);
  // A Derived/Work record has no key index; nor does a keyless SQL Table (r02's R1).
  const derived = planRecordSave({ ...stored, recordType: RecordType.DerivedWork }, {
    recname: 'ZZ_PCODE_LAB_R9', recordType: RecordType.DerivedWork, openedVersion: 0, isNew: true,
    fields: [{ name: 'ZZ_PCODE_LAB_KEY', useEdit: UseEdit.UseDefaultLabel, useEdit2: 0, isNew: true }]
  }, { ts: '2026-10-07 09:00:00.000000', operatorId: 'JARED' });
  assert.equal(derived.indexCount, 0);
  assert.throws(() => planRecordSave(stored, { recname: 'ZZ_PCODE_LAB_R9', recordType: RecordType.Table, openedVersion: 0, isNew: true, fields: [] },
    { ts: '2026-10-07 09:00:00.000000', operatorId: 'JARED' }), /at least one field/);
});

test('record type changes as App Designer saved them (r26, r28): tablespace, key index and view SQL follow the type', () => {
  const base = (recordType: RecordType, indexes: Row[] = []) => ({
    recname: 'ZZ_PCODE_LAB_T', recordType, version: 1, indexes,
    fields: [{ RECNAME: 'ZZ_PCODE_LAB_T', FIELDNAME: 'ZZ_PCODE_LAB_KEY', FIELDNUM: 1, USEEDIT: 0x800001, USEEDIT2: 0, SUBRECORD: 'N' }]
  });
  const stamp = { ts: 'NOW', operatorId: 'J' };
  // Derived/Work -> SQL Table (r26): the tablespace row, and the key index its key needs.
  const derived = base(RecordType.DerivedWork);
  let e = setRecordType(editStateFor(derived), RecordType.DerivedWork, { recordType: RecordType.Table });
  let plan = planRecordSave(derived, e, stamp);
  assert.equal(plan.recordColumns.RECTYPE, RecordType.Table);
  assert.equal(plan.tablespace, 'insert');
  assert.equal(plan.indexCount, 1);
  // SQL Table -> SQL View (r28): the tablespace row goes, no key index, the SQL is written; Build Sequence 2.
  const table = base(RecordType.Table);
  e = setRecordType(editStateFor(table), RecordType.Table, { recordType: RecordType.View, buildSequence: 2 });
  assert.throws(() => planRecordSave(table, e, stamp), /needs its SQL/);
  e = setRecordType(e, RecordType.Table, { viewSql: "SELECT 'X', 'Y' FROM DUAL\n" });
  plan = planRecordSave(table, e, stamp);
  assert.deepEqual([plan.recordColumns.RECTYPE, plan.recordColumns.BUILDSEQNO, plan.tablespace, plan.indexCount, plan.viewSql],
    [RecordType.View, 2, 'delete', 0, "SELECT 'X', 'Y' FROM DUAL"]);
  // Non-Standard SQL Table Name (r27).
  plan = planRecordSave(table, setRecordType(editStateFor(table), RecordType.Table, { sqlTableName: 'ps_zz_pcode_lab_tx' }), stamp);
  assert.equal(plan.recordColumns.SQLTABLENAME, 'PS_ZZ_PCODE_LAB_TX');
  // Unobserved changes are refused.
  // SQL Table -> Derived/Work (r46): the table name cleared, the tablespace row and key index gone.
  const toDerived = planRecordSave(table, setRecordType(editStateFor(table), RecordType.Table, { recordType: RecordType.DerivedWork }), stamp);
  assert.deepEqual([toDerived.recordColumns.RECTYPE, toDerived.recordColumns.SQLTABLENAME, toDerived.tablespace, toDerived.indexCount],
    [RecordType.DerivedWork, ' ', 'delete', 0]);
  // SQL View -> SQL Table (r57): the key index and tablespace row created, the view SQL dropped.
  const fromView = planRecordSave(base(RecordType.View), setRecordType(editStateFor(base(RecordType.View)), RecordType.View, { recordType: RecordType.Table }), stamp);
  assert.deepEqual([fromView.recordColumns.RECTYPE, fromView.tablespace, fromView.indexCount, fromView.dropViewSql], [RecordType.Table, 'insert', 1, true]);
  // SQL View -> Derived/Work (r58): the view SQL dropped (with its PSSQLDEL marker), no key index, no tablespace.
  const viewToDerived = planRecordSave(base(RecordType.View), setRecordType(editStateFor(base(RecordType.View)), RecordType.View, { recordType: RecordType.DerivedWork }), stamp);
  assert.deepEqual([viewToDerived.recordColumns.RECTYPE, viewToDerived.dropViewSql, viewToDerived.indexCount, viewToDerived.tablespace],
    [RecordType.DerivedWork, true, 0, undefined]);
  assert.throws(() => setRecordType(editStateFor(base(RecordType.View)), RecordType.View, { recordType: RecordType.DynamicView }), /not been observed/);
  assert.throws(() => setRecordType(editStateFor(table), RecordType.Table, { viewSql: 'SELECT 1 FROM DUAL' }), /Only a view/);
  // A view saved without SQL changes writes no SQL rows (r32).
  const view = base(RecordType.View);
  assert.equal(planRecordSave(view, editStateFor(view), stamp).viewSql, undefined);
});

test('audit record and options, and the Timestamp Field with its Auto-Update bit (r49, r51)', () => {
  const stored = { recname: 'ZZ_PCODE_LAB_R4', recordType: RecordType.Table, version: 1, indexes: [], fields: [
    { RECNAME: 'ZZ_PCODE_LAB_R4', FIELDNAME: 'ZZ_PCODE_LAB_KEY', FIELDNUM: 1, USEEDIT: 0x800000, USEEDIT2: 0, SUBRECORD: 'N' },
    { RECNAME: 'ZZ_PCODE_LAB_R4', FIELDNAME: 'LASTUPDDTTM', FIELDNUM: 2, USEEDIT: 8388608, USEEDIT2: 0, SUBRECORD: 'N' }
  ] };
  let e = setRecordProperties(editStateFor(stored), { auditRecord: 'zz_pcode_lab_t', recUse: 1 });
  e = setRecordProperties(e, { timestampField: 'LASTUPDDTTM' });
  const plan = planRecordSave(stored, e, { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual([plan.recordColumns.AUDITRECNAME, plan.recordColumns.RECUSE, plan.recordColumns.TIMESTAMPFIELDNAME],
    ['ZZ_PCODE_LAB_T', 1, 'LASTUPDDTTM']);
  // r51: LASTUPDDTTM's USEEDIT 8388608 -> 75497472, the field row not restamped.
  assert.equal(plan.fields[1].USEEDIT, 75497472);
  assert.equal(plan.fields[1].LASTUPDDTTM, undefined);
  assert.throws(() => setRecordProperties(e, { recUse: 16 }), /audit options/);
  assert.throws(() => setRecordProperties(e, { timestampField: 'NOPE' }), /not a field/);
});

test('a subrecord inserts as App Designer inserted ABS_HIST_BELSBR into R5 (r53): one row, its fields expanded after', () => {
  const own = (name: string, n: number) => ({ RECNAME: 'R5', FIELDNAME: name, FIELDNUM: n, USEEDIT: 0x800000, USEEDIT2: 0, SUBRECORD: 'N' });
  const stored = { recname: 'R5', recordType: RecordType.DerivedWork, version: 1, indexes: [], fields: [own('A', 1), own('B', 2)],
    subrecords: { SUB: [{ RECNAME: 'SUB', FIELDNAME: 'S1', FIELDNUM: 1, USEEDIT: 8404992, SUBRECORD: 'N' }, { RECNAME: 'SUB', FIELDNAME: 'S2', FIELDNUM: 2, USEEDIT: 0, SUBRECORD: 'N' }] } };
  // In the middle, as ADHOC_SALCHG_WK holds SS_PROC_SBR: the field after it is numbered on.
  const e = insertSubrecord(editStateFor(stored), 'sub', 1);
  const plan = planRecordSave(stored, e, { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual(plan.fields.map((f) => [f.FIELDNAME, f.FIELDNUM, f.SUBRECORD, f.USEEDIT, f.DEFGUICONTROL]),
    [['A', 1, 'N', 0x800000, undefined], ['SUB', 2, 'Y', 0, 99], ['B', 3, 'N', 0x800000, undefined]]);
  assert.equal(plan.fieldCount, 3);
  assert.deepEqual(plan.dbFields.map((f) => [f.FIELDNAME, f.RECNAME, f.RECNAME_PARENT, f.FIELDNUM, f.USEEDIT]),
    [['A', 'R5', 'R5', 1, 0x800000], ['S1', 'R5', 'SUB', 2, 8404992], ['S2', 'R5', 'SUB', 3, 0], ['B', 'R5', 'R5', 4, 0x800000]]);
  // Only into Derived/Work records; never twice; not removed (no case); not nested.
  assert.throws(() => insertSubrecord(editStateFor({ ...stored, recordType: RecordType.Table }), 'SUB'), /Derived\/Work/);
  assert.throws(() => insertSubrecord(e, 'SUB'), /already/);
  const withSub = { ...stored, fields: [own('A', 1), { ...own('SUB', 2), SUBRECORD: 'Y', USEEDIT: 0 }] };
  // Removing a subrecord (r56): its row and expansion go, PGM moves.
  const gone = planRecordSave(withSub, removeField(editStateFor(withSub), 1), { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual([gone.fieldCount, gone.dbFields.length, gone.bumpPgm], [1, 1, true]);
  assert.throws(() => planRecordSave({ ...withSub, subrecords: { SUB: [{ FIELDNAME: 'X', SUBRECORD: 'Y' }] } }, editStateFor(withSub),
    { ts: 'NOW', operatorId: 'J' }), /nested/);
});

test('alternate search keys index as App Designer indexed R6\'s (r55): one index each, the field then the keys', () => {
  const f = (name: string, n: number, useEdit: number) => ({ RECNAME: 'R6', FIELDNAME: name, FIELDNUM: n, USEEDIT: useEdit, USEEDIT2: 0, SUBRECORD: 'N' });
  const stored = { recname: 'R6', recordType: RecordType.Table, version: 1, indexes: [{ RECNAME: 'R6', INDEXID: '_' }],
    fields: [f('KEY', 1, 0x800001), f('N1', 2, 0x800041), f('N2', 3, 0x800002), f('N3', 4, 0x800000), f('N4', 5, 0x800000)] };
  let e = setUse(editStateFor(stored), 3, { altSearch: true });
  e = setUse(e, 4, { altSearch: true, descending: true });
  const plan = planRecordSave(stored, e, { ts: 'NOW', operatorId: 'J' });
  assert.equal(plan.indexCount, 3);
  assert.deepEqual(plan.altIndexes.map((ix) => [ix.row.INDEXID, ix.row.INDEXTYPE, ix.row.UNIQUEFLAG, ix.row.CLUSTERFLAG, ix.row.KEYCOUNT]),
    [['0', 3, 0, 0, 3], ['1', 3, 0, 0, 3]]);
  // r55: N3, KEY, N1 (descending) -- the duplicate order key N2 is not in it.
  assert.deepEqual(plan.altIndexes[0].keys.map((k) => [k.KEYPOSN, k.FIELDNAME, k.ASCDESC]), [[1, 'N3', 1], [2, 'KEY', 1], [3, 'N1', 0]]);
  assert.deepEqual(plan.altIndexes[1].keys.map((k) => [k.FIELDNAME, k.ASCDESC]), [['N4', 0], ['KEY', 1], ['N1', 0]]);
  // Alternate search keys and keys exclude each other.
  assert.equal(setUse(e, 3, { key: true }).fields[3].useEdit & UseEdit.AltSearchKey, 0);
});

test('the System ID Field takes Auto-Update, as R4\'s did (r54)', () => {
  const stored = { recname: 'R4', recordType: RecordType.Table, version: 1, indexes: [], fields: [
    { RECNAME: 'R4', FIELDNAME: 'N2', FIELDNUM: 1, USEEDIT: 0x800000, USEEDIT2: 0, SUBRECORD: 'N' }] };
  const plan = planRecordSave(stored, setRecordProperties(editStateFor(stored), { systemIdField: 'N2' }), { ts: 'NOW', operatorId: 'J' });
  assert.deepEqual([plan.recordColumns.SYSTEMIDFIELDNAME, plan.fields[0].USEEDIT], ['N2', 75497472]);
});
