import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UseEdit, hasFlag, isKeyField, FieldType } from '../model/record.js';

const field = (useEdit: number) => ({
  name: 'EMPLID', fieldNum: 1, type: FieldType.Character,
  length: 11, decimalPositions: 0, useEdit
});

test('USEEDIT is read as a bit mask, so combined attributes all register', () => {
  const f = field(UseEdit.Key | UseEdit.SearchKey | UseEdit.ListBoxItem);
  assert.ok(isKeyField(f));
  assert.ok(hasFlag(f.useEdit, UseEdit.SearchKey));
  assert.ok(hasFlag(f.useEdit, UseEdit.ListBoxItem));
  assert.ok(!hasFlag(f.useEdit, UseEdit.Required));
});

test('a search key that is not a key field is not reported as one', () => {
  assert.ok(!isKeyField(field(UseEdit.SearchKey)));
});

test('a field with no attributes has none of them', () => {
  const f = field(0);
  for (const flag of Object.values(UseEdit).filter((v) => typeof v === 'number')) {
    assert.ok(!hasFlag(f.useEdit, flag as UseEdit));
  }
});
