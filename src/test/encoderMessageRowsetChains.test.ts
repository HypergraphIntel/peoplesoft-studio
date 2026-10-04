import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 162: a chain rooted at a declared `Local Message` is bound, so its
 * GetRowset() Rowset, GetRow(n) Row and GetRecord(n) Record follow the
 * ordinary transitions and a bare field member is a FIELD row (28784 /
 * 28785 / 28786 `&ReqMessage.GetRowset().GetRow(1).GetRecord(1).OPRID.Value
 * = &Userid`; every bare record / field member reached through a Message's
 * GetRowset() has its stored row, 14 / 14 sites). The Message type's own
 * PACKAGE row is unchanged; an undeclared root stays late-bound (Cycle 121).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const keyOf = (r: any) => r.kind === 'owner' ? '' : r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : r.kind === 'record' ? `RECORD.${r.recordName}` : `${r.recordName}.${r.fieldName}`;
const encode = (body: string[]) => {
  const source = ['class Demo', '   method Run(&Userid As string);', 'end-class;', '', 'method Run', ...body.map(line => `   ${line}`), 'end-method;', ''].join('\n');
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  const operands = new Set(decoded.tokens.filter(t => t.opcode === 0x21 || t.opcode === 0x4a).map(t => t.nameNum));
  for (const r of references.filter(x => x.kind === 'field')) assert.ok(operands.has(r.index + 1), `operand for ${keyOf(r)}`);
  return references.filter(r => r.kind !== 'owner').map(r => `${r.index + 1}:${keyOf(r)}`);
};

test('a declared Message GetRowset().GetRow(n).GetRecord(n) member is a FIELD row (28785)', () => {
  assert.deepEqual(
    encode([
      'Local Message &ReqMessage;',
      '&ReqMessage = CreateMessage(Operation.EOAG_GET_TEMPLATE_REQUEST, %IntBroker_Request);',
      '&ReqMessage.GetRowset().GetRow(1).GetRecord(1).OPRID.Value = &Userid;',
      '&ReqMessage.GetRowset().GetRow(1).GetRecord(1).EFFDT.Value = %Date;'
    ]),
    ['2:PACKAGE.MESSAGE', '3:Operation.EOAG_GET_TEMPLATE_REQUEST', '4:FIELD.OPRID', '5:FIELD.EFFDT']
  );
});

test('an undeclared root stays late-bound (control)', () => {
  assert.deepEqual(
    encode(['&Msg.GetRowset().GetRow(1).GetRecord(1).OPRID.Value = &Userid;']),
    []
  );
});
