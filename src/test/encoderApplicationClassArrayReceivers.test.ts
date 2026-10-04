import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName, type EncodeProgramContext } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';

/*
 * Cycle 109: in an Application Class body the element of an
 * `array of <Class>` value -- a Local, a method parameter, a property, a
 * property or method result the type metadata declares as one -- is a
 * receiver of the class once every array level is indexed, and then uses
 * the class's program row (Cycle 108). Corpus shape 29109:
 * `&factors [&f].FactorHandler.GetFactorDisplays(...)` on a parameter
 * `&factors As array of CAFNUI_CORE:OBJECT:Factor`.
 */
const provider = createApplicationClassTypeMetadataProvider([
  {
    path: ['PKG', 'Widget'],
    source: [
      'class Widget',
      '   method Ping();',
      '   method GetAll() Returns array of PKG:Widget;',
      '   property PKG:Other Partner;',
      '   property array of PKG:Widget Children;',
      '   property array of Record Records;',
      'end-class;',
      ''
    ].join('\n')
  },
  { path: ['PKG', 'Other'], source: 'class Other\n   method Ping();\nend-class;\n' },
  { path: ['PKG', 'Base'], source: 'class Base\n   property array of PKG:Other Items;\n   property array of array of PKG:Other Grid;\nend-class;\n' },
  { path: ['APP', 'Heir'], source: 'import PKG:Base;\nclass Heir extends PKG:Base\n   method Run();\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });

const kid = (header: string[], body: string[], className = 'Kid', extendsType?: string) => [
  ...(extendsType ? [`import ${extendsType};`] : []),
  `class ${className}${extendsType ? ` extends ${extendsType}` : ''}`,
  ...header.map(line => `   ${line}`),
  'end-class;',
  '',
  'method Run',
  ...body.map(line => `   ${line}`),
  'end-method;',
  ''
].join('\n');
const rows = (source: string, extra: Partial<EncodeProgramContext> = {}, className = 'Kid') =>
  encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: className, packagePath: ['APP', className] }, ...extra }).references
    .filter(reference => reference.kind === 'package' && reference.packageName)
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName}` : ''}`);
const others = (source: string, extra: Partial<EncodeProgramContext> = {}, className = 'Kid') =>
  rows(source, extra, className).filter(row => row.startsWith('OTHER'));
const typed = { applicationClassTypeMetadata: provider };

test('the element of an inherited array property is a receiver: its class opens a row', () => {
  const source = kid(['method Run();'], ['%Super.Items [1].Ping();', '%Super.Items [2].Ping();'], 'Heir', 'PKG:Base');
  assert.deepEqual(others(source, typed, 'Heir'), ['OTHER.PING']);
  assert.deepEqual(others(source, {}, 'Heir'), []);
});

test('an element still holding an array level is not a receiver; indexing every level is', () => {
  const partly = kid(['method Run();'], ['%Super.Grid [1].Ping();'], 'Heir', 'PKG:Base');
  const fully = kid(['method Run();'], ['%Super.Grid [1] [2].Ping();'], 'Heir', 'PKG:Base');
  assert.deepEqual(others(partly, typed, 'Heir'), []);
  assert.deepEqual(others(fully, typed, 'Heir'), ['OTHER.PING']);
});

test('the fully indexed element of an array parameter is a receiver (29109)', () => {
  const source = kid(['method Run(&items As array of PKG:Widget);'], ['&items [1].Partner.Ping();', '&items [2].Partner.Ping();']);
  assert.deepEqual(others(source, typed), ['OTHER.PING']);
  assert.deepEqual(others(source), []);
});

test('typed steps after an array parameter element: every array level indexed first', () => {
  const partly = kid(['method Run(&grid As array of array of PKG:Widget);'], ['&grid [1].Partner.Ping();']);
  const fully = kid(['method Run(&grid As array of array of PKG:Widget);'], ['&grid [1] [2].Partner.Ping();']);
  assert.deepEqual(others(partly, typed), []);
  assert.deepEqual(others(fully, typed), ['OTHER.PING']);
});

test('Local, own property and instance arrays', () => {
  for (const [header, body] of [
    [['method Run();'], ['Local array of PKG:Widget &ws;', '&ws [1].Partner.Ping();']],
    [['method Run();', 'property array of PKG:Widget Items;'], ['%This.Items [1].Partner.Ping();']],
    [['method Run();', 'private', 'instance array of PKG:Widget &mItems;'], ['&mItems [1].Partner.Ping();']]
  ]) {
    assert.deepEqual(others(kid(header, body), typed), ['OTHER.PING'], body.join(' '));
  }
});

test('an array property or array method result the metadata declares', () => {
  for (const line of ['&w.Children [1].Partner.Ping();', '&w.GetAll() [1].Partner.Ping();']) {
    const source = kid(['method Run();'], ['Local PKG:Widget &w = create PKG:Widget();', line]);
    assert.deepEqual(others(source, typed), ['OTHER.PING'], line);
  }
});

test('a member of the array itself is not an element', () => {
  const source = kid(['method Run(&items As array of PKG:Widget);'], ['Local number &n = &items.Len;', '&items.Push(create PKG:Widget());']);
  assert.deepEqual(rows(source, typed), rows(source));
});

test('arrays of built-in objects keep their encoding', () => {
  const source = kid(['method Run();'], ['Local PKG:Widget &w = create PKG:Widget();', 'Local array of Record &recs;', '&recs [1].Delete();', '&w.Records [1].Delete();']);
  const withMetadata = encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: 'Kid', packagePath: ['APP', 'Kid'] }, ...typed });
  const plain = encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: 'Kid', packagePath: ['APP', 'Kid'] } });
  assert.deepEqual(withMetadata.program, plain.program);
  assert.deepEqual(withMetadata.references, plain.references);
});

// Cycle 166: ordinary programs model metadata arrays too (19433 / 24458 /
// 24500 / 24503 `&g.GridColumns [&c].SelectAll()` store the element class
// row); before, Cycle 107 / 109 kept them unmodeled there.
test('ordinary programs model metadata arrays as App Class programs do (Cycle 166)', () => {
  const source = 'Local PKG:Widget &w = create PKG:Widget();\n&w.Children [1].Partner.Ping();\n';
  const ordinary = (extra: Partial<EncodeProgramContext>) => encodeProgramArtifacts(source, { owner: { recordName: 'REC', fieldName: 'FLD' }, ...extra }).references
    .filter(reference => reference.kind === 'package' && reference.packageName?.startsWith('OTHER'))
    .map(reference => `${reference.packageName}.${reference.methodName ?? ''}`);
  assert.deepEqual(ordinary(typed), ['OTHER.PING']);
  // without type metadata the chain stays unmodeled
  assert.deepEqual(ordinary({}), []);
});
