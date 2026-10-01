import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment } from '../peoplecode/encoder.js';

/*
 * Cycle 113: a block comment's opcode is its placement -- 0x24 when it
 * starts its own source line, 0x4E when anything precedes it on that line
 * -- at every call site. Corpus shapes 523 (after a comment), 5065 (after
 * `try`), 14452 (after a For header), 2809 (own line after an expression).
 */
const commentOpcodes = (source: string): number[] => {
  const bytes = encodeFragment(source);
  const opcodes: number[] = [];
  for (const text of [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map(m => m[0])) {
    const at = bytes.indexOf(Buffer.from(text, 'utf16le'));
    assert.ok(at >= 3, `comment ${text} not encoded`);
    opcodes.push(bytes[at - 3]);
  }
  return opcodes;
};

test('a comment after another comment on the same line is inline (523)', () => {
  assert.deepEqual(commentOpcodes('F();\n/* a */ /* b */\nG();\n'), [0x24, 0x4e]);
});

test('a comment after try on the same line is inline (5065)', () => {
  assert.deepEqual(commentOpcodes('try /* guarded */\n   F();\ncatch Exception &e\nend-try;\n'), [0x4e]);
});

test('a comment that starts its own line is standalone', () => {
  assert.deepEqual(commentOpcodes('F();\n   /* own line */\nG();\n'), [0x24]);
});
