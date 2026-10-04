import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 160: in an Application Class program an `As <Class>` cast opens its
 * class row only when the cast's result receives a method call, as in an
 * ordinary program (Cycle 144). A cast passed as an argument or read for a
 * property stores none: 28797 / 30194 `&coll.InsertItem(&x As
 * PTAI_COLLECTION:Collectable)`, 29615 / 30161 `(&o.Item(&i) As
 * PTAI_ACTION_ITEMS:ContextData).keyValue` (7 / 7 cast-only classes).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const packages = (body: string) => {
  const source = `import PKG:*;\n\nclass Demo\n   method Run();\nend-class;\n\nmethod Run\n${body}\nend-method;\n`;
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : '');
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'package').map(r => r.packageName);
};

test('a cast passed as an argument opens no class row (28797)', () => {
  assert.deepEqual(packages('   &coll.InsertItem(&x As PKG:Collectable);'), ['']);
});

test('a cast read for a property opens no class row (29615)', () => {
  assert.deepEqual(packages('   &k = (&ctx.Item(&i) As PKG:ContextData).keyValue;'), ['']);
});

test('a method call on the cast result still opens the class row (control)', () => {
  assert.deepEqual(packages('   (&o As PKG:Handler).Run();'), ['', 'HANDLER']);
});
