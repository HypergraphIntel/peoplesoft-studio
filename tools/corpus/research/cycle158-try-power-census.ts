/*
 * Cycle 158: try statements by catch count, and the `**` operator (research
 * only).
 *
 *   1. every `try ... end-try` (comments / strings masked, nesting tracked)
 *      by catch count and program kind: EXACT / non-EXACT programs; for a
 *      zero-catch try the stored tokens before / at end-try.
 *   2. every `**` in code: the stored token at the site (opcode 0x46).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle158-try-power-census.ts --taxonomy t.json [--verbose]
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, isApplicationClass, storedNameTable, decodeAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const verbose = args.includes('--verbose');
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const tokenText = (t: any) => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + JSON.stringify(t.text).slice(0, 24) : ''}`;
const ctx = openHarnessContext();
for (const def of ctx.definitions as any[]) {
  const code = maskNonCode(def.sourceText).replace(/"(?:[^"\n]|"")*"/g, m => ' '.repeat(m.length));
  const exact = !taxonomy.has(def.definitionId);
  const kind = isApplicationClass(def) ? 'App Class' : 'ordinary ';
  // 1. try statements
  const stack: number[] = [];
  const counts: number[] = [];
  for (const m of code.matchAll(/\b(try|catch|end-try)\b/gi)) {
    const word = m[1].toLowerCase();
    if (word === 'try') stack.push(0);
    else if (word === 'catch' && stack.length > 0) stack[stack.length - 1]++;
    else if (word === 'end-try' && stack.length > 0) counts.push(stack.pop()!);
  }
  for (const n of new Set(counts)) add(`1. try with ${n >= 3 ? '3+' : n} catch${n === 1 ? '' : 'es'} ${kind}`, exact, def.definitionId);
  const powerSites = (code.match(/\*\*/g) ?? []).length;
  if (counts.includes(0) || powerSites > 0) {
    let tokens: any[] = [];
    try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { /* undecodable */ }
    if (counts.includes(0)) {
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].opcode !== 0x67) continue;
        // walk back to the matching try: a 0x66 catch header in between means it has catches
        let depth = 0, catches = 0, k = i - 1;
        for (; k >= 0; k--) {
          if (tokens[k].opcode === 0x67) depth++;
          else if (tokens[k].opcode === 0x65) { if (depth === 0) break; depth--; }
          else if (tokens[k].opcode === 0x66 && depth === 0) catches++;
        }
        if (catches > 0) continue;
        add(`1a. zero-catch stored: ... ${tokenText(tokens[i - 1])} 67 ${tokens[i + 1]?.opcode === 0x15 ? '15' : tokenText(tokens[i + 1] ?? {})}`, exact, def.definitionId);
      }
    }
    if (powerSites > 0) {
      const stored = tokens.filter(t => t.opcode === 0x46).length;
      add(`2. ** sites ${powerSites}, stored 0x46 tokens ${stored} ${kind}`, exact, def.definitionId);
      if (verbose) console.log(`  ${def.definitionId} ${(/[^\n]*\*\*[^\n]*/.exec(code)?.[0] ?? '').trim()}`);
    }
  }
}
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(64)} ${String(e.size).padStart(5)} / ${String(n.size).padEnd(3)} ${[...e].slice(0, 5).join(' ')} | ${[...n].slice(0, 8).join(' ')}`);
