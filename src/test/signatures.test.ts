import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_SIGNATURES, signatureContextAt } from '../peoplecode/signatures.js';

test('the call and active parameter are found from the cursor', () => {
  // SQLExec(a, b| , c)  -- cursor after the second argument's comma
  const line = 'SQLExec(&sql, &bind, &out)';
  const at = line.indexOf('&bind') + 2;
  const ctx = signatureContextAt(line, at);
  assert.ok(ctx);
  assert.equal(ctx!.name, 'sqlexec');
  assert.equal(ctx!.activeParameter, 1);
});

test('nested calls resolve to the innermost call', () => {
  const line = '&r = GetRecord(Record.JOB).GetField(Field.EMPLID)';
  // cursor inside GetField(...)
  const ctx = signatureContextAt(line, line.indexOf('Field.EMPLID') + 1);
  assert.ok(ctx);
  assert.equal(ctx!.name, 'getfield');
  assert.equal(ctx!.activeParameter, 0);
});

test('a nested call as an argument keeps the outer active parameter', () => {
  // MsgGet(1, 2, Substring(&s, 1, 3)| , ...) -- cursor after the nested call, third outer arg
  const line = 'MsgGet(1, 2, Substring(&s, 1, 3), &x)';
  const ctx = signatureContextAt(line, line.indexOf('&x'));
  assert.ok(ctx);
  assert.equal(ctx!.name, 'msgget');
  assert.equal(ctx!.activeParameter, 3);
});

test('outside any call there is no signature context', () => {
  assert.equal(signatureContextAt('&x = 1 + 2;', 6), undefined);
  assert.equal(signatureContextAt('CreateRecord(Record.JOB)', 24), undefined); // past the closing paren
});

test('every signature lists at least one parameter and a doc', () => {
  for (const [name, sig] of Object.entries(BUILTIN_SIGNATURES)) {
    assert.ok(sig.parameters.length >= 1, `${name} has no parameters`);
    assert.ok(sig.doc.length > 0, `${name} has no doc`);
    assert.ok(sig.label.toLowerCase().startsWith(name), `${name} label mismatch: ${sig.label}`);
  }
});
