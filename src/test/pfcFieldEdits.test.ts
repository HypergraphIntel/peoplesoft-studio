import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFieldSettings, defaultMaskFor, describeFieldSettings, fieldRowKey, fieldSettingsOf, maskOf, withFieldRow, withFieldSettings, withMask, withoutFieldRow
} from '../model/pfcFieldEdits.js';

/*
 * Editing a configuration's field rows as the configurator's Fields grid does
 * (model/pfcFieldEdits.ts); the blank-row behaviour is pfc02's (a sequence
 * whose field was removed keeps one blank row) and EOCC_ADD_PB's (adding to
 * it fills that row).
 */

const SEQ = { SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 };
const KEY_JOBCODE = { ...SEQ, RECNAME: 'JOBCODE_TBL', FIELDNAME: 'KEY_JOBCODE', OCCURSLEVEL: 1, LBLTEXT: 'Key Job Code', PTCS_PNLFLDNAME: '1.JOBCODE_TBL.KEY_JOBCODE.180.1.P' };
const SHORT_TITLE = { ...SEQ, RECNAME: 'JOBCODE_TBL', FIELDNAME: 'DESCRSHORT', OCCURSLEVEL: 1, LBLTEXT: 'Short Job Title', PTCS_PNLFLDNAME: '1.JOBCODE_TBL.DESCRSHORT.14.1.P' };

test('a field row\'s settings, read from a compact row (defaults left out)', () => {
  assert.deepEqual(fieldSettingsOf(KEY_JOBCODE), { hidden: false, displayOnly: false, required: false });
  assert.deepEqual(fieldSettingsOf({ ...KEY_JOBCODE, EOCC_IS_REQUIRED: 'Y' }), { hidden: false, displayOnly: false, required: true });
  assert.deepEqual(fieldSettingsOf({ ...SHORT_TITLE, EOCC_VISIBLE_FLAG: 'N', EOCC_LBL_OVERRIDE: 'Y', LBLTEXT: 'Abbrev' }), { hidden: true, displayOnly: false, required: false, label: 'Abbrev' });
});

test('settings applied set the configurator\'s columns; taking a label away restores the page\'s', () => {
  const r = withFieldSettings(SHORT_TITLE, { hidden: false, displayOnly: true, required: false, label: 'Abbreviation' });
  assert.equal(r.EOCC_DISABLED, 'Y');
  assert.equal(r.EOCC_VISIBLE_FLAG, 'Y');
  assert.equal(r.EOCC_LBL_OVERRIDE, 'Y');
  assert.equal(r.LBLTEXT, 'Abbreviation');
  const back = withFieldSettings(r, { hidden: false, displayOnly: false, required: false }, 'Short Job Title');
  assert.equal(back.EOCC_LBL_OVERRIDE, 'N');
  assert.equal(back.LBLTEXT, 'Short Job Title');
  assert.equal(describeFieldSettings(fieldSettingsOf(r)), 'display only, labelled "Abbreviation"');
});

test('conflicting settings are refused', () => {
  assert.equal(checkFieldSettings({ hidden: true, displayOnly: false, required: true }).length, 1);
  assert.equal(checkFieldSettings({ hidden: false, displayOnly: false, required: false, label: ' ' }).length, 1);
  assert.deepEqual(checkFieldSettings({ hidden: true, displayOnly: false, required: false }), []);
});

test('adding a field fills the sequence\'s blank row, then appends; the same field is replaced [pfc02, EOCC_ADD_PB]', () => {
  const blank = [{ ...SEQ }];
  const one = withFieldRow(blank, KEY_JOBCODE);
  assert.equal(one.length, 1);
  assert.equal(one[0].FIELDNAME, 'KEY_JOBCODE');
  const two = withFieldRow(one, SHORT_TITLE);
  assert.equal(two.length, 2);
  const again = withFieldRow(two, { ...KEY_JOBCODE, EOCC_IS_REQUIRED: 'Y' });
  assert.equal(again.length, 2);
  assert.equal(again[0].EOCC_IS_REQUIRED, 'Y');
  // Another sequence's rows are not touched.
  const other = withFieldRow([{ SEQUENCE_NBR: 2, EOCC_SEQUENCE_NBR: 2 }], KEY_JOBCODE);
  assert.equal(other.length, 2);
});

test('removing a sequence\'s last field leaves one blank row, as the page does [pfc02]', () => {
  const rows = withoutFieldRow([KEY_JOBCODE], SEQ, fieldRowKey(KEY_JOBCODE));
  assert.deepEqual(rows, [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 }]);
  const kept = withoutFieldRow([KEY_JOBCODE, SHORT_TITLE], SEQ, fieldRowKey(KEY_JOBCODE));
  assert.deepEqual(kept.map((r) => r.FIELDNAME), ['DESCRSHORT']);
});

test('masking: the field group\'s profile, else the default; a masked row as Oracle\'s rows are [PERSONAL_DATA, PYE_BANKACCT]', () => {
  const profiles = [{ id: 'DATE_YR_MASK', isDefault: false }, { id: 'FULL', isDefault: true }, { id: 'PARTIAL_4CHAR', isDefault: false }];
  const groups = { BIRTHDATE: 'DATE_YR_MASK', ACCOUNT_EC_ID: 'PARTIAL_4CHAR' };
  assert.equal(defaultMaskFor('BIRTHDATE', profiles, groups), 'DATE_YR_MASK');
  assert.equal(defaultMaskFor('MAR_STATUS', profiles, groups), 'FULL');
  assert.equal(defaultMaskFor('X', [], {}), undefined);
  const masked = withMask({ ...SEQ, RECNAME: 'PERSON', FIELDNAME: 'BIRTHDATE' }, 'DATE_YR_MASK');
  assert.deepEqual([masked.EOCC_MASK_FLAG, masked.EOCC_MASK_ID, masked.EOCC_PROF_STATUS], ['Y', 'DATE_YR_MASK', 'D']);
  assert.equal(maskOf(masked), 'DATE_YR_MASK');
  assert.equal(maskOf(withMask(masked, undefined)), undefined);
});

test('defaults and set to blank: written as the page writes them, refused where the page refuses them', () => {
  const withDefault = withFieldSettings(SHORT_TITLE, { hidden: false, displayOnly: false, required: false, defaultValue: '%Date', overrideDefault: true });
  assert.deepEqual([withDefault.EOCC_DFLT_VALUE, withDefault.EOCC_DFLTOVRD_FLAG], ['%Date', 'Y']);
  assert.deepEqual(fieldSettingsOf(withDefault), { hidden: false, displayOnly: false, required: false, defaultValue: '%Date', overrideDefault: true });
  assert.match(describeFieldSettings(fieldSettingsOf(withDefault)), /default "%Date" \(replaces the value\)/);
  // EOCC_DFLTOVRD_FLAG FieldChange: "Can't Override to blank"; RowInit: set to blank only on a hidden or display-only field.
  assert.equal(checkFieldSettings({ hidden: false, displayOnly: false, required: false, overrideDefault: true }).length, 1);
  assert.equal(checkFieldSettings({ hidden: false, displayOnly: false, required: false, setBlank: true }).length, 1);
  assert.deepEqual(checkFieldSettings({ hidden: false, displayOnly: true, required: false, setBlank: true }), []);
  const blank = withFieldSettings(SHORT_TITLE, { hidden: false, displayOnly: true, required: false, setBlank: true });
  assert.equal(blank.EOCC_SET_BLANK, 'Y');
  // Changing only Hidden on an Oracle-style row (blank flags) leaves those columns alone.
  const hidden = withFieldSettings(SHORT_TITLE, { hidden: true, displayOnly: false, required: false });
  assert.ok(!('EOCC_SET_BLANK' in hidden) && !('EOCC_DFLT_VALUE' in hidden) && !('EOCC_DFLTOVRD_FLAG' in hidden));
  // Taking the default away clears it.
  const cleared = withFieldSettings(withDefault, { hidden: false, displayOnly: false, required: false });
  assert.deepEqual([cleared.EOCC_DFLT_VALUE, cleared.EOCC_DFLTOVRD_FLAG], ['', 'N']);
});
