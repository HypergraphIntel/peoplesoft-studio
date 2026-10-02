import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 121: in an ordinary program a member chain rooted at a variable
 * the program never declares is late-bound -- its bare RECORD / FIELD
 * members are inline names, not references (913
 * `&XLAT.GetRow(&I).GetRecord(1).FIELDVALUE.Value`, 13413
 * `&RSPrcsList.GetRow(&nbr).PMN_DERIVED.SELECT_FLAG.Value`). A declared
 * root binds them (FIELD / RECORD rows); `PanelGroup` declarations type
 * their variables like `Component` ones (4434 `PanelGroup Record
 * &REC_JOB;`). Symbolic arguments (`Record.X`, `Field.X`) are references
 * either way.
 */
const references = (source: string) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'R', fieldName: 'F' } }).references
    .filter(reference => reference.kind === 'record' || reference.kind === 'field')
    .map(reference => reference.kind === 'record' ? `RECORD.${reference.recordName}` : `FIELD.${reference.fieldName}`);

test('a declared Record variable binds its bare member as a FIELD row', () => {
  assert.deepEqual(references('Local Record &r;\n&x = &r.FLD.Value;\n'), ['FIELD.FLD']);
});

test('a chain on an undeclared root keeps its members inline (913)', () => {
  assert.deepEqual(references('&x = &rs.GetRow(1).GetRecord(1).FLD.Value;\n'), []);
  assert.deepEqual(references('Local Rowset &rs;\n&x = &rs.GetRow(1).GetRecord(1).FLD.Value;\n'), ['FIELD.FLD']);
});

test('Row shorthand on an undeclared CreateRowset target stays inline; declared, it binds RECORD and FIELD', () => {
  assert.deepEqual(references('&rs = CreateRowset(Record.REC);\n&x = &rs.GetRow(1).REC.FLD.Value;\n'), ['RECORD.REC']);
  assert.deepEqual(references('Local Rowset &rs;\n&x = &rs.GetRow(1).REC.FLD.Value;\n'), ['RECORD.REC', 'FIELD.FLD']);
});

test('a PanelGroup Record variable is declared (4434)', () => {
  assert.deepEqual(references('PanelGroup Record &r;\n&x = &r.FLD.Value;\n'), ['FIELD.FLD']);
});

test('symbolic Record.X / Field.X arguments are references on any root', () => {
  assert.deepEqual(references('&x = &rs.GetRow(1).GetRecord(Record.REC).GetField(Field.FLD).Value;\n'), ['RECORD.REC', 'FIELD.FLD']);
});

test('a Function parameter counts as declared', () => {
  assert.deepEqual(references('Function F(&r As Record)\n   &x = &r.FLD.Value;\nEnd-Function;\n'), ['FIELD.FLD']);
});
