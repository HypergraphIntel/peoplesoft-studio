import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 169: a value of a class extending the built-in Rowset is a Rowset
 * (29245 `%This.GetRow(&I).DERIVED_CO.DESCR`, 29244
 * `%This.rsData.GetRow(n).PERSON_ADDRESS.ADDRESS_TYPE` through a property
 * of that class): `.GetRow(n)` is a Row whose bare member is a RECORD row.
 */
const classSource = (name: string, base: string, body: string, header = '') =>
  `class ${name}${base}\n   method Run();\n${header}end-class;\n\nmethod Run\n   ${body}\nend-method;\n`;
const rows = (path: string[], source: string, others: { path: string[]; source: string }[]) => {
  const provider = createApplicationClassTypeMetadataProvider([...others, { path, source }], { isBuiltinType: isBuiltinObjectTypeName });
  const context = { owner: { recordName: path[0], fieldName: path[1], packagePath: path }, applicationClassTypeMetadata: provider };
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName ?? ''}.${r.fieldName ?? ''}`.replace(/\.$/, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, context).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'record' || r.kind === 'field').map(r => `${r.kind}:${r.recordName ?? ''}${r.fieldName ?? ''}`);
};
const body = '&x = %This.GetRow(1).REC_A.FLD_A.Value;';

test('%This in a class extending Rowset is a Rowset: GetRow(n).REC.FIELD rows (29245)', () => {
  assert.deepEqual(rows(['PKG', 'Coll'], classSource('Coll', ' extends Rowset', body), []), ['record:REC_A', 'field:FLD_A']);
});

test('a property typed with a Rowset subclass is a Rowset (29244)', () => {
  const coll = { path: ['PKG', 'Coll'], source: 'class Coll extends Rowset\nend-class;\n' };
  const source = `import PKG:Coll;\n\n${classSource('Ctl', '', '&x = %This.rs.GetRow(1).REC_A.FLD_A.Value;', '   property PKG:Coll rs;\n')}`;
  assert.deepEqual(rows(['PKG', 'Ctl'], source, [coll]), ['record:REC_A', 'field:FLD_A']);
});

test('%This in a plain App Class stays an App Class value (control)', () => {
  assert.deepEqual(rows(['PKG', 'Plain'], classSource('Plain', '', body), []), []);
});
