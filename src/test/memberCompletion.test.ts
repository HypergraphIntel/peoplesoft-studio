import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApplicationClassSource } from '../peoplecode/applicationClassProgram.js';
import { declaredClassOf, publicMembers, qualifiedExtends } from '../peoplecode/memberCompletion.js';

const CLASS = [
  'class Widget extends ZZ_PCODE_LAB:ORDERING:BASECLS',
  '   method Widget();',
  '   method Draw() Returns string;',
  '   property number Count get;',
  '   property string Name;',
  'private',
  '   method helper();',
  '   instance number &total;',
  'end-class;'
].join('\n');

test('declaredClassOf finds a Local/Component/instance declaration and a parameter type', () => {
  assert.deepEqual(declaredClassOf('Local ZZ_PCODE_LAB:ORDERING:PARENT &w;', '&w'), ['ZZ_PCODE_LAB', 'ORDERING', 'PARENT']);
  assert.deepEqual(declaredClassOf('   instance PT_RCF:ServiceInterface &svc;', 'svc'), ['PT_RCF', 'ServiceInterface']);
  assert.deepEqual(declaredClassOf('method M(&x As PKG:SUB:CLS)', '&x'), ['PKG', 'SUB', 'CLS']);
});

test('declaredClassOf returns undefined when the variable is untyped or unknown', () => {
  assert.equal(declaredClassOf('Local string &s;', '&s'), undefined);
  assert.equal(declaredClassOf('Local number &n = 1;', '&other'), undefined);
});

test('publicMembers returns only public methods, properties and constants', () => {
  const program = parseApplicationClassSource(CLASS);
  assert.ok(program);
  const names = publicMembers(program!).map((m) => m.name).sort();
  assert.deepEqual(names, ['Count', 'Draw', 'Name', 'Widget']);
  const draw = publicMembers(program!).find((m) => m.name === 'Draw');
  assert.equal(draw!.kind, 'method');
  assert.match(draw!.detail, /Returns string/);
});

test('qualifiedExtends returns the base class parts only when it is qualified', () => {
  const program = parseApplicationClassSource(CLASS);
  assert.deepEqual(qualifiedExtends(program!), ['ZZ_PCODE_LAB', 'ORDERING', 'BASECLS']);
  const noExtends = parseApplicationClassSource('class Solo\n   method Solo();\nend-class;');
  assert.equal(qualifiedExtends(noExtends!), undefined);
});
