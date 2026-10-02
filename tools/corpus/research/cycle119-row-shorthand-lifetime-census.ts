/*
 * Cycle 119: RECORD / FIELD row lifetime of Row-shorthand chains
 * (`&row.REC.FIELD`) -- research only.
 *
 * Evidence is read from the compiled programs, not from source matching:
 * every `05 4A 05 4A` pair in the decoded PSPCMPROG whose first operand is
 * a RECORD row and whose second is a FIELD row is one shorthand
 * occurrence (`<receiver> . REC . FIELD`); a lone `05 4A` RECORD operand
 * after a receiver is a RECORD-only occurrence. Each occurrence carries
 * its operand NAMENUMs, its method body (0x63 `method` / get / set after
 * `end-class` opens one), its statement (0x15 count) and its control
 * depth (If / For / While / Evaluate / Repeat / try nesting).
 *
 * Reuse is read per occurrence: a later occurrence of the same key reuses
 * when its NAMENUM equals an earlier occurrence's, and opens when it is a
 * new row. Keys: RECORD by record name; FIELD by field name and by
 * record + field. Each repeat is classified by its relation to the
 * nearest earlier occurrence of the key (same statement / same method /
 * different method; same or different control nesting), giving the
 * contradiction counts of candidate lifetimes (whole program, method
 * body, statement, control group) directly. The same extraction runs on
 * the harness encode (generated program + references) for comparison.
 *
 * Usage: npx tsx tools/corpus/research/cycle119-row-shorthand-lifetime-census.ts [--taxonomy t.json] <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { snapshotConditionalCompilation } from '../snapshot/toolsRelease';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

interface Occurrence {
  method: number;
  statement: number;
  control: string;
  receiver: string;
  record: string;
  recordNum: number;
  field?: string;
  fieldNum?: number;
}

const OPENERS = /^(If|For|While|Evaluate|Repeat|try)$/i;
const CLOSERS = /^(End-If|End-For|End-While|End-Evaluate|Until|end-try)$/i;

function occurrences(tokens: any[], kindOf: (num: number) => [string, string] | undefined, app: boolean): Occurrence[] {
  const out: Occurrence[] = [];
  let method = 0, statement = 0, inBodies = !app;
  const control: number[] = [];
  let nextControl = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.opcode === 0x5b) inBodies = true;
    if (inBodies && t.kind !== 'name' && (t.opcode === 0x63 || /^(get|set)$/i.test(t.text ?? ''))) method++;
    if (t.opcode === 0x15) statement++;
    if (t.kind !== 'name' && OPENERS.test(t.text ?? '')) control.push(nextControl++);
    if (t.kind !== 'name' && CLOSERS.test(t.text ?? '')) control.pop();
    if (t.opcode !== 0x05 || tokens[k + 1]?.opcode !== 0x4a) continue;
    const rec = kindOf(tokens[k + 1].nameNum);
    if (rec?.[0] !== 'RECORD') continue;
    const prev = tokens[k - 1];
    const receiver = prev?.opcode === 0x01 ? 'variable' : prev?.opcode === 0x14 ? 'call-or-index-result' : prev?.opcode === 0x12 ? 'system-variable' : 'other';
    const occurrence: Occurrence = { method, statement, control: control.join('/'), receiver, record: rec[1], recordNum: tokens[k + 1].nameNum };
    if (tokens[k + 2]?.opcode === 0x05 && tokens[k + 3]?.opcode === 0x4a) {
      const field = kindOf(tokens[k + 3].nameNum);
      if (field?.[0] === 'FIELD') { occurrence.field = field[1]; occurrence.fieldNum = tokens[k + 3].nameNum; }
    }
    out.push(occurrence);
  }
  return out;
}

type Relation = 'same-statement' | 'same-method' | 'other-method';
const relation = (a: Occurrence, b: Occurrence): Relation =>
  a.method !== b.method ? 'other-method' : a.statement === b.statement ? 'same-statement' : 'same-method';
const controlRelation = (a: Occurrence, b: Occurrence) =>
  a.method !== b.method ? 'other-method' : a.control === b.control ? 'same-control' : 'other-control';

/** For each repeated key: [relation to the nearest earlier occurrence, reused?] */
function repeats(list: Occurrence[], key: (o: Occurrence) => string | undefined, num: (o: Occurrence) => number | undefined) {
  const seen = new Map<string, Occurrence[]>();
  const result: Array<{ relation: Relation; control: string; reused: boolean; reusedAny: boolean }> = [];
  for (const o of list) {
    const k = key(o);
    if (k === undefined) continue;
    const earlier = seen.get(k) ?? [];
    if (earlier.length > 0) {
      const last = earlier[earlier.length - 1];
      result.push({
        relation: relation(last, o), control: controlRelation(last, o),
        reused: num(o) === num(last),
        reusedAny: earlier.some(e => num(e) === num(o))
      });
    }
    earlier.push(o);
    seen.set(k, earlier);
  }
  return result;
}

let taxonomyPath: string | undefined;
const args = process.argv.slice(2);
if (args[0] === '--taxonomy') { taxonomyPath = args[1]; args.splice(0, 2); }
const taxonomy = new Map<number, string>();
if (taxonomyPath) for (const row of JSON.parse(fs.readFileSync(taxonomyPath, 'utf8')).rows) taxonomy.set(row.definitionId, row.primaryCategory);

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const conditionalCompilation = snapshotConditionalCompilation(db);
const out = fs.openSync(args[0], 'w');
const matrix = new Map<string, number>();
const count = (k: string) => matrix.set(k, (matrix.get(k) ?? 0) + 1);
const receivers = new Map<string, number>();
const wholeProgramContradictions = new Map<number, string[]>();
const programs = { app: 0, ordinary: 0, occurrencesApp: 0, occurrencesOrdinary: 0, recordOnlyApp: 0 };
for (const def of listSnapshotDefinitions(db) as any[]) {
  const app = def.objectid1 === 104;
  const storedNames = new Map<number, [string, string]>();
  for (const row of def.names) storedNames.set(Number(row.namenum), [String(row.recname ?? '').trim().toUpperCase(), String(row.refname ?? '').trim().toUpperCase()]);
  if (![...storedNames.values()].some(([r]) => r === 'RECORD')) continue;
  let storedTokens: any[];
  try {
    const names = new NameTable();
    for (const row of def.names) {
      const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
      names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
    }
    storedTokens = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: app } as any).tokens;
  } catch { continue; }
  const stored = occurrences(storedTokens, num => storedNames.get(num), app);
  if (stored.length === 0) continue;
  app ? programs.app++ : programs.ordinary++;
  for (const o of stored) {
    receivers.set(`${app ? 'app' : 'ord'} ${o.receiver}${o.field ? '' : ' (RECORD only)'}`, (receivers.get(`${app ? 'app' : 'ord'} ${o.receiver}${o.field ? '' : ' (RECORD only)'}`) ?? 0) + 1);
    if (app) { if (o.field) programs.occurrencesApp++; else programs.recordOnlyApp++; } else if (o.field) programs.occurrencesOrdinary++;
  }

  // generated (harness-equivalent encode)
  let generated: Occurrence[] | undefined;
  try {
    const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
    const ev = values.findIndex(v => v.toLowerCase() === 'onexecute');
    const owner = { recordName: values[0], fieldName: values[1], packagePath: app && ev > 0 ? values.slice(0, ev) : undefined };
    const artifacts = encodeProgramArtifacts(String(def.sourceText), { owner, applicationClassTypeMetadata: provider, conditionalCompilation } as any);
    const generatedNames = new Map<number, [string, string]>();
    const names = new NameTable();
    for (const r of artifacts.references as any[]) {
      if (r.kind === 'record') generatedNames.set(Number(r.index), ['RECORD', String(r.recordName).toUpperCase()]);
      else if (r.kind === 'field') generatedNames.set(Number(r.index), ['FIELD', String(r.fieldName).toUpperCase()]);
      // the decoder needs every operand's text to walk the stream
      names.add(Number(r.index), String(r.recordName ?? r.fieldName ?? r.packageName ?? r.objectName ?? 'X'));
    }
    const tokens = decodeProgram(artifacts.program, names, { mode: 'auto', isApplicationClass: app } as any).tokens;
    generated = occurrences(tokens, num => generatedNames.get(num), app);
  } catch { /* not encodable */ }

  const kind = app ? 'app' : 'ord';
  const tally = (side: string, list: Occurrence[]) => {
    for (const r of repeats(list, o => o.record, o => o.recordNum)) count(`${kind} ${side} RECORD by-record ${r.relation} ${r.reused ? 'reuse' : r.reusedAny ? 'reuse-older' : 'open'}`);
    for (const r of repeats(list, o => o.record, o => o.recordNum)) count(`${kind} ${side} RECORD by-record ${r.control} ${r.reused ? 'reuse' : 'open'}`);
    for (const r of repeats(list, o => o.field, o => o.fieldNum)) count(`${kind} ${side} FIELD by-field ${r.relation} ${r.reused ? 'reuse' : 'open'}`);
    for (const r of repeats(list, o => o.field && `${o.record}.${o.field}`, o => o.fieldNum)) count(`${kind} ${side} FIELD by-record+field ${r.relation} ${r.reused ? 'reuse' : 'open'}`);
  };
  tally('stored', stored);
  if (app) {
    // whole-program contradictions: a repeated App Class key that stored opens again
    const opens = [
      ...repeats(stored, o => o.record, o => o.recordNum).filter(r => !r.reusedAny).map(r => `RECORD ${r.relation}`),
      ...repeats(stored, o => o.field, o => o.fieldNum).filter(r => !r.reusedAny).map(r => `FIELD ${r.relation}`)
    ];
    if (opens.length > 0) wholeProgramContradictions.set(def.definitionId, opens);
  }
  if (generated) tally('generated', generated);
  const storedRecordOpens = new Set(stored.map(o => o.recordNum)).size, storedFieldOpens = new Set(stored.filter(o => o.field).map(o => o.fieldNum)).size;
  fs.writeSync(out, JSON.stringify({
    id: def.definitionId, app, category: taxonomy.get(def.definitionId) ?? 'EXACT', occurrences: stored.length,
    records: new Set(stored.map(o => o.record)).size, storedRecordRows: storedRecordOpens,
    fields: new Set(stored.filter(o => o.field).map(o => `${o.record}.${o.field}`)).size, storedFieldRows: storedFieldOpens,
    generatedRecordRows: generated && new Set(generated.map(o => o.recordNum)).size,
    generatedFieldRows: generated && new Set(generated.filter(o => o.field).map(o => o.fieldNum)).size,
    methods: new Set(stored.map(o => o.method)).size,
    sample: stored.slice(0, 6).map(o => `${o.method}:${o.statement}:${o.record}#${o.recordNum}.${o.field ?? ''}#${o.fieldNum ?? ''}`)
  }) + '\n');
}
fs.closeSync(out);
console.log(`programs with RECORD operands after a receiver: ${programs.app} App Class / ${programs.ordinary} ordinary; REC.FIELD occurrences ${programs.occurrencesApp} App Class / ${programs.occurrencesOrdinary} ordinary; App Class RECORD-only ${programs.recordOnlyApp}`);
console.log(`receivers:\n    ${[...receivers].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join('\n    ')}`);
console.log('repeat matrix (kind side row key relation outcome):');
for (const [k, v] of [...matrix].sort()) console.log(`    ${k}: ${v}`);
console.log(`App Class whole-program contradictions (a repeated RECORD / FIELD name stored opens again): ${wholeProgramContradictions.size} definitions`);
for (const [id, opens] of wholeProgramContradictions) console.log(`    ${id} ${taxonomy.get(id) ?? 'EXACT'}: ${opens.join(', ')}`);
