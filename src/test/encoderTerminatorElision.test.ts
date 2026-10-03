import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 154: statements stored without a terminator before a block keyword,
 * and comments between a statement and its `;`.
 */
const tokensOf = (program: Buffer) =>
  decodeProgram(program, new NameTable(), { mode: 'auto' }).tokens
    .map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);

const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  // the harness roundtrip: the stored comment opcodes travel with the text
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return tokensOf(program);
};

const around = (tokens: string[], at: string, before: number, after: number) => {
  const i = tokens.indexOf(at);
  return tokens.slice(i - before, i + after);
};

test('a bare Return before End-If takes no value and writes no terminator (826)', () => {
  const tokens = roundtrips('If &a = 7 Then\n   Return\nEnd-If;\n&b = 1;\n');
  assert.deepEqual(around(tokens, '38:Return', 0, 3), ['38:Return', '1a:End-If', '15:;']);
});

test('the last try-body statement may omit ; before catch (14149, 30159)', () => {
  const tokens = roundtrips('try\n   &x.SetDefault()\ncatch Exception &e\n   &y = 1;\nend-try;\n');
  assert.deepEqual(around(tokens, '66:catch', 2, 1), ['b:(', '14:)', '66:catch']);
});

test('an Else-body statement may omit ; before a REM line (29622)', () => {
  const tokens = roundtrips('If &a Then\n   &b = 1;\nElse\n   MessageBox(0, "", 0, 0, &m)\n   rem Warning;\nEnd-If;\n');
  const rem = tokens.findIndex(t => t.startsWith('24:'));
  assert.deepEqual([tokens[rem - 1], tokens[rem + 1]], ['14:)', '1a:End-If']);
});

test('a comment between a When-body statement and its ; is an inline 0x4E (28868)', () => {
  const tokens = roundtrips('Evaluate &t\nWhen "OE"\n   &d = F(1) /* note */;\n   Break;\nEnd-Evaluate;\n');
  assert.deepEqual(around(tokens, '4e:/* note */', 1, 2), ['14:)', '4e:/* note */', '15:;']);
});

test('a comment between a For-body statement and its ; is an inline 0x4E (5047)', () => {
  const tokens = roundtrips('For &i = 1 To 2\n   &d = F(1) /* note */;\nEnd-For;\n');
  assert.deepEqual(around(tokens, '4e:/* note */', 1, 2), ['14:)', '4e:/* note */', '15:;']);
});

test('a missing ; before an ordinary statement still fails', () => {
  for (const source of [
    'If &a Then\n   &x = 1\n   &y = 2;\nEnd-If;\n',
    'try\n   &x = 1\n   &y = 2;\ncatch Exception &e\nend-try;\n',
    'If &a Then\n   Return\n   &y = 2;\nEnd-If;\n'
  ]) {
    assert.throws(() => encodeProgram(source), Error, source);
  }
});
