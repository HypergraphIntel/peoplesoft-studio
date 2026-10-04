import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 158: a try with no catch clause -- stored `65 try <body> 67
 * end-try 15` (28760 29507 29815 29816 29817).
 */
const tokensOf = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return decoded.tokens.map(t => t.opcode.toString(16));
};

test('try ... end-try with no catch writes 65 <body> 67 15', () => {
  const ops = tokensOf('try\n   &x = 1;\nend-try;\n');
  const at = ops.indexOf('65');
  assert.deepEqual(ops.slice(at), ['65', '1', '6', '50', '15', '67', '15']);
});

test('a blank line before a catch-less end-try is a 0x4F marker (29816)', () => {
  const ops = tokensOf('try\n   &x = 1;\n\nend-try;\n');
  assert.deepEqual(ops.slice(ops.indexOf('67') - 2), ['15', '4f', '67', '15']);
});

test('one and several catch clauses are unchanged (controls)', () => {
  assert.equal(tokensOf('try\n   &x = 1;\ncatch Exception &e\n   &y = 2;\nend-try;\n').filter(o => o === '66').length, 1);
  assert.equal(tokensOf('try\n   &x = 1;\ncatch PKG:A &a\n   &y = 2;\ncatch Exception &e\n   &y = 3;\nend-try;\n').filter(o => o === '66').length, 2);
});

test('a missing end-try still fails', () => {
  assert.throws(() => encodeProgram('try\n   &x = 1;\n'), Error);
});
