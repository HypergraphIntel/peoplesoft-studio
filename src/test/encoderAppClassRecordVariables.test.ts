import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 120: a Record declared outside an Application Class method body --
 * header `instance` / `property`, top-level `Global` / `Component` -- is a
 * Record variable in every body, like a body `Local Record`: its bare
 * member is a FIELD row (one per field name, Cycle 119). Corpus shapes:
 * 28904 `instance Record &m_rcXLATITEM;` ... `&m_rcXLATITEM.FIELDNAME.Value`,
 * 29617 `Global Record &GBL_rec_share;` ... `&GBL_rec_share.HR_PSEL_HANDLER.Value`.
 */
const program = (header: string[], top: string[], body: string[], params = '') => [
  'class Kid',
  `   method Run(${params});`,
  ...header.map(line => `   ${line}`),
  'end-class;',
  '',
  ...top,
  '',
  'method Run',
  ...body.map(line => `   ${line}`),
  'end-method;',
  ''
].join('\n');
const fields = (source: string) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: 'Kid', packagePath: ['APP', 'Kid'] } } as any).references
    .filter(reference => reference.kind === 'field')
    .map(reference => reference.fieldName);

test('a header instance Record variable: its bare member is a FIELD row (28904)', () => {
  const source = program(['instance Record &m_rec;'], [], [
    '&m_rec = CreateRecord(Record.PSXLATITEM);',
    'Local string &a = &m_rec.FIELDNAME.Value;',
    'Local string &b = &m_rec.FIELDNAME.Value;'
  ]);
  assert.deepEqual(fields(source), ['FIELDNAME']);
});

test('a header property Record is a Record variable in the body', () => {
  assert.deepEqual(fields(program(['property Record ObjRec;'], [], ['Local string &a = &ObjRec.SETID.Value;'])), ['SETID']);
});

test('top-level Global and Component Record variables (29617)', () => {
  assert.deepEqual(fields(program([], ['Global Record &g_rec;'], ['Local string &a = &g_rec.HR_PSEL_HANDLER.Value;'])), ['HR_PSEL_HANDLER']);
  assert.deepEqual(fields(program([], ['Component Record &c_rec;'], ['Local string &a = &c_rec.EMPLID.Value;'])), ['EMPLID']);
});

test('Record built-in members stay inline: GetField, Name, FieldCount', () => {
  const source = program(['instance Record &m_rec;'], [], [
    'Local Field &f = &m_rec.GetField(Field.EMPLID);',
    'Local string &n = &m_rec.Name;',
    'Local integer &c = &m_rec.FieldCount;'
  ]);
  assert.ok(!fields(source).some(name => /^(GETFIELD|NAME|FIELDCOUNT)$/i.test(name ?? '')));
});

test('a parameter or a body Local of another type shadows an outside Record', () => {
  assert.deepEqual(fields(program(['instance Record &m_rec;'], [], ['Local string &a = &m_rec.Value;'], '&m_rec As Rowset')), []);
  assert.deepEqual(fields(program(['instance Record &m_rec;'], [], ['Local Rowset &m_rec;', 'Local number &a = &m_rec.ActiveRowCount;'])), []);
});
