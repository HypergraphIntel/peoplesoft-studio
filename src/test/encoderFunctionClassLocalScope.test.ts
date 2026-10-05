import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 169: a Local of an Application Class type declared inside an
 * ordinary Function types its variable only until End-Function (as Cycle
 * 163's Record / Row / Rowset Locals). 15528: `&prim` is a
 * PT_SCHEMA:LogicalSchemaPrimitive in one Function, `Local Primitive &PRIM`
 * in another -- the second Function's calls open no class row.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const packages = (secondLocal: string) => {
  const source = `Function A()\n   Local PKG:Cls &x;\n   &x.Run();\nEnd-Function;\n\nFunction B()\n   ${secondLocal}\n   &X.Run();\nEnd-Function;\n`;
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'package').map(r => `${r.packageName}${r.methodName ? `.${r.methodName}` : ''}`);
};

test('a class-typed Local ends at End-Function: a same-name built-in Local elsewhere is not that class (15528)', () => {
  assert.deepEqual(packages('Local Primitive &X;'), ['CLS', 'CLS.RUN', 'PRIMITIVE']);
});

test('a class-typed Local in each Function types each (control)', () => {
  assert.deepEqual(packages('Local PKG:Cls &X;'), ['CLS', 'CLS.RUN', 'CLS', 'CLS.RUN']);
});
