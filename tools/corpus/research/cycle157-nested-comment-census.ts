/*
 * Cycle 157: `<* ... *>` comments (research only).
 *
 * For every program containing `<*`: the stored 0x55 tokens (the `<*`
 * comment opcode), each payload's nesting depth (max count of open `<*`),
 * whether the stored payload equals the span that first-`*>` matching
 * would give (non-nested) or needs balanced matching, the comment's
 * placement (what precedes / follows it in the stored token stream), and
 * whether the program is EXACT. Also: any other opcode carrying `<*` text.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle157-nested-comment-census.ts --taxonomy t.json [--verbose]
 */
import fs from 'node:fs';

import { openHarnessContext, storedNameTable, decodeAsHarness, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const verbose = args.includes('--verbose');
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const depthOf = (text: string): number => {
  let depth = 0, max = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text.startsWith('<*', i)) { depth++; max = Math.max(max, depth); i++; }
    else if (text.startsWith('*>', i)) { depth--; i++; }
  }
  return max;
};
const placeOf = (prev: any, next: any): string => {
  const p = prev?.opcode === 0x15 || prev?.opcode === 0x2d || prev?.opcode === 0x4f || prev?.opcode === 0xa0 || prev?.opcode === 0x24 || prev?.opcode === 0x55 || /^(Then|Else|Do)$/i.test(prev?.text ?? '') ? 'statement' : `after ${prev?.text ?? prev?.opcode?.toString(16)}`;
  const n = /^(When|When-Other|End-Evaluate|End-If|Else|End-For|End-While|end-try|catch|End-Function|end-method)$/i.test(next?.text ?? '') ? `before ${next.text}` : '';
  return `${p}${n ? ' ' + n : ''}`;
};
const ctx = openHarnessContext();
for (const def of ctx.definitions as any[]) {
  if (!def.sourceText.includes('<*')) continue;
  const exact = !taxonomy.has(def.definitionId);
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === undefined || !t.text.startsWith('<*')) continue;
    const depth = depthOf(t.text);
    const naive = t.text.slice(0, t.text.indexOf('*>') + 2) === t.text ? 'first-*> span' : 'needs balanced nesting';
    const placement = placeOf(tokens[i - 1], tokens[i + 1]);
    const coarse = placement.startsWith('statement') ? 'statement level' : `inside a statement (${placement.split(' ').slice(0, 2).join(' ')})`;
    add(`${t.opcode.toString(16)} depth ${depth > 2 ? '3+' : depth} ${naive.padEnd(22)} ${coarse}`, exact, def.definitionId);
    if (verbose && !exact) console.log(`  -${def.definitionId} ${isApplicationClass(def) ? 'AC ' : 'ord'} ${t.opcode.toString(16)} depth ${depth} ${placement} ${JSON.stringify(t.text.slice(0, 50))}`);
  }
}
console.log('                                                                         EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(72)} ${String(e.size).padStart(5)} / ${String(n.size).padEnd(3)} ${[...e].slice(0, 4).join(' ')} | ${[...n].slice(0, 8).join(' ')}`);
