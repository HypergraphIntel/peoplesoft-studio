import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 119: in an Application Class program a Row-shorthand chain
 * (`&row.REC.FIELD`) keeps one RECORD row per record name and one FIELD row
 * per field name for the whole program -- across statements, control
 * groups and methods -- like an explicit `Record.X` (Cycle 71) and a
 * Record variable's fields (Cycle 65). Corpus shapes: 28797
 * `&rwAgcTmplTbl.AGC_TMPL_TBL.DESCR100.Value` (four fields of one record),
 * 28764 `GetLevel0()(1).PSADSDMW_WRK.PTSESSIONID` (twice in one statement).
 * Ordinary programs keep their allocation units.
 */
const appClass = (methods: Record<string, string[]>) => [
  'class Kid',
  ...Object.keys(methods).map(name => `   method ${name}();`),
  'end-class;',
  '',
  ...Object.entries(methods).flatMap(([name, body]) => [`method ${name}`, ...body.map(line => `   ${line}`), 'end-method;', ''])
].join('\n');
const rows = (source: string, owner: object = { recordName: 'APP', fieldName: 'Kid', packagePath: ['APP', 'Kid'] }) =>
  encodeProgramArtifacts(source, { owner } as any).references
    .filter(reference => reference.kind === 'record' || reference.kind === 'field')
    .map(reference => reference.kind === 'record' ? `RECORD.${reference.recordName}` : `FIELD.${reference.fieldName}`);

test('a repeated Row-shorthand REC.FIELD reuses its RECORD and FIELD rows', () => {
  const source = appClass({ Run: ['Local Row &r;', 'Local string &a = &r.REC.FLD.Value;', 'Local string &b = &r.REC.FLD.Value;'] });
  assert.deepEqual(rows(source), ['RECORD.REC', 'FIELD.FLD']);
});

test('different fields of one record share the RECORD row and get one FIELD row each (28797)', () => {
  const source = appClass({ Run: ['Local Row &r;', 'Local string &a = &r.REC.FLD_A.Value;', 'Local string &b = &r.REC.FLD_B.Value;'] });
  assert.deepEqual(rows(source), ['RECORD.REC', 'FIELD.FLD_A', 'FIELD.FLD_B']);
});

test('the rows are reused across control groups and methods', () => {
  const source = appClass({
    Run: ['Local Row &r;', 'Local string &a = &r.REC.FLD.Value;', 'If &a = "" Then', '   &a = &r.REC.FLD.Value;', 'End-If;'],
    Other: ['Local Row &q;', 'Local string &b = &q.REC.FLD.Value;']
  });
  assert.deepEqual(rows(source), ['RECORD.REC', 'FIELD.FLD']);
});

test('a FIELD after a call-result row shorthand is reused within the statement (28764)', () => {
  const source = appClass({ Run: ['If GetLevel0()(1).REC.FLD.Value = "A" And GetLevel0()(1).REC.FLD.Value = "B" Then', 'End-If;'] });
  assert.deepEqual(rows(source).filter(row => row.startsWith('FIELD.')), ['FIELD.FLD']);
});

test('ordinary programs keep their allocation units for row shorthand', () => {
  const source = [
    'Local Row &r;',
    'Local string &a = &r.REC.FLD.Value;',
    'If &a = "" Then',
    '   &a = &r.REC.FLD.Value;',
    'End-If;',
    ''
  ].join('\n');
  const ordinary = rows(source, { recordName: 'REC', fieldName: 'FLD' });
  assert.equal(ordinary.filter(row => row === 'RECORD.REC').length, 2);
});
