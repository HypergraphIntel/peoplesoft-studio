import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 159: inline block comments inside a Local declaration and a
 * Function parameter list are 0x4E comments at their source position
 * (25960, 14854).
 */
const tokensOf = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
};
const around = (tokens: string[], at: string) => { const i = tokens.indexOf(at); return [tokens[i - 1], tokens[i], tokens[i + 1]]; };

test('a comment between a declaration type and its variable (25960 `Local array of date /*...*/&X`)', () => {
  const tokens = tokensOf('Local array of date /*&Old, */&X;\n');
  assert.deepEqual(around(tokens, '4e:/*&Old, */'), ['40:date', '4e:/*&Old, */', '1:&X']);
});

test('comments after a comma and before the ; of a declaration list (25960)', () => {
  const tokens = tokensOf('Local string &A, /*&B, */&C /*, &D*/;\n');
  assert.deepEqual(around(tokens, '4e:/*&B, */'), ['3:,', '4e:/*&B, */', '1:&C']);
  assert.deepEqual(around(tokens, '4e:/*, &D*/'), ['1:&C', '4e:/*, &D*/', '15:;']);
});

test('a comment after a Function parameter type, before ) (14854)', () => {
  const tokens = tokensOf('Function F(&c As boolean, &op As boolean /*True is for addition, and False*/)\n   &x = 1;\nEnd-Function;\n');
  assert.deepEqual(around(tokens, '4e:/*True is for addition, and False*/'), ['40:boolean', '4e:/*True is for addition, and False*/', '14:)']);
});
