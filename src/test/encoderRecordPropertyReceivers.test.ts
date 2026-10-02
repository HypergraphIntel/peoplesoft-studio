import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName, type EncodeProgramContext } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';

/*
 * Cycle 118: a property the type-metadata provider declares `Record` is a
 * declared Record value: its next bare member is a FIELD row, reused like
 * a Record variable's. Corpus shape 29128 (`property Record ObjectRecord
 * readonly;` ... `Return %This.ObjectRecord.CAF_FCTLST_ID.Value;`), 29954
 * (repeated fields reuse one row), 19432 (an ordinary program:
 * `&AdsProjectBinds [&CurrentADS].CompareLogRec.PTSESSIONID.Value`).
 */
const kidHeader = [
  'import PKG:*;',
  'class Kid extends PKG:Base',
  '   method Run();',
  '   property Record ObjectRecord readonly;',
  '   property PKG:Outer Wrapper;',
  'end-class;',
  ''
].join('\n');
const provider = createApplicationClassTypeMetadataProvider([
  { path: ['APP', 'Kid'], source: kidHeader },
  { path: ['PKG', 'Base'], source: 'class Base\n   property Record BaseRec;\nend-class;\n' },
  { path: ['PKG', 'Holder'], source: 'class Holder\n   property Record Rec;\n   property Row TheRow;\n   property Field Fld;\nend-class;\n' },
  { path: ['PKG', 'Outer'], source: 'class Outer\n   property PKG:Holder Inner;\nend-class;\n' },
  // a class named Record does not make `property Record X` a class (Cycle 107 precedence)
  { path: ['PKG', 'Record'], source: 'class Record\n   method Ping();\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });

const program = (body: string[]) => [
  kidHeader.replace('end-class;', '').trimEnd(),
  'end-class;',
  '',
  'method Run',
  ...body.map(line => `   ${line}`),
  'end-method;',
  ''
].join('\n');
const fields = (source: string, extra: Partial<EncodeProgramContext> = { applicationClassTypeMetadata: provider }) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: 'Kid', packagePath: ['APP', 'Kid'] }, ...extra }).references
    .filter(reference => reference.kind === 'field')
    .map(reference => reference.fieldName);
const packages = (source: string) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'APP', fieldName: 'Kid', packagePath: ['APP', 'Kid'] }, applicationClassTypeMetadata: provider }).references
    .filter(reference => reference.kind === 'package')
    .map(reference => reference.packageName);

test('a member of an own Record-typed property is a FIELD row (29128)', () => {
  const source = program(['Local string &id = %This.ObjectRecord.CAF_FCTLST_ID.Value;']);
  assert.deepEqual(fields(source), ['CAF_FCTLST_ID']);
  // without type metadata the member stays inline
  assert.deepEqual(fields(source, {}), []);
});

test('a repeated field of the same Record property reuses its row (29954)', () => {
  const source = program([
    'Local string &a = %This.ObjectRecord.APPROVEOPRID.Value;',
    'Local string &b = %This.ObjectRecord.APPROVEOPRID.Value;'
  ]);
  assert.deepEqual(fields(source), ['APPROVEOPRID']);
});

test('inherited (%Super), typed-receiver and chained Record properties', () => {
  assert.deepEqual(fields(program(['Local string &a = %Super.BaseRec.EMPLID.Value;'])), ['EMPLID']);
  assert.deepEqual(fields(program(['Local PKG:Holder &h = create PKG:Holder();', 'Local string &a = &h.Rec.SETID.Value;'])), ['SETID']);
  assert.deepEqual(fields(program(['Local string &a = %This.Wrapper.Inner.Rec.DEPTID.Value;'])), ['DEPTID']);
});

test('Record intrinsic properties stay inline after a Record-typed property', () => {
  assert.deepEqual(fields(program(['Local integer &n = %This.ObjectRecord.FieldCount;', 'Local string &s = %This.ObjectRecord.Name;'])), []);
});

test('Row- and Field-typed properties do not make their next member a FIELD row', () => {
  assert.deepEqual(fields(program(['Local PKG:Holder &h = create PKG:Holder();', 'Local number &n = &h.TheRow.RowNumber;', 'Local string &v = &h.Fld.Value;'])), []);
});

test('a built-in Record property allocates no PACKAGE row and wins over a class named Record', () => {
  const source = program(['Local string &id = %This.ObjectRecord.CAF_FCTLST_ID.Value;']);
  assert.deepEqual(fields(source), ['CAF_FCTLST_ID']);
  const withoutAccess = program(['Local string &id = "";']);
  assert.deepEqual(packages(source), packages(withoutAccess));
});

test('diagnostics-only metadata is identical to no provider', () => {
  const source = program(['Local string &id = %This.ObjectRecord.CAF_FCTLST_ID.Value;']);
  assert.deepEqual(
    fields(source, { applicationClassTypeMetadata: provider, applicationClassTypeMetadataDiagnosticsOnly: true }),
    fields(source, {})
  );
});
