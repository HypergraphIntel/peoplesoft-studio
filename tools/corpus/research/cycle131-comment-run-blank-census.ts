/*
 * Cycle 131: blank-line markers (0x4F) after a standalone comment /
 * disabled-code run (research only).
 *
 * In every stored program a "comment run" is a maximal run of 0x24 / 0x55
 * tokens (REM statements and block comments are 0x24, `<* *>` 0x55). Per
 * run: the token before it (the context the run sits in), how many 0x4F
 * follow it, the next token. A program whose first forward divergence is
 * right after such a run, with stored 0x4F and generated something else, is
 * a target; its run is marked. EXACT programs show which contexts the
 * encoder already reproduces.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle131-comment-run-blank-census.ts --taxonomy t.json [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, encodeAsHarness, isApplicationClass, PROGRAM_HEADER_LENGTH } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Map<number, string>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => [r.definitionId, r.primaryCategory]) : []);
const out = args[2] ? fs.openSync(args[2], 'w') : undefined;

const hex = (n: number | undefined) => n === undefined ? '--' : n.toString(16).padStart(2, '0');
const label = (t: any) => t === undefined ? '<start>' : `${hex(t.opcode)}${t.text && t.kind !== 'comment' ? ` ${String(t.text).slice(0, 12)}` : ''}`;
const COMMENT = new Set([0x24, 0x55]);
const ctx = openHarnessContext();
const tally = new Map<string, number[]>();
const bump = (k: string, col: number) => { const v = tally.get(k) ?? [0, 0, 0]; tally.set(k, v); v[col]++; };
const targets: string[] = [];
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const category = taxonomy.get(def.definitionId);
  const exact = category === undefined;
  let divergence = -1, generatedByte: number | undefined;
  if (!exact) {
    const g = encodeAsHarness(ctx, def).artifacts?.program;
    if (g !== undefined) {
      let d = PROGRAM_HEADER_LENGTH;
      while (d < g.length && d < def.storedProgram.length && g[d] === def.storedProgram[d]) d++;
      divergence = d; generatedByte = g[d];
    }
  }
  for (let k = 0; k < tokens.length; k++) {
    if (!COMMENT.has(tokens[k].opcode) || COMMENT.has(tokens[k - 1]?.opcode)) continue;
    let end = k; while (COMMENT.has(tokens[end + 1]?.opcode)) end++;
    let markers = 0; while (tokens[end + 1 + markers]?.opcode === 0x4f) markers++;
    if (markers === 0) continue;
    const firstMarker = tokens[end + 1];
    const isTarget = category === 'REFERENCE_COMPLETE_DOWNSTREAM' && firstMarker.offset === divergence && generatedByte !== 0x4f && generatedByte !== 0x2d;
    const previous = tokens[k - 1];
    const key = `${isApplicationClass(def) ? 'App Class' : 'ordinary'}: after ${label(previous)}`;
    bump(key, isTarget ? 2 : exact ? 0 : 1);
    if (isTarget) targets.push(`${def.definitionId}(${label(previous)}; run ${end - k + 1}; 4F x${markers}; next ${label(tokens[end + 1 + markers])})`);
    if (out !== undefined) fs.writeSync(out, JSON.stringify({ id: def.definitionId, app: isApplicationClass(def), exact, target: isTarget, previous: label(previous), runLength: end - k + 1, markers, next: label(tokens[end + 1 + markers]), offset: firstMarker.offset }) + '\n');
  }
}
console.log('comment run + 0x4F sites by context   (EXACT programs / other non-EXACT / target first divergence)');
for (const [k, [e, n, t]] of [...tally].sort((a, b) => b[1][2] - a[1][2] || b[1][0] - a[1][0])) if (t || e + n >= 20) console.log(`  ${k.padEnd(44)} ${String(e).padStart(6)} / ${String(n).padStart(4)} / ${t}`);
console.log(`\ntargets ${targets.length}:\n  ${targets.join('\n  ')}`);
if (out !== undefined) fs.closeSync(out);
