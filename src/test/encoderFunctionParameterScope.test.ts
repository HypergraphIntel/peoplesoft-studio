import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 151: ordinary Function parameters and declaration scope.
 */
const owner = { recordName: 'PAY_LINE', fieldName: 'EMPLID' };

const keyOf = (r: any): string => {
  switch (r.kind) {
    case 'scroll': return `SCROLL.${r.recordName}`.toUpperCase();
    case 'record': return `RECORD.${r.recordName}`.toUpperCase();
    case 'package': return `PACKAGE.${r.packageName}`.toUpperCase();
    case 'field': return `FIELD.${r.fieldName}`.toUpperCase();
    default: return `${r.recordName}.${r.fieldName}`.toUpperCase();
  }
};

const encode = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  references.forEach(r => names.add(r.index + 1, keyOf(r)));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  const operands = decoded.tokens
    .filter(t => t.opcode === 0x4a || t.opcode === 0x21)
    .map(t => `${t.opcode.toString(16)} ${names.get(t.nameNum!)} #${t.nameNum}`);
  return { keys: references.map(keyOf), operands };
};

test('an `As array of Record` parameter\'s indexed element member is a FIELD row (16720, 28683)', () => {
  const { keys, operands } = encode(`Function F(&arr As array of Record)
   &x = &arr [1].PTPROPNAME.Value;
End-Function;
`);
  assert.deepEqual(keys, ['PAY_LINE.EMPLID', 'FIELD.PTPROPNAME']);
  assert.deepEqual(operands, ['4a FIELD.PTPROPNAME #2']);
});
