import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 114: the empty statement. Each `;` where a statement starts is one
 * statement whose only byte is its 0x15 terminator, in every statement
 * list. Corpus shapes: 17429 (a program that is only `;`), 5061
 * (`... ".pdf";;`), 14641 (`...; /* c *\/;`), 9136 (`Else /* c *\/;`),
 * 3219 (`Function ... Returns boolean;;`), 21969 / 23232 (`Global ...;\n;`).
 */
const hex = (bytes: Buffer) => bytes.toString('hex');

test('a lone ; is one 0x15 (17429)', () => {
  assert.equal(hex(encodeFragment(';')), '15');
});

test('each extra ; after a statement is one more 0x15', () => {
  const one = encodeFragment('F();');
  assert.equal(hex(encodeFragment('F();;')), hex(one) + '15');
  assert.equal(hex(encodeFragment('F();;;')), hex(one) + '1515');
});

test('an empty statement is accepted in an If body, before End-If (29008)', () => {
  const plain = encodeFragment('If &x Then\n   F();\nEnd-If;');
  const empty = encodeFragment('If &x Then\n   F();;\nEnd-If;');
  const end = plain.lastIndexOf(0x1a);
  assert.equal(hex(empty), hex(Buffer.concat([plain.subarray(0, end), Buffer.from([0x15]), plain.subarray(end)])));
});

test('an empty statement can be the first item of a body (9136)', () => {
  const bytes = encodeFragment('If &x Then\n   F();\nElse\n   ;\nEnd-If;');
  const elseAt = bytes.indexOf(0x19);
  assert.equal(bytes[elseAt + 1], 0x15);
});

test('an empty statement after an inline comment follows the comment (14641)', () => {
  const bytes = encodeFragment('If &x Then\n   F(); /* c */;\nEnd-If;');
  const comment = bytes.indexOf(Buffer.from('/* c */', 'utf16le'));
  assert.equal(bytes[comment - 3], 0x4e);
  assert.equal(bytes[comment + Buffer.byteLength('/* c */', 'utf16le')], 0x15);
});

test('an empty statement is a Function body statement (3219)', () => {
  assert.doesNotThrow(() => encodeFragment('Function F()\n   ;\nEnd-Function;'));
  assert.doesNotThrow(() => encodeFragment('While &x\n   ;\nEnd-While;'));
  assert.doesNotThrow(() => encodeFragment('Evaluate &x\nWhen 1\n   ;\nEnd-Evaluate;'));
});

test('a top-level empty statement closes an open declaration section with 0x2D only (21969)', () => {
  // a compiled reference keeps the blank-line marker (Cycle 15 gating); 23232 has references too
  const bytes = encodeFragment('Global string &a;\n;\n\nF(Record.REC);');
  const terminator = bytes.indexOf(0x15);
  assert.equal(hex(bytes.subarray(terminator, terminator + 4)), '152d154f');
});

test('an Application Class method body accepts an empty statement', () => {
  const source = ['class Child', '   method Go();', 'end-class;', '', 'method Go', '   F();;', 'end-method;', ''].join('\n');
  const program = encodeProgramArtifacts(source, { owner: { recordName: 'PKG', fieldName: 'Child', packagePath: ['PKG', 'Child'] } }).program;
  assert.ok(program.includes(Buffer.from([0x14, 0x15, 0x15])));
});
