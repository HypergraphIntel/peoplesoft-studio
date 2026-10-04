import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 158: `**` is one operator token, 0x46 (14531 `(16**&nPower)`,
 * 16585 `(2**17)`, 25484 `(10**32)`). The corpus only has parenthesized
 * `a ** b`; precedence and associativity are not asserted.
 */
const tokensOf = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  assert.deepEqual(encodeProgram(decoded.text), program, 'roundtrip');
  // PeopleTools writes `**` with no space on either side
  assert.match(decoded.text, /\(16\*\*&p\)|\(2\*\*17\)/);
  return decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
};

test('(a ** b) writes a single 0x46 between its operands (14531, 16585)', () => {
  const tokens = tokensOf('&x = &n * (16**&p);\n&i = Int(&u / (2**17));\n');
  const first = tokens.findIndex(t => t.startsWith('46'));
  assert.deepEqual(tokens.slice(first - 1, first + 2), ['50:16', '46:**', '1:&p']);
  assert.equal(tokens.filter(t => t.startsWith('46')).length, 2);
  // never split into two multiplications
  assert.equal(tokens.filter(t => t.startsWith('f:')).length, 1);
});
