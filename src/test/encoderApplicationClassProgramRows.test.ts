import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName, type EncodeProgramContext } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';

/*
 * Cycle 108: in an Application Class PROGRAM a class has one PACKAGE row
 * for the whole program (`ApplicationClassProgramRows`): the first
 * occurrence that needs the class opens it -- a type or a method call --
 * and every later one reuses it, in any method body, statement or control
 * structure, whatever method it calls. Synthetic classes; corpus shapes
 * 28927 (`%Super.TxtCat.getSimpleTextPlan(...)` eighteen times, one
 * TEXTCATALOG row), 30130 (a `create` after a call), 29983 (a Local inside
 * an `If`), 29422 (two classes named Utils, one row).
 */
const child = (body: string) => [
  'import PKG:Parent;',
  '',
  'class Child extends PKG:Parent',
  '   method Child();',
  '   method First();',
  '   method Second();',
  'end-class;',
  '',
  'method Child',
  '   %Super = create PKG:Parent();',
  'end-method;',
  '',
  body,
  ''
].join('\n');

const sources = {
  first: [
    'method First',
    '   Local string &a = %Super.TxtCat.GetText("A");',
    '   If &a = "" Then',
    '      &a = %Super.TxtCat.GetText("B");',
    '   End-If;',
    'end-method;',
    '',
    'method Second',
    '   Local string &b = %Super.TxtCat.GetOther("C");',
    '   %Super.Route.BuildSteps();',
    '   Local PKG:Path &p = create PKG:Path();',
    'end-method;'
  ].join('\n')
};

const provider = createApplicationClassTypeMetadataProvider([
  { path: ['PKG', 'Parent'], source: 'class Parent\n   property PKG:TextCatalog TxtCat;\n   property PKG:Path Route;\nend-class;\n' },
  { path: ['PKG', 'TextCatalog'], source: 'class TextCatalog\n   method GetText(&id As string) Returns string;\n   method GetOther(&id As string) Returns string;\nend-class;\n' },
  { path: ['PKG', 'Path'], source: 'class Path\n   method BuildSteps();\nend-class;\n' },
  { path: ['PKG', 'Widget'], source: 'class Widget\n   method Ping();\nend-class;\n' },
  { path: ['APP', 'Child'], source: child(sources.first) },
  { path: ['APP', 'Kid'], source: 'import PKG:Parent;\nclass Kid extends PKG:Parent\n   method Run();\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });

const encode = (source: string, className: string, extra: Partial<EncodeProgramContext> = {}) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: className, packagePath: ['APP', className] }, ...extra });
const rows = (source: string, className: string, extra: Partial<EncodeProgramContext> = {}) =>
  encode(source, className, extra).references
    .filter(reference => reference.kind === 'package' && reference.packageName)
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName}` : ''}`);

test('%Super property calls in several bodies, calling several methods, share ONE row; it records the first call', () => {
  const generated = rows(child(sources.first), 'Child', { applicationClassTypeMetadata: provider });
  assert.deepEqual(generated.filter(row => row.startsWith('TEXTCATALOG')), ['TEXTCATALOG.GETTEXT']);
  // without metadata the receiver is unknown: no row at all
  assert.deepEqual(rows(child(sources.first), 'Child').filter(row => row.startsWith('TEXTCATALOG')), []);
});

test('a create after a call-opened row of its class reuses it', () => {
  const generated = rows(child(sources.first), 'Child', { applicationClassTypeMetadata: provider });
  assert.deepEqual(generated.filter(row => row.startsWith('PATH')), ['PATH.BUILDSTEPS']);
});

test('an inherited %This property is typed through the metadata; an own one by its source declaration', () => {
  const source = [
    'import PKG:Parent;',
    'import PKG:Widget;',
    'class Kid extends PKG:Parent',
    '   method Run();',
    '   property Widget Mine;',
    'end-class;',
    '',
    'method Run',
    '   %This.Route.BuildSteps();',
    '   %This.Route.BuildSteps();',
    '   %This.Mine.Ping();',
    'end-method;',
    ''
  ].join('\n');
  const events: string[] = [];
  const generated = rows(source, 'Kid', {
    applicationClassTypeMetadata: provider,
    applicationClassTypeMetadataTrace: event => events.push(`${event.kind}:${event.member}`)
  });
  assert.deepEqual(generated.filter(row => row.startsWith('PATH') || row.startsWith('WIDGET')), ['WIDGET', 'PATH.BUILDSTEPS']);
  // `Mine` is declared by the program itself: the provider is not asked about it
  assert.deepEqual(events.filter(event => event.startsWith('member:')), ['member:Route', 'member:Route']);
});

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

test('diagnostics-only mode consults the metadata in an Application Class program but encodes as if it were absent', () => {
  const source = child(sources.first);
  const events: string[] = [];
  const diagnostics = encode(source, 'Child', {
    applicationClassTypeMetadata: provider,
    applicationClassTypeMetadataDiagnosticsOnly: true,
    applicationClassTypeMetadataTrace: event => events.push(`${event.kind}:${event.member}`)
  });
  const plain = encode(source, 'Child');
  assert.deepEqual(diagnostics.program, plain.program);
  assert.deepEqual(diagnostics.references, plain.references);
  assert.deepEqual(events, ['member:TxtCat', 'member:TxtCat', 'member:TxtCat', 'member:Route']);
});
