import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 169: in an App Class's region between end-class and the first
 * method, a Declare Function may end at its line's end without `;`: its
 * own 0x42 closes it, no 0x15 follows, and its row is written (29293
 * stores `... 40 "FieldFormula" 42 2D ...` and the GPFR_AF_PACKAGE row).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const encode = (terminator: string) => encodeProgramArtifacts(
  `class Demo\n   method Run();\nend-class;\n\nDeclare Function F PeopleCode A_REC.B_FLD FieldFormula${terminator}\n\nmethod Run\n   F();\nend-method;\n`,
  { owner }
);
const afterEvent = (program: Buffer) => {
  const event = program.indexOf(Buffer.from('FieldFormula', 'utf16le'));
  assert.ok(event > 0);
  return [...program.subarray(event + 26, event + 28)];
};

test('an unterminated Declare Function writes 0x42 and no 0x15, and keeps its row (29293)', () => {
  const { program, references } = encode('');
  assert.deepEqual(afterEvent(program), [0x42, 0x2d]);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.match(decoded.text, /FieldFormula\n\nmethod/);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  assert.ok(references.some(r => r.kind === 'declare-function' && r.recordName === 'A_REC'));
});

test('a terminated Declare Function keeps its 0x15 (control)', () => {
  const { program, references } = encode(';');
  assert.deepEqual(afterEvent(program), [0x42, 0x15]);
  assert.ok(references.some(r => r.kind === 'declare-function' && r.recordName === 'A_REC'));
});
