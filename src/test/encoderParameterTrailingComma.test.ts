import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 159: a Function parameter list may end with a comma (14727
 * `Function SetIndentImg(&iLvl As integer,)`, stored `40 integer 03 14`);
 * the comma is written and no parameter follows.
 */
test('a trailing comma in a parameter list is kept, with one parameter', () => {
  const source = 'Function SetIndentImg(&iLvl As integer,) Returns string\n   Return "x";\nEnd-Function;\n';
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  assert.deepEqual(encodeProgram(decoded.text), program, 'roundtrip');
  const ops = decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
  const at = ops.indexOf('40:integer');
  assert.deepEqual(ops.slice(at, at + 3), ['40:integer', '3:,', '14:)']);
  // a comma with nothing before it is still rejected
  assert.throws(() => encodeProgram('Function F(,)\nEnd-Function;\n'), Error);
});
