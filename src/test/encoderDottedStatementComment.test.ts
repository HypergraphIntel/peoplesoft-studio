import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram, encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 159: a comment between a dotted method-call statement and its `;`
 * is an inline 0x4E (28936 `BEN_RPANEL_WRK.GROUPBOX.AddFFClass("ps_hidden")
 * /* Bug 30912657 *\/;` -> `14 4E 15`).
 */
test('REC.FIELD.Method(...) /* comment */; writes 14 4E 15', () => {
  const source = 'REC_WRK.GROUPBOX.AddFFClass("ps_hidden") /* Bug 30912657 */;\n&x = 1;\n';
  const { program, references } = encodeProgramArtifacts(source);
  const names = new NameTable();
  for (const r of references as any[]) names.add(r.index + 1, `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgram(decoded.text, { commentOpcodes }), program, 'roundtrip');
  const ops = decoded.tokens.map(t => t.opcode.toString(16));
  const at = ops.indexOf('4e');
  assert.deepEqual(ops.slice(at - 1, at + 2), ['14', '4e', '15']);
});
