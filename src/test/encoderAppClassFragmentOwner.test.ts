import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 147: an Application Class method fragment writes no owner row, so
 * its first record/field-shaped reference must not bind to the (suppressed)
 * owner slot -- in a class with an inherited `%This` call it did, dropping
 * the row (29163 `GetChart(CAF_DISP_WRK.CAF_CHART)`, `IsMenuItemAuthorized(
 * MenuName.COMPARISON_ANALYSIS_FRAMEWORK, BarName.MAIN, ...)`).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const source = `import PKG:Base;

class Demo extends PKG:Base
   method Run();
   method Can() Returns boolean;
end-class;

method Run
   %This.Inherited();
   Local object &chart = GetChart(CAF_DISP_WRK.CAF_CHART);
end-method;

method Can
   /+ Returns Boolean +/
   Return IsMenuItemAuthorized(MenuName.MY_MENU, BarName.MAIN, ItemName.MY_ITEM, Page.MY_PAGE, "U");
end-method;
`;

test('a method fragment\'s first symbolic reference gets its own row (29163)', () => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const symbolic = references.filter(r => r.kind === 'record-field');
  assert.deepEqual(symbolic.map(r => `${r.recordName}.${r.fieldName}`),
    ['CAF_DISP_WRK.CAF_CHART', 'MenuName.MY_MENU', 'BarName.MAIN', 'ItemName.MY_ITEM', 'Page.MY_PAGE']);
  const names = new NameTable();
  references.forEach(r => names.add(r.index + 1, r.kind === 'record-field' ? `${r.recordName}.${r.fieldName}` : r.kind === 'owner' ? '' : `X${r.index}`));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  // each 0x21 operand is its own row's NAMENUM (index + 1)
  assert.deepEqual(decoded.tokens.filter(t => t.opcode === 0x21).map(t => t.nameNum), symbolic.map(r => r.index + 1));
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program);
});

test('without owner context an ordinary program still binds its first record/field to the owner slot (control)', () => {
  const { references } = encodeProgramArtifacts('&x = REC.FLD;\n&y = REC.FLD2;\n');
  assert.deepEqual(references.map(r => `${r.kind}:${r.recordName}.${r.fieldName}`), ['owner:REC.FLD', 'record-field:REC.FLD2']);
});
