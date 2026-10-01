import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 103: built-in object types and their PACKAGE dependency rows in
 * ordinary programs. Synthetic variable names; the declaration shapes and
 * the stored rows they need are the corpus ones.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const packageRows = (source: string): string[] =>
  encodeProgramArtifacts(source, { owner }).references
    .filter(reference => reference.kind === 'package')
    .map(reference => reference.packageName ?? '');

for (const [source, expected, evidence] of [
  ['Local Page &pg;\n&pg = GetPage(Page.MY_PAGE);\n', ['PAGE'], 'Page 20/20'],
  ['Local JsonParser &parser;\n&parser = CreateJsonParser();\n', ['JSONPARSER'], 'JsonParser 9/9'],
  ['Component CubeCollection &cubes;\n&cubes = Null;\n', ['CUBECOLLECTION'], 'CubeCollection component 7/7'],
  ['Global SQL &sql;\n&sql = Null;\n', ['SQL'], 'SQL global 7/7'],
  ['Local array of Message &msgs;\n&msgs = Null;\n', ['MESSAGE'], 'Message array element (17111)'],
  ['Function F(&node As XmlNode)\n   &node = Null;\nEnd-Function;\n', ['XMLNODE'], 'XmlNode parameter (25289)']
] as const) {
  test(`a built-in ${expected[0]} declaration allocates its PACKAGE row: ${evidence}`, () => {
    assert.deepEqual(packageRows(source), expected);
  });
}

test('a type written with a package path is an Application Class, not a registry built-in', () => {
  const rows = encodeProgramArtifacts('import MY_PKG:Page;\nLocal MY_PKG:Page &pg;\n&pg = Null;\n', { owner }).references
    .filter(reference => reference.kind === 'package');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].packageName, 'PAGE');
  assert.notEqual((rows[0] as { packagePath?: string[] }).packagePath, undefined);
});
