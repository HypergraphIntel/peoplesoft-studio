import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment } from '../peoplecode/encoder.js';

/*
 * Cycle 113: a statement inside a When body keeps one 0x4F per blank line
 * before it (the general blank-line rule), not a single marker. 5208 /
 * 5373: `End-If;` + two blank lines + `If ...` inside a When stores
 * `1A 15 4F 4F 1C`.
 */
const markersBefore = (source: string, name: string): number => {
  const bytes = encodeFragment(source);
  let at = bytes.indexOf(Buffer.from(name, 'utf16le')) - 1;
  let markers = 0;
  while (bytes[--at] === 0x4f) markers++;
  return markers;
};

test('two blank lines before a When-body statement are two markers (5373)', () => {
  const source = 'Evaluate &x\nWhen 1\n   F();\n\n\n   &second = 2;\nEnd-Evaluate;\n';
  assert.equal(markersBefore(source, '&second'), 2);
});

test('one blank line before a When-body statement is one marker', () => {
  const source = 'Evaluate &x\nWhen 1\n   F();\n\n   &second = 2;\nEnd-Evaluate;\n';
  assert.equal(markersBefore(source, '&second'), 1);
});

test('two blank lines before End-Evaluate are two markers (6956)', () => {
  const bytes = encodeFragment('Evaluate &x\nWhen 1\n   F();\n\n\nEnd-Evaluate;\n');
  let at = bytes.indexOf(0x3f) - 1;
  let markers = 0;
  while (bytes[at--] === 0x4f) markers++;
  assert.equal(markers, 2);
});
