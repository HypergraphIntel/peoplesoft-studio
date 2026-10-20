import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FieldType, RecordType } from '../model/record.js';
import { combineBuildPlans, planAlterTable, planCreateIndexes, planCreateViews, type AlterSettings, type DbTableFacts } from '../model/recordAlter.js';
import { planCreateTables } from '../model/recordBuild.js';
import type { DdlField, DdlRecord } from '../model/recordDdl.js';

/*
 * App Designer's own Build scripts on HRDMO 8.62.09 (2026-10-19), built
 * script-only and kept byte for byte (src/test/fixtures/build; CRLF as App
 * Designer writes them). ZZ_PCODE_LAB_R1's definition changed between
 * captures in App Designer while its table stayed as first built; the
 * DBMS_METADATA DDL of that table and index is metadata.json. The PSOPTSYNC
 * trigger App Designer appends for R1 (OPTTRIGFLAG Y) is not generated here.
 */
const fixture = (name: string) => readFileSync(path.join('src', 'test', 'fixtures', 'build', `${name}.sql`), 'utf8').replace(/\r\n/g, '\n');
const metadata = JSON.parse(readFileSync(path.join('src', 'test', 'fixtures', 'build', 'metadata.json'), 'utf8')) as Record<string, string>;
/** The captured script without R1's trigger, ending as this module writes scripts. */
const expected = (name: string) => {
  const s = fixture(name);
  const cut = s.indexOf('CREATE OR REPLACE TRIGGER');
  return (cut < 0 ? s : s.slice(0, cut)).replace(/\n?$/, '\n');
};

const MODEL = {
  table: 'CREATE TABLE [TBNAME] ([TBCOLLIST]) TABLESPACE [TBSPCNAME] STORAGE (INITIAL **INIT** NEXT **NEXT** MAXEXTENTS **MAXEXT** PCTINCREASE **PCT**) PCTFREE **PCTFREE** PCTUSED **PCTUSED**;',
  index: 'CREATE [UNIQUE] **BITMAP** INDEX [IDXNAME] ON [TBNAME] ([IDXCOLLIST]) TABLESPACE **INDEXSPC** STORAGE (INITIAL **INIT** NEXT **NEXT** MAXEXTENTS **MAXEXT** PCTINCREASE **PCT**) PCTFREE **PCTFREE** PARALLEL NOLOGGING;',
  tableParms: { INIT: '40000', MAXEXT: 'UNLIMITED', NEXT: '100000', PCT: '0', PCTFREE: '10', PCTUSED: '80' },
  indexParms: { BITMAP: ' ', INDEXSPC: 'PSINDEX', INIT: '40000', MAXEXT: 'UNLIMITED', NEXT: '100000', PCT: '0', PCTFREE: '10' }
};
const f = (name: string, type: FieldType, length: number, useEdit = 8388608, decimalPositions = 0): DdlField => ({ name, type, length, decimalPositions, useEdit });
const ch = (n: string, length: number, useEdit = 8388608) => f(`ZZ_PCODE_LAB_${n}`, FieldType.Character, length, useEdit);

// PSRECFIELD.USEEDIT as App Designer saved them.
const ORIGINAL = [ch('KEY', 10, 276826177), ch('C01', 1, 25182208), ch('C02', 1, 10485760), ch('C03', 1, 142614528), ch('C04', 1, 8388608),
  ch('C05', 1, 8388736), ch('C06', 1, 25166848), ch('C07', 1, 8404992), ch('VAL', 10, 8404992), f('LASTUPDDTTM', FieldType.DateTime, 26, 75497472)];
const withKeys = (fields: DdlField[]) => fields.map((x) => x.name === 'ZZ_PCODE_LAB_C01' ? { ...x, useEdit: 25182256 } : x.name === 'ZZ_PCODE_LAB_C02' ? { ...x, useEdit: 10485761 } : x);
const ADDED = [ch('C08', 12), f('ZZ_PCODE_LAB_N4', FieldType.Number, 10, 8388608, 2), f('ZZ_PCODE_LAB_S1', FieldType.SignedNumber, 5), f('ZZ_PCODE_LAB_D1', FieldType.Date, 10),
  f('ZZ_PCODE_LAB_T1', FieldType.Time, 15), f('ZZ_PCODE_LAB_DT', FieldType.DateTime, 26), f('ZZ_PCODE_LAB_L1', FieldType.LongCharacter, 0),
  f('ZZ_PCODE_LAB_L2', FieldType.LongCharacter, 254), f('ZZ_PCODE_LAB_IR', FieldType.ImageReference, 30)];
const r1 = (fields: DdlField[]): DdlRecord => ({ name: 'ZZ_PCODE_LAB_R1', recordType: RecordType.Table, sqlTableName: ' ', tablespace: 'AAAPP', fields, optimizationTrigger: true });

/** PS_ZZ_PCODE_LAB_R1 as App Designer first built it: the original ten columns, empty, its key index on the key alone. */
const R1_TABLE: DbTableFacts = {
  exists: true, hasRows: false, ddl: metadata['TABLE:PS_ZZ_PCODE_LAB_R1'],
  columns: ORIGINAL.map((x) => x.type === FieldType.DateTime
    ? { name: x.name, dataType: 'TIMESTAMP(6)', charLength: 0, precision: null, scale: 6, nullable: true }
    : { name: x.name, dataType: 'VARCHAR2', charLength: x.length, precision: null, scale: null, nullable: false }),
  indexes: [{ name: 'PS_ZZ_PCODE_LAB_R1', unique: true, columns: ['ZZ_PCODE_LAB_KEY'], ddl: metadata['INDEX:PS_ZZ_PCODE_LAB_R1'] }]
};
const DEFAULTS: AlterSettings = { tableOption: 'rename', dropColumn: 'skip', changeLength: 'skip', adds: true, changes: true, renames: true, deletes: true, evenIfNoChanges: false };

test('Create Tables recreating an existing table is App Designer\'s script T1', () => {
  assert.equal(planCreateTables(r1(ORIGINAL), MODEL, 'recreate', true).script, expected('T1'));
});

test('Create Indexes, recreate if it already exists: DROP, then the head with the record\'s columns and the database\'s physical clauses (I3)', () => {
  assert.equal(planCreateIndexes(r1(ORIGINAL), MODEL, R1_TABLE, 'recreate').script, expected('I3'));
});

test('Create Indexes, only if modified: an unchanged index is left alone and a new one comes from the DDL model (I5)', () => {
  const fields = ORIGINAL.map((x) => x.name === 'ZZ_PCODE_LAB_C01' ? { ...x, useEdit: 25182256 } : x);
  assert.equal(planCreateIndexes(r1(fields), MODEL, R1_TABLE, 'ifModified').script, expected('I5'));
  const unchanged = planCreateIndexes(r1(ORIGINAL), MODEL, R1_TABLE, 'ifModified');
  assert.equal(unchanged.script, '');
  assert.match(unchanged.notes[0], /unchanged/);
});

test('Create Indexes, only if modified: a modified index keeps its physical clauses with its new columns (I6)', () => {
  assert.equal(planCreateIndexes(r1(withKeys(ORIGINAL)), MODEL, R1_TABLE, 'ifModified').script, expected('I6'));
});

test('Create Indexes on a delivered table with alternate search keys: every DROP first, then each index (BA_CD_TBL, I4)', () => {
  const ba: DdlRecord = { name: 'BA_CD_TBL', recordType: RecordType.Table, sqlTableName: ' ', fields: [
    f('BA_CD', FieldType.Character, 5, 0x800001), f('EFFDT', FieldType.Date, 10, 0x800141), f('EFF_STATUS', FieldType.Character, 1),
    f('DESCR100', FieldType.Character, 100, 0x800010), f('DESCRSHORT', FieldType.Character, 10, 0x800010)] };
  const facts: DbTableFacts = { exists: true, hasRows: true, columns: [], indexes: [
    { name: 'PS_BA_CD_TBL', unique: true, columns: ['BA_CD', 'EFFDT'], ddl: metadata['INDEX:PS_BA_CD_TBL'] },
    { name: 'PS0BA_CD_TBL', unique: false, columns: ['DESCR100', 'BA_CD', 'EFFDT'], ddl: metadata['INDEX:PS0BA_CD_TBL'] },
    { name: 'PS1BA_CD_TBL', unique: false, columns: ['DESCRSHORT', 'BA_CD', 'EFFDT'], ddl: metadata['INDEX:PS1BA_CD_TBL'] }] };
  assert.equal(planCreateIndexes(ba, MODEL, facts, 'recreate').script, expected('I4'));
});

test('Alter with only key changes does the index work alone (A0)', () => {
  const plan = planAlterTable(r1(withKeys(ORIGINAL)), MODEL, R1_TABLE, DEFAULTS);
  assert.equal(plan.script, expected('A0'));
  assert.match(plan.notes.join(' '), /optimization trigger/);
});

test('Alter by table rename adding a character column (A1)', () => {
  assert.equal(planAlterTable(r1([...withKeys(ORIGINAL), ADDED[0]]), MODEL, R1_TABLE, DEFAULTS).script, expected('A1'));
});

test('Alter by table rename adding every column type: NOT NULL ones filled, nullable ones left out of the copy (A2)', () => {
  assert.equal(planAlterTable(r1([...withKeys(ORIGINAL), ...ADDED]), MODEL, R1_TABLE, DEFAULTS).script, expected('A2'));
});

test('Alter in place adding every column type (A3)', () => {
  assert.equal(planAlterTable(r1([...withKeys(ORIGINAL), ...ADDED]), MODEL, R1_TABLE, { ...DEFAULTS, tableOption: 'inPlace' }).script, expected('A3'));
});

test('a deleted column, a lengthened one and a DateTime made NOT NULL rebuild by table rename, even with Alter in place set (A4)', () => {
  const fields = withKeys(ORIGINAL).filter((x) => x.name !== 'ZZ_PCODE_LAB_C06')
    .map((x) => x.name === 'ZZ_PCODE_LAB_C07' ? { ...x, length: 3 } : x.name === 'LASTUPDDTTM' ? { ...x, useEdit: 75497728 } : x);
  for (const tableOption of ['rename', 'inPlace'] as const) {
    assert.equal(planAlterTable(r1([...fields, ...ADDED]), MODEL, R1_TABLE, { ...DEFAULTS, tableOption }).script, expected('A4'));
  }
});

test('Alter back to the original: a deleted LOB column resets the copy to the DDL model, a shortened column is cut with SUBSTR (A5)', () => {
  const a5 = JSON.parse(readFileSync(path.join('src', 'test', 'fixtures', 'build', 'metadata-a5.json'), 'utf8')) as Record<string, string>;
  const v = (name: string, charLength: number, nullable = false) => ({ name, dataType: 'VARCHAR2', charLength, precision: null, scale: null, nullable });
  // The table as Studio's executed A4 Alter left it (2026-10-19), while the definition went back to the original in App Designer.
  const facts: DbTableFacts = { exists: true, hasRows: false, ddl: a5['TABLE:PS_ZZ_PCODE_LAB_R1'], columns: [
    v('ZZ_PCODE_LAB_KEY', 10), v('ZZ_PCODE_LAB_C01', 1), v('ZZ_PCODE_LAB_C02', 1), v('ZZ_PCODE_LAB_C03', 1), v('ZZ_PCODE_LAB_C04', 1), v('ZZ_PCODE_LAB_C05', 1),
    v('ZZ_PCODE_LAB_C07', 3), v('ZZ_PCODE_LAB_VAL', 10), { name: 'LASTUPDDTTM', dataType: 'TIMESTAMP(6)', charLength: 0, precision: null, scale: 6, nullable: false },
    v('ZZ_PCODE_LAB_C08', 12), { name: 'ZZ_PCODE_LAB_N4', dataType: 'NUMBER', charLength: 0, precision: 9, scale: 2, nullable: false },
    { name: 'ZZ_PCODE_LAB_S1', dataType: 'NUMBER', charLength: 0, precision: null, scale: 0, nullable: false },
    { name: 'ZZ_PCODE_LAB_D1', dataType: 'DATE', charLength: 0, precision: null, scale: null, nullable: true },
    { name: 'ZZ_PCODE_LAB_T1', dataType: 'TIMESTAMP(6)', charLength: 0, precision: null, scale: 6, nullable: true },
    { name: 'ZZ_PCODE_LAB_DT', dataType: 'TIMESTAMP(6)', charLength: 0, precision: null, scale: 6, nullable: true },
    v('ZZ_PCODE_LAB_L2', 254, true), v('ZZ_PCODE_LAB_IR', 30), { name: 'ZZ_PCODE_LAB_L1', dataType: 'CLOB', charLength: 0, precision: null, scale: null, nullable: true }],
    indexes: [
      { name: 'PS0ZZ_PCODE_LAB_R1', unique: false, columns: ['ZZ_PCODE_LAB_C01', 'ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_C02'], ddl: a5['INDEX:PS0ZZ_PCODE_LAB_R1'] },
      { name: 'PS_ZZ_PCODE_LAB_R1', unique: true, columns: ['ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_C02'], ddl: a5['INDEX:PS_ZZ_PCODE_LAB_R1'] }] };
  const plan = planAlterTable(r1(ORIGINAL), MODEL, facts, DEFAULTS);
  assert.equal(plan.script, expected('A5'));
  assert.match(plan.notes[0], /DDL model defaults/);
  // A LOB the record keeps has storage App Designer was not seen to carry over.
  const kept = planAlterTable(r1([...ORIGINAL, f('ZZ_PCODE_LAB_L1', FieldType.LongCharacter, 0)]), MODEL, facts, DEFAULTS);
  assert.match(kept.notes[0], /LOB storage for a column the record keeps/);
});

test('Alter refuses or skips what was not captured, and keeps data the settings protect', () => {
  const held = { ...R1_TABLE, hasRows: true };
  const drop = withKeys(ORIGINAL).filter((x) => x.name !== 'ZZ_PCODE_LAB_C06');
  assert.match(planAlterTable(r1(drop), MODEL, held, DEFAULTS).notes[0], /Skip record if data present/);
  const dropped = planAlterTable(r1(drop), MODEL, held, { ...DEFAULTS, dropColumn: 'drop' });
  assert.ok(dropped.script.includes('RENAME PSYZZ_PCODE_LAB_R1 TO PS_ZZ_PCODE_LAB_R1'));
  assert.match(dropped.drops ?? '', /ZZ_PCODE_LAB_C06/);
  const shorter = ORIGINAL.map((x) => x.name === 'ZZ_PCODE_LAB_VAL' ? { ...x, length: 5 } : x);
  assert.match(planAlterTable(r1(shorter), MODEL, held, DEFAULTS).notes[0], /Skip record if field too short/);
  assert.ok(planAlterTable(r1(shorter), MODEL, held, { ...DEFAULTS, changeLength: 'truncate' }).script.includes('SUBSTR(ZZ_PCODE_LAB_VAL, 1, 5)'));
  const retyped = ORIGINAL.map((x) => x.name === 'ZZ_PCODE_LAB_VAL' ? { ...x, type: FieldType.Number } : x);
  assert.match(planAlterTable(r1(retyped), MODEL, R1_TABLE, DEFAULTS).notes[0], /changes type.*not been captured/);
  const requiredDate = [...ORIGINAL, f('ZZ_PCODE_LAB_D1', FieldType.Date, 10, 0x800100)];
  assert.match(planAlterTable(r1(requiredDate), MODEL, R1_TABLE, DEFAULTS).notes[0], /fill value/);
  assert.match(planAlterTable(r1(ORIGINAL), MODEL, { ...R1_TABLE, exists: false }, DEFAULTS).notes[0], /Create Tables builds it/);
  assert.match(planAlterTable(r1(ORIGINAL), { ...MODEL, platform: 'mssql' }, R1_TABLE, DEFAULTS).notes[0], /Oracle scripts only/);
  const unchanged = planAlterTable({ ...r1(ORIGINAL), optimizationTrigger: false }, MODEL, R1_TABLE, DEFAULTS);
  assert.equal(unchanged.script, '');
  assert.match(unchanged.notes[0], /match the definition/);
});

test('Create Views is App Designer\'s view script, header and all (ZZ_DSTNCT_DEPT, V1)', () => {
  const view: DdlRecord = { name: 'ZZ_DSTNCT_DEPT', recordType: RecordType.View, sqlTableName: ' ', fields: [
    f('SETID', FieldType.Character, 5), f('DEPTID', FieldType.Character, 10), f('TREE_NODE_NUM', FieldType.Number, 10), f('TREE_NODE_NUM_END', FieldType.Number, 10)] };
  const sql = 'SELECT\r\nSETID,\r\nDEPTID,\r\nTREE_NODE_NUM,\r\nTREE_NODE_NUM_END\r\nFROM PS_TRN_DPTSCRTY_VW\r\nGROUP BY SETID, DEPTID,TREE_NODE_NUM,\r\nTREE_NODE_NUM_END';
  assert.equal(planCreateViews(view, sql, true, 'recreate', MODEL).script, expected('V1'));
  assert.match(planCreateViews(view, sql, true, 'skip', MODEL).notes[0], /Skip view/);
  assert.ok(!planCreateViews(view, sql, false, 'recreate', MODEL).script.includes('DROP VIEW'));
  assert.match(planCreateViews(view, 'SELECT %CurrentDateIn FROM PS_INSTALLATION', true, 'recreate', MODEL).notes[0], /meta-SQL/);
});

test('a view script runs without its header, and Build Project writes the header once', () => {
  const view = (name: string): DdlRecord => ({ name, recordType: RecordType.View, sqlTableName: ' ', fields: [f('SETID', FieldType.Character, 5)] });
  const one = planCreateViews(view('ZZ_V1'), 'SELECT SETID FROM PS_SETID_TBL', true, 'recreate', MODEL);
  assert.deepEqual(one.statements, ['DROP VIEW PS_ZZ_V1', 'CREATE VIEW PS_ZZ_V1 (SETID) AS SELECT SETID FROM PS_SETID_TBL']);
  const both = combineBuildPlans([one, planCreateViews(view('ZZ_V2'), 'SELECT SETID FROM PS_SETID_TBL', false, 'recreate', MODEL)]);
  assert.equal(both.script.split('--SET DEFINE OFF').length, 2);
  assert.deepEqual(both.statements.map((x) => x.split(' ').slice(0, 3).join(' ')), ['DROP VIEW PS_ZZ_V1', 'CREATE VIEW PS_ZZ_V1', 'CREATE VIEW PS_ZZ_V2']);
});
