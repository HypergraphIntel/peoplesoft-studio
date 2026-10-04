import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 168: `(<chain>).Next` continues the chain inside the parentheses
 * -- value type and Application Class receiver carry over (29945
 * `(&row.GetRowset(1)).GetRow(1).GetRecord(1).PTADSRELNAME`, 29465
 * `(%This.getDataObject()).save(...)`).
 */
const provider = createApplicationClassTypeMetadataProvider([
  { path: ['PKG', 'Ctl'], source: 'class Ctl\n   method GetData() Returns PKG:Data;\nend-class;\n' },
  { path: ['PKG', 'Data'], source: 'class Data\n   method Save();\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const rows = (statement: string) => {
  const source = `import PKG:Ctl;\n\nclass Demo\n   method Run(&row As Row);\nend-class;\n\nComponent PKG:Ctl &c;\n\nmethod Run\n   /+ &row as Row +/\n   ${statement}\nend-method;\n`;
  const context = { owner, applicationClassTypeMetadata: provider };
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName ?? ''}.${r.fieldName ?? ''}`.replace(/\.$/, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, context).program, program, 'roundtrip');
  return references.filter(r => r.kind !== 'owner').map(r => r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.kind}:${r.recordName ?? ''}.${r.fieldName ?? ''}`);
};

test('a parenthesized Row chain keeps its type: the same rows as without the parentheses (29945)', () => {
  const plain = rows('&x = &row.GetRowset(1).GetRow(1).GetRecord(1).FLD_A.Value;');
  assert.ok(plain.includes('field:.FLD_A'));
  assert.deepEqual(rows('&x = (&row.GetRowset(1)).GetRow(1).GetRecord(1).FLD_A.Value;'), plain);
});

test('a parenthesized class result receiving a call opens its class row (29465)', () => {
  assert.ok(rows('(&c.GetData()).Save();').includes('PACKAGE.DATA'));
});
