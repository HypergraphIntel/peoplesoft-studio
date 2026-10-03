import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 154: a block comment inside an expression -- between an operand and
 * the operator / comma / assignment `=` that continues it, or right after an
 * operator / comma -- is an inline 0x4E comment at its source position.
 */
const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  const tokens = decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
  return { tokens, text: decoded.text };
};

const around = (tokens: string[], at: string, before: number, after: number) => {
  const i = tokens.indexOf(at);
  return tokens.slice(i - before, i + after);
};

test('a comment before a comparison operator (If &a /* c */ < &b)', () => {
  const { tokens, text } = roundtrips('If &a /* c */ < &b Then\n   &x = 1;\nEnd-If;\n');
  assert.deepEqual(around(tokens, '4e:/* c */', 1, 3), ['1:&a', '4e:/* c */', 'd:<', '1:&b']);
  assert.match(text, /\/\* c \*\//);
});

test('a comment after a multi-index subscript, before the operator (25951)', () => {
  const { tokens } = roundtrips('If &a [1, 2] /* CONCEPT Amount */ < 0 Then\n   &x = 1;\nEnd-If;\n');
  assert.deepEqual(around(tokens, '4e:/* CONCEPT Amount */', 1, 2), ['4d:]', '4e:/* CONCEPT Amount */', 'd:<']);
});

test('arithmetic, assignment and call-argument comments (5047, 25953, 5004, 29654)', () => {
  const { tokens } = roundtrips('&n = 10 /*last*/ + &i;\n&a [1, 2] /*TT30*/ = 1;\n&r = F(&x /*one*/, /*two*/&y);\n');
  assert.deepEqual(around(tokens, '4e:/*last*/', 1, 2), ['50:10', '4e:/*last*/', '13:+']);
  assert.deepEqual(around(tokens, '4e:/*TT30*/', 1, 2), ['4d:]', '4e:/*TT30*/', '6:=']);
  assert.deepEqual(around(tokens, '4e:/*one*/', 1, 2), ['1:&x', '4e:/*one*/', '3:,']);
  assert.deepEqual(around(tokens, '4e:/*two*/', 1, 2), ['3:,', '4e:/*two*/', '1:&y']);
});

test('a comment after an operator, before its operand (25951 `| /*...*/`)', () => {
  const { tokens } = roundtrips('&s = "a" | /*b*/ "c";\n');
  assert.deepEqual(around(tokens, '4e:/*b*/', 1, 2), ['23:|', '4e:/*b*/', '16:"c"']);
});

test('a comment ending a statement is still a statement boundary', () => {
  const { tokens } = roundtrips('&a = 1 /* end */;\n&b = 2;\n');
  assert.deepEqual(around(tokens, '4e:/* end */', 1, 2), ['50:1', '4e:/* end */', '15:;']);
});
