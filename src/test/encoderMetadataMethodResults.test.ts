import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 168: a call whose result the type metadata declares `Row` or
 * `Record` on another class is that value, as an own `%This` result
 * (Cycle 160) or a Row / Record property is: a Row's bare member is a
 * RECORD row (28981 `&cDataController.GetCurrentPgmDefRow()
 * .W3EB_PGM_PLN_VW.DFLT_CREDIT_IND.Value`), a Record's a FIELD row
 * (29452 / 29479); an intrinsic member (`.Name`) stays inline.
 */
const provider = createApplicationClassTypeMetadataProvider([
  { path: ['PKG', 'Ctl'], source: 'class Ctl\n   method GetDefRow() Returns Row;\n   method GetDefRec() Returns Record;\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const rows = (statement: string) => {
  const source = `import PKG:Ctl;\n\nclass Demo\n   method Run();\nend-class;\n\nComponent PKG:Ctl &c;\n\nmethod Run\n   ${statement}\nend-method;\n`;
  const context = { owner, applicationClassTypeMetadata: provider };
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName ?? ''}.${r.fieldName ?? ''}`.replace(/\.$/, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, context).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'record' || r.kind === 'field').map(r => `${r.kind}:${r.recordName ?? ''}.${r.fieldName ?? ''}`);
};

test('a Row-returning metadata method result: its bare member is a RECORD row (28981)', () => {
  assert.deepEqual(rows('&x = &c.GetDefRow().REC_A.FLD_A.Value;'), ['record:REC_A.', 'field:.FLD_A']);
});

test('a Record-returning metadata method result: its bare member is a FIELD row (29452)', () => {
  assert.deepEqual(rows('&x = &c.GetDefRec().FLD_B.Value;'), ['field:.FLD_B']);
});

test('an intrinsic member of a Record result stays inline (control)', () => {
  assert.deepEqual(rows('&x = &c.GetDefRec().Name;'), []);
});
