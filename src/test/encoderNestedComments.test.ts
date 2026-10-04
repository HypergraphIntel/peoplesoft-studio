import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 157: `<* ... *>` is one 0x55 comment token whose delimiters nest
 * (2201 / 24079 / 24918 `<* ... <* ... *> ... *>`).
 */
const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return decoded.tokens;
};

test('a statement-level <* *> comment is one 0x55 token', () => {
  const tokens = roundtrips('&a = 1;\n<* simple comment *>\n&b = 2;\n');
  const comments = tokens.filter(t => t.opcode === 0x55);
  assert.deepEqual(comments.map(t => t.text), ['<* simple comment *>']);
});

test('nested <* <* *> *> is ONE 0x55 token carrying the whole raw text (2201)', () => {
  const nested = '<* outer\n   <* inner; End-If; When "X" *>\n   outer < 1 *>';
  const tokens = roundtrips(`&a = 1;\n${nested}\n&b = 2;\n`);
  const comments = tokens.filter(t => t.opcode === 0x55);
  assert.deepEqual(comments.map(t => t.text), [nested]);
  // the keywords, `;` and `<` inside it never reach the parser
  assert.deepEqual(tokens.filter(t => t.opcode === 0x01).map(t => t.text), ['&a', '&b']);
});

test('an unterminated <* comment, nested or not, does not encode', () => {
  for (const source of ['&a = 1;\n<* never closed\n', '&a = 1;\n<* outer <* inner *> still open\n']) {
    assert.throws(() => encodeProgram(source), Error, source);
  }
});

test('a <* *> comment is a body item of While, Repeat, try and catch bodies (2867, 15537)', () => {
  for (const source of [
    'While &i < 3\n   <* disabled; *>\n   &i = &i + 1;\nEnd-While;\n',
    'Repeat\n   <* disabled; *>\n   &i = &i + 1;\nUntil &i > 3;\n',
    'try\n   <* disabled; *>\n   &x = F();\ncatch Exception &c1\n   <* No need to display a message *>\nend-try;\n'
  ]) {
    const tokens = roundtrips(source);
    assert.ok(tokens.some(t => t.opcode === 0x55), source);
  }
});
