import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldType, RecordType } from '../model/record.js';
import { createTableScript } from '../model/recordDdl.js';
import { ddlRecordFromLayout, planCreateTables, planProjectCreateTables, scriptStatements } from '../model/recordBuild.js';
import type { RecordLayout } from '../model/recordLayout.js';

const MODEL = {
  table: 'CREATE TABLE [TBNAME] ([TBCOLLIST]) TABLESPACE [TBSPCNAME] STORAGE (INITIAL **INIT** NEXT **NEXT** MAXEXTENTS **MAXEXT** PCTINCREASE **PCT**) PCTFREE **PCTFREE** PCTUSED **PCTUSED**;',
  index: 'CREATE [UNIQUE] **BITMAP** INDEX [IDXNAME] ON [TBNAME] ([IDXCOLLIST]) TABLESPACE **INDEXSPC** STORAGE (INITIAL **INIT** NEXT **NEXT** MAXEXTENTS **MAXEXT** PCTINCREASE **PCT**) PCTFREE **PCTFREE** PARALLEL NOLOGGING;',
  tableParms: { INIT: '40000', MAXEXT: 'UNLIMITED', NEXT: '100000', PCT: '0', PCTFREE: '10', PCTUSED: '80' },
  indexParms: { BITMAP: ' ', INDEXSPC: 'PSINDEX', INIT: '40000', MAXEXT: 'UNLIMITED', NEXT: '100000', PCT: '0', PCTFREE: '10' }
};

const R1 = {
  name: 'ZZ_PCODE_LAB_R1', recordType: RecordType.Table, sqlTableName: ' ', tablespace: 'AAAPP',
  fields: [
    { name: 'ZZ_PCODE_LAB_KEY', type: FieldType.Character, length: 10, decimalPositions: 0, useEdit: 0x800001 },
    { name: 'LASTUPDDTTM', type: FieldType.DateTime, length: 26, decimalPositions: 0, useEdit: 75497472 }
  ]
};

test('Recreate: an existing table is dropped first, as App Designer\'s R1 script did once PS_ZZ_PCODE_LAB_R1 was built', () => {
  const plan = planCreateTables(R1, MODEL, 'recreate', true);
  assert.ok(plan.script.startsWith('DROP TABLE PS_ZZ_PCODE_LAB_R1\n/\nCREATE TABLE PS_ZZ_PCODE_LAB_R1 ('));
  assert.equal(plan.script, 'DROP TABLE PS_ZZ_PCODE_LAB_R1\n/\n' + createTableScript(R1, MODEL));
  assert.equal(plan.drops, 'PS_ZZ_PCODE_LAB_R1');
  assert.deepEqual(plan.statements.map((s) => s.split(/\s+/).slice(0, 3).join(' ')),
    ['DROP TABLE PS_ZZ_PCODE_LAB_R1', 'CREATE TABLE PS_ZZ_PCODE_LAB_R1', 'CREATE UNIQUE iNDEX', 'ALTER INDEX PS_ZZ_PCODE_LAB_R1']);
});

test('a table not built yet: the create script alone, whatever the option', () => {
  for (const option of ['recreate', 'skip'] as const) {
    const plan = planCreateTables(R1, MODEL, option, false);
    assert.equal(plan.script, createTableScript(R1, MODEL));
    assert.equal(plan.drops, undefined);
  }
});

test('Skip: an existing table is left alone', () => {
  const plan = planCreateTables(R1, MODEL, 'skip', true);
  assert.deepEqual([plan.script, plan.statements], ['', []]);
  assert.match(plan.notes[0], /PS_ZZ_PCODE_LAB_R1 exists: skipped/);
});

test('a script\'s statements end at "/" lines; wrapped lines stay one statement', () => {
  assert.deepEqual(scriptStatements('A\n B\n/\nC\n/\n'), ['A\n B', 'C']);
  assert.throws(() => scriptStatements('A\n/\nB\n'), /without "\/"/);
});

/** A record layout with what Build reads (the rest of RecordLayout is the editor's). */
const layout = (r: typeof R1, over: Partial<RecordLayout> = {}): RecordLayout =>
  ({ ...r, fields: r.fields.map((f) => ({ ...f, isSubrecord: false })), ...over }) as unknown as RecordLayout;

test("a record's DDL shape comes from its layout as the record editor built it", () => {
  assert.deepEqual(ddlRecordFromLayout(layout(R1)), R1);
});

test('Build Project: each SQL Table\'s script in project order, a note for every record left out', () => {
  const R2 = { ...R1, name: 'ZZ_PCODE_LAB_R2', fields: [R1.fields[0]] };
  const plan = planProjectCreateTables([
    { layout: layout(R1), model: MODEL, tableExists: true },
    { layout: layout(R1, { name: 'ZZ_PCODE_LAB_V', recordType: RecordType.View }), model: MODEL, tableExists: false },
    { layout: layout(R2), model: MODEL, tableExists: false },
    { layout: layout(R1, { name: 'ZZ_PCODE_LAB_T', recordType: RecordType.DerivedWork }), model: MODEL, tableExists: false },
    { layout: { ...layout(R1, { name: 'ZZ_PCODE_LAB_S' }), fields: [{ ...R1.fields[0], isSubrecord: true }] } as unknown as RecordLayout, model: MODEL, tableExists: false }
  ], 'recreate');
  assert.equal(plan.script, ['DROP TABLE PS_ZZ_PCODE_LAB_R1\n/\n' + createTableScript(R1, MODEL), createTableScript(R2, MODEL)].join('\n'));
  assert.equal(plan.drops, '1 table');
  assert.deepEqual(plan.notes, [
    'ZZ_PCODE_LAB_V: not an SQL Table (only Create Tables is built here).',
    'ZZ_PCODE_LAB_T: not an SQL Table (only Create Tables is built here).',
    'ZZ_PCODE_LAB_S: has subrecords (not built here yet).'
  ]);
  assert.equal(plan.statements.filter((st) => st.startsWith('CREATE TABLE')).length, 2);
  assert.deepEqual(planProjectCreateTables([], 'recreate'), { script: '', statements: [], notes: [] });
});
