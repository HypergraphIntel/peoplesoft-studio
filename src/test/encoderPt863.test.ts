import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';
import { createPt863CompilerProfile } from '../peoplecode/compilerProfile.js';

/*
 * PT863 lab-native track (2026-11-24): the rules that closed the 36
 * non-EXACT programs of the lab's 8.63.05 recompile (963 / 963 EXACT,
 * tools/corpus/controlled-compile/results/8.63.05). Each test pins one
 * rule on a synthetic program; the cited lab program is the evidence.
 */
const keyOf = (r: any) => r.kind === 'owner' ? '' : r.kind === 'package' ? `PACKAGE.${String(r.packageName).toUpperCase()}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`.toUpperCase();
const ordinaryOwner = { recordName: 'ZZ_REC', fieldName: 'ZZ_FLD' };
const appOwner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };

const encode = (source: string, context: any = { owner: ordinaryOwner }) => {
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, keyOf(r));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: context.owner?.packagePath !== undefined });
  return {
    program,
    rows: references.filter(r => r.kind !== 'owner').map(r => keyOf(r)),
    text: decoded.text,
    tokens: decoded.tokens
  };
};
const dword = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
const occurrences = (haystack: Buffer, needle: Buffer) => {
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
};

test('Local boolean initialized from (create X()).Method() is an ordinary expression (PTMFA_RENAME)', () => {
  const { text } = encode('Local boolean &bok = (create PT_SECURITY:MFA:MFA_UTIL()).RenameDevice("A");\n');
  assert.match(text, /\(create PT_SECURITY:MFA:MFA_UTIL\(\)\)\.RenameDevice\("A"\)/);
});

test('an operand may open with a block comment, stored in place (PTNUI_LAND_WRK)', () => {
  const { tokens } = encode('Local string &s;\n&s = /*&label*/MsgGetText(95, 10247, "Add");\n');
  const at = tokens.findIndex(t => t.text === '/*&label*/');
  assert.ok(at > 0);
  assert.equal(tokens[at].opcode, 0x4e);
  assert.equal(tokens[at - 1].text, '=');
});

test('<* *> comments before an argument and before its comma stay in place (ConsolidateFilters)', () => {
  const { tokens } = encode('Local array of string &a;\n&a = CreateArray("x",\n   <*index here*>\n   "key:"\n   <*Key *>\n   , "y");\n');
  const shape = tokens.filter(t => [0x03, 0x16, 0x55].includes(t.opcode)).map(t => t.opcode === 0x55 ? t.text : t.opcode === 0x03 ? ',' : 'str');
  assert.deepEqual(shape, ['str', ',', '<*index here*>', 'str', '<*Key *>', ',', 'str']);
});

test('Function JavaObject / ProcessRequest parameters and Returns JsonBuilder: descriptors and PACKAGE rows', () => {
  const { program, rows } = encode([
    'Function F(&a As JavaObject, &r As ProcessRequest) Returns JsonBuilder',
    '   Return CreateJsonBuilder();',
    'End-Function;',
    ''
  ].join('\n'));
  assert.ok(program.includes(dword(0xc008001b)), 'JavaObject parameter c008001b');
  assert.ok(program.includes(dword(0xc008000b)), 'ProcessRequest parameter c008000b');
  assert.ok(program.includes(dword(0x00080061)), 'JsonBuilder return 80061');
  for (const row of ['PACKAGE.JAVAOBJECT', 'PACKAGE.PROCESSREQUEST', 'PACKAGE.JSONBUILDER']) assert.ok(rows.includes(row), row);
});

test('PTDirectTransferObject, CQChunkedProcessor and PPMClass are built-ins with a PACKAGE row', () => {
  const { rows } = encode('Local PTDirectTransferObject &o;\nLocal CQChunkedProcessor &c;\nLocal PPMClass &p;\n&p = GetPPMInst("x");\n');
  assert.deepEqual(rows, ['PACKAGE.PTDIRECTTRANSFEROBJECT', 'PACKAGE.CQCHUNKEDPROCESSOR', 'PACKAGE.PPMCLASS']);
});

test('ComponentLife: a built-in allocates its row, a %metadata class parses (PTS_MNG_WL_WRK, PTPG_NUI_VWR)', () => {
  assert.deepEqual(encode('ComponentLife Rowset &rs;\n&rs = GetRowset();\n').rows, ['PACKAGE.ROWSET']);
  assert.match(encode('ComponentLife %metadata:ComponentDefn:ComponentDefn &cd;\n').text, /ComponentLife %metadata:ComponentDefn:ComponentDefn &cd;/i);
});

test('a quote inside a REM does not hide later Functions from the directory (PORTAL_GEN_FUNC)', () => {
  const body = (rem: string) => [
    'Function FuncOneZ()',
    'End-Function;',
    '',
    rem,
    'Function FuncTwoZ()',
    'End-Function;',
    ''
  ].join('\n');
  const name = Buffer.from('FuncTwoZ', 'utf16le');
  // the name is written in the code and again in the Function directory
  assert.equal(occurrences(encode(body('REM plain text;')).program, name), 2);
  assert.equal(occurrences(encode(body('REM " -- &quot ;')).program, name), 2);
});

test('a method call on a same-program Function result is a method row of its Returns class (PTS_SRCH_BTN)', () => {
  const program = (labelBody: string) => encode([
    'Function GetUtilsObj() Returns PTS_CFGSRCH_FL:Utilities',
    '   Return create PTS_CFGSRCH_FL:Utilities();',
    'End-Function;',
    '',
    'Function Label() Returns string',
    labelBody,
    'End-Function;',
    ''
  ].join('\n')).rows;
  const withCall = program('   Return GetUtilsObj().GetRecFieldLabelId("A", "B");');
  const without = program('   Return "A";');
  // the call adds exactly one UTILITIES row, after the existing ones
  assert.deepEqual(withCall, [...without, 'PACKAGE.UTILITIES']);
});

test('App Class: IBConnectorInfo / Chart / CQRuntime / JsonParser are built-in descriptors (PTCBAPPLSVCDEFN)', () => {
  const { program } = encode([
    'class Demo',
    '   property IBConnectorInfo IBConnector;',
    '   property Chart TheChart;',
    '   property CQRuntime Runtime;',
    '   property JsonParser Parser;',
    'end-class;',
    ''
  ].join('\n'), { owner: appOwner });
  for (const value of [0x8002d, 0x8001f, 0x80044, 0x80066]) assert.ok(program.includes(dword(value)), value.toString(16));
});

test('App Class: a named %metadata import does not stand in for the header row (WebHookHdrProp)', () => {
  const { rows } = encode([
    'import %metadata:Webhook:Ptibwebhdrprp;',
    '',
    'class Demo',
    '   method Demo(&p As %metadata:Webhook:Ptibwebhdrprp);',
    'end-class;',
    '',
    'method Demo',
    'end-method;',
    ''
  ].join('\n'), { owner: appOwner });
  assert.deepEqual(rows, ['PACKAGE.PTIBWEBHDRPRP']);
});

test('App Class: a comment between a property type and its name stays in place (Tile)', () => {
  const { tokens } = encode('class Demo\n   property array of string /* note */Items;\nend-class;\n', { owner: appOwner });
  const at = tokens.findIndex(t => t.text === '/* note */');
  assert.ok(at > 0);
  assert.equal(tokens[at].opcode, 0x4e);
  assert.equal(tokens[at + 1].text, 'Items');
});

test('App Class: a Declare Function target repeated across a directive opens a row per session (PTSFEnableRTI)', () => {
  const { rows } = encode([
    'class Demo',
    '   method Run();',
    'end-class;',
    '',
    'Declare Function A PeopleCode ZZ_WK.ZZ_FLD FieldFormula;',
    '#If #ToolsRel >= "8.60" #Then',
    'Declare Function B PeopleCode ZZ_WK.ZZ_FLD FieldFormula;',
    '#End-If',
    'Declare Function C PeopleCode ZZ_WK.ZZ_FLD FieldFormula;',
    '',
    'method Run',
    'end-method;',
    ''
  ].join('\n'), { owner: appOwner, profile: createPt863CompilerProfile() });
  assert.deepEqual(rows, ['ZZ_WK.ZZ_FLD', 'ZZ_WK.ZZ_FLD', 'ZZ_WK.ZZ_FLD']);
});
