import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApplicationClassSource } from '../peoplecode/applicationClassProgram.js';
import { classCandidates, classMembers, declaredClassOf, declaredTypeOf, importsOf, publicMembers, qualifiedExtends } from '../peoplecode/memberCompletion.js';

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

test('classMembers: inside the class (%This) its private members too, without the constructor or instance variables', () => {
  const program = parseApplicationClassSource(CLASS)!;
  const inside = classMembers(program, ['public', 'protected', 'private'], true).map((m) => m.name).sort();
  assert.deepEqual(inside, ['Count', 'Draw', 'Name', 'helper']);
  const inherited = classMembers(parseApplicationClassSource([
    'class Base',
    '   method Shown();',
    'protected',
    '   method ForSubclasses();',
    'private',
    '   method Hidden();',
    'end-class;'
  ].join('\n'))!, ['public', 'protected'], true).map((m) => m.name);
  assert.deepEqual(inherited, ['Shown', 'ForSubclasses']);
});

test('classCandidates resolves a bare class name through exact imports, PKG:* imports, then the own package', () => {
  const text = 'import ZZ_PKG:Exact;\nimport ZZ_PKG:SUB:*;\nimport OTHER:*;\nclass Fmt extends Config\nend-class;';
  assert.deepEqual(classCandidates('Exact', text, ['ZZ_PKG']), [['ZZ_PKG', 'Exact'], ['ZZ_PKG', 'SUB', 'Exact'], ['OTHER', 'Exact']]);
  assert.deepEqual(classCandidates('Config', text, ['ZZ_PKG']), [['ZZ_PKG', 'SUB', 'Config'], ['OTHER', 'Config'], ['ZZ_PKG', 'Config']]);
  assert.deepEqual(classCandidates('A:B:C', text), [['A', 'B', 'C']]);
  assert.deepEqual(importsOf(text), { classes: [['ZZ_PKG', 'Exact']], packages: [['ZZ_PKG', 'SUB'], ['OTHER']] });
});

test('declaredTypeOf accepts a bare imported class name but never a PeopleCode type', () => {
  assert.equal(declaredTypeOf('Local Config &cfg = create Config();', '&cfg'), 'Config');
  assert.equal(declaredTypeOf('method Run(&f As Fmt)', '&f'), 'Fmt');
  assert.equal(declaredTypeOf('Local ZZ_P:Cls &c;', '&c'), 'ZZ_P:Cls');
  assert.equal(declaredTypeOf('Local string &s;', '&s'), undefined);
  assert.equal(declaredTypeOf('Local Rowset &rs;', '&rs'), undefined);
  assert.equal(declaredTypeOf('Local array of string &a;', '&a'), undefined);
});
