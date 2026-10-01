import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 111: the source events that open an Application Class PACKAGE
 * row in an ORDINARY program (Cycle 94 allocation units). Synthetic
 * classes; corpus shapes 15800 / 2116 (Function headers) and 10567 /
 * 14134 (catch).
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const rows = (source: string): string[] =>
  encodeProgramArtifacts(source, { owner }).references
    .filter(reference => reference.kind === 'package' && reference.packageName)
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName}` : ''}`);

test('a later Function header is its own unit: its class parameter opens a row before the next parameter (15800)', () => {
  const source = [
    'Function First(&p As PKG:Widget)',
    '   &p.Ping();',
    'End-Function;',
    '',
    'Function Second(&q As PKG:Widget, &f As Field)',
    '   &q.Ping();',
    'End-Function;',
    ''
  ].join('\n');
  assert.deepEqual(rows(source), ['WIDGET', 'WIDGET.PING', 'WIDGET', 'FIELD', 'WIDGET.PING']);
});

test('the first Function header stays in the leading unit: an imported class is reused there (14356)', () => {
  const source = 'import PKG:Widget;\n\nFunction First(&p As PKG:Widget)\n   &p.Ping();\nEnd-Function;\n';
  assert.deepEqual(rows(source), ['WIDGET', 'WIDGET.PING']);
});

test('a Returns class uses its class in the header unit, like a parameter (2116)', () => {
  const source = [
    'Function First()',
    '   Local number &n = 1;',
    'End-Function;',
    '',
    'Function Second() Returns PKG:Widget',
    '   Return Null;',
    'End-Function;',
    ''
  ].join('\n');
  assert.deepEqual(rows(source), ['WIDGET']);
});

test('a catch variable is a receiver: a method call on it opens the class row, the clause itself none (10567, 14134)', () => {
  const called = 'try\n   F();\ncatch PKG:Oops &ex\n   &ex.Output();\nend-try;\n';
  const silent = 'try\n   F();\ncatch PKG:Oops &ex\nend-try;\n';
  assert.deepEqual(rows(called), ['OOPS.OUTPUT']);
  assert.deepEqual(rows(silent), []);
});
