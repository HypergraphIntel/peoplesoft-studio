import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 167: an Application Class program keeps one PACKAGE row per
 * imported leaf -- a repeated named import reuses the compilation unit's
 * row (29465 one path x3; 28729 `import PTWIDGETS:WidgetFactory;` twice),
 * also when an inherited %This call turns the shared session off.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const packages = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName}.${r.fieldName}`);
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'package').map(r => `${r.index + 1}:${r.packageName}`);
};
const program = (imports: string[], body: string) => [
  ...imports,
  '',
  'class Demo extends PKG:Base',
  '   method Demo();',
  'end-class;',
  '',
  'method Demo',
  `   ${body}`,
  'end-method;',
  ''
].join('\n');

test('a repeated named import opens no second row (29465)', () => {
  const source = program(['import PKG:Factory;', 'import PKG:Frame;', 'import PKG:Factory;'], 'Local PKG:Factory &f = create PKG:Factory();');
  assert.deepEqual(packages(source), ['2:FACTORY', '3:FRAME', '4:BASE']);
});

test('a repeated named import opens no second row with an inherited %This call (28729)', () => {
  const source = program(['import PKG:Base;', 'import PKG:Factory;', 'import PKG:Factory;'], '%This.Inherited();');
  const rows = packages(source);
  assert.equal(rows.filter(r => r.endsWith(':FACTORY')).length, 1);
});

test('different leaves each keep their row (control)', () => {
  const source = program(['import PKG:Factory;', 'import PKG:Frame;'], '&x = 1;');
  assert.deepEqual(packages(source), ['2:FACTORY', '3:FRAME', '4:BASE']);
});
