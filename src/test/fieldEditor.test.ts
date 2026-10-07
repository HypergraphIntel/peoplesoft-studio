import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTypeLabel, type FieldDefinition } from '../model/fieldDefinition.js';
import { FieldType } from '../model/record.js';
import { renderFieldHtml } from '../editors/fieldHtml.js';

const C02: FieldDefinition = {
  name: 'ZZ_PCODE_LAB_C02', type: FieldType.Character, length: 1, decimalPositions: 0,
  labels: [{ id: 'ZZ_PCODE_LAB_C02', longName: 'ZZ_PCODE_LAB_C02', shortName: 'C02', isDefault: true }],
  format: 0, formatFamily: '', displayName: '', defaultCenturyYear: 50, notUsed: false, auxFlagMask: 0, version: 1
};

test('only the character formats established on HRDMO are named', () => {
  assert.equal(formatTypeLabel(0), 'Uppercase');
  assert.equal(formatTypeLabel(1), 'Name');
  assert.equal(formatTypeLabel(6), 'Mixed Case');
  assert.equal(formatTypeLabel(14), 'Custom');
  assert.equal(formatTypeLabel(8), 'Format 8 (stored value)');
  assert.equal(formatTypeLabel(undefined), '');
});

test('a character field reads like App Designer\'s Field dialog', () => {
  const html = renderFieldHtml(C02, 'HRDMO', 'n');
  for (const s of ['ZZ_PCODE_LAB_C02 (Field)', 'Field Type:', '>Character<', 'Field Length:', '>1<',
    'Field Labels', 'Label ID', 'Long Name', 'Short Name', '>C02<', 'Field Format', 'Format Type:', '>Uppercase<', 'Not Used']) {
    assert.ok(html.includes(s), s);
  }
  // The default label is ticked; ten grid rows, as the dialog shows.
  assert.equal((html.match(/&#10003;/g) ?? []).length, 1);
  assert.equal((html.match(/<tr/g) ?? []).length, 11);
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes(`content="default-src 'none'; style-src 'nonce-n';"`));
});

test('numbers show length and decimals; non-character fields have no format type', () => {
  const html = renderFieldHtml({ ...C02, name: 'AMT', type: FieldType.SignedNumber, length: 18, decimalPositions: 3, format: 0 }, 'X', 'n');
  assert.ok(html.includes('Decimal Positions:') && html.includes('>3<'));
  assert.ok(!html.includes('Format Type:'));
});

test('labels without a default flag (a project export) are not shown as unticked', () => {
  const html = renderFieldHtml({ ...C02, labels: [{ id: 'A', longName: 'A', shortName: 'A' }], auxFlagMask: undefined, notUsed: undefined }, 'X', 'n');
  assert.ok(html.includes('class="check unknown"'));
  assert.ok(!html.includes('AUXFLAGMASK'));
});

test('editable, the page offers the field actions and runs only its own nonce\'d script', () => {
  const html = renderFieldHtml({ ...C02, description: 'Long <text>' }, 'HRDMO', 'n', { editable: true });
  for (const act of ['length', 'addLabel', 'editLabel', 'defaultLabel', 'description']) assert.ok(html.includes(`data-act="${act}"`), act);
  assert.ok(html.includes(`script-src 'nonce-n';`) && html.includes('<script nonce="n">'));
  assert.ok(html.includes('data-label="ZZ_PCODE_LAB_C02"'));
  assert.ok(html.includes('Long &lt;text&gt;'));
  // A date has no length to change.
  assert.ok(!renderFieldHtml({ ...C02, type: FieldType.Date, length: 10 }, 'X', 'n', { editable: true }).includes('data-act="length"'));
  const readOnly = renderFieldHtml(C02, 'X', 'n', { readOnlyReason: 'scratch fields only' });
  assert.ok(readOnly.includes('Read-only: scratch fields only') && !/<script/i.test(readOnly));
});

test('values are escaped', () => {
  const html = renderFieldHtml({ ...C02, labels: [{ id: '<b>', longName: '"x"', shortName: '&', isDefault: false }] }, 'H<R>', 'n');
  assert.ok(html.includes('&lt;b&gt;') && html.includes('&quot;x&quot;') && html.includes('H&lt;R&gt;'));
});
