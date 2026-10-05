import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 170: comments inside an App Class header method's parameter list
 * are tokens where they stand (28818), as in an ordinary Function's
 * (Cycle 159): before a parameter, after its type, after a trailing comma.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const encode = (signature: string) => {
  const source = `class Demo\n   method Run${signature};\nend-class;\n\nmethod Run\n   &x = 1;\nend-method;\n`;
  const { program } = encodeProgramArtifacts(source, { owner });
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  return program;
};
const comment = (text: string) => {
  const payload = Buffer.from(text, 'utf16le');
  return Buffer.concat([Buffer.from([0x4e, payload.length & 0xff, payload.length >> 8]), payload]);
};

test('a comment before a header parameter is written before its name (28818)', () => {
  const program = encode('(&a As string, /* id */&b As string)');
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x03]), comment('/* id */'), Buffer.from([0x01])])));
});

test('a comment after the last parameter type precedes the closing parenthesis', () => {
  const program = encode('(&a As string /* flag */)');
  assert.ok(program.includes(Buffer.concat([comment('/* flag */'), Buffer.from([0x14])])));
});

test('a comment after a trailing comma precedes the closing parenthesis', () => {
  const program = encode('(&a As string, /* flag */)');
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x03]), comment('/* flag */'), Buffer.from([0x14])])));
});

test('a parameter list without comments is unchanged (control)', () => {
  assert.ok(!encode('(&a As string, &b As string)').includes(Buffer.from([0x4e])));
});
