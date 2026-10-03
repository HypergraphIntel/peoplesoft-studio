import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram, encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 153: a subscript holds one or more comma-separated indexes --
 * `&a [i, j]` is ONE subscript, stored `4C <i> 03 <j> 4D` (4101
 * `&sAdmnAtchmtRole = &Attachment_Array [1, 1];`).
 */
const tokensOf = (program: Buffer) =>
  decodeProgram(program, new NameTable(), { mode: 'auto' }).tokens
    .map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);

const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  assert.deepEqual(encodeProgram(decoded.text), program, 'roundtrip');
  return { program, text: decoded.text };
};

test('&a [1, 1] is one subscript with the 0x03 comma (4101)', () => {
  const { program, text } = roundtrips('&r = &Attachment_Array [1, 1];\n');
  assert.deepEqual(tokensOf(program).slice(3, 9), ['1:&Attachment_Array', '4c:[', '50:1', '3:,', '50:1', '4d:]']);
  assert.match(text, /&Attachment_Array \[1, 1\]/);
});

test('variable indexes, an assignment target and a nested call comma', () => {
  const { program } = roundtrips('&a [&i, &j] = F(1, 2);\n&x = &a [F(1, 2), &j];\n');
  const tokens = tokensOf(program);
  const second = tokens.indexOf('4c:[', tokens.indexOf('4c:[') + 1);
  // F(1, 2) keeps its own comma inside the first index; one subscript comma follows it
  assert.deepEqual(tokens.slice(second, second + 10), ['4c:[', 'a:F', 'b:(', '50:1', '3:,', '50:2', '14:)', '3:,', '1:&j', '4d:]']);
});

test('the postfix chain continues after a multi-index subscript', () => {
  roundtrips('&n = &a [1, 2].Len;\nIf &a [&i, 2] = "X" Then\n   &b = &a [&i, 1];\nEnd-If;\n');
});

test('whitespace variants encode the same subscript', () => {
  const tight = tokensOf(encodeProgram('&x = &a[1,1];\n'));
  const spaced = tokensOf(encodeProgram('&x = &a [1, 1];\n'));
  assert.deepEqual(tight.filter(t => /^(4c|4d|3|50)/.test(t)), spaced.filter(t => /^(4c|4d|3|50)/.test(t)));
});

test('malformed subscripts do not encode', () => {
  for (const source of ['&x = &a [, 1];\n', '&x = &a [1, ];\n', '&x = &a [1, , 2];\n', '&x = &a [1 2];\n']) {
    assert.throws(() => encodeProgram(source), Error, source);
  }
});

test('an App Class method body uses the same subscript grammar (28872)', () => {
  const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
  const { program } = encodeProgramArtifacts(`class Demo
   method Run();
end-class;

method Run
   Local array of array of string &arrAttCfgs;
   Local integer &i;
   &s = &arrAttCfgs [&i, 3];
end-method;
`, { owner });
  const tokens = decodeProgram(program, new NameTable(), { mode: 'auto', isApplicationClass: true }).tokens
    .map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
  const at = tokens.indexOf('4c:[');
  assert.deepEqual(tokens.slice(at, at + 5), ['4c:[', '1:&i', '3:,', '50:3', '4d:]']);
});
