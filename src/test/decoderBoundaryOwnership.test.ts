import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 102: the last 10 ROUNDTRIP_ONLY definitions encoded byte-exact from
 * source but re-encoded their decoded text with one extra 0x4F right after a
 * stored `2d 4f`: the 0x2D boundary's own line ending was rendered although
 * something before it already owned that line ending.
 *
 * Synthetic names; the byte shapes are the corpus ones.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };

function roundTrip(source: string): { bytes: Buffer; text: string; again: Buffer } {
  const bytes = encodeProgram(source, { owner });
  const decoded = decodeProgram(bytes, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  return { bytes, text: decoded.text, again: encodeProgram(decoded.text, { owner, commentOpcodes }) };
}

test('a ComponentLife declaration section closes like Component: `15 2d 4f` is one blank line', () => {
  // 2202, 3948, 16496, 18387: `ComponentLife boolean &b;\n\n<statement>`.
  const { bytes, text, again } = roundTrip('ComponentLife boolean &bReady;\n\n&bReady = True;\n');
  assert.equal(bytes.includes(Buffer.from([0x15, 0x2d, 0x4f])), true);
  assert.equal(text, 'ComponentLife boolean &bReady;\n\n&bReady = True;\n');
  assert.deepEqual(again, bytes);
});

test('a comment directly before a declaration\'s `;` does not hide the declaration from its boundary', () => {
  // 18580: `Component string &a, ... /*, &x*/;` + blank line stores `4e 15 2d 4f`.
  const { bytes, text, again } = roundTrip('Component string &sA, &sB /*, &sC*/;\n\n/* next section */\n&sA = "X";\n');
  assert.equal(bytes.includes(Buffer.from([0x15, 0x2d, 0x4f, 0x24])), true);
  assert.doesNotMatch(text, /\n\n\n/);
  assert.deepEqual(again, bytes);
});

test('the same declaration without the comment was already one blank line (control)', () => {
  const { text, again, bytes } = roundTrip('Component string &sA, &sB;\n\n/* next section */\n&sA = "X";\n');
  assert.equal(text, 'Component string &sA, &sB;\n\n/* next section */\n&sA = "X";\n');
  assert.deepEqual(again, bytes);
});
