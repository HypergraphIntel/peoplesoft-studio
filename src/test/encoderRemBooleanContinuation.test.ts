import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 156: a REM between a boolean operator and its right operand is a
 * 0x24 comment carrying its own `;`; the expression continues after it
 * (16592 `... And` / `rem All(...) And ;` / `&Group... <> ...`).
 */
const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
};

test('a REM after And continues the condition (16592)', () => {
  const tokens = roundtrips('If &a = "Y" And\n      rem All(&b) And ;\n      &c <> &d Then\n   &x = 1;\nEnd-If;\n');
  const rem = tokens.findIndex(t => t.startsWith('24:'));
  assert.equal(tokens[rem - 1], '18:And');
  assert.equal(tokens[rem], '24:rem All(&b) And ;');
  assert.equal(tokens[rem + 1], '1:&c');
  // the REM's own `;` is not a statement terminator
  assert.equal(tokens.slice(0, tokens.indexOf('1f:Then')).filter(t => t === '15:;').length, 0);
});

test('a REM after Or continues the condition (28753 `rem, ...;`)', () => {
  const tokens = roundtrips('If &a = 1 Or\n      rem, add row level merge case;\n      &b = 2 Then\n   &x = 1;\nEnd-If;\n');
  const rem = tokens.findIndex(t => t.startsWith('24:'));
  assert.deepEqual([tokens[rem - 1], tokens[rem + 1]], ['1e:Or', '1:&b']);
});
