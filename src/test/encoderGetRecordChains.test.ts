import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 146: two bare-`GetRecord()` chain shapes bind RECORD / FIELD rows.
 * (1) `.ParentRow.ParentRowset...GetRow(n).REC.FIELD`: `ParentRowset` is an
 * inline Row property but keeps the navigation's binding (22705 stores
 * RECORD.GPS_WFS_FLD_VW, FIELD.GPS_WFS_RPT_FLD). (2) A single member that
 * ends the chain is a FIELD (22705 `GetRecord().GPS_WFS_MAP_RESULT` as an
 * argument) unless it is a Record property (`Name`, `IsChanged`: inline).
 */
const owner = { recordName: 'R', fieldName: '' };
const encode = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const keys = references.filter(r => r.kind !== 'owner').map(r => `${r.kind}:${(r as any).recordName ?? ''}.${(r as any).fieldName ?? ''}`);
  return { program, references, keys };
};
const operand = (index: number) => Buffer.from([0x4a, index & 0xff, index >> 8]);

test('a ParentRow / ParentRowset navigation chain keeps its binding through GetRow (22705)', () => {
  const { program, references, keys } = encode('&s = GetRecord().ParentRow.ParentRowset.ParentRowset.GetRow(CurrentRowNumber(1)).REC.FLD.Value;\n');
  assert.deepEqual(keys, ['record:REC.', 'field:.FLD']);
  for (const reference of references.filter(r => r.kind !== 'owner')) assert.ok(program.includes(operand(reference.index)));
});

test('a single field member after a bare GetRecord() is a FIELD reference; Record properties stay inline (22705)', () => {
  const { program, references, keys } = encode('X(&a, GetRecord().MAP_RESULT, &b);\nIf GetRecord().IsChanged Then\n   &n = GetRecord().Name;\nEnd-If;\n');
  assert.deepEqual(keys, ['field:.MAP_RESULT']);
  assert.ok(program.includes(operand(references.find(r => r.kind === 'field')!.index)));
  assert.ok(program.includes(Buffer.concat([Buffer.from([0x0a]), Buffer.from('IsChanged\0', 'utf16le')])));
});
