import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationClassTypeMetadataProvider, type ApplicationClassDefinition } from '../peoplecode/applicationClassTypeMetadata.js';
import { isBuiltinObjectTypeName } from '../peoplecode/encoder.js';

/*
 * Cycle 107: the pure Application Class type-metadata provider. Small
 * synthetic class definitions; the lookups are the ones the encoder makes
 * for `&obj.Prop.M()` and `&obj.Get().M()`.
 */
const cls = (path: string, source: string): ApplicationClassDefinition => ({ path: path.split(':'), source });

const definitions = [
  cls('PKG:Base', 'import PKG:Other;\nclass Base\n   property PKG:Other Shared;\n   property PKG:Other Shadowed;\n   method GetBase() Returns Other;\nend-class;\n'),
  cls('PKG:Widget', [
    'import PKG:Other;',
    'import WILD:*;',
    'class Widget extends PKG:Base',
    '   method GetOther() Returns Other;',
    '   method GetGadget() Returns Gadget;',
    '   method GetNothing();',
    '   property PKG:Other Partner;',
    '   property PKG:Base Shadowed;',
    '   property string Name;',
    '   property Rowset Rows;',
    '   property MISSING:Gone Lost;',
    '   property Ambiguous Twin;',
    'end-class;',
    ''
  ].join('\n')),
  cls('PKG:Other', 'class Other\nend-class;\n'),
  cls('WILD:Gadget', 'class Gadget\nend-class;\n'),
  cls('WILD:Ambiguous', 'class Ambiguous\nend-class;\n'),
  cls('PKG:Ambiguous', 'class Ambiguous\nend-class;\n'),
  cls('PKG:Rowset', 'class Rowset\nend-class;\n'),
  cls('LOOP:A', 'class A extends LOOP:B\nend-class;\n'),
  cls('LOOP:B', 'class B extends LOOP:A\nend-class;\n')
];
const provider = createApplicationClassTypeMetadataProvider(definitions, { isBuiltinType: isBuiltinObjectTypeName });
const widget = ['PKG', 'Widget'];

test('an own property declared with a qualified class type', () => {
  assert.deepEqual(provider.memberType(widget, 'Partner'), { kind: 'class', path: ['PKG', 'Other'] });
});

test('an inherited property resolves through the parent, which resolves its own imports', () => {
  assert.deepEqual(provider.memberType(widget, 'shared'), { kind: 'class', path: ['PKG', 'Other'] });
});

test('the nearest declaration wins over an ancestor one', () => {
  assert.deepEqual(provider.memberType(widget, 'Shadowed'), { kind: 'class', path: ['PKG', 'Base'] });
});

test('method return types: own (named import), inherited, wildcard import, none', () => {
  assert.deepEqual(provider.methodReturnType(widget, 'GetOther'), { kind: 'class', path: ['PKG', 'Other'] });
  assert.deepEqual(provider.methodReturnType(widget, 'GetBase'), { kind: 'class', path: ['PKG', 'Other'] });
  assert.deepEqual(provider.methodReturnType(widget, 'GetGadget'), { kind: 'class', path: ['WILD', 'Gadget'] });
  assert.deepEqual(provider.methodReturnType(widget, 'GetNothing'), { kind: 'other', type: '' });
});

test('primitive and built-in types are not Application Classes, even with a same-named class around', () => {
  assert.deepEqual(provider.memberType(widget, 'Name'), { kind: 'other', type: 'string' });
  assert.deepEqual(provider.memberType(widget, 'Rows'), { kind: 'other', type: 'Rowset' });
});

test('unavailable, ambiguous, and missing answers are undefined, never guessed', () => {
  assert.equal(provider.memberType(widget, 'Lost'), undefined);
  assert.equal(provider.memberType(widget, 'Twin'), undefined);
  assert.equal(provider.memberType(widget, 'NoSuchMember'), undefined);
  assert.equal(provider.memberType(['NOPE', 'Class'], 'Partner'), undefined);
});

test('an inheritance cycle terminates', () => {
  assert.equal(provider.memberType(['LOOP', 'A'], 'Anything'), undefined);
});

test('the parent class (`%Super`): available classes only, never through a cycle guess', () => {
  assert.deepEqual(provider.superclassOf(widget), ['PKG', 'Base']);
  assert.equal(provider.superclassOf(['PKG', 'Base']), undefined);
  assert.deepEqual(provider.superclassOf(['LOOP', 'A']), ['LOOP', 'B']);
  assert.equal(provider.superclassOf(['NOPE', 'Class']), undefined);
});

test('an array of an available class keeps its element and depth; other arrays are not classes', () => {
  const arrays = createApplicationClassTypeMetadataProvider([
    cls('PKG:Holder', [
      'import PKG:Other;',
      'class Holder',
      '   property array of PKG:Other Many;',
      '   property array of array of Other Grid;',
      '   property array of string Names;',
      '   property array of Rowset Sets;',
      '   property array of MISSING:Gone Lost;',
      '   method All() Returns array of Other;',
      'end-class;',
      ''
    ].join('\n')),
    cls('PKG:Other', 'class Other\nend-class;\n')
  ], { isBuiltinType: isBuiltinObjectTypeName });
  const holder = ['PKG', 'Holder'];
  assert.deepEqual(arrays.memberType(holder, 'Many'), { kind: 'array', element: ['PKG', 'Other'], depth: 1 });
  assert.deepEqual(arrays.memberType(holder, 'Grid'), { kind: 'array', element: ['PKG', 'Other'], depth: 2 });
  assert.deepEqual(arrays.methodReturnType(holder, 'All'), { kind: 'array', element: ['PKG', 'Other'], depth: 1 });
  assert.deepEqual(arrays.memberType(holder, 'Names'), { kind: 'other', type: 'array of string' });
  assert.deepEqual(arrays.memberType(holder, 'Sets'), { kind: 'other', type: 'array of Rowset' });
  assert.equal(arrays.memberType(holder, 'Lost'), undefined);
});

test('a short built-in name wins over a wildcard-imported class of the same name (Cycle 110: Collection, 29870)', () => {
  const builtins = createApplicationClassTypeMetadataProvider([
    cls('APP:User', 'import XMLGEN:*;\nclass User\n   property Collection Items;\n   property XMLGEN:Collection Mine;\nend-class;\n'),
    cls('XMLGEN:Collection', 'class Collection\nend-class;\n')
  ], { isBuiltinType: isBuiltinObjectTypeName });
  assert.deepEqual(builtins.memberType(['APP', 'User'], 'Items'), { kind: 'other', type: 'Collection' });
  assert.deepEqual(builtins.memberType(['APP', 'User'], 'Mine'), { kind: 'class', path: ['XMLGEN', 'Collection'] });
});
