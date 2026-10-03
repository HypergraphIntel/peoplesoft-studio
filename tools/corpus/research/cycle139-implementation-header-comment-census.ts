/*
 * Cycle 139: comments around Application Class implementation headers
 * (research only).
 *
 *   - every stored 0x6D: its text family and position (after an
 *     implementation header's 0x2D, or elsewhere), ordinary / App Class;
 *   - per App Class implementation (`method` / `get` / `set` + name, after
 *     `end-class`): what the source header LINE holds after the name
 *     (nothing, `;`, a block comment, ...) against what stored writes
 *     after the name (0x2D, or 0x4E then 0x2D), EXACT / non-EXACT by the
 *     taxonomy. Programs whose source and stored implementation counts
 *     differ are counted apart.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle139-implementation-header-comment-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const IMPLEMENTATION = new Map([[0x63, 'method'], [0x5f, 'get'], [0x49, 'set']]);

const sixD = new Map<string, number>();
let sixDDefinitions = 0;
const tally = new Map<string, number[]>();
const examples = new Map<string, number[]>();
const count = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[exact ? 0 : 1]++;
  const e = examples.get(key) ?? []; examples.set(key, e);
  if (e.length < 8 && !e.includes(exact ? id : -id)) e.push(exact ? id : -id);
};
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = (decodeAsHarness(def, def.storedProgram, storedNameTable(def)) as any).tokens; } catch { continue; }
  const appClass = isApplicationClass(def);
  const exact = !taxonomy.has(def.definitionId);
  if (tokens.some(t => t.opcode === 0x6d)) sixDDefinitions++;
  let afterClass = false;
  const storedHeaders: string[] = [];
  tokens.forEach((t, k) => {
    if (t.opcode === 0x5b || t.opcode === 0x71) afterClass = true;
    if (t.opcode === 0x6d) {
      let j = k - 1;
      while (j >= 0 && tokens[j].opcode === 0x6d) j--;
      const afterHeader = tokens[j]?.opcode === 0x2d && (tokens[j - 1]?.opcode === 0x0a && IMPLEMENTATION.has(tokens[j - 2]?.opcode) ||
        tokens[j - 1]?.opcode === 0x4e && tokens[j - 2]?.opcode === 0x0a && IMPLEMENTATION.has(tokens[j - 3]?.opcode));
      const key = `${appClass ? 'App Class' : 'ordinary'} ${String(t.text).slice(0, 2)} ... ${afterHeader ? 'after an implementation header' : 'elsewhere'}`;
      sixD.set(key, (sixD.get(key) ?? 0) + 1);
    }
    if (afterClass && IMPLEMENTATION.has(t.opcode) && tokens[k + 1]?.opcode === 0x0a) {
      storedHeaders.push(`${IMPLEMENTATION.get(t.opcode)} ${tokens[k + 2]?.opcode === 0x4e ? '4E 2D' : tokens[k + 2]?.opcode.toString(16).toUpperCase()}`);
    }
  });
  if (!appClass) continue;
  const endClass = def.sourceText.search(/^\s*end-(?:class|interface)/im);
  const headers = [...def.sourceText.slice(endClass).matchAll(/^[ \t]*(method|get|set)[ \t]+(\w+)([^\n]*)$/gim)];
  if (headers.length !== storedHeaders.length) { count('(source / stored implementation counts differ)', exact, def.definitionId); continue; }
  headers.forEach((m, i) => {
    const rest = m[3].trim();
    const shape = rest === '' ? 'nothing' : /^\/\*[^]*\*\/$/.test(rest) ? 'a block comment' : rest === ';' ? '`;`' : 'other text';
    count(`source: ${m[1].toLowerCase()} <name> + ${shape}`.padEnd(42) + ` stored: ${storedHeaders[i]}`, exact, def.definitionId);
  });
}
console.log(`stored 0x6D in ${sixDDefinitions} definitions:`);
for (const [k, n] of sixD) console.log(`  ${k.padEnd(60)} ${n}`);
console.log('App Class implementation headers                                EXACT / non-EXACT   (negative = non-EXACT)');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(62)} ${String(e).padStart(5)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).join(' ')}`);
