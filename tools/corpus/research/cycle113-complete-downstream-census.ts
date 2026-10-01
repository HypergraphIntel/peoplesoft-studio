/*
 * Cycle 113: the REFERENCE_COMPLETE_DOWNSTREAM population -- programs
 * whose PSPCMNAME list already matches stored while their PSPCMPROG bytes
 * do not -- classified by the FIRST differing opcode event (research
 * only).
 *
 * Population: the `REFERENCE_COMPLETE_DOWNSTREAM` rows of a taxonomy file
 * (`cycle73-nonexact-taxonomy.ts`). Each program is encoded as the harness
 * encodes it (owner record / field / package path, snapshot type metadata;
 * TEST A), its reference list re-checked against stored (keys exact), and
 * both PSPCMPROG streams decoded with the stored name table into opcode
 * tokens. The token streams are aligned from the start; at the first
 * differing token:
 *
 *   inserted      generated has an extra token (stored[k] == generated[k+1])
 *   missing       generated lacks a token (stored[k+1] == generated[k])
 *   marker-count  both sides are runs of the same marker opcode, of
 *                 different lengths
 *   operand       same opcode, different operand / text
 *   substituted   different opcode, no realignment within one token
 *   tail          one stream ends where the other continues
 *   outside       token streams equal; the bytes differ outside them
 *                 (header / directory / trailer)
 *
 * plus the raw first differing byte, the length delta, the token context
 * (5 tokens either side, both streams) and the statement the difference
 * sits in (the first token after the preceding statement boundary).
 *
 * Usage: npx tsx tools/corpus/research/cycle113-complete-downstream-census.ts [--taxonomy t.json] <out.jsonl>
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram, type Token } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const ROOT = path.join(__dirname, '../../..');
const args = process.argv.slice(2);
const taxonomyIndex = args.indexOf('--taxonomy');
const taxonomyPath = taxonomyIndex >= 0 ? args[taxonomyIndex + 1] : path.join(ROOT, '.claude/nonexact-taxonomy.json');
const outPath = args.filter((a, i) => a !== '--taxonomy' && args[i - 1] !== '--taxonomy')[0];
const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
const population = new Set<number>(taxonomy.rows.filter((r: any) => r.primaryCategory === 'REFERENCE_COMPLETE_DOWNSTREAM').map((r: any) => r.definitionId));

const gKey = (g: any): string => {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (g.kind) {
    case 'package': return `PACKAGE.${up(g.packageName)}`;
    case 'scroll': return `SCROLL.${up(g.recordName)}`;
    case 'record': return `RECORD.${up(g.recordName)}`;
    case 'field': return `FIELD.${up(g.fieldName)}`;
    case 'component': return `COMPONENT.${up(g.objectName)}`;
    default: return `${up(g.recordName)}.${up(g.fieldName)}`;
  }
};
const hex = (n: number) => '0x' + n.toString(16).padStart(2, '0');
const tokenLabel = (t: Token | undefined) => t === undefined ? '<end>' : `${hex(t.opcode)}:${t.kind}:${JSON.stringify(t.text)}`;
const same = (a: Token | undefined, b: Token | undefined) => a !== undefined && b !== undefined && a.opcode === b.opcode && a.text === b.text;

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const out = fs.openSync(outPath, 'w');
let written = 0;
for (const def of listSnapshotDefinitions(db) as any[]) {
  if (!population.has(def.definitionId)) continue;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const ri = ids.findIndex((x: number) => x === 1), fi = ids.findIndex((x: number) => x === 2);
  const owner = { recordName: ri >= 0 ? values[ri] : values[0], fieldName: fi >= 0 ? values[fi] : values[1], packagePath: values.slice(0, event < 0 ? values.length : event).filter(Boolean) };
  const app = def.objectid1 === 104;
  const artifacts = encodeProgramArtifacts(def.sourceText, { owner, applicationClassTypeMetadata: provider });
  const stored: Buffer = def.storedProgram;
  const generated: Buffer = artifacts.program;

  const storedRows = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum));
  const referencesExact = storedRows.slice(1).map((r: any) => `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`).join('|') ===
    artifacts.references.filter(r => r.kind !== 'owner').map(gKey).join('|');

  let firstByte = 0;
  while (firstByte < Math.min(stored.length, generated.length) && stored[firstByte] === generated[firstByte]) firstByte++;

  const names = new NameTable();
  for (const row of storedRows) {
    const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  let s: Token[] = [], g: Token[] = [];
  let decodeError: string | undefined;
  try {
    s = decodeProgram(stored, names, { mode: 'auto', isApplicationClass: app } as any).tokens;
    g = decodeProgram(generated, names, { mode: 'auto', isApplicationClass: app } as any).tokens;
  } catch (e) { decodeError = String(e).slice(0, 120); }

  let k = 0;
  while (k < s.length && k < g.length && same(s[k], g[k])) k++;
  let shape: string;
  if (decodeError) shape = 'undecodable';
  else if (k === s.length && k === g.length) shape = 'outside';
  else if (k === s.length || k === g.length) shape = 'tail';
  else if (same(s[k], g[k + 1])) shape = 'inserted';
  else if (same(s[k + 1], g[k])) shape = 'missing';
  else if (s[k].opcode === g[k].opcode) shape = 'operand';
  else shape = 'substituted';
  // a run of one marker opcode whose length differs
  if ((shape === 'inserted' || shape === 'missing') && s[k] && g[k]) {
    const run = (list: Token[], at: number, opcode: number) => { let n = 0; while (list[at + n]?.opcode === opcode) n++; return n; };
    const op = shape === 'inserted' ? g[k].opcode : s[k].opcode;
    const back = (list: Token[]) => { let n = 0; while (list[k - 1 - n]?.opcode === op) n++; return n; };
    if (run(s, k, op) + back(s) !== run(g, k, op) + back(g) && (s[k - 1]?.opcode === op || s[k]?.opcode === op) && (g[k - 1]?.opcode === op || g[k]?.opcode === op)) shape = 'marker-count';
  }
  // the statement the difference sits in: tokens after the last 0x15 (statement end) / newline before k
  let start = k - 1;
  while (start >= 0 && s[start] && s[start].opcode !== 0x15 && s[start].kind !== 'newline') start--;
  const statement = s.slice(start + 1, Math.min(k + 1, start + 7)).map(t => t.text).join(' ');
  const window = (list: Token[]) => list.slice(Math.max(0, k - 5), k + 6).map(tokenLabel);
  fs.writeSync(out, JSON.stringify({
    id: def.definitionId, app, referencesExact,
    storedLength: stored.length, generatedLength: generated.length, delta: generated.length - stored.length,
    firstByte, storedBytes: stored.subarray(firstByte, firstByte + 12).toString('hex'), generatedBytes: generated.subarray(firstByte, firstByte + 12).toString('hex'),
    tokenIndex: k, shape, stored: tokenLabel(s[k]), generated: tokenLabel(g[k]),
    previous: tokenLabel(s[k - 1]), statement,
    storedWindow: window(s), generatedWindow: window(g), decodeError
  }) + '\n');
  written++;
}
fs.closeSync(out);
console.log(`${written} COMPLETE_DOWNSTREAM programs`);
