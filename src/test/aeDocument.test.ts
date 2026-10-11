import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
  deleteSection, documentFromRows, findStep, flattenAeSql, insertAction, newProgram, nextName, rowsFromDocument, storedActionText,
  type AeDocument
} from '../model/aeDocument.js';
import { PROPERTY_OPS, STRUCTURE_OPS } from './aeCaptureOps.js';
import type { Row } from '../model/appEngine.js';
import { capturedProgram, captureExists, LAB, RESULTS } from './aeCaptures.js';

/*
 * The editable App Engine document against App Designer's own saves
 * (docs/APP_ENGINE.md): what it reads from a stored program writes the same
 * rows back, and each operation, applied to the program as it was before a
 * captured save, gives the rows App Designer saved.
 */

const STAMPS = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const norm = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => !STAMPS.has(k)).map(([k, v]) =>
  [k, v === null || v === undefined ? null : (k === 'EFFDT' || k === 'ASOF_DT') ? String(v).slice(0, 10) : String(v)]));
const set = (rows: Row[]) => rows.map((r) => JSON.stringify(norm(r), Object.keys(norm(r)).sort())).sort();

const TABLES = [
  ['program', 'PSAEAPPLDEFN'], ['states', 'PSAEAPPLSTATE'], ['tempTables', 'PSAEAPPLTEMPTBL'], ['sections', 'PSAESECTDEFN'],
  ['variants', 'PSAESECTDTLDEFN'], ['steps', 'PSAESTEPDEFN'], ['actions', 'PSAESTMTDEFN'], ['messages', 'PSAESTEPMSGDEFN']
] as const;

/** Asserts the document's rows are exactly the captured program's (PSAE tables, SQL text, PeopleCode), stamps aside. */
function assertRows(doc: AeDocument, caseName: string, phase: 'before' | 'after', program = LAB): void {
  const captured = capturedProgram(caseName, phase, program);
  assert.ok(captured, `${caseName} ${phase} has ${program}`);
  const want = rowsFromDocument(doc);
  for (const [k, table] of TABLES) {
    const stored: Row[] = k === 'program' ? [captured.rows.program] : captured.rows[k];
    const desired: Row[] = k === 'program' ? [want.program] : want[k];
    assert.deepEqual(set(desired), set(stored), `${caseName} ${phase} ${table}`);
  }
  const texts = new Map<string, string>();
  for (const r of [...captured.rows.sqlText].sort((a, b) => Number(a.SEQNUM) - Number(b.SEQNUM))) {
    const key = `${r.SQLID}|${r.SQLTYPE}|${r.MARKET}|${String(r.DBTYPE)}|${String(r.EFFDT).slice(0, 10)}`;
    texts.set(key, (texts.get(key) ?? '') + String(r.SQLTEXT ?? ''));
  }
  assert.deepEqual(new Map(want.texts.map((t) => [`${t.sqlId}|${t.sqlType}|${t.market}|${t.dbType}|${t.effdt}`, t.text])), texts, `${caseName} ${phase} SQL text`);
  assert.deepEqual(new Map(want.peopleCode.map((p) => [p.parts.join('|'), p.source])), captured.peopleCode, `${caseName} ${phase} PeopleCode`);
}

const before = (c: string) => documentFromRows(capturedProgram(c, 'before', LAB)!.rows, capturedProgram(c, 'before', LAB)!.peopleCode);
const replay = (c: string, edit: (doc: AeDocument) => AeDocument) => {
  if (!captureExists(c)) return;
  assertRows(edit(before(c)), c, 'after');
};

test('every captured state of ZZ_AE_LAB01 reads into a document that writes its rows back', () => {
  let states = 0;
  for (const c of readdirSync(RESULTS).filter((d) => /^a[a-z]+\d|^ap-pc/.test(d)).sort()) {
    for (const phase of ['before', 'after'] as const) {
      if (!captureExists(c)) continue;
      const p = capturedProgram(c, phase, LAB);
      if (!p) continue;
      assertRows(documentFromRows(p.rows, p.peopleCode), c, phase);
      states++;
    }
  }
  assert.ok(states > 150, `${states} states`);
});

test('a new program is App Designer\'s: MAIN, Public, Step01, no action [ae01]', () => {
  if (!captureExists('ae01-create')) return;
  const doc = newProgram(LAB);
  const captured = capturedProgram('ae01-create', 'after', LAB)!;
  const want = rowsFromDocument(doc);
  // LICENSE_CODE is App Designer's cipher text; a new program written here carries ' '.
  const { LICENSE_CODE: _l, ...program } = norm(captured.rows.program);
  const { LICENSE_CODE: _d, ...desired } = norm(want.program);
  assert.deepEqual(desired, program);
  assert.deepEqual(set(want.sections), set(captured.rows.sections));
  assert.deepEqual(set(want.variants), set(captured.rows.variants));
  assert.deepEqual(set(want.steps), set(captured.rows.steps));
});

test('App Engine SQL is stored flattened, as App Designer saves it [aa04-aa10]', () => {
  const cases: [string, string, string][] = [
    ['aa04-sql-newlines', 'select x\nfrom y\nwhere z = 1', 'select x from y where z = 1'],
    ['aa05-sql-indent', 'select x\n   from y\n\nwhere z = 1 ', 'select x  from y  where z = 1'],
    ['aa06-sql-ws', 'a0\n b1\n  c2\n   d3\n    e4\nf5  \ng6\n\nh7\n\t i8', 'a0  b1  c2  d3  e4 f5  g6  h7   i8'],
    ['aa07-sql-ws2', '  s1\n\t\tt2\nu3\t\tv3\n   \nw4  x4\n\tz', ' s1   t2 u3  v3   w4 x4  z'],
    ['aa08-sql-literals', `select 'a  b' ,  "d  e"  from x  /* f  g */  where c = '  '`, `select 'a  b' , "d e" from x /* f g */ where c = '  '`],
    ['aa09-sql-quote-nl', `select 'x  \n  y' from z  \nwhere 'it''s  ok' = a`, `select 'x     y' from z  where 'it''s  ok' = a`],
    ['aa10-sql-edges', "\n  select 'a\tb'\t\tfrom x\n\n", "  select 'a b'  from x"]
  ];
  for (const [c, typed, stored] of cases) {
    assert.equal(flattenAeSql(typed), stored, c);
    if (!captureExists(c)) continue;
    const text = capturedProgram(c, 'after', LAB)!.rows.sqlText.map((r) => String(r.SQLTEXT)).join('');
    assert.equal(text, stored, `${c}: the stored text`);
  }
  // XSLT is stored as typed [ax43].
  const xslt = '<xsl:stylesheet version="1.0">\r\n  <xsl:template  match="/"/>\r\n</xsl:stylesheet>  ';
  assert.equal(storedActionText('X', xslt), xslt);
});

test('step names follow the step above: Step01 -> Step02, Init -> Init2, taken names skipped', () => {
  assert.equal(nextName('Step01', new Set(['Step01']), 8), 'Step02');
  assert.equal(nextName('Init', new Set(['Init', 'Init2']), 8), 'Init3');
  assert.equal(nextName('Step09', new Set(), 8), 'Step10');
  assert.equal(nextName('ABCDEFGH', new Set(), 8), 'ABCDEFG2');
});

test('section, step and action operations reproduce App Designer\'s saves', () => {
  for (const [c, edit] of Object.entries(STRUCTURE_OPS)) replay(c, edit);
});

test('property edits write the column App Designer writes', () => {
  for (const [c, edit] of Object.entries(PROPERTY_OPS)) replay(c, edit);
});

test('MAIN cannot be deleted; a step takes one action of a type and never SQL with Call Section', () => {
  const doc = newProgram('ZZ_AE_T');
  assert.throws(() => deleteSection(doc, 'MAIN'), /MAIN cannot be deleted/);
  const withSql = insertAction(doc, { section: 'MAIN', step: 'Step01', type: 'S' }).doc;
  assert.throws(() => insertAction(withSql, { section: 'MAIN', step: 'Step01', type: 'S' }), /already has/);
  assert.throws(() => insertAction(withSql, { section: 'MAIN', step: 'Step01', type: 'C' }), /both SQL and Call Section/);
  // Insert Action on a Standard program never offers XSLT.
  let d = withSql;
  for (let i = 0; i < 6; i++) d = insertAction(d, { section: 'MAIN', step: 'Step01' }).doc;
  assert.deepEqual(findStep(d, { section: 'MAIN', step: 'Step01' }).step.actions.map((a) => a.type), ['H', 'W', 'D', 'P', 'S', 'M', 'N']);
  assert.throws(() => insertAction(d, { section: 'MAIN', step: 'Step01' }), /every action/);
});
