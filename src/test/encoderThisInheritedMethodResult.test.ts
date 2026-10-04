import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 168: `%This.<method>(...)` is typed by the class's metadata, which
 * walks its ancestors: an inherited method's class result is the receiver
 * of the next call, which opens its class row (29465
 * `(%This.getDataObject()).save(...)` stores ABSTMPLDATA.SAVE).
 */
const demo = 'import PKG:Base;\n\nclass Demo extends PKG:Base\n   method Run();\nend-class;\n\nmethod Run\n   %This.GetData().Save();\nend-method;\n';
const classes = [
  { path: ['PKG', 'Base'], source: 'class Base\n   method GetData() Returns PKG:Data;\nend-class;\n' },
  { path: ['PKG', 'Data'], source: 'class Data\n   method Save();\nend-class;\n' }
];
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const packages = (definitions: typeof classes) => {
  const provider = createApplicationClassTypeMetadataProvider([...definitions, { path: ['APP', 'Demo'], source: demo }], { isBuiltinType: isBuiltinObjectTypeName });
  const context = { owner, applicationClassTypeMetadata: provider };
  const { program, references } = encodeProgramArtifacts(demo, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, context).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'package').map(r => r.packageName);
};

test('an inherited %This method result receiving a call opens its class row (29465)', () => {
  assert.ok(packages(classes).includes('DATA'));
});

test('without the superclass metadata the result stays untyped (control)', () => {
  assert.ok(!packages([]).includes('DATA'));
});
