import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 163: a `Local` declared inside an ordinary Function body types its
 * variable only until End-Function. Outside, the name has no declared type
 * here, so its bare record / field members stay inline names: 15069 `Local
 * Row &row` in addEntities, then top-level `&row.PSMAPSEC_VW.SELECT_FLAG`
 * (stored `0A PSMAPSEC_VW 0A SELECT_FLAG`); 16962 `&orow` and 27367
 * `&rPersonalData` likewise; 17155 / 25960 lists exact. A top-level Local
 * keeps its type in every Function (control).
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const encode = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'record' ? `RECORD.${r.recordName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'record' || r.kind === 'field').map(r => r.kind === 'record' ? `RECORD.${r.recordName}` : `FIELD.${r.fieldName}`);
};

test('a Function-local Row has no type after End-Function (15069)', () => {
  assert.deepEqual(
    encode('Function AddEntities()\n   Local Row &row;\n   &row = GetRow();\n   &a = &row.INSIDE_REC.F1.Value;\nEnd-Function;\n\n&row = GetRow();\nIf &row.PSMAPSEC_VW.SELECT_FLAG.Value = "Y" Then\n   &x = 1;\nEnd-If;\n'),
    ['RECORD.INSIDE_REC', 'FIELD.F1']
  );
});

test('a top-level Local keeps its type inside a later Function (control)', () => {
  assert.deepEqual(
    encode('Local Row &row;\n\nFunction AddEntities()\n   &a = &row.INSIDE_REC.F1.Value;\nEnd-Function;\n'),
    ['RECORD.INSIDE_REC', 'FIELD.F1']
  );
});
