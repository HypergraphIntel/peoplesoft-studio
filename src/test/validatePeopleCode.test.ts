import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { lineAndColumn, pcmKeyFor, validatePeopleCode } from '../peoplecode/validate.js';

const FIELD = makeKey(DefinitionType.RecordPeopleCode, 'ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange');

test('a program that compiles has no problems, on the release asked for', () => {
  assert.deepEqual(validatePeopleCode('Local number &n = 1;\n', FIELD, '8.62'), { profile: 'PT862', problems: [] });
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
