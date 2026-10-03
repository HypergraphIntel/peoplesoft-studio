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

test('a cast opens its class row only for a method call on the result (22493, 24988)', () => {
  const { program, references } = encodeProgramArtifacts(
    'Local PKG:Svc &s = create PKG:Svc();\n(&s.Get() As PKG:Item).Run();\n&x = (&s.Get() As PKG:Thing).Name;\n&r = CreateRecord(Record.PSOPRDEFN);\n',
    { owner }
  );
  assert.deepEqual(keys(references), ['PACKAGE.SVC', 'PACKAGE.SVC', 'PACKAGE.ITEM', 'PACKAGE.SVC', 'RECORD.PSOPRDEFN']);
  assert.ok(recordOperandMatchesRow(program, references));
});
