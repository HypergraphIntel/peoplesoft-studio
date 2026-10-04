import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 160: a class-header member typed with the built-in `Exception`
 * (a method parameter or return, a property, an instance) is a declaration
 * dependency: its PACKAGE.EXCEPTION row is allocated in header order like
 * any other built-in type (30206 `method getExceptionText(&pException As
 * Exception)` before `Returns ApiObject`: EXCEPTION 3, APIOBJECT 4; 28985
 * `property Exception LastError get;`). `extends Exception` alone is not:
 * the 17 classes that only extend it store no EXCEPTION row (30009, 30023).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const packages = (header: string, body = '   &x = 1;') => {
  const source = `import PKG:*;\n\nclass Demo${header}\nend-class;\n\nmethod Run\n${body}\nend-method;\n`;
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : '');
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'package').map(r => `${r.index + 1}:${r.packageName}`);
};

test('an Exception method parameter allocates its row in header order (30206)', () => {
  assert.deepEqual(
    packages('\n   method Run();\n   method Show(&pException As Exception);\n   method Open() Returns ApiObject;'),
    ['2:', '3:EXCEPTION', '4:APIOBJECT']
  );
});

test('an Exception property or instance allocates one row (28985)', () => {
  assert.deepEqual(
    packages('\n   method Run();\n   property Exception LastError get;\nprivate\n   instance Exception &mo_LastError;'),
    ['2:', '3:EXCEPTION']
  );
});

test('extends Exception alone allocates no EXCEPTION row (30009)', () => {
  assert.deepEqual(packages(' extends Exception\n   method Run();'), ['2:']);
});

test('extends Exception with an Exception parameter allocates one row (30006)', () => {
  assert.deepEqual(packages(' extends Exception\n   method Run();\n   method Wrap(&e As Exception);'), ['2:', '3:EXCEPTION']);
});
