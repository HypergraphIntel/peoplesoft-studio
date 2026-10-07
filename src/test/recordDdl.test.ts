import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldType, RecordType } from '../model/record.js';
import { columnType, createTableScript, notNull, tableName, wrapLine } from '../model/recordDdl.js';

const f = (type: FieldType, length: number, decimalPositions = 0, useEdit = 0x800000, format = 0) =>
  ({ name: 'F', type, length, decimalPositions, useEdit, format });

// HRDMO's Oracle DDL model (PSDDLMODEL platform 2, PSDDLDEFPARMS).
const MODEL = {
  table: 'CREATE TABLE [TBNAME] ([TBCOLLIST]) TABLESPACE [TBSPCNAME] STORAGE (INITIAL **INIT** NEXT **NEXT** MAXEXTENTS **MAXEXT** PCTINCREASE **PCT**) PCTFREE **PCTFREE** PCTUSED **PCTUSED**;',
  index: 'CREATE [UNIQUE] **BITMAP** INDEX [IDXNAME] ON [TBNAME] ([IDXCOLLIST]) TABLESPACE **INDEXSPC** STORAGE (INITIAL **INIT** NEXT **NEXT** MAXEXTENTS **MAXEXT** PCTINCREASE **PCT**) PCTFREE **PCTFREE** PARALLEL NOLOGGING;',
  tableParms: { INIT: '40000', MAXEXT: 'UNLIMITED', NEXT: '100000', PCT: '0', PCTFREE: '10', PCTUSED: '80' },
  indexParms: { BITMAP: ' ', INDEXSPC: 'PSINDEX', INIT: '40000', MAXEXT: 'UNLIMITED', NEXT: '100000', PCT: '0', PCTFREE: '10' }
};

test('the script is App Designer\'s, byte for byte, for ZZ_PCODE_LAB_R1 (its Build > Create Tables script)', () => {
  const ch = (name: string, length: number, useEdit = 0x800000) => ({ name, type: FieldType.Character, length, decimalPositions: 0, useEdit });
  const script = createTableScript({
    name: 'ZZ_PCODE_LAB_R1', recordType: RecordType.Table, sqlTableName: ' ', tablespace: 'AAAPP',
    fields: [
      // A descending key: Oracle indexes are never DESC.
      ch('ZZ_PCODE_LAB_KEY', 10, 276826177),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ch(`ZZ_PCODE_LAB_C0${n}`, 1)),
      ch('ZZ_PCODE_LAB_VAL', 10),
      { name: 'LASTUPDDTTM', type: FieldType.DateTime, length: 26, decimalPositions: 0, useEdit: 75497472 }
    ]
  }, MODEL);
  assert.equal(script, [
    'CREATE TABLE PS_ZZ_PCODE_LAB_R1 (ZZ_PCODE_LAB_KEY VARCHAR2(10) NOT',
    ' NULL,',
    '   ZZ_PCODE_LAB_C01 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_C02 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_C03 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_C04 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_C05 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_C06 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_C07 VARCHAR2(1) NOT NULL,',
    '   ZZ_PCODE_LAB_VAL VARCHAR2(10) NOT NULL,',
    '   LASTUPDDTTM tIMESTAMP) TABLESPACE AAAPP STORAGE (INITIAL 40000 NEXT',
    ' 100000 MAXEXTENTS UNLIMITED PCTINCREASE 0) PCTFREE 10 PCTUSED 80',
    '/',
    'CREATE UNIQUE  iNDEX PS_ZZ_PCODE_LAB_R1 ON PS_ZZ_PCODE_LAB_R1',
    ' (ZZ_PCODE_LAB_KEY) TABLESPACE PSINDEX STORAGE (INITIAL 40000 NEXT',
    ' 100000 MAXEXTENTS UNLIMITED PCTINCREASE 0) PCTFREE 10 PARALLEL',
    ' NOLOGGING',
    '/',
    'ALTER INDEX PS_ZZ_PCODE_LAB_R1 NOPARALLEL LOGGING',
    '/',
    ''
  ].join('\n'));
});

test('every column type, a non-unique index and LOBs last are App Designer\'s, for ZZ_PCODE_LAB_R6', () => {
  const x = (name: string, type: FieldType, length: number, decimalPositions = 0, useEdit = 0x800000) => ({ name, type, length, decimalPositions, useEdit });
  const R = 0x800100;
  const script = createTableScript({
    name: 'ZZ_PCODE_LAB_R6', recordType: RecordType.Table, sqlTableName: ' ', tablespace: 'AAAPP',
    fields: [
      x('ZZ_PCODE_LAB_KEY', FieldType.Character, 10, 0, 0x800001), x('ZZ_PCODE_LAB_N1', FieldType.Number, 4, 0, 0x800041),
      x('ZZ_PCODE_LAB_N2', FieldType.Number, 9, 0, 0x800002), x('ZZ_PCODE_LAB_N3', FieldType.Number, 12),
      x('ZZ_PCODE_LAB_N4', FieldType.Number, 10, 2), x('ZZ_PCODE_LAB_S1', FieldType.SignedNumber, 5),
      x('ZZ_PCODE_LAB_S2', FieldType.SignedNumber, 12, 3), x('ZZ_PCODE_LAB_D1', FieldType.Date, 10, 0, R),
      x('ZZ_PCODE_LAB_T1', FieldType.Time, 15), x('ZZ_PCODE_LAB_DT', FieldType.DateTime, 26, 0, R),
      x('ZZ_PCODE_LAB_L1', FieldType.LongCharacter, 0), x('ZZ_PCODE_LAB_L2', FieldType.LongCharacter, 254, 0, R),
      x('ZZ_PCODE_LAB_C08', FieldType.Character, 10)
    ]
  }, MODEL);
  assert.equal(script, [
    'CREATE TABLE PS_ZZ_PCODE_LAB_R6 (ZZ_PCODE_LAB_KEY VARCHAR2(10) NOT',
    ' NULL,',
    '   ZZ_PCODE_LAB_N1 SMALLINT NOT NULL,',
    '   ZZ_PCODE_LAB_N2 INTEGER NOT NULL,',
    '   ZZ_PCODE_LAB_N3 DECIMAL(12) NOT NULL,',
    '   ZZ_PCODE_LAB_N4 DECIMAL(9, 2) NOT NULL,',
    '   ZZ_PCODE_LAB_S1 SMALLINT NOT NULL,',
    '   ZZ_PCODE_LAB_S2 DECIMAL(10, 3) NOT NULL,',
    '   ZZ_PCODE_LAB_D1 DATE NOT NULL,',
    '   ZZ_PCODE_LAB_T1 TIMESTAMP,',
    '   ZZ_PCODE_LAB_DT tIMESTAMP NOT NULL,',
    '   ZZ_PCODE_LAB_L2 vARCHAR2(254) NOT NULL,',
    '   ZZ_PCODE_LAB_C08 VARCHAR2(10) NOT NULL,',
    '   ZZ_PCODE_LAB_L1 CLOB) TABLESPACE AAAPP STORAGE (INITIAL 40000 NEXT',
    ' 100000 MAXEXTENTS UNLIMITED PCTINCREASE 0) PCTFREE 10 PCTUSED 80',
    '/',
    'CREATE   iNDEX PS_ZZ_PCODE_LAB_R6 ON PS_ZZ_PCODE_LAB_R6',
    ' (ZZ_PCODE_LAB_KEY,',
    '   ZZ_PCODE_LAB_N1,',
    '   ZZ_PCODE_LAB_N2) TABLESPACE PSINDEX STORAGE (INITIAL 40000 NEXT',
    ' 100000 MAXEXTENTS UNLIMITED PCTINCREASE 0) PCTFREE 10 PARALLEL',
    ' NOLOGGING',
    '/',
    'ALTER INDEX PS_ZZ_PCODE_LAB_R6 NOPARALLEL LOGGING',
    '/',
    ''
  ].join('\n'));
});

test('lines wrap at 70 characters, the moved word keeping its space', () => {
  assert.deepEqual(wrapLine('a'.repeat(66) + ' NULL,'), ['a'.repeat(66), ' NULL,']);
  assert.deepEqual(wrapLine('b'.repeat(70)), ['b'.repeat(70)]);
});

test('NOT NULL: always for character and numbers; for dates and longs only when required', () => {
  assert.ok(notNull(f(FieldType.Character, 1)) && notNull(f(FieldType.Number, 3)));
  assert.ok(!notNull(f(FieldType.Date, 10)));
  assert.ok(notNull(f(FieldType.Date, 10, 0, 0x800100)));
  assert.ok(!notNull(f(FieldType.LongCharacter, 0)));
  assert.equal(columnType(f(FieldType.Character, 11)), 'VARCHAR2(11)');
  assert.equal(columnType(f(FieldType.DateTime, 26)), 'tIMESTAMP');
  assert.equal(tableName({ name: 'X', sqlTableName: ' ' }), 'PS_X');
  assert.throws(() => createTableScript({ name: 'V', recordType: RecordType.View, sqlTableName: '', fields: [] }, MODEL), /not an SQL Table/);
});
