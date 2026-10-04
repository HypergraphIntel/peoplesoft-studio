import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 112: an ordinary program whose rows depend on external class
 * metadata (a method call through a property of unknown type, Cycle 93)
 * keeps the allocation-unit model. Cycle 167: its wildcard imports no
 * longer differ -- the first one claims the blank row, as in every program
 * (each claiming one was 13525's compensation for rows of WCS classes the
 * snapshot lacked; the captured metadata now types them).
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const encode = (source: string) => {
  let fallback = false;
  const references = encodeProgramArtifacts(source, { owner, onExternalMetadataFallback: () => { fallback = true; } }).references
    .filter(reference => reference.kind === 'package')
    .map(reference => `${reference.packageName ?? ''}${reference.methodName ? `.${reference.methodName}` : ''}`);
  return { fallback, references };
};

const program = (tail: string) => [
  'import PKG:*;',
  'import OTHER:*;',
  '',
  'Local PKG:Widget &w;',
  '',
  '&w = create PKG:Widget();',
  tail,
  ''
].join('\n');

test('a program with an unresolvable chain keeps its declaration rows; the first wildcard import claims the blank row', () => {
  const { fallback, references } = encode(program('&w.Partner.Ping();'));
  assert.equal(fallback, true);
  assert.deepEqual(references, ['', 'WIDGET', 'WIDGET']);
});

test('control: without the unresolvable chain one blank row is claimed, and the rows are otherwise the same', () => {
  const { fallback, references } = encode(program('&w.Ping();'));
  assert.equal(fallback, false);
  assert.deepEqual(references, ['', 'WIDGET', 'WIDGET', 'WIDGET.PING']);
});
