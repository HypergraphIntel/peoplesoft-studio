import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderComponentInterface, renderFileLayout } from '../model/integrationDefinitions.js';

test('a fixed file layout: segments with their fields\' positions; date formats only on date fields', () => {
  const text = renderFileLayout('GPUS_SM1_C', {
    layout: { DESCR: 'Creates State MMREF 1 File', FLDFORMAT: 0, VERSION: 1, LASTUPD: '2015-05-15 10:19:07', LASTUPDOPRID: 'PPLSOFT' },
    segments: [
      { FLDSEGNAME: 'GPUS_RA_TMP', FLDSEGPARENT: ' ', FLDSEQNO: 2, DESCR100: 'RA Record' },
      { FLDSEGNAME: 'GPUS_IL_TMP', FLDSEGPARENT: ' ', FLDSEQNO: 1 },
      { FLDSEGNAME: 'GPUS_CHILD', FLDSEGPARENT: 'GPUS_RA_TMP', FLDSEQNO: 1 }
    ],
    fields: [
      { FLDSEGNAME: 'GPUS_RA_TMP', FLDFIELDNAME: 'GPUS_REC_ID', FLDFIELDTYPE: 0, FLDSTART: 1, FLDLENGTH: 2, FLDSEQNO: 1, FLDDATEFMT: 'MMDDYYYY', FLDFIELDDFLT: 'RA' },
      { FLDSEGNAME: 'GPUS_RA_TMP', FLDFIELDNAME: 'PAY_END_DT', FLDFIELDTYPE: 4, FLDSTART: 3, FLDLENGTH: 8, FLDSEQNO: 2, FLDDATEFMT: 'MMDDYYYY' }
    ]
  });
  assert.match(text, /Format: FIXED/);
  assert.ok(text.indexOf('Segment GPUS_IL_TMP') < text.indexOf('Segment GPUS_RA_TMP'));
  assert.match(text, /GPUS_REC_ID +Character +start 1, length 2 {3}default "RA"\n/);
  assert.match(text, /PAY_END_DT +Date +start 3, length 8 {3}date format MMDDYYYY/);
  assert.match(text, /\n {4}Segment GPUS_CHILD/);
});

test('a CSV file layout shows its delimiter and qualifier', () => {
  const text = renderFileLayout('ACCT_CD_TBL_INPUT', {
    layout: { FLDFORMAT: 1, FLDDELIMITER: ',', FLDQUALIFIER: '"', FLDFILENAME: 'C:\\temp\\ACCTCD2.CSV' }, segments: [], fields: []
  });
  assert.match(text, /Format: CSV {3}Delimiter: "," {3}Qualifier: "\\"" {3}File: C:\\temp\\ACCTCD2\.CSV/);
});

test('a component interface: methods from the bits, keys, and collections as a tree (USER_PROFILE on HRDMO)', () => {
  const text = renderComponentInterface('USER_PROFILE', {
    ci: { DESCR: 'User Profile', BCPGNAME: 'USERMAINT', MARKET: 'GBL', MENUNAME: 'MAINTAIN_SECURITY', SEARCHRECNAME: 'PSOPRDEFN_SRCH', BCSTDMETHODS: 27 },
    items: [
      { BCTYPE: 1, BCITEMPARENT: 'PS_ROOT', BCITEMNAME: 'UserID', RECNAME: 'PSOPRDEFN_SRCH', FIELDNAME: 'OPRID', SEQUENCE_NBR_6: 1, BCACCESS: 1 },
      { BCTYPE: 2, BCITEMPARENT: 'PS_ROOT', BCITEMNAME: 'UserID', RECNAME: 'PSOPRDEFN_SRCH', FIELDNAME: 'OPRID', SEQUENCE_NBR_6: 2, BCACCESS: 1 },
      { BCTYPE: 4, BCITEMPARENT: 'PS_ROOT', BCITEMNAME: 'UserDescription', RECNAME: 'PSOPRDEFN', FIELDNAME: 'OPRDEFNDESC', SEQUENCE_NBR_6: 3, BCACCESS: 1 },
      { BCTYPE: 3, BCITEMPARENT: 'PS_ROOT', BCITEMNAME: 'IDTypes', RECNAME: 'PSOPRALIAS', BCSCROLLNAME: '00-00-01-02', SEQUENCE_NBR_6: 4, BCACCESS: 1 },
      { BCTYPE: 4, BCITEMPARENT: 'IDTypes', BCITEMNAME: 'IDType', RECNAME: 'PSOPRALIAS', FIELDNAME: 'OPRALIASTYPE', SEQUENCE_NBR_6: 5, BCACCESS: 2 }
    ]
  });
  assert.match(text, /Standard methods: Cancel, Create, Get, Save\n/);
  assert.match(text, /Get Keys: UserID \(PSOPRDEFN_SRCH\.OPRID\)\n {2}Create Keys: UserID/);
  assert.ok(!text.includes('Find Keys'));
  assert.match(text, /\n {4}UserDescription +PSOPRDEFN\.OPRDEFNDESC\n {4}Collection IDTypes {3}\(record PSOPRALIAS, scroll 00-00-01-02\)\n {6}IDType +PSOPRALIAS\.OPRALIASTYPE {2}\[access 2\]/);
});
