import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 104: Application Class method-dependency rows for receivers the
 * encoder did not track. Cycle 94 rule: a use of a class reuses its row in
 * the current allocation unit or opens one; a row a method call opens
 * carries the method name. Synthetic class names; corpus shapes.
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const classRows = (source: string): string[] =>
  encodeProgramArtifacts(source, { owner }).references
    .filter(reference => reference.kind === 'package')
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName.toUpperCase()}` : ''}`);

test('a ComponentLife receiver opens a method row per top-level unit, like Component (2200, 18375)', () => {
  const body = '&s.Clear();\n&s.Run();\n';
  assert.deepEqual(
    classRows(`import PKG:Search;\nComponentLife PKG:Search &s;\n${body}`),
    ['SEARCH', 'SEARCH.CLEAR', 'SEARCH.RUN']
  );
  assert.deepEqual(
    classRows(`import PKG:Search;\nComponent PKG:Search &s;\n${body}`),
    ['SEARCH', 'SEARCH.CLEAR', 'SEARCH.RUN']
  );
});

test('two calls on a ComponentLife receiver in one control structure share one row', () => {
  assert.deepEqual(
    classRows('import PKG:Search;\nComponentLife PKG:Search &s;\nIf True Then\n   &s.Clear();\n   &s.Run();\nEnd-If;\n'),
    ['SEARCH', 'SEARCH.CLEAR']
  );
});
