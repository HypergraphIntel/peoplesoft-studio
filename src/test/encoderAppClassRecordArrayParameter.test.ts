import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 161: an Application Class method parameter `As array of Record` is
 * a record array in its body, like an ordinary Function parameter (Cycle
 * 151, 21 / 21): an indexed element's bare member is a FIELD row (29303
 * `&StgRec [&RI].PROCESS_INSTANCE.Value`, 29333; 4 / 4 sites), while its
 * Record properties (`.Name`, `.IsChanged`) stay inline.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const keyOf = (r: any) => r.kind === 'owner' ? '' : r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : `${r.recordName}.${r.fieldName}`;
const encode = (body: string[]) => {
  const source = ['class Demo', '   method Run(&StgRec As array of Record);', 'end-class;', '', 'method Run', ...body.map(line => `   ${line}`), 'end-method;', ''].join('\n');
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  const operands = decoded.tokens.filter(t => t.opcode === 0x21 || t.opcode === 0x4a).map(t => t.nameNum);
  return { rows: references.filter(r => r.kind !== 'owner').map(r => `${r.index + 1}:${keyOf(r)}`), operands };
};

test('an indexed array-of-Record parameter element\'s member is a FIELD row (29303)', () => {
  const { rows, operands } = encode(['&StgRec [&RI].PROCESS_INSTANCE.Value = &p;', '&StgRec [&RI].PROCESS_INSTANCE.Value = &q;']);
  // the header's array-of-Record dependency (Cycle 52) comes first
  assert.deepEqual(rows, ['2:PACKAGE.RECORD', '3:FIELD.PROCESS_INSTANCE']);
  assert.deepEqual(operands.filter(n => n === 3).length, 2);
});

test('Record properties of an element stay inline (control)', () => {
  const { rows } = encode(['&n = &StgRec [&RI].Name;', 'If &StgRec [&RI].IsChanged Then', '   &x = 1;', 'End-If;']);
  assert.ok(!rows.some(r => r.includes('FIELD.')), rows.join(' '));
});
