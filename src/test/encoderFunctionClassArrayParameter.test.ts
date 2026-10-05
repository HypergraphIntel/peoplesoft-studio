import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 170: an ordinary Function's `As array of <Class>` parameter is a
 * declared class array (Cycle 104 / 109): a call on an indexed element
 * opens the class row (25337 `&axAppMsgs [&I].ToString()`).
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const rows = (parameterType: string) => encodeProgramArtifacts(
  `Function LogErrors(&msgs As ${parameterType})\n   Local integer &i;\n   &i = 1;\n   Warning (&msgs [&i].ToString());\nEnd-Function;\n`,
  { owner }
).references.filter(r => r.kind === 'package').map(r => `${r.packageName}${r.methodName ? `.${r.methodName}` : ''}`);

test('a call on an indexed array-of-class Function parameter element opens the class row (25337)', () => {
  const packages = rows('array of PKG:AppMsg');
  assert.equal(packages.filter(p => p.startsWith('APPMSG')).length, 2);
});

test('an array of a built-in type stays as before (control)', () => {
  assert.ok(!rows('array of string').some(p => p.startsWith('APPMSG')));
});
