import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 138: in an Application Class program a conditional-compilation
 * directive outside the method bodies ends the reference session -- the
 * implementations after it open their rows again (every kind), and their
 * operands use the new rows. 29724 `#If #ToolsRel >= "8.55.07" #Then` ...
 * `get ConfirmationWithReport` ... `#End-If;` then `method saveData`:
 * stored re-opens LAUNCHMANAGER, APPROVALMANAGER, TEXTCATALOG,
 * RECORD.PY_TD1_STG_CAN ... A directive inside a body opens nothing (the
 * ~40 programs with body directives store no repeat). A method's parameter
 * types stay in its class-header declaration's session (29249).
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const source = (betweenMethods: string, inFirstBody: string) => `import PKG:Util;

class Demo
   method First();
   method Second(&r As Record);
end-class;

method First
   Local PKG:Util &u = create PKG:Util();
   &u.Run(Record.PSOPRDEFN);
${inFirstBody}end-method;
${betweenMethods}
method Second
   /+ &r as Record +/
   Local PKG:Util &u = create PKG:Util();
   &u.Run(Record.PSOPRDEFN);
end-method;
`;
const encode = (betweenMethods: string, inFirstBody = '') =>
  encodeProgramArtifacts(source(betweenMethods, inFirstBody), { owner, conditionalCompilation: { toolsRelease: '8.61' } });
const keys = (references: readonly any[]) => references
  .filter(r => r.kind !== 'owner')
  .map(r => r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.kind.toUpperCase()}.${r.recordName}`);
const recordOperand = (index: number) => Buffer.from([0x21, index & 0xff, index >> 8]);

test('a top-level directive between implementations re-opens the rows after it (29724)', () => {
  const { program, references } = encode('\n#If #ToolsRel >= "8.55" #Then\n   Declare Function X PeopleCode FUNCLIB_X.FIELD1 FieldFormula;\n#End-If;\n');
  assert.deepEqual(keys(references), ['PACKAGE.UTIL', 'PACKAGE.RECORD', 'RECORD.PSOPRDEFN', 'PACKAGE.UTIL', 'RECORD.PSOPRDEFN']);
  // each method's `Record.PSOPRDEFN` operand is its own session's row
  const rows = references.filter(r => r.kind === 'record').map(r => r.index);
  assert.equal(rows.length, 2);
  for (const index of rows) assert.ok(program.includes(recordOperand(index)));
});

for (const [label, betweenMethods, inFirstBody] of [
  ['a directive inside a body', '', '   #If #ToolsRel >= "8.55" #Then\n   &x = 1;\n   #End-If;\n'],
  ['no directive', '', '']
] as const) {
  test(`${label} keeps one session: one row per key`, () => {
    const { program, references } = encode(betweenMethods, inFirstBody);
    assert.deepEqual(keys(references), ['PACKAGE.UTIL', 'PACKAGE.RECORD', 'RECORD.PSOPRDEFN']);
    assert.equal(program.indexOf(recordOperand(3)) !== program.lastIndexOf(recordOperand(3)), true);
  });
}
