import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import {
  changeActionType, deleteAction, deleteSection, documentFromRows, findStep, insertAction, insertSection, insertStep, newProgram,
  renameSection, renameStep, type AeDocument
} from '../model/aeDocument.js';
import type { Row } from '../model/appEngine.js';
import { formatAeSql } from '../model/aeDocument.js';
import { applyOp } from '../model/aeSession.js';
import { appEngineToken, planAppEngineSave, type Counters, type StoredAppEngine, type StoredSql } from '../providers/appEngineWriter.js';
import type { StoredProgram } from '../peoplecode/writeback/savePlan.js';
import { capturedProgram, captureExists, LAB, tableRows } from './aeCaptures.js';

/*
 * The App Engine writer's plans against App Designer's saves
 * (docs/APP_ENGINE.md): the program as it was before a captured save, the
 * same edit, and the plan must move the counters App Designer moved, write
 * the tombstones it wrote, and treat SQL and PeopleCode as it did.
 */

function storedFrom(caseName: string, phase: 'before' | 'after', program = LAB): StoredAppEngine {
  const p = capturedProgram(caseName, phase, program)!;
  const key = (r: Row) => `${String(r.SQLID)}|${String(r.SQLTYPE).trim()}`;
  const sql: StoredSql[] = p.sqlDefn.map((d) => ({
    sqlId: String(d.SQLID), sqlType: String(d.SQLTYPE).trim(), defn: d,
    descr: p.sqlDescr.filter((r) => key(r) === key(d)), text: p.rows.sqlText.filter((r) => key(r) === key(d)), hash: p.sqlHash.filter((r) => key(r) === key(d))
  }));
  const peopleCode = new Map<string, StoredProgram>();
  const pcKey = (r: Row) => [1, 2, 3, 4, 5, 6, 7].map((n) => String(r[`OBJECTVALUE${n}`])).join('|');
  const entry = (r: Row) => {
    const k = pcKey(r);
    if (!peopleCode.has(k)) peopleCode.set(k, { key: { objectIds: [66, 77, 39, 20, 21, 78, 12], objectValues: k.split('|') }, text: [], program: [], names: [] });
    return peopleCode.get(k)!;
  };
  for (const r of tableRows(caseName, phase, 'PSPCMTXT', program)) entry(r).text.push({ progseq: Number(r.PROGSEQ), text: String(r.PCTEXT), hashSignature: String(r.HASH_SIGNATURE) });
  for (const r of tableRows(caseName, phase, 'PSPCMPROG', program)) {
    entry(r).program.push({
      progseq: Number(r.PROGSEQ), version: Number(r.VERSION), namecount: Number(r.NAMECOUNT), proglen: Number(r.PROGLEN), progrunloc: Number(r.PROGRUNLOC),
      progflags: Number(r.PROGFLAGS), licenseCode: String(r.LICENSE_CODE), lastupddttm: String(r.LASTUPDDTTM), lastupdoprid: String(r.LASTUPDOPRID),
      progextends: String(r.PROGEXTENDS), pttoolsrel: String(r.PTTOOLSREL), bytes: Buffer.from(String(r.PROGTXT), 'hex')
    });
  }
  for (const r of tableRows(caseName, phase, 'PSPCMNAME', program)) {
    entry(r).names.push({ namenum: Number(r.NAMENUM), recname: String(r.RECNAME), refname: String(r.REFNAME), packageroot: String(r.PACKAGEROOT), qualifypath: String(r.QUALIFYPATH), appclassmethod: String(r.APPCLASSMETHOD) });
  }
  return { exists: true, rows: p.rows, sql, peopleCode, tombstones: { program: p.appDel, sections: p.sectDel, sql: p.sqlDel, peopleCode: p.pcDel } };
}

const docOf = (s: StoredAppEngine) => documentFromRows(s.rows, new Map([...s.peopleCode].map(([k, p]) => [k, [...p.text].sort((a, b) => a.progseq - b.progseq).map((t) => t.text).join('')])));

function plan(caseName: string, edit: (d: AeDocument) => AeDocument) {
  const stored = storedFrom(caseName, 'before');
  const before = capturedProgram(caseName, 'before', LAB)!;
  const counters = Object.fromEntries((['AEM', 'AES', 'SRM', 'PCM', 'PJM', 'SYS'] as const).map((n) => [n, before.counters[n]])) as unknown as Counters;
  return plan0(stored, edit(docOf(stored)), counters);
}
const plan0 = (stored: StoredAppEngine | undefined, doc: AeDocument, counters: Counters) =>
  planAppEngineSave(stored, doc, { operatorId: 'JARED', toolsRelease: '8.62', lastupddttm: '2026-10-11T12:00:00.000000', counters, oracledb: ADAPTER_TYPES });

/** App Designer's counter moves in a capture. */
function moved(caseName: string): Record<string, number> {
  const b = capturedProgram(caseName, 'before', LAB)!.counters;
  const a = capturedProgram(caseName, 'after', LAB)?.counters ?? capturedProgram(caseName, 'before', LAB)!.counters;
  return Object.fromEntries(['AEM', 'AES', 'SRM', 'PCM', 'PJM', 'SYS'].map((n) => [n, (a[n] ?? 0) - (b[n] ?? 0)]).filter(([, d]) => d !== 0));
}
const incs = (p: ReturnType<typeof plan>) => Object.fromEntries(Object.entries(p.increments).filter(([, d]) => d));
const MAIN = 'MAIN';

test('an unchanged document plans nothing', () => {
  for (const c of ['ap20-progtype-std', 'ar01-rename-step', 'ae17-recreate-keys', 'ax43-xslt-text']) {
    if (!captureExists(c)) continue;
    const p = plan(c, (d) => d);
    assert.equal(p.empty, true, c);
    assert.equal(p.statements.length, 0, c);
  }
});

test('plans move the counters App Designer moved', () => {
  const cases: [string, (d: AeDocument) => AeDocument][] = [
    ['ap02-comments', (d) => ({ ...d, program: { ...d.program, descrlong: 'Lab comments line' } })],
    ['ap11-state-add', (d) => ({ ...d, stateRecords: [{ record: 'AE_GB_AET', isDefault: true }] })],
    ['as01-descr', (d) => { const x = structuredClone(d); x.sections.find((s) => s.name === 'Section1')!.variants[0].descr = 'Lab section one'; return x; }],
    ['ax26-insert-step2', (d) => insertStep(d, { section: MAIN, after: 'Step01' }).doc],
    ['ax14-insert-4', (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc],
    ['ar01-rename-step', (d) => renameStep(d, { section: MAIN, step: 'Step01' }, 'Init')],
    ['ae11-rename-section', (d) => renameSection(d, 'Section2', 'Proc')],
    ['ae16-delete-section', (d) => deleteSection(d, 'Proc')],
    ['ad01-delete-pc', (d) => deleteAction(d, { section: MAIN, step: 'Init', type: 'P' })],
    ['ad02-delete-sql', (d) => deleteAction(d, { section: MAIN, step: 'Init', type: 'S' })],
    ['ae10-insert-section', (d) => insertSection(d).doc],
    ['ax27-type-to-call', (d) => changeActionType(d, { section: MAIN, step: 'Step02', type: 'S' }, 'C')],
    ['ae18-market-with-actions', (d) => { const x = structuredClone(d); x.sections.find((s) => s.name === MAIN)!.variants[0].market = 'GBR'; return x; }],
    ['aa03-sql-resave', (d) => { const x = structuredClone(d); findStep(x, { section: MAIN, step: 'Step01' }).step.actions.find((a) => a.type === 'S')!.text = 'UPDATE PS_ZZ_X   SET A = 1   WHERE B = %Bind(EMPLID) AND C = 3'; return x; }],
    ['ap-pc02-update', (d) => { const x = structuredClone(d); findStep(x, { section: MAIN, step: 'Step01' }).step.actions.find((a) => a.type === 'P')!.peopleCode = 'Local string &s = "ae02";\n'; return x; }]
  ];
  for (const [c, edit] of cases) {
    if (!captureExists(c)) continue;
    assert.deepEqual(incs(plan(c, edit)), moved(c), c);
  }
});

test('a step rename moves its SQL (ENABLEEFFDT N, PSSQLDEL) and its PeopleCode (PSPCMPROGDEL) [ar01]', () => {
  if (!captureExists('ar01-rename-step')) return;
  const p = plan('ar01-rename-step', (d) => renameStep(d, { section: MAIN, step: 'Step01' }, 'Init'));
  const sql = p.statements.map((s) => s.sql).join('\n');
  assert.match(p.summary.sqlChanged.join(), /MAIN    Init    S moved/);
  assert.match(p.summary.sqlChanged.join(), /MAIN    Step01  S deleted/);
  const defn = p.statements.find((s) => /^INSERT INTO PSSQLDEFN/.test(s.sql))!;
  assert.ok(Object.values(defn.binds).includes('N'), 'ENABLEEFFDT N');
  assert.match(sql, /INSERT INTO PSSQLDEL/);
  assert.match(sql, /INSERT INTO PSPCMPROGDEL/);
  assert.deepEqual(p.summary.peopleCodeChanged, ['MAIN.GBL.default.1900-01-01.Init.OnExecute moved', 'MAIN.GBL.default.1900-01-01.Step01.OnExecute deleted']);
  // The moved PeopleCode is the stored program, byte for byte, at the new PCM.
  const moved = [...p.peopleCode.values()][0];
  const stored = storedFrom('ar01-rename-step', 'after');
  const after = stored.peopleCode.get([...p.peopleCode.keys()][0])!;
  assert.ok(moved.program[0].bytes.equals(after.program[0].bytes));
  assert.equal(moved.program[0].version, Number(after.program[0].version));
});

test('re-creating a deleted key removes its tombstone [ae17]; a section delete writes one [ae16]', () => {
  if (captureExists('ae16-delete-section')) {
    const p = plan('ae16-delete-section', (d) => deleteSection(d, 'Proc'));
    assert.deepEqual(p.summary.tombstones.sort(), ['PSAESECTDEL Proc', 'PSPCMPROGDEL Proc.GBL.default.1900-01-01.Step01', 'PSSQLDEL ZZ_AE_LAB01 Proc    Step01  S'].sort());
  }
  if (captureExists('ae17-recreate-keys')) {
    const stored = storedFrom('ae17-recreate-keys', 'before');
    const after = capturedProgram('ae17-recreate-keys', 'after', LAB)!;
    // The document as App Designer saved it; its new keys had tombstones.
    const doc = documentFromRows(after.rows, after.peopleCode);
    for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) { if (st.name === 'Step01') delete st.origin; }
    const p = plan0(stored, doc, capturedProgram('ae17-recreate-keys', 'before', LAB)!.counters as unknown as Counters);
    const sql = p.statements.map((s) => s.sql).join('\n');
    assert.match(sql, /DELETE FROM PSSQLDEL/);
    assert.match(sql, /DELETE FROM PSPCMPROGDEL/);
  }
});

test('a new program plans App Designer\'s create: AEM, AES, SYS + 1; LICENSE_CODE blank [ae01]', () => {
  const counters = { AEM: 6, AES: 1, SRM: 27, PCM: 123, PJM: 58, SYS: 2088 };
  const p = plan0(undefined, newProgram('ZZ_AE_NEW'), counters);
  assert.deepEqual(incs(p), { AEM: 1, AES: 1, SYS: 1 });
  const program = p.statements.find((s) => /^INSERT INTO PSAEAPPLDEFN/.test(s.sql))!;
  assert.ok(Object.values(program.binds).includes(7), 'VERSION = new AEM');
  assert.equal(p.desired.program.LICENSE_CODE, ' ');
  assert.equal(p.desired.program.ASOF_DT, null);
  assert.equal(appEngineToken(undefined), 'absent');
});

test('SQL typed in the editor is flattened; unchanged stored SQL is never rewritten', () => {
  if (!captureExists('aa03-sql-resave')) return;
  const ref = { section: MAIN, step: 'Step01', type: 'S' as const };
  // Stored text that flattening would change (two spaces after a line break) is written back as it is.
  assert.equal(plan('ar01-rename-step', (d) => renameStep(d, { section: MAIN, step: 'Step01' }, 'Init'))
    .statements.filter((s) => /^INSERT INTO PSSQLTEXTDEFN/.test(s.sql)).map((s) => (Object.values(s.binds).find((b) => (b as { val?: string })?.val) as { val: string }).val)[0],
  "  select 'a b'  from x");
  // Re-laying out the stored text in an editor changes nothing.
  const same = plan('aa03-sql-resave', (d) => applyOp(d, { kind: 'setAction', ref, patch: { text: formatAeSql(findStep(d, ref).step.actions.find((a) => a.type === 'S')!.text!) } }));
  assert.equal(same.empty, true);
  const p = plan('aa03-sql-resave', (d) => applyOp(d, { kind: 'setAction', ref, patch: { text: 'UPDATE PS_ZZ_X\n   SET A = 1\n   WHERE B = %Bind(EMPLID) AND C = 3' } }));
  const text = p.statements.find((s) => /^INSERT INTO PSSQLTEXTDEFN/.test(s.sql))!;
  assert.ok(Object.values(text.binds).some((b) => (b as { val?: string })?.val === 'UPDATE PS_ZZ_X  SET A = 1  WHERE B = %Bind(EMPLID) AND C = 3'));
});

test('PeopleCode that does not compile is refused, never written', () => {
  if (!captureExists('ap-pc02-update')) return;
  assert.throws(() => plan('ap-pc02-update', (d) => {
    const x = structuredClone(d);
    findStep(x, { section: MAIN, step: 'Step01' }).step.actions.find((a) => a.type === 'P')!.peopleCode = 'Local string &s = ;\n';
    return x;
  }), /does not compile/);
});

test('creating a program whose name was deleted removes its tombstones, as App Designer\'s next save does [nae01]', () => {
  const missing: StoredAppEngine = {
    exists: false, sql: [], peopleCode: new Map(),
    rows: { program: {}, states: [], tempTables: [], languages: [], sections: [], variants: [], steps: [], actions: [], messages: [], sqlText: [] },
    tombstones: { program: [{ AE_APPLID: 'ZZ_AE_NEW', VERSION: 291 }], sections: [{ AE_APPLID: 'ZZ_AE_NEW', AE_SECTION: 'MAIN', VERSION: 269 }], sql: [], peopleCode: [] }
  };
  const p = plan0(missing, newProgram('ZZ_AE_NEW'), { AEM: 300, AES: 280, SRM: 1, PCM: 1, PJM: 1, SYS: 2439 });
  const sql = p.statements.map((s) => s.sql).join('\n');
  assert.match(sql, /DELETE FROM PSAEAPPLDEL/);
  assert.match(sql, /DELETE FROM PSAESECTDEL/);
});
