import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 101: 92 Application Classes whose direct source encode was already
 * byte-exact failed decode -> re-encode by exactly one 0x4F blank-line marker.
 * The directory, names and slots always matched; only the decoder's text
 * layout around two tokens was wrong:
 *
 *   - `private` / `protected` (0x61 / 0x73) did not end their own line, so the
 *     blank line stored under them (`4f 61 4f`, e.g. 28769) was lost;
 *   - `end-get` / `end-set` (0x6a / 0x6b) were missing from the declaration
 *     closers whose `15 2d 4f` already implies the blank line, so the next
 *     implementation got two blank lines (e.g. 28716, 29086) -- the same bug
 *     Cycle 79 fixed for `end-method`.
 *
 * Synthetic class and member names; the byte shapes are the corpus ones.
 */
const owner = { recordName: 'PKG', fieldName: 'Widget', packagePath: ['PKG', 'Widget'] };

function roundTrip(source: string): { bytes: Buffer; text: string; again: Buffer } {
  const bytes = encodeProgram(source, { owner });
  const text = decodeProgram(bytes, new NameTable(), { mode: 'auto', isApplicationClass: true }).text;
  return { bytes, text, again: encodeProgram(text, { owner }) };
}

for (const section of ['private', 'protected']) {
  test(`a blank line after \`${section}\` survives decode -> re-encode`, () => {
    const member = section === 'private' ? 'instance number &n;' : 'property number Size;';
    const { bytes, text, again } = roundTrip(
      `class Widget\n   method Widget();\n\n${section}\n\n   ${member}\nend-class;\n\nmethod Widget\nend-method;\n`);
    assert.equal(bytes.includes(Buffer.from([0x4f, section === 'private' ? 0x61 : 0x73, 0x4f])), true);
    assert.match(text, new RegExp(`\\n  ${section}\\n\\n  ${member.split(' ')[0]}`));
    assert.deepEqual(again, bytes);
  });
}

test('`private` with no blank line under it still renders on a line of its own', () => {
  const { text, again, bytes } = roundTrip(
    'class Widget\n   method Widget();\nprivate\n   instance number &n;\nend-class;\n\nmethod Widget\nend-method;\n');
  assert.match(text, /\n  private\n  instance number &n;\n/);
  assert.deepEqual(again, bytes);
});

test('`end-get;` / `end-set;` followed by a blank line do not decode with two', () => {
  const { bytes, text, again } = roundTrip(
    'class Widget\n   property number Size get set;\n   property number Count get;\nend-class;\n\n' +
    'get Size\n   /+ Returns Number +/\n   Return 1;\nend-get;\n\n' +
    'set Size\n   /+ &NewValue as Number +/\nend-set;\n\n' +
    'get Count\n   /+ Returns Number +/\n   Return 2;\nend-get;\n');
  assert.equal(bytes.includes(Buffer.from([0x6a, 0x15, 0x2d, 0x4f])), true);
  assert.equal(bytes.includes(Buffer.from([0x6b, 0x15, 0x2d, 0x4f])), true);
  assert.doesNotMatch(text, /\n\n\n/);
  assert.deepEqual(again, bytes);
});
