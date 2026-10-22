import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { formatPeopleCode } from '../peoplecode/formatProgram.js';

// Application Designer's layout, calibrated on the HCDEV snapshot's stored text (tools/lab/peoplecode-format-corpus.mts);
// these programs are written for the test, not taken from it.
const FIELD = makeKey(DefinitionType.RecordPeopleCode, 'ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange');
const format = (source: string, key = FIELD) => {
  const result = formatPeopleCode(source, key, '8.62');
  assert.ok('text' in result, 'refused' in result ? result.refused : '');
  return result.text;
};

test('blocks indent three spaces, keywords and definition keywords take App Designer casing, a blank line keeps its block indent', () => {
  assert.equal(format('if %Component=component.ZZ_COMP then\nlocal rowset &rs=CreateRowset(record.ZZ_PCODE_LAB);\n\n&rs.Flush();\nend-if;\n'),
    'If %Component = Component.ZZ_COMP Then\n   Local rowset &rs = CreateRowset(Record.ZZ_PCODE_LAB);\n   \n   &rs.Flush();\nEnd-If;\n');
});

test('wrapped statements: two levels under a block header, one under anything else, And after Or and parentheses deeper', () => {
  assert.equal(format('If ZZ_PCODE_LAB.ZZ_A = "1" Or\nZZ_PCODE_LAB.ZZ_B = "2" And\nZZ_PCODE_LAB.ZZ_C = "3" Or\n(ZZ_PCODE_LAB.ZZ_D = "4" And\n'
    + 'ZZ_PCODE_LAB.ZZ_E = "5") Then\n&x = 1;\nEnd-If;\n&y = (&a = 1 Or\n&b = 2);\nRepeat\n&n = &n + 1;\nUntil &n > 3 Or\n&done;\n'),
  'If ZZ_PCODE_LAB.ZZ_A = "1" Or\n      ZZ_PCODE_LAB.ZZ_B = "2" And\n         ZZ_PCODE_LAB.ZZ_C = "3" Or\n      (ZZ_PCODE_LAB.ZZ_D = "4" And\n'
    + '         ZZ_PCODE_LAB.ZZ_E = "5") Then\n   &x = 1;\nEnd-If;\n&y = (&a = 1 Or\n   &b = 2);\nRepeat\n   &n = &n + 1;\nUntil &n > 3 Or\n   &done;\n');
});

test("App Designer's spacing: a keyword or unary minus after (, create tight, Exit (n)", () => {
  assert.equal(format('If (Not &x) Then\nAllowEmplIdChg(True);\n&o = CreateArrayRept(create ZZ_PK:Thing(), 0);\n&v = &v * (-1);\nExit(1);\nEnd-If;\n'),
    'If ( Not &x) Then\n   AllowEmplIdChg( True);\n   &o = CreateArrayRept(create ZZ_PK:Thing(), 0);\n   &v = &v * ( - 1);\n   Exit (1);\nEnd-If;\n');
});

test("a class's private section header sits at the class line's level", () => {
  assert.equal(format('class Thing\nmethod Thing();\nprivate\ninstance string &s;\nend-class;\n\nmethod Thing\n&s = "x";\nend-method;\n',
    makeKey(DefinitionType.ApplicationClassPeopleCode, 'ZZ_PK', 'Thing')),
  'class Thing\n   method Thing();\nprivate\n   instance string &s;\nend-class;\n\nmethod Thing\n   &s = "x";\nend-method;\n');
});

test('the source keeps its quoted-name spelling, line endings and final newline; what does not compile is refused', () => {
  const quoted = 'TriggerBusinessEvent(BusProcess."Administer Workforce", BusActivity."Maintain Data", BusEvent."Change State");\n';
  assert.equal(format(quoted), quoted);
  assert.equal(format('if &a=1 then\r\n&b=2;\r\nend-if;'), 'If &a = 1 Then\r\n   &b = 2;\r\nEnd-If;');
  assert.equal(format('&a = 1;\n\n\n'), '&a = 1;\n\n\n');
  const broken = formatPeopleCode('If &x Then\n', FIELD, '8.62');
  assert.ok('refused' in broken && /does not compile/.test(broken.refused));
  assert.ok('refused' in formatPeopleCode('&a = 1;\n', makeKey(DefinitionType.Record, 'JOB'), '8.62'));
});

test('formatting is a fixed point: formatted text formats to itself', () => {
  const once = format('If &a=1 Or\n&b=2 Then\nIf &c Then\n&d=(&e Or\n&f);\nEnd-If;\nEnd-If;\n');
  assert.equal(format(once), once);
});
