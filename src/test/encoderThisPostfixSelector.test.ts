import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 156: a `%This` chain may take a direct postfix `(...)` selector after
 * a call result, like an `&variable` chain (stored `14 ) 0B ( ... 14 )`;
 * 30068 `%This.lvl0_.GetRow(1).GetRowset(Scroll.PTAFEMC_LYT_LIN)(&i)`).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const tokensOf = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references as any[]) {
    const key = r.kind === 'scroll' ? `SCROLL.${r.recordName}` : r.kind === 'package' ? `PACKAGE.${r.packageName}`
      : r.kind === 'record' ? `RECORD.${r.recordName}` : r.kind === 'field' ? `FIELD.${r.fieldName}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`;
    names.add(r.index + 1, key.toUpperCase());
  }
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  return decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined && t.nameNum === undefined ? ':' + t.text : ''}`);
};
const wrap = (body: string) => `class Demo
   method Run();
   property Rowset lvl0_;
end-class;

method Run
   Local number &i;
${body}
end-method;
`;

test('a %This chain takes a postfix selector after a method result (30068)', () => {
  const tokens = tokensOf(wrap('   &row = %This.lvl0_.GetRow(1).GetRowset(Scroll.TEST_SCROLL)(&i);'));
  const at = tokens.lastIndexOf('1:&i');
  assert.deepEqual(tokens.slice(at - 2, at + 2), ['14:)', 'b:(', '1:&i', '14:)']);
});

test('the selector result continues the chain (29338 `%This.getSucRowset()(1).IsNew`)', () => {
  tokensOf(wrap('   If %This.getSucRowset()(1).IsNew Then\n      &i = 1;\n   End-If;'));
});

test('a %This member that is not a call result still takes the postfix the same way (control: &variable root)', () => {
  tokensOf(wrap('   Local Rowset &rs;\n   &row = &rs.GetRow(1).GetRowset(Scroll.TEST_SCROLL)(&i);'));
});

test('a literal still cannot be invoked', () => {
  assert.throws(() => encodeProgramArtifacts('&x = True(1);\n'), Error);
});
