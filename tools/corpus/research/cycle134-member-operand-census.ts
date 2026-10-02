/*
 * Cycle 134: reference operand (0x4A) vs inline name (0x0A) for a bare
 * chain member (research only).
 *
 * Every stored bare member -- a 0x4A or 0x0A name after `.` that is not
 * itself called -- is keyed by the chain step it follows: the method whose
 * result it is (`getcurreffrow()`), an index `(...)` / `[...]` on a value,
 * a property (`parentrecord`), a variable, a reference operand. Matrix of
 * stored 0x4A / 0x0A per step, EXACT / non-EXACT, with the members that
 * follow a 0x4A member counted separately (`REC.FIELD`: the FIELD follows a
 * RECORD reference). Targets: first forward divergence at the member,
 * stored 4A / generated 0A (or the reverse).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle134-member-operand-census.ts --taxonomy t.json [step-filter-regex]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, encodeAsHarness, isApplicationClass, PROGRAM_HEADER_LENGTH } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Map<number, string>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => [r.definitionId, r.primaryCategory]) : []);
const filter = args[2] !== undefined ? new RegExp(args[2], 'i') : undefined;

/** The chain step a member at token k follows (tokens[k - 1] is `.`). */
function stepBefore(tokens: any[], k: number): string {
  let j = k - 2;
  const t = tokens[j];
  if (t === undefined) return '<none>';
  if (t.opcode === 0x14) { // `)`: a call or an index
    let depth = 0;
    for (; j >= 0; j--) {
      if (tokens[j].opcode === 0x14) depth++;
      else if (tokens[j].opcode === 0x0b && --depth === 0) break;
    }
    const callee = tokens[j - 1];
    if (callee !== undefined && (callee.opcode === 0x0a)) return `${String(callee.text).toLowerCase()}()`;
    return `index() on ${callee === undefined ? '?' : callee.opcode === 0x01 ? 'variable' : callee.opcode === 0x14 ? 'call result' : callee.opcode.toString(16)}`;
  }
  if (t.opcode === 0x4d) return 'array element []';
  if (t.opcode === 0x0a) return `.${String(t.text).toLowerCase()}`;
  if (t.opcode === 0x4a) return 'after a 0x4A member';
  if (t.opcode === 0x01) return 'variable';
  if (t.opcode === 0x12) return `system ${String(t.text)}`;
  if (t.opcode === 0x21) return 'after a 0x21 reference';
  return t.opcode.toString(16);
}

const tally = new Map<string, number[]>();
const examples = new Map<string, Set<string>>();
const bump = (k: string, col: number, ex?: string) => {
  const v = tally.get(k) ?? [0, 0, 0, 0]; tally.set(k, v); v[col]++;
  if (ex) { const e = examples.get(k) ?? new Set(); examples.set(k, e); if (e.size < 8) e.add(ex); }
};
const ctx = openHarnessContext();
const targets: string[] = [];
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const category = taxonomy.get(def.definitionId);
  const exact = category === undefined;
  let divergence = -1, generatedByte: number | undefined;
  if (category === 'REFERENCE_COMPLETE_DOWNSTREAM') {
    const g = encodeAsHarness(ctx, def).artifacts?.program;
    if (g !== undefined) {
      let d = PROGRAM_HEADER_LENGTH;
      while (d < g.length && d < def.storedProgram.length && g[d] === def.storedProgram[d]) d++;
      divergence = d; generatedByte = g[d];
    }
  }
  tokens.forEach((t, k) => {
    if ((t.opcode !== 0x4a && t.opcode !== 0x0a) || tokens[k - 1]?.opcode !== 0x05 || tokens[k + 1]?.opcode === 0x0b) return;
    const step = stepBefore(tokens, k);
    if (filter && !filter.test(step)) return;
    const key = `${isApplicationClass(def) ? 'App Class' : 'ordinary '} ${step}`;
    const form = t.opcode === 0x4a ? 0 : 1;
    const isTarget = t.offset === divergence && ((t.opcode === 0x4a && generatedByte === 0x0a) || (t.opcode === 0x0a && generatedByte === 0x4a));
    bump(key, exact ? form : 2 + form, isTarget ? `${def.definitionId}*` : exact ? undefined : String(def.definitionId));
    if (isTarget) targets.push(`${def.definitionId} ${t.opcode === 0x4a ? 'stored 4A / generated 0A' : 'stored 0A / generated 4A'} ${String(t.text)} after ${step}`);
  });
}
console.log('bare chain members by the step before them   EXACT 4A / 0A   non-EXACT 4A / 0A   (* = target)');
for (const [k, [e4, e0, n4, n0]] of [...tally].sort((a, b) => b[1][0] + b[1][1] + b[1][2] + b[1][3] - a[1][0] - a[1][1] - a[1][2] - a[1][3])) {
  if (e4 + e0 + n4 + n0 < 3 && !(examples.get(k) ?? new Set()).size) continue;
  console.log(`  ${k.padEnd(46)} ${String(e4).padStart(6)} / ${String(e0).padEnd(6)} ${String(n4).padStart(5)} / ${String(n0).padEnd(5)} ${[...(examples.get(k) ?? [])].filter(x => x.endsWith('*')).join(' ')}`);
}
console.log(`\ntargets ${targets.length}:\n  ${targets.join('\n  ')}`);
