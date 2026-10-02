import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolsRelCondition, preprocessConditionalCompilation } from '../peoplecode/conditionalCompilation.js';
import { encodeProgramArtifacts, UnsupportedPeopleCodeError } from '../peoplecode/encoder.js';

/*
 * Cycle 115: `#If #ToolsRel ... #Then ... #Else ... #End-If` conditional
 * compilation. Corpus shapes: 4115 (live Then, dead Else), 18320 (dead
 * Then with a same-line comment), 19510 (dead branch holding an incomplete
 * `If ... Then`), 4601 (`#End-If;`).
 */
const release = { toolsRelease: '8.61' };
const owner = { recordName: 'REC', fieldName: 'FLD' };
const encode = (source: string) => encodeProgramArtifacts(source, { owner, conditionalCompilation: release }).program;
const record = (opcode: number, text: string) => {
  const payload = Buffer.from(text, 'utf16le');
  const header = Buffer.alloc(3);
  header[0] = opcode;
  header.writeUInt16LE(payload.length, 1);
  return Buffer.concat([header, payload]);
};

test('#ToolsRel conditions compare dotted versions numerically at the literal precision', () => {
  assert.equal(evaluateToolsRelCondition('#ToolsRel >= "8.61"', '8.61'), true);
  assert.equal(evaluateToolsRelCondition('#ToolsRel >= "8.62"', '8.61'), false);
  assert.equal(evaluateToolsRelCondition('#ToolsRel < "8.55.12"', '8.61'), false);
  assert.equal(evaluateToolsRelCondition('#toolsrel>="8.55.06"', '8.61'), true);
  assert.equal(evaluateToolsRelCondition('#ToolsRel = "8.54"', '8.61'), false);
  assert.equal(evaluateToolsRelCondition('#ToolsRel >= "8.59.16" && #ToolsRel < "8.60"', '8.61'), false);
  // && binds tighter than ||
  assert.equal(evaluateToolsRelCondition('#ToolsRel >= "8.59" || #ToolsRel = "8.58" && #ToolsRel >= "8.58.07"', '8.58.07'), true);
  assert.equal(evaluateToolsRelCondition('#ToolsRel >= "8.59" || #ToolsRel = "8.58" && #ToolsRel >= "8.58.07"', '8.58.06'), false);
  assert.equal(evaluateToolsRelCondition('#ToolsRel >= 8.61', '8.61'), undefined);
  assert.equal(evaluateToolsRelCondition('#Other >= "8.61"', '8.61'), undefined);
});

test('the preprocessed source keeps every offset; directive lines become spaces', () => {
  const source = 'F();\n#If #ToolsRel >= "8.55" #Then\n   G();\n#End-If;\nH();\n';
  const result = preprocessConditionalCompilation(source, release)!;
  assert.equal(result.source.length, source.length);
  assert.ok(!result.source.includes('#'));
  assert.ok(result.source.includes('G();') && result.source.includes('H();'));
  assert.equal(result.regions.size, 2);
});

test('a live Then branch is compiled between bare #Then and #End-If records; #End-If; adds 0x15 (4115)', () => {
  const plain = encode('F();\nG();\nH();\n');
  const bytes = encode('F();\n#If #ToolsRel >= "8.55" #Then\n   G();\n#End-If;\nH();\n');
  const ifRecord = record(0x75, '#If #ToolsRel >= "8.55"');
  const at = bytes.indexOf(ifRecord);
  assert.ok(at > 0);
  assert.ok(bytes.includes(Buffer.concat([ifRecord, record(0x76, '#Then')])));
  assert.ok(bytes.includes(Buffer.concat([record(0x78, '#End-If'), Buffer.from([0x15])])));
  assert.equal(bytes.length, plain.length + ifRecord.length + record(0x76, '#Then').length + record(0x78, '#End-If').length + 1);
});

test('a dead branch is one record holding its source text, up to the last newline before the next directive', () => {
  const source = 'F();\n#If #ToolsRel < "8.55" #Then /* old */\n   Old();\n#Else\n   New();\n#End-If\n';
  const bytes = encode(source);
  assert.ok(bytes.includes(record(0x76, '#Then /* old */\n   Old();')));
  assert.ok(bytes.includes(record(0x77, '#Else')));
  assert.ok(bytes.includes(Buffer.from('New', 'utf16le')));
});

test('a dead branch may hold code the encoder cannot parse (19510)', () => {
  const source = 'F();\n#If #ToolsRel < "8.55" #Then\n   If Not (A()) Then\n#Else\n   If Not (B()) Then\n#End-If\n   G();\nEnd-If;\n';
  assert.doesNotThrow(() => encode(source));
});

test('#If inside a comment, a string, a REM or disabled code is not a directive', () => {
  for (const source of [
    '/* #If #ToolsRel >= "8.55" #Then */\nF();\n',
    'F("#If #ToolsRel");\n',
    'rem #If #ToolsRel >= "8.55" #Then;\nF();\n',
    '<*\n#If #ToolsRel >= "8.55" #Then\n#End-If\n*>\nF();\n'
  ]) {
    assert.equal(preprocessConditionalCompilation(source, release), undefined, source);
    assert.doesNotThrow(() => encode(source));
  }
});

test('nested directives are not supported (no corpus evidence)', () => {
  const source = '#If #ToolsRel >= "8.55" #Then\n#If #ToolsRel >= "8.56" #Then\nF();\n#End-If\n#End-If\n';
  assert.throws(() => encode(source), UnsupportedPeopleCodeError);
});

test('without a Tools release the source is encoded as before Cycle 115', () => {
  assert.throws(() => encodeProgramArtifacts('F();\n#If #ToolsRel >= "8.55" #Then\n   G();\n#End-If;\n', { owner }), UnsupportedPeopleCodeError);
});

/*
 * Cycle 115: a comment right before a directive closes no section; the
 * open section closes at the next real statement, after the directive's
 * records (25883: `15 4F 24 75 76 2D 4F`; 4601: the import section stays
 * open to the Declare, `15 24 75 76 78 15 2D 4F 31`).
 */
test('a comment before a directive leaves the leading Local run open (25883)', () => {
  const bytes = encode('Local Row &r;\n\n/* c */\n#If #ToolsRel >= "8.55" #Then\n\n   &x = F(Record.REC);\n#End-If;\n');
  const comment = record(0x24, '/* c */');
  const condition = record(0x75, '#If #ToolsRel >= "8.55"');
  const at = bytes.indexOf(comment);
  assert.equal(bytes.subarray(at - 2, at).toString('hex'), '154f');
  const then = record(0x76, '#Then');
  const afterThen = bytes.indexOf(Buffer.concat([condition, then])) + condition.length + then.length;
  assert.equal(bytes.subarray(afterThen, afterThen + 2).toString('hex'), '2d4f');
});

test('a comment before a directive keeps the import section open (4601)', () => {
  const bytes = encode('import PKG:*;\n/* c */\n#If #ToolsRel >= "8.62" #Then\n   import OTHER:Thing;\n#End-If;\n\nDeclare Function F PeopleCode REC.FLD FieldFormula;\n');
  const end = Buffer.concat([record(0x78, '#End-If'), Buffer.from([0x15])]);
  const at = bytes.indexOf(end) + end.length;
  assert.equal(bytes.subarray(at, at + 3).toString('hex'), '2d4f31');
  const comment = record(0x24, '/* c */');
  assert.equal(bytes[bytes.indexOf(comment) - 1], 0x15);
});
