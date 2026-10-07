import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldType, RecordType } from '../model/record.js';
import { createTableScript } from '../model/recordDdl.js';
import { planCreateTables, scriptStatements } from '../model/recordBuild.js';

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
