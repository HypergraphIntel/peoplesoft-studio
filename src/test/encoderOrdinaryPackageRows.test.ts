import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 122: ordinary-program PACKAGE rows.
 *   - an Application Class row is identified by its leaf class name within
 *     an allocation unit: a second import of the same leaf (22665, 19155)
 *     or a declaration of another package's class of that leaf (18372)
 *     reuses the row;
 *   - a conditional-compilation block ends the leading unit (4602);
 *   - `Component array of` / `Returns array of` a built-in type need the
 *     element type's row (4470, 14341; 9986, 25290).
 */
const packageRows = (source: string) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'R', fieldName: 'F' }, conditionalCompilation: { toolsRelease: '8.61' } }).references
    .filter(reference => reference.kind === 'package')
    .map(reference => reference.packageName);

test('a second import of the same leaf class opens no row (22665)', () => {
  assert.deepEqual(packageRows('import A:Mgr;\nimport B:Mgr;\nLocal A:Mgr &m;\n&x = 1;\n'), ['MGR']);
});

test('a declaration of another package\'s class with the imported leaf reuses the row (18372)', () => {
  assert.deepEqual(packageRows('import P:Q:Action;\nLocal array of Z:Action &a;\n&x = 1;\n'), ['ACTION']);
});

test('a directive block ends the leading unit: the class is opened again after it (4602)', () => {
  assert.deepEqual(packageRows('import H:Base;\nGlobal H:Base &g;\n&x = 1;\n'), ['BASE']);
  assert.deepEqual(packageRows('import H:Base;\n#If #ToolsRel >= "8.62" #Then\nimport X:Y;\n#End-If;\nGlobal H:Base &g;\n&x = 1;\n'), ['BASE', 'BASE']);
});

test('Component array of / Returns array of a built-in type open its row (4470, 9986)', () => {
  assert.deepEqual(packageRows('Component array of Record &recs;\n&x = 1;\n'), ['RECORD']);
  assert.deepEqual(packageRows('Function F() Returns array of Record\nEnd-Function;\n'), ['RECORD']);
});
