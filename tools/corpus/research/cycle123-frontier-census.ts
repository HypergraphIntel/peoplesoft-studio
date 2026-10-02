/*
 * Cycle 123: the exactness frontier -- one harness-equivalent pass over
 * every definition (research only).
 *
 * Writes:
 *   <out>.sweep.json  id -> [forwardExact, programSha1, firstBodyDiff,
 *                     referencesSha1, error] -- a byte / reference
 *                     fingerprint of the whole corpus; two sweeps diffed
 *                     with `--compare` prove a change semantic-neutral (or
 *                     list what moved);
 *   <out>.jsonl       one record per definition that is not forward-exact
 *                     or is not harness EXACT (taxonomy `--taxonomy`):
 *                     category, kind, fallback, encode error, references
 *                     exact (the taxonomy comparator) and first divergence,
 *                     first body byte difference and length delta, first
 *                     aligned decoded-token divergence with windows,
 *                     decoded-source match (`sourcesMatch`) and the first
 *                     differing normalized line.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle123-frontier-census.ts --taxonomy t.json <out>
 *   npx tsx tools/corpus/research/cycle123-frontier-census.ts --compare a.sweep.json b.sweep.json
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

import {
  openHarnessContext, encodeAsHarness, isApplicationClass, storedNameTable, generatedNameTable,
  decodeAsHarness, generatedReferenceKey, storedReferenceKeys, PROGRAM_HEADER_LENGTH
} from './lib/harnessContext';
import { normalizePeopleCodeSource, sourcesMatch } from '../../../src/peoplecode/corpus/sourceNormalize';

const sha1 = (data: Buffer | string) => createHash('sha1').update(data).digest('hex');

if (process.argv[2] === '--compare') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const ids = Object.keys(a);
  const gained = ids.filter(k => b[k][0] && !a[k][0]), lost = ids.filter(k => a[k][0] && !b[k][0]);
  const bytes = ids.filter(k => a[k][1] !== b[k][1]), refs = ids.filter(k => a[k][3] !== b[k][3]);
  console.log(`definitions ${ids.length}; forward-exact gained ${gained.length} lost ${lost.length}; program bytes changed ${bytes.length}; reference lists changed ${refs.length}`);
  for (const [label, list] of [['gained', gained], ['lost', lost], ['bytes', bytes], ['references', refs]] as const) {
    if (list.length) console.log(`  ${label}: ${list.slice(0, 60).join(' ')}`);
  }
  process.exit(bytes.length || refs.length ? 1 : 0);
}

const args = process.argv.slice(2);
let taxonomyPath: string | undefined;
if (args[0] === '--taxonomy') { taxonomyPath = args[1]; args.splice(0, 2); }
const outBase = args[0];
const taxonomy = new Map<number, any>();
if (taxonomyPath) for (const row of JSON.parse(fs.readFileSync(taxonomyPath, 'utf8')).rows) taxonomy.set(row.definitionId, row);

const label = (t: any) => t === undefined ? '<end>' : `${t.opcode.toString(16).padStart(2, '0')}:${JSON.stringify(String(t.text ?? '').slice(0, 24))}`;
const sameToken = (g: any, s: any) => g.opcode === s.opcode && String(g.text ?? '') === String(s.text ?? '');
/** Align by opcode class (0x0A ~ 0x4A) with a short resync; first token pair that differs. */
function firstTokenDivergence(generated: any[], stored: any[]) {
  let i = 0, j = 0;
  while (i < generated.length && j < stored.length) {
    if (sameToken(generated[i], stored[j])) { i++; j++; continue; }
    return {
      generatedIndex: i, storedIndex: j,
      stored: label(stored[j]), generated: label(generated[i]),
      previous: label(stored[j - 1]),
      storedWindow: stored.slice(Math.max(0, j - 4), j + 5).map(label),
      generatedWindow: generated.slice(Math.max(0, i - 4), i + 5).map(label)
    };
  }
  if (i === generated.length && j === stored.length) return undefined;
  return {
    generatedIndex: i, storedIndex: j,
    stored: label(stored[j]), generated: label(generated[i]), previous: label(stored[j - 1]),
    storedWindow: stored.slice(Math.max(0, j - 4), j + 5).map(label),
    generatedWindow: generated.slice(Math.max(0, i - 4), i + 5).map(label)
  };
}

function firstLineDifference(expected: string, actual: string) {
  const a = normalizePeopleCodeSource(expected).split('\n'), b = normalizePeopleCodeSource(actual).split('\n');
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const sa = a[k] ?? '<end>', sb = b[k] ?? '<end>';
  let c = 0;
  while (c < sa.length && c < sb.length && sa[c] === sb[c]) c++;
  const from = Math.max(0, c - 50);
  // the line pair around the first differing column (lines differ at `column`)
  return { line: k, column: c, source: sa.slice(from, c + 60), decoded: sb.slice(from, c + 60), nextSource: (a[k + 1] ?? '<end>').slice(0, 80), nextDecoded: (b[k + 1] ?? '<end>').slice(0, 80) };
}

const ctx = openHarnessContext();
const sweep: Record<number, [boolean, string, number, string, string]> = {};
const out = fs.openSync(`${outBase}.jsonl`, 'w');
let forwardExact = 0;
for (const def of ctx.definitions) {
  const id = def.definitionId;
  const encoded = encodeAsHarness(ctx, def);
  const stored: Buffer = def.storedProgram;
  if (encoded.artifacts === undefined) {
    sweep[id] = [false, 'ERR', -1, 'ERR', encoded.error!.slice(0, 160)];
  } else {
    const program = encoded.artifacts.program;
    const exact = Buffer.compare(program, stored) === 0;
    let firstDiff = -1;
    if (!exact) {
      firstDiff = PROGRAM_HEADER_LENGTH;
      while (firstDiff < program.length && firstDiff < stored.length && program[firstDiff] === stored[firstDiff]) firstDiff++;
    }
    if (exact) forwardExact++;
    sweep[id] = [exact, sha1(program), firstDiff, sha1(encoded.artifacts.references.map(generatedReferenceKey).join('|')), ''];
  }
  const row = taxonomy.get(id);
  if (sweep[id][0] && row === undefined) continue;

  const record: any = { id, app: isApplicationClass(def), category: row?.primaryCategory ?? 'EXACT', forwardExact: sweep[id][0], fallback: encoded.fallback };
  if (encoded.error !== undefined) record.error = encoded.error.replace(/^Cannot encode PeopleCode at source offset \d+: /, '').slice(0, 140);
  const storedKeys = storedReferenceKeys(def).slice(1);
  if (encoded.artifacts !== undefined) {
    const generatedKeys = encoded.artifacts.references.filter((r: any) => r.kind !== 'owner').map(generatedReferenceKey);
    let k = 0;
    while (k < Math.max(storedKeys.length, generatedKeys.length) && storedKeys[k] === generatedKeys[k]) k++;
    record.referencesExact = k === Math.max(storedKeys.length, generatedKeys.length);
    record.referenceSetExact = !record.referencesExact && [...storedKeys].sort().join('|') === [...generatedKeys].sort().join('|');
    if (!record.referencesExact) record.firstReference = { index: k, stored: storedKeys[k] ?? '<end>', generated: generatedKeys[k] ?? '<end>' };
    record.firstBodyDiff = sweep[id][2];
    record.lengthDelta = encoded.artifacts.program.length - stored.length;
    try {
      const storedTokens = decodeAsHarness(def, stored, storedNameTable(def)).tokens;
      const generatedTokens = decodeAsHarness(def, encoded.artifacts.program, generatedNameTable(encoded.artifacts.references)).tokens;
      record.firstToken = firstTokenDivergence(generatedTokens, storedTokens);
    } catch (error: any) { record.decodeError = String(error?.message ?? error).slice(0, 120); }
  }
  try {
    const decoded = decodeAsHarness(def, stored, storedNameTable(def)).text;
    record.decodeMatch = sourcesMatch(def.sourceText, decoded);
    if (!record.decodeMatch) record.firstLine = firstLineDifference(def.sourceText, decoded);
  } catch (error: any) { record.decodeMatch = false; record.decodeError = String(error?.message ?? error).slice(0, 120); }
  fs.writeSync(out, JSON.stringify(record) + '\n');
}
fs.closeSync(out);
fs.writeFileSync(`${outBase}.sweep.json`, JSON.stringify(sweep));
console.log(`${ctx.definitions.length} definitions; forward-exact ${forwardExact}; encode errors ${Object.values(sweep).filter(v => v[1] === 'ERR').length}`);
