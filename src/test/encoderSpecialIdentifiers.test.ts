import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram, encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 159: `#` / `$` inside identifiers, stored literally in the
 * ordinary name tokens (3430 `Function assign_seq#`, 26680
 * `&$Adfmt_Edittable_sql_fieldvalue`, 28771 `&c_#aliases`, 29825
 * `&pit.ObjectID#0#`).
 */
const tokensOf = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  assert.deepEqual(encodeProgram(decoded.text), program, 'roundtrip');
  return decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);
};

test('a Function definition name may end in # (3430)', () => {
  const tokens = tokensOf('Function assign_seq#\n   &x = 1;\nEnd-Function;\n');
  assert.ok(tokens.includes('a:assign_seq#'));
});

test('variables may contain $ and # (26680, 28771)', () => {
  const tokens = tokensOf('Local string &$Name, &x_#name;\n&$Name = &x_#name;\n');
  assert.ok(tokens.includes('1:&$Name') && tokens.includes('1:&x_#name'));
});

test('a member name may contain # (29825)', () => {
  const tokens = tokensOf('If &pit.ObjectID#0# = 1 Then\n   &x = 1;\nEnd-If;\n');
  assert.ok(tokens.includes('a:ObjectID#0#'));
});

test('a conditional-compilation directive is not an identifier; a leading # is not a variable (controls)', () => {
  const { program } = encodeProgramArtifacts('#If #ToolsRel >= "8.55" #Then\n&x = 1;\n#End-If;\n',
    { conditionalCompilation: { toolsRelease: '8.61' } });
  const names = decodeProgram(program, new NameTable(), { mode: 'auto' }).tokens.filter(t => t.opcode === 0x01).map(t => t.text);
  assert.deepEqual(names, ['&x']);
  assert.throws(() => encodeProgram('&#x = 1;\n'), Error);
});
