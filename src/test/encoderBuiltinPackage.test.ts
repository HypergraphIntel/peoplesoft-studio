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

/*
 * Built-in row LIFETIME: one row per type per built-in unit (see the
 * encoder's `builtinUnit`). Each case is a corpus shape. The first two were
 * wrong under the control-group pool it replaces; the Function-run cases
 * document the rule (the old pool happened to agree on these shapes); the
 * controls must not move.
 */
for (const [name, source, expected] of [
  ['each Function body statement is its own unit (10263)',
    'Function F()\n   Local Record &a;\n   Local Record &b;\n   &a = Null;\nEnd-Function;\n', ['RECORD', 'RECORD']],
  ['a bare declaration after an initialized one opens again (the section closed)',
    'Local Rowset &a = GetLevel0();\nLocal Rowset &b;\n&b = Null;\n', ['ROWSET', 'ROWSET']],
  ['a Function header joins the open run before it',
    'Local Rowset &rs;\nFunction F(&r As Rowset)\n   &r = Null;\nEnd-Function;\n&rs = Null;\n', ['ROWSET']],
  ['a Function definition starts a new run: declarations after it do not share with its header',
    'Function F(&r As Rowset)\n   &r = Null;\nEnd-Function;\nLocal Rowset &rs;\n&rs = Null;\n', ['ROWSET', 'ROWSET']],
  ['declarations after a Function share their own run (13627)',
    'Function F()\n   F2();\nEnd-Function;\nLocal ApiObject &a;\nLocal ApiObject &b;\n&a = Null;\n', ['APIOBJECT']],
  ['control: bare top-level leading declarations share one row (802)',
    'Local SQL &a;\nLocal SQL &b;\nLocal SQL &c;\n&a = Null;\n', ['SQL']],
  ['control: consecutive initialized top-level declarations open one each (22515)',
    'Local SQL &a = GetSQL(SQL.ONE);\nLocal SQL &b = GetSQL(SQL.TWO);\n', ['SQL', 'SQL']],
  ['control: initialized declarations in one control structure share (19565)',
    'If True Then\n   Local Rowset &a = GetLevel0();\n   Local Rowset &b = GetLevel0();\nEnd-If;\n', ['ROWSET']]
] as const) {
  test(`built-in row lifetime: ${name}`, () => {
    assert.deepEqual(packageRows(source), expected);
  });
}

test('a PanelGroup built-in declaration allocates its row like Component (959, 3618)', () => {
  assert.deepEqual(packageRows('PanelGroup Message &msg;\n&msg = Null;\n'), ['MESSAGE']);
});

test('a PanelGroup declaration shares the leading run with the declarations after it', () => {
  assert.deepEqual(packageRows('PanelGroup Record &a;\nLocal Record &b;\n&a = Null;\n'), ['RECORD']);
});
