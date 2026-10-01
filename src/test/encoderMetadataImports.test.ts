import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 106: imports rooted at `%metadata` contribute no PSPCMNAME row and
 * do not take the "first wildcard claims the metadata row" claim; ordinary
 * imports keep theirs. Synthetic class names; corpus shapes (16084, 17911,
 * 28726).
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const packageRows = (source: string): string[] =>
  encodeProgramArtifacts(source, { owner }).references
    .filter(reference => reference.kind === 'package')
    .map(reference => reference.packageName ? reference.packageName : `*${(reference.packagePath ?? []).join(':')}`);

test('a named %metadata import has no row; the class gets one at its declaration (16084)', () => {
  assert.deepEqual(
    packageRows('import %metadata:MacroDefn:Macro;\nLocal %metadata:MacroDefn:Macro &m;\n&m = Null;\n'),
    ['MACRO']
  );
  assert.deepEqual(
    packageRows('import %metadata:MacroDefn:Macro;\n&n = 1;\n'),
    []
  );
});

test('a %metadata wildcard import has no blank metadata row (28726)', () => {
  assert.deepEqual(packageRows('import %metadata:*;\nimport %metadata:RecordDefn:*;\n&n = 1;\n'), []);
});

test('a %metadata wildcard does not take the first-wildcard claim: the first ordinary wildcard does (17911)', () => {
  assert.deepEqual(packageRows('import %metadata:*;\nimport PROJECT:*;\nimport ADSM:*;\n&n = 1;\n'), ['*PROJECT']);
});

test('ordinary imports keep their rows (control)', () => {
  assert.deepEqual(packageRows('import PKG:Widget;\nimport ROOT:*;\nimport OTHER:*;\n&n = 1;\n'), ['WIDGET', '*ROOT']);
});
