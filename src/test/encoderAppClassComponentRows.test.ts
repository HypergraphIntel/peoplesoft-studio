import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 162: an Application Class program has one COMPONENT row per name
 * (121 stored App Class COMPONENT rows, none repeated): a repeated
 * `Component.X` -- in another control group of the same method or in
 * another method -- reuses it (28850 `%Component = Component.BAS_STATMNTS_FL`
 * twice, 29516 / 29535 / 29618 / 29625). Ordinary programs keep the
 * control-group rows (stored 2 or more rows for 127 repeated names).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const encode = (source: string, context: any) => {
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'component' ? `COMPONENT.${r.objectName}` : r.kind === 'owner' ? '' : `${r.recordName}.${r.fieldName}`);
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: context.owner?.packagePath !== undefined });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { ...context, commentOpcodes }).program, program, 'roundtrip');
  return {
    rows: references.filter(r => r.kind === 'component').map(r => `${r.index + 1}:${r.objectName}`),
    operands: decoded.tokens.filter(t => t.opcode === 0x21).map(t => t.nameNum)
  };
};

test('a repeated Component.X in later control groups and methods reuses one App Class row (28850)', () => {
  const { rows, operands } = encode([
    'class Demo',
    '   method Run();',
    '   method Other();',
    'end-class;',
    '',
    'method Run',
    '   Local boolean &b = (%Component = Component.BAS_STATMNTS_FL);',
    '   If %Component = Component.BAS_STATMNTS_FL Then',
    '      &b = True;',
    '   End-If;',
    'end-method;',
    '',
    'method Other',
    '   If %Component = Component.BAS_STATMNTS_FL Or',
    '         %Component = Component.OTHER_CMP Then',
    '      &x = 1;',
    '   End-If;',
    'end-method;',
    ''
  ].join('\n'), { owner });
  assert.deepEqual(rows, ['2:BAS_STATMNTS_FL', '3:OTHER_CMP']);
  assert.deepEqual(operands, [2, 2, 2, 3]);
});

test('an ordinary program reopens the row in a later control group (control)', () => {
  const { rows } = encode('If %Component = Component.ABS_CMP Then\n   &x = 1;\nEnd-If;\nIf %Component = Component.ABS_CMP Then\n   &x = 2;\nEnd-If;\n', { owner: { recordName: 'OWN_REC', fieldName: 'OWN_FLD' } });
  assert.deepEqual(rows, ['2:ABS_CMP', '3:ABS_CMP']);
});
