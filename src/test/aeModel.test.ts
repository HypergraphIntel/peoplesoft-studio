import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { documentFromRows, findStep, newProgram, type AeDocument } from '../model/aeDocument.js';
import type { AppEngineRows } from '../model/appEngine.js';
import { AeSession, applyOp } from '../model/aeSession.js';
import { bindFields, validateAppEngine, validateAppEngineReferences, type AeReferenceLookup } from '../model/aeValidation.js';
import { dependencies, executionFlow, explainProgram } from '../model/aeSemantics.js';
import { diffSpec, documentFromSpec, specFromDocument, type AeProgramSpec } from '../model/aeSpec.js';
import { applyOperation } from '../model/aeOperations.js';
import { capturedProgram, captureExists, LAB, RESULTS } from './aeCaptures.js';

/*
 * The App Engine model around the document: the editing session, the
 * validator, the flow analysis, the agent spec and the MCP operations
 * (docs/APP_ENGINE.md, docs/APP_ENGINE_SEMANTICS.md).
 */

const fixture = (name: string) => documentFromRows(JSON.parse(readFileSync(path.join('src', 'test', 'fixtures', 'appEngine', `${name}.rows.json`), 'utf8')) as AppEngineRows);
const codes = (doc: AeDocument) => validateAppEngine(doc).map((d) => `${d.severity}:${d.code}`);

const SPEC: AeProgramSpec = {
  program: 'ZZ_AE_T1', description: 'Staging', stateRecords: [{ record: 'HR_HRWF0006_AET', default: true }], tempTables: ['ZZ_PCODE_TMP'], tempTableInstances: 2,
  sections: [
    { name: 'MAIN', steps: [
      { name: 'Init', actions: [{ type: 'SQL', sql: "%Select(IF_FLAG) SELECT 'Y' FROM PS_INSTALLATION", noRows: 'Abort' }] },
      { name: 'Emps', frequency: 100, actions: [
        { type: 'Do Select', doSelectType: 'Restartable', sql: '%Select(EMPLID)\nSELECT EMPLID FROM PS_PERSONAL_DATA' },
        { type: 'PeopleCode', onReturn: 'Skip Step', peopleCode: 'Local string &s = "x";\n' },
        { type: 'SQL', sql: "INSERT INTO %Table(ZZ_PCODE_TMP) (ZZ_PCODE_LAB_KEY) VALUES (%Bind(EMPLID))", reuse: 'Yes' }] },
      { name: 'Finish', actions: [{ type: 'Call Section', section: 'DONE' }] }] },
    { name: 'DONE', steps: [{ name: 'Log', actions: [{ type: 'Log Message', messageSet: 1000, messageNumber: 25, parameters: '%Bind(RUN_CNTL_ID)' }] }] }
  ]
};

test('the session applies operations, undoes and redoes them, and knows when it is dirty', () => {
  const s = new AeSession(newProgram('ZZ_AE_S'), 'absent');
  assert.equal(s.dirty, false);
  s.apply({ kind: 'insertAction', ref: { section: 'MAIN', step: 'Step01' }, type: 'S' });
  s.apply({ kind: 'setAction', ref: { section: 'MAIN', step: 'Step01', type: 'S' }, patch: { text: 'select a\n  from b' } });
  assert.equal(findStep(s.doc, { section: 'MAIN', step: 'Step01' }).step.actions[0].text, 'select a  from b', 'edited SQL is stored as App Designer stores it');
  assert.equal(s.dirty, true);
  assert.ok(s.undo());
  assert.equal(findStep(s.doc, { section: 'MAIN', step: 'Step01' }).step.actions[0].text, undefined);
  assert.ok(s.undo());
  assert.equal(s.dirty, false);
  assert.ok(s.redo());
  assert.equal(findStep(s.doc, { section: 'MAIN', step: 'Step01' }).step.actions.length, 1);
  assert.throws(() => s.apply({ kind: 'setSection', section: 'MAIN', patch: { isPublic: false } }), /MAIN is always Public/);
  assert.throws(() => s.apply({ kind: 'setStep', ref: { section: 'MAIN', step: 'Step01' }, patch: { descr: 'x'.repeat(31) } }), /at most 30/);
});

test('validation: App Designer\'s Edit Validation warnings and structural errors', () => {
  const fresh = newProgram('ZZ_AE_V');
  assert.deepEqual(codes(fresh), ['warning:no-actions']);
  const sql = applyOp(fresh, { kind: 'insertAction', ref: { section: 'MAIN', step: 'Step01' }, type: 'S' });
  assert.deepEqual(codes(sql), ['warning:no-text']);
  const both = structuredClone(sql);
  findStep(both, { section: 'MAIN', step: 'Step01' }).step.actions.push({ type: 'C', descr: 'x', descrlong: null, reuse: 'N', doSelectType: 'F' });
  assert.ok(codes(both).includes('error:sql-and-call'));
  const noMain = structuredClone(fresh);
  noMain.sections[0].name = 'OTHER';
  assert.ok(codes(noMain).includes('error:main-missing'));
  noMain.program.library = true;
  assert.ok(!codes(noMain).includes('error:main-missing'), 'a library needs no MAIN');
  const badCall = applyOp(fresh, { kind: 'insertAction', ref: { section: 'MAIN', step: 'Step01' }, type: 'C' });
  findStep(badCall, { section: 'MAIN', step: 'Step01' }).step.doSection = 'NOPE';
  assert.ok(codes(badCall).includes('error:call-missing'));
  const twoDefaults = { ...fresh, stateRecords: [{ record: 'A_AET', isDefault: true }, { record: 'B_AET', isDefault: true }] };
  assert.ok(codes(twoDefaults).includes('error:state-default'));
  // A Select/Fetch loop that commits while restart is on.
  const loop = documentFromSpec({ ...SPEC, sections: [{ name: 'MAIN', steps: [{ name: 'L', commitAfter: 'After Step', actions: [{ type: 'Do Select', sql: '%Select(A) SELECT A FROM PS_X' }] }] }] });
  assert.ok(codes(loop).includes('warning:select-fetch-commit'));
  // Every delivered fixture validates without errors.
  for (const f of ['TL_CAL_GEN', 'PTIAAUTSKEXE']) assert.deepEqual(codes(fixture(f)).filter((c) => c.startsWith('error')), [], f);
});

test('reference validation asks the database about records, programs and messages', async () => {
  const lookup: AeReferenceLookup = {
    recordType: async (r) => ({ HR_HRWF0006_AET: 0, ZZ_PCODE_TMP: 7, PS_NOT_TEMP: 0 } as Record<string, number>)[r],
    recordFields: async (r) => (r === 'HR_HRWF0006_AET' ? ['PROCESS_INSTANCE', 'OPRID', 'RUN_CNTL_ID', 'IF_FLAG', 'EMPLID'] : []),
    programSections: async (p) => (p === 'OTHER_PGM' ? [{ name: 'PUB', isPublic: true }, { name: 'PRIV', isPublic: false }] : undefined),
    messageExists: async (s, n) => s === 1000 && n === 25
  };
  const doc = documentFromSpec(SPEC);
  assert.deepEqual(await validateAppEngineReferences(doc, lookup), []);
  const bad = documentFromSpec({ ...SPEC, tempTables: ['PS_NOT_TEMP'], sections: [
    { name: 'MAIN', steps: [{ name: 'S1', actions: [{ type: 'Call Section', section: 'PRIV', program: 'OTHER_PGM' }] },
      { name: 'S2', actions: [{ type: 'SQL', sql: 'UPDATE PS_X SET A = %Bind(NO_SUCH_FIELD)' }] }] }] });
  const got = (await validateAppEngineReferences(bad, lookup)).map((d) => d.code);
  assert.deepEqual(got.sort(), ['bind-field', 'call-private', 'temp-type']);
  assert.deepEqual(bindFields('%Select(A, REC.B) SELECT 1 FROM X WHERE C = %Bind(C, NOQUOTES) AND D = %Bind(REC.D)').sort(), ['A', 'B', 'C', 'D']);
});

test('an Error-severity message before Exit(1) under On Return Break is refused; Warning is fine', async () => {
  // ZZ_BENEFITS.B_CONTRB.RESPAY abended on HRDMO with message 25500,9 (E); the same step
  // completed and broke cleanly once it logged 25500,20 (W).
  const sev: Record<string, string> = { '25500,9': 'E', '25500,20': 'W', '25500,30': 'C' };
  const lookup: AeReferenceLookup = {
    recordType: async () => 0, recordFields: async () => [], programSections: async () => undefined,
    messageExists: async () => true, messageSeverity: async (s, n) => sev[`${s},${n}`]
  };
  const step = (msg: number, onReturn: string) => {
    const d = documentFromSpec({ ...SPEC, stateRecords: [], sections: [{ name: 'MAIN', steps: [{ name: 'RESPAY',
      actions: [{ type: 'PeopleCode', peopleCode: `MessageBox(0, "", 25500, ${msg}, "No payroll.");\nExit(1);` }] }] }] });
    d.sections[0]!.variants[0]!.steps[0]!.onReturn = onReturn;
    return d;
  };
  const codes = async (d: ReturnType<typeof step>) => (await validateAppEngineReferences(d, lookup)).map((x) => x.code).filter((c) => c === 'break-error-message');
  assert.deepEqual(await codes(step(9, 'B')), ['break-error-message']);
  assert.deepEqual(await codes(step(30, 'B')), ['break-error-message']);
  assert.deepEqual(await codes(step(20, 'B')), []);
  // On Return Abort intends to stop, so an Error message there is right.
  assert.deepEqual(await codes(step(9, 'A')), []);
});

test('the flow follows the runtime: MAIN, the sections it calls, recursion and dependencies', () => {
  const doc = documentFromSpec(SPEC);
  const flow = executionFlow(doc);
  assert.deepEqual(flow.reachable, ['MAIN', 'DONE']);
  assert.deepEqual(flow.unreachable, []);
  const deps = dependencies(doc);
  assert.deepEqual(deps.tablesRead, ['INSTALLATION', 'PERSONAL_DATA']);
  assert.deepEqual(deps.tablesWritten, ['ZZ_PCODE_TMP']);
  assert.deepEqual(deps.messages, [{ set: 1000, number: 25 }]);
  assert.match(explainProgram(doc), /Do Select, Restartable/);
  const loop = structuredClone(doc);
  findStep(loop, { section: 'DONE', step: 'Log' }).step.actions.push({ type: 'C', descr: 'x', descrlong: null, reuse: 'N', doSelectType: 'F' });
  Object.assign(findStep(loop, { section: 'DONE', step: 'Log' }).step, { doSection: 'MAIN', doProgram: 'ZZ_AE_T1' });
  assert.deepEqual(executionFlow(loop).cycles, [['MAIN', 'DONE', 'MAIN']]);
});

test('a spec builds the program App Designer would, and reads back the same', () => {
  const doc = documentFromSpec(SPEC);
  const emps = findStep(doc, { section: 'MAIN', step: 'Emps' }).step;
  assert.deepEqual(emps.actions.map((a) => a.type), ['D', 'P', 'S'], 'actions in runtime order');
  assert.equal(emps.actions[0].text, '%Select(EMPLID) SELECT EMPLID FROM PS_PERSONAL_DATA');
  assert.equal(emps.onReturn, 'S');
  assert.deepEqual(diffSpec(doc, SPEC), []);
  assert.deepEqual(diffSpec(documentFromSpec(specFromDocument(doc)), specFromDocument(doc)), []);
});

test('every captured program state reads as a spec that describes it exactly', () => {
  let n = 0;
  for (const c of readdirSync(RESULTS).filter((d) => /^a[a-z]+\d/.test(d))) {
    if (!captureExists(c)) continue;
    const p = capturedProgram(c, 'after', LAB);
    if (!p) continue;
    const doc = documentFromRows(p.rows, p.peopleCode);
    assert.deepEqual(diffSpec(doc, specFromDocument(doc)), [], c);
    n++;
  }
  assert.ok(n > 60);
});

test('MCP operations make the designer\'s changes', () => {
  let doc = documentFromSpec(SPEC);
  doc = applyOperation(doc, { op: 'add_step', section: 'MAIN', after: 'Emps', name: 'Count', actions: [{ type: 'SQL', sql: 'DELETE FROM PS_X' }] });
  doc = applyOperation(doc, { op: 'set_action', section: 'MAIN', step: 'Finish', type: 'Call Section', callSection: 'DONE', callProgram: 'OTHER' });
  doc = applyOperation(doc, { op: 'rename_step', section: 'MAIN', step: 'Init', to: 'Start' });
  doc = applyOperation(doc, { op: 'set_program', applicationLibrary: false, batchOnly: true });
  doc = applyOperation(doc, { op: 'move_step', section: 'MAIN', step: 'Finish', after: null });
  const main = doc.sections.find((s) => s.name === 'MAIN')!;
  assert.deepEqual(main.variants[0].steps.map((s) => s.name), ['Finish', 'Start', 'Emps', 'Count']);
  assert.equal(findStep(doc, { section: 'MAIN', step: 'Finish' }).step.doProgram, 'OTHER');
  assert.equal(doc.program.recuse & 2, 2);
  assert.throws(() => applyOperation(doc, { op: 'add_action', section: 'MAIN', step: 'Finish', type: 'SQL', sql: 'x' }), /both SQL and Call Section/);
});
