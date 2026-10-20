import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { lineAndColumn, pcmKeyFor, validatePeopleCode } from '../peoplecode/validate.js';

const FIELD = makeKey(DefinitionType.RecordPeopleCode, 'ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange');

test('a program that compiles has no problems, on the release asked for', () => {
  const v = validatePeopleCode('Local number &n = 1;\n', FIELD, '8.62');
  assert.equal(v.profile, 'PT862');
  assert.deepEqual(v.problems, []);
  assert.equal(validatePeopleCode('Local number &n = 1;\n', FIELD, '8.61').profile, 'PT861');
});

test("a compile error is reported where the compiler stopped, with CRLF text counted as the editor's lines", () => {
  // The controlled compile lab's 10-compile-failure, which App Designer refused too.
  const source = 'Local number &n = 1;\r\nLocal string &c = ;\r\n';
  const v = validatePeopleCode(source, FIELD, '8.62');
  assert.equal(v.problems.length, 1);
  assert.match(v.problems[0].message, /expected/);
  assert.deepEqual(lineAndColumn(source.replace(/\r\n/g, '\n'), v.problems[0].offset), { line: 1, column: 18 });
  assert.match(validatePeopleCode('If &x Then\n', FIELD, '8.62').problems[0].message, /End-If/);
});

test("PeopleCode keys map to the compiler's: an Application Class by its depth, the rest by kind", () => {
  assert.deepEqual(pcmKeyFor(makeKey(DefinitionType.ApplicationClassPeopleCode, 'PK', 'SUB1', 'Inner'))?.objectIds, [104, 105, 107, 12, 0, 0, 0]);
  assert.deepEqual(pcmKeyFor(makeKey(DefinitionType.ApplicationClassPeopleCode, 'PK', 'Hello'))?.objectIds, [104, 107, 12, 0, 0, 0, 0]);
  assert.deepEqual(pcmKeyFor(FIELD), { objectIds: [1, 2, 12, 0, 0, 0, 0], objectValues: ['ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange', ' ', ' ', ' ', ' '] });
  assert.deepEqual(validatePeopleCode('class Inner\nend-class;\n', makeKey(DefinitionType.ApplicationClassPeopleCode, 'PK', 'SUB1', 'Inner'), '8.62').problems, []);
  assert.equal(pcmKeyFor(makeKey(DefinitionType.Record, 'JOB')), undefined);
});

test('validation does not depend on the write scope: any program can be checked', () => {
  // A delivered record name, outside any lab prefix: saving it may be refused, compiling it is not.
  assert.deepEqual(validatePeopleCode('Local number &n = 1;\n', makeKey(DefinitionType.RecordPeopleCode, 'JOB', 'EMPLID', 'FieldChange'), '8.62').problems, []);
});

const R2 = makeKey(DefinitionType.RecordPeopleCode, 'ZZ_PCODE_LAB_R2', 'ZZ_PCODE_LAB_MCP1', 'FieldChange');
const R2_FIELDS = ['ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_VAL', 'LASTUPDDTTM', 'ZZ_PCODE_LAB_MCP1'];

test('bare field names of the program\'s record compile, qualified as App Designer stores them (native Validate Syntax, 2026-10-19)', () => {
  const source = 'zz_pcode_lab_val = "A";\nIf ZZ_PCODE_LAB_MCP1 = "Y" Then\n   ZZ_PCODE_LAB_VAL = "B";\nEnd-If;\n';
  const v = validatePeopleCode(source, R2, '8.62', { ownerFields: R2_FIELDS });
  assert.deepEqual(v.qualifications, [
    { offset: 0, length: 16, text: 'ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_VAL' },
    { offset: 27, length: 17, text: 'ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_MCP1' },
    { offset: 59, length: 16, text: 'ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_VAL' }]);
  assert.ok(v.problems.every((p) => p.severity === 'info' && p.code === 'qualify'));
  // Applying them gives text that compiles as it stands.
  let fixed = source;
  for (const q of [...v.qualifications!].reverse()) fixed = fixed.slice(0, q.offset) + q.text + fixed.slice(q.offset + q.length);
  assert.deepEqual(validatePeopleCode(fixed, R2, '8.62', { ownerFields: R2_FIELDS }).problems, []);
});

test('a bare name that is not a field is App Designer\'s 2,17; without the record\'s fields the message says how to fix it', () => {
  const missing = validatePeopleCode('Local string &x = ZZ_NO_SUCH_FLD;\n', R2, '8.62', { ownerFields: R2_FIELDS }).problems;
  assert.deepEqual(missing.map((p) => [p.offset, p.code, p.message]), [[18, 'field-not-defined', 'Field ZZ_PCODE_LAB_R2.ZZ_NO_SUCH_FLD not defined. (2,17)']]);
  assert.match(validatePeopleCode('zz_pcode_lab_val = "A";\n', R2, '8.62').problems[0].message, /write it ZZ_PCODE_LAB_R2\.ZZ_PCODE_LAB_VAL/);
});

test('compiled RECORD.FIELD references are returned for the database check; an undeclared call is App Designer\'s Unknown function', () => {
  const v = validatePeopleCode('ZZ_PCODE_LAB_R2.ZZ_NO_SUCH_FLD = "X";\nZzNoSuchFunc();\n', R2, '8.62', { ownerFields: R2_FIELDS });
  assert.deepEqual(v.fieldReferences, [{ record: 'ZZ_PCODE_LAB_R2', field: 'ZZ_NO_SUCH_FLD', offset: 0 }]);
  assert.deepEqual(v.problems.map((p) => [p.offset, p.code]), [[38, 'unknown-function']]);
  // Built-ins, the program's own functions and methods are known.
  assert.deepEqual(validatePeopleCode('Function Helper()\nEnd-Function;\nHelper();\nMessageBox(0, "", 0, 0, "x");\n', R2, '8.62').problems, []);
});
