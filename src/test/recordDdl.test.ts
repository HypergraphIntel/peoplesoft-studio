import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldType, RecordType } from '../model/record.js';
import { columnType, createTableScript, notNull, tableName } from '../model/recordDdl.js';

const f = (type: FieldType, length: number, decimalPositions = 0, useEdit = 0x800000, format = 0) =>
  ({ name: 'F', type, length, decimalPositions, useEdit, format });

test('column types follow the rules read off HRDMO\'s built tables', () => {
  assert.equal(columnType(f(FieldType.Character, 11)), 'VARCHAR2(11 CHAR)');
  assert.equal(columnType(f(FieldType.Number, 3)), 'NUMBER(*,0)');
  assert.equal(columnType(f(FieldType.Number, 15)), 'NUMBER(15)');
  // STD_HOURS 7.2 -> NUMBER(6,2); AMOUNT (signed) 20.3 -> NUMBER(18,3).
  assert.equal(columnType(f(FieldType.Number, 7, 2)), 'NUMBER(6,2)');
  assert.equal(columnType(f(FieldType.SignedNumber, 20, 3)), 'NUMBER(18,3)');
  assert.equal(columnType(f(FieldType.SignedNumber, 11)), 'NUMBER(*,0)');
  assert.equal(columnType(f(FieldType.SignedNumber, 12)), 'NUMBER(11)');
  assert.equal(columnType(f(FieldType.LongCharacter, 0)), 'CLOB');
  assert.equal(columnType(f(FieldType.LongCharacter, 1333)), 'VARCHAR2(1333 CHAR)');
  assert.equal(columnType(f(FieldType.LongCharacter, 1500)), 'CLOB');
  assert.equal(columnType(f(FieldType.LongCharacter, 0, 0, 0, 7)), 'BLOB');
  assert.equal(columnType(f(FieldType.Date, 10)), 'DATE');
  assert.equal(columnType(f(FieldType.DateTime, 26)), 'TIMESTAMP(6)');
  assert.equal(columnType(f(FieldType.Image, 0)), 'BLOB');
});

test('NOT NULL: always for character and numbers; for dates and longs only when required', () => {
  assert.ok(notNull(f(FieldType.Character, 1)) && notNull(f(FieldType.Number, 3)));
  assert.ok(!notNull(f(FieldType.Date, 10)));
  assert.ok(notNull(f(FieldType.Date, 10, 0, 0x800100)));
  assert.ok(!notNull(f(FieldType.LongCharacter, 0)));
});

test('the script creates the table and its key index', () => {
  const script = createTableScript({
    name: 'ZZ_PCODE_LAB_R1', recordType: RecordType.Table, sqlTableName: '', tablespace: 'AAAPP',
    fields: [{ ...f(FieldType.Character, 10, 0, 0x800841), name: 'ZZ_PCODE_LAB_KEY' }, { ...f(FieldType.Character, 1), name: 'ZZ_PCODE_LAB_C01' }]
  });
  assert.match(script, /CREATE TABLE PS_ZZ_PCODE_LAB_R1 \(\n {3}ZZ_PCODE_LAB_KEY VARCHAR2\(10 CHAR\) NOT NULL,\n {3}ZZ_PCODE_LAB_C01 VARCHAR2\(1 CHAR\) NOT NULL\n\) TABLESPACE AAAPP\n\//);
  assert.match(script, /CREATE UNIQUE INDEX PS_ZZ_PCODE_LAB_R1 ON PS_ZZ_PCODE_LAB_R1 \(\n {3}ZZ_PCODE_LAB_KEY DESC\)/);
  const dup = createTableScript({ name: 'R', recordType: RecordType.Table, sqlTableName: 'PSR', fields: [{ ...f(FieldType.Character, 1, 0, 0x2), name: 'A' }] });
  assert.match(dup, /CREATE INDEX PSR ON PSR/);
  assert.equal(tableName({ name: 'X', sqlTableName: ' ' }), 'PS_X');
  assert.throws(() => createTableScript({ name: 'V', recordType: RecordType.View, sqlTableName: '', fields: [] }), /not an SQL Table/);
});
