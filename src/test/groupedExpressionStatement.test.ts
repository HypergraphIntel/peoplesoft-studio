import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';

/*
 * Cycle 116: a statement may start with a grouped (parenthesized)
 * expression continued by a postfix chain. Corpus shapes: 5857 / 18410
 * `(create PKG:Class()).Method(...);` (56 of 74), 22491 `(&o.m() As
 * PKG:Class).Method();`, 25294 `(&rs.GetRow(1).GetRecord(1)).CopyFieldsTo(
 * &rec);`, 14328 `(Record.X).GetField(...).Value = ...;`, 5854 the same
 * call statement unterminated at EOF.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const encode = (source: string) => encodeProgramArtifacts(source, { owner });
const body = (program: Buffer) => program.subarray(program.indexOf(0x0b));

test('a grouped create statement writes the expression bytes of the group and its postfix chain (5857)', () => {
  const statement = encode('(create PKG:Cls()).Run();\n');
  const assigned = encode('&y = (create PKG:Cls()).Run();\n');
  // `0B 69 <class path> 0B 14 14 05 0A "Run" 0B 14 15`: no grouping opcode
  assert.deepEqual(body(statement.program), body(assigned.program));
  assert.equal(body(statement.program).subarray(0, 2).toString('hex'), '0b69');
  assert.deepEqual(statement.references.map(r => r.kind), assigned.references.map(r => r.kind));
});

test('a grouped create with constructor and method arguments (18410 shape)', () => {
  const statement = encode('(create PKG:Cls(&a)).Run(&b);\n');
  const assigned = encode('&y = (create PKG:Cls(&a)).Run(&b);\n');
  assert.deepEqual(body(statement.program), body(assigned.program));
});

test('a grouped method result continues its postfix chain (25294)', () => {
  const statement = encode('(&r.GetRow(1)).CopyFieldsTo(&rec);\n');
  assert.ok(statement.program.includes(Buffer.from('CopyFieldsTo', 'utf16le')));
});

test('a grouped call statement may omit its ; at EOF (5854)', () => {
  const program = encode('(create PKG:Cls()).Run()\n').program;
  // `Run()` closes with `0B 14`; no 0x15 before the end-of-program 0x07
  assert.equal(program.subarray(-3).toString('hex'), '0b1407');
});

test('a group with no postfix step is not a statement (no corpus evidence)', () => {
  assert.throws(() => encode('(&a);\n'), UnsupportedPeopleCodeError);
});
