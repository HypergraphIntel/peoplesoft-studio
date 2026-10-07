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

test('the USEEDIT bits App Designer\'s Use display confirmed on HRDMO', () => {
  // ABS_HIST_DET.BEGIN_DT: Key, Dir D (0x800141); PSOPRDEFN.USERIDALIAS: Alt, List Yes (0x800030).
  assert.equal(UseEdit.Key, 0x1);
  assert.equal(UseEdit.AltSearchKey, 0x10);
  assert.equal(UseEdit.ListBoxItem, 0x20);
  assert.equal(UseEdit.DescendingKey, 0x40);
  assert.ok(hasFlag(0x800141, UseEdit.DescendingKey) && hasFlag(0x800141, UseEdit.Key));
  assert.ok(hasFlag(0x800030, UseEdit.AltSearchKey) && hasFlag(0x800030, UseEdit.ListBoxItem) && !hasFlag(0x800030, UseEdit.Key));
});
