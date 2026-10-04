import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 164: a `<*` disabled comment is never a `<` comparison (Cycle 157),
 * also when the Cycle 154 lookahead skips a block comment to find what
 * continues an expression. 17155:
 *
 *   While &MYSQL2.Fetch(..., &rtngtype)
 *      /*** Check for the &sendernode and &receivernode ***\/
 *      <** ANY to LOCAL not considered as valid any more **>
 *
 * stores `14 2D 24 55` -- the condition's 2D, then the own-line comment --
 * as every While followed by an own-line comment does (871, 1295, 3547,
 * 4404); the lookahead had taken `<**` for `<` and pulled the comment in
 * before the 2D. A real comparison after a comment still continues the
 * expression (Cycle 154 control).
 */
const ops = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return decoded.tokens.map(t => t.opcode.toString(16).padStart(2, '0'));
};

test('a comment then <* *> after a While condition follows the condition boundary (17155)', () => {
  const tokens = ops('While &S.Fetch(&a, &b)\n   /*** Check ***/\n   <** disabled **>\n   &x = 1;\nEnd-While;\n');
  const at = tokens.indexOf('2d');
  assert.equal(tokens.slice(at - 1, at + 3).join(' '), '14 2d 24 55');
});

test('a comparison after a comment still continues the condition (control)', () => {
  const tokens = ops('If &a /* c */ < &b Then\n   &x = 1;\nEnd-If;\n');
  const at = tokens.indexOf('4e');
  assert.equal(tokens.slice(at - 1, at + 3).join(' '), '01 4e 0d 01');
});
