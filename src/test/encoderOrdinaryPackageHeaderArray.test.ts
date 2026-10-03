import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 144: ordinary PACKAGE rows for casts and array-typed Function
 * headers. A cast uses its class row only when its parenthesized result
 * receives a method call (22493 `(... As GPS_EDITFUNCTIONS:StaffingContent)
 * .dtlSaveEdit();`); a property of the result (24988 `(... As
 * PTAI_ACTION_ITEMS:ContextData).ctxKey`) or a bare cast stores none. A
 * Function header's `As array of <Class>` / `Returns array of <Class>` uses
 * the class in the header's unit like the scalar form (15070, 14641).
 */
const owner = { recordName: 'R', fieldName: 'F' };
const keys = (references: readonly any[]) => references
  .filter(r => r.kind === 'package' || r.kind === 'record')
  .map(r => r.kind === 'package' ? `PACKAGE.${r.packageName}` : `RECORD.${r.recordName}`);
const recordOperandMatchesRow = (program: Buffer, references: readonly any[]) => {
  const index = references.findIndex(r => r.kind === 'record');
  return program.includes(Buffer.from([0x21, index & 0xff, index >> 8]));
};

test('a later Function header\'s array-of class parameter and return type open their rows (15070, 14641)', () => {
  const { program, references } = encodeProgramArtifacts(
    'Function First(&i As PKG:Item)\nEnd-Function;\n\nFunction Second(&a As array of PKG:Item) Returns array of PKG:Thing\n   Local Record &r = CreateRecord(Record.PSOPRDEFN);\nEnd-Function;\n',
    { owner }
  );
  // the first header shares the leading unit; the second opens its own rows
  assert.deepEqual(keys(references), ['PACKAGE.ITEM', 'PACKAGE.ITEM', 'PACKAGE.THING', 'PACKAGE.RECORD', 'RECORD.PSOPRDEFN']);
  assert.ok(recordOperandMatchesRow(program, references));
});
