import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, type EncodeProgramContext } from '../peoplecode/encoder.js';

/*
 * Cycle 108: in an Application Class PROGRAM a class has one PACKAGE row
 * for the whole program (`ApplicationClassProgramRows`): the first
 * occurrence that needs the class opens it -- a type or a method call --
 * and every later one reuses it, in any method body, statement or control
 * structure, whatever method it calls. Corpus shapes 29983 (a Local inside
 * an `If`, two calls, one row) and 29422 (two classes named Utils, one
 * row).
 */
const encode = (source: string, className: string, extra: Partial<EncodeProgramContext> = {}) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: className, packagePath: ['APP', className] }, ...extra });
const rows = (source: string, className: string, extra: Partial<EncodeProgramContext> = {}) =>
  encode(source, className, extra).references
    .filter(reference => reference.kind === 'package' && reference.packageName)
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName}` : ''}`);

test('a Local inside a control structure uses its class row at the declaration; later calls reuse it', () => {
  const source = [
    'class Kid',
    '   method Run();',
    'end-class;',
    '',
    'method Run',
    '   If %Date > %Date Then',
    '      Local PKG:Widget &w = %This.Make();',
    '      &w.Ping();',
    '      &w.Ping();',
    '   End-If;',
    'end-method;',
    ''
  ].join('\n');
  assert.deepEqual(rows(source, 'Kid').filter(row => row.startsWith('WIDGET')), ['WIDGET']);
});

test('two classes with one name share the row (the stored identity is the class name)', () => {
  const source = [
    'import CAR:Utils;',
    'class Kid',
    '   method Run();',
    'end-class;',
    '',
    'method Run',
    '   Local WFS:Utils &u = create WFS:Utils();',
    '   &u.Go();',
    'end-method;',
    ''
  ].join('\n');
  assert.deepEqual(rows(source, 'Kid').filter(row => row.startsWith('UTILS')), ['UTILS']);
});
