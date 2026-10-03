/*
 * Cycle 141: who owns the 0x2D / 0x4F bytes between ordinary leading-
 * section declarations (research only).
 *
 * For every ordinary program, every `;` that ends a leading-section
 * declaration (import, Local, Global, Component, Constant, Declare
 * Function, ComponentLife, PanelGroup -- before the first executable
 * statement) is followed by a stored gap of 0x2D / 0x4F / comment tokens
 * and then the next construct. Keyed by (declaration kind -> next
 * construct, gap pattern) with comments typed C (`/* *\/`), R (`rem`), X
 * (`<* *>`) and runs of 0x4F collapsed to `4F+`; EXACT / non-EXACT by the
 * taxonomy (negative = non-EXACT). An optional regex filters the keys.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle141-marker-ownership-census.ts --taxonomy t.json [key-regex]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const filter = args[2] !== undefined ? new RegExp(args[2]) : undefined;
const KIND: Record<number, string> = {
  0x44: 'Local', 0x45: 'Global', 0x54: 'Component', 0x56: 'Constant', 0x31: 'Declare', 0x32: 'Function',
  0x58: 'import', 0x79: 'ComponentLife', 0x51: 'PanelGroup'
};
const GAP = new Set([0x2d, 0x4f, 0x24, 0x55]);
const gapToken = (t: any): string =>
  t.opcode === 0x2d ? '2D' : t.opcode === 0x4f ? '4F' : t.opcode === 0x55 ? 'X' : /^rem\b/i.test(String(t.text)) ? 'R' : 'C';

const tally = new Map<string, number[]>();
const examples = new Map<string, number[]>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (isApplicationClass(def)) continue;
  let tokens: any[];
  try { tokens = (decodeAsHarness(def, def.storedProgram, storedNameTable(def)) as any).tokens; } catch { continue; }
  const exact = !taxonomy.has(def.definitionId);
  let statementStart = -1, initialized = false, sawExecutable = false;
  for (let k = 1; k < tokens.length && !sawExecutable; k++) {
    const t = tokens[k];
    if (statementStart < 0 && !GAP.has(t.opcode) && t.opcode !== 0x15) { statementStart = k; initialized = false; }
    if (statementStart >= 0 && t.opcode === 0x06) initialized = true;
    if (t.opcode !== 0x15) continue;
    const kind = KIND[tokens[statementStart]?.opcode];
    statementStart = -1;
    if (kind === undefined) { sawExecutable = true; continue; }
    if (kind === 'Function') continue;
    let j = k + 1;
    const gap: string[] = [];
    while (j < tokens.length && GAP.has(tokens[j].opcode)) gap.push(gapToken(tokens[j++]));
    const next = KIND[tokens[j]?.opcode] ?? (tokens[j]?.opcode === 0x07 ? 'EOF' : 'exec');
    const key = `${kind}${kind === 'Local' && initialized ? '(init)' : ''} -> ${next}: [${gap.join(' ').replace(/4F( 4F)+/g, '4F+')}]`;
    if (filter && !filter.test(key)) continue;
    const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[exact ? 0 : 1]++;
    const e = examples.get(key) ?? []; examples.set(key, e);
    if (e.length < 8 && !e.includes(exact ? def.definitionId : -def.definitionId)) e.push(exact ? def.definitionId : -def.definitionId);
  }
}
console.log('leading-section declaration gaps (ordinary)                     EXACT / non-EXACT');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(60)} ${String(e).padStart(6)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).join(' ')}`);
