import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram, encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 160: `FreeFormStyleName` is a Row property: off a Row value it is
 * written inline (`0A FreeFormStyleName`) and opens no RECORD row -- 28936
 * `&row_plan_sum.FreeFormStyleName = " "`, 16495 `&pageScroll(
 * CurrentRowNumber()).FreeFormStyleName = "psc_force-hidden"`, 28872. No
 * stored list in the corpus has a RECORD or FIELD row of that name.
 */
const keyOf = (r: any): string =>
  r.kind === 'record' ? `RECORD.${r.recordName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`;
const encodeAndRoundtrip = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'owner' ? '' : keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  return { references: references.map(keyOf), decoded };
};

test('a Row value\'s FreeFormStyleName stays inline and opens no RECORD row (28936)', () => {
  const { references, decoded } = encodeAndRoundtrip('Local Row &r;\n&r = GetRow();\n&r.FreeFormStyleName = " ";\n&x = &r.FreeFormStyleName;\n');
  assert.ok(!references.includes('RECORD.FreeFormStyleName'), references.join(' '));
  assert.ok(decoded.tokens.some(t => t.opcode === 0x0a && t.text === 'FreeFormStyleName'));
});

test('an indexed Rowset (a Row) keeps FreeFormStyleName inline (16495)', () => {
  const { references } = encodeAndRoundtrip('Local Rowset &rs;\n&rs = GetLevel0();\n&rs(1).FreeFormStyleName = "psc_force-hidden";\n');
  assert.ok(!references.includes('RECORD.FreeFormStyleName'), references.join(' '));
});

test('a Row value\'s record member is still a RECORD row (control)', () => {
  const { references } = encodeAndRoundtrip('Local Row &r;\n&r = GetRow();\n&x = &r.MY_REC.MY_FIELD.Value;\n&r.MY_REC.MY_FIELD.FreeFormStyleName = "a";\n');
  assert.ok(references.includes('RECORD.MY_REC'), references.join(' '));
  assert.ok(references.includes('FIELD.MY_FIELD'), references.join(' '));
});
