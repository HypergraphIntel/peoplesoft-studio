import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readProgramLayout, encodeSimpleProgramHeader } from '../peoplecode/programLayout.js';

const helpers = import(pathToFileURL(resolve(__dirname, '../../scripts/lib/corpus-validation.mjs')).href);

test('corpus normalization preserves semantic differences and does not erase comments', async () => {
  const { normalizeSource: norm } = await helpers;
  assert.deepEqual(norm('Return  &Foo ;\r\n'), norm('return &foo;'));
  for (const [a, b] of [
    ['Return "a b";', 'Return "ab";'], ['Return "ABC";', 'Return "abc";'],
    ['&a = 1;', '&a = 2;'], ['Return 1;', 'Return 1'],
    ['Return True;', 'Return False;'], ['/* a */ Return 1;', 'Return 1;'],
    ['&a <= &b;', '&a < = &b;'], ['Return 01;', 'Return 1;']
  ]) assert.notDeepEqual(norm(a), norm(b));
  assert.deepEqual(norm('Return "a""b";'), [['word', 'return'], ['string', 'a"b'], ['punctuation', ';']]);
  assert.throws(() => norm('Return "oops'), /Unterminated/);
});

test('corpus binary diagnostics compare section boundaries independently', async () => {
  const { binaryDifference } = await helpers;
  const a = Buffer.concat([encodeSimpleProgramHeader(2), Buffer.from([0x15, 0x07])]);
  const b = Buffer.concat([encodeSimpleProgramHeader(3), Buffer.from([0x38, 0x15, 0x07])]);
  const result = binaryDifference(a, b, readProgramLayout);
  assert.equal(result.firstDifference, 5);
  assert.equal(result.classification, 'statement/body');
  assert.deepEqual(result.sections, ['header', 'statements']);
  assert.equal(binaryDifference(a, a, readProgramLayout).equal, true);
});

test('corpus name comparison checks every raw column and refuses missing model semantics', async () => {
  const { projectNameRows, compareNameRows } = await helpers;
  const key = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap(i => [[`OBJECTID${i}`, 0], [`OBJECTVALUE${i}`, ' ']]));
  const projection = projectNameRows([{ kind: 'owner', sequence: 1, index: 0 }], key);
  assert.equal(compareNameRows(projection.rows, projection).status, 'exact');
  assert.equal(compareNameRows([{ ...projection.rows[0], APPCLASSMETHOD: 'Unexpected' }], projection).status, 'mismatch');
  assert.equal(compareNameRows([{ ...projection.rows[0], OBJECTID7: 12 }], projection).status, 'mismatch');
  assert.equal(compareNameRows([], projection).status, 'mismatch');
  assert.equal(projectNameRows([{ kind: 'package', sequence: 1, index: 0 }], key).status, 'unrepresentable');
});
