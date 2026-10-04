import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 160: `%This.<method>(...)` where this class's own header declares
 * the method `Returns Record` is a Record value -- its bare member is a
 * FIELD row (29391 `%This.getDTLRecord().SETID.Value`: 44 / 44 sites
 * store the FIELD row) -- and `Returns Row` is a Row whose bare member is a
 * RECORD row (29249 `%This.getStackElement().CO_NAV_WRK`). A property the
 * type metadata declares `Row` is likewise a Row (29609 `property Row
 * eSignRowCommon;` ... `%This.eSignRowCommon.HCSC_ESIGN_WRK.USER_ID.Value`
 * stores RECORD.HCSC_ESIGN_WRK and the field row).
 */
const header = [
  'class Demo',
  '   method Run();',
  '   method getDTLRecord() Returns Record;',
  '   method getRow() Returns Row;',
  '   method getRs() Returns Rowset;',
  '   property Row eSignRow;',
  'end-class;'
].join('\n');
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const provider = createApplicationClassTypeMetadataProvider([{ path: ['APP', 'Demo'], source: header }], { isBuiltinType: isBuiltinObjectTypeName });
const keyOf = (r: any): string =>
  r.kind === 'record' ? `RECORD.${r.recordName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName ?? ''}.${r.fieldName ?? ''}`;
const encode = (body: string[]) => {
  const source = `${header}\n\nmethod Run\n${body.map(line => `   ${line}`).join('\n')}\nend-method;\n`;
  const context = { owner, applicationClassTypeMetadata: provider };
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { ...context, commentOpcodes }).program, program, 'roundtrip');
  const rows = references.filter(r => r.kind === 'record' || r.kind === 'field');
  // header types (Cycle 52) come first; every record/field row is written as its own NAMENUM operand
  const operands = new Set(decoded.tokens.filter(t => t.opcode === 0x21 || t.opcode === 0x4a).map(t => t.nameNum));
  for (const r of rows) assert.ok(operands.has(r.index + 1), `operand for ${keyOf(r)}`);
  return references.filter(r => r.kind !== 'owner').map(r => `${r.index + 1}:${keyOf(r)}`);
};

test('a member of an own `Returns Record` method result is a FIELD row (29391)', () => {
  assert.deepEqual(
    encode(['&a = %This.getDTLRecord().SETID.Value;', '&b = %This.getDTLRecord().SETID.Value;', '&c = %This.getDTLRecord().GPS_POST_ID.Value;']),
    ['2:PACKAGE.RECORD', '3:PACKAGE.ROW', '4:PACKAGE.ROWSET', '5:PACKAGE.DEMO', '6:FIELD.SETID', '7:FIELD.GPS_POST_ID']
  );
});

test('a member of an own `Returns Row` method result is a RECORD row (29249)', () => {
  assert.deepEqual(encode(['&a = %This.getRow().CO_NAV_WRK.PAGE.Value;']), ['2:PACKAGE.RECORD', '3:PACKAGE.ROW', '4:PACKAGE.ROWSET', '5:PACKAGE.DEMO', '6:RECORD.CO_NAV_WRK', '7:FIELD.PAGE']);
});

test('a Row-typed property is a Row value (29609)', () => {
  assert.deepEqual(
    encode(['%This.eSignRow.HCSC_ESIGN_WRK.USER_ID.Value = "x";', '%This.eSignRow.HCSC_ESIGN_WRK.DISPLAY_NAME.Value = "y";']),
    ['2:PACKAGE.RECORD', '3:PACKAGE.ROW', '4:PACKAGE.ROWSET', '5:RECORD.HCSC_ESIGN_WRK', '6:FIELD.USER_ID', '7:FIELD.DISPLAY_NAME']
  );
});

test('a Rowset result\'s own property and an inherited method result stay inline (controls)', () => {
  assert.deepEqual(encode(['&n = %This.getRs().ActiveRowCount;', '&v = %This.inheritedRecord().SETID.Value;']), ['2:PACKAGE.RECORD', '3:PACKAGE.ROW', '4:PACKAGE.ROWSET', '5:PACKAGE.DEMO']);
});
