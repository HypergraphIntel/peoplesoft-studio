/*
 * Cycle 140: the `array` type keyword, and blank lines around
 * conditional-compilation directives (research only).
 *
 *   1. every stored `array` token: its opcode, whether it is bare (no `of`
 *      after it) or `array of`, what precedes it (Local / Global /
 *      Component / instance / property / As / Returns / `of`), program
 *      kind and App Class region (class header or elsewhere); plus the
 *      stored 0x40 totals and texts;
 *   2. for every `#If` with blank source lines before it and every
 *      `#End-If` with blank lines after it: the blank-line count against
 *      the stored 0x4F markers there, by position (ordinary; App Class
 *      header, body, or top level -- outside the class and the bodies).
 *
 * EXACT / non-EXACT by the taxonomy (negative = non-EXACT).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle140-array-keyword-directive-gap-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);

const tallies = { array: new Map<string, number[]>(), gaps: new Map<string, number[]>() };
const examples = new Map<string, number[]>();
const add = (table: Map<string, number[]>, key: string, exact: boolean, id: number) => {
  const v = table.get(key) ?? [0, 0]; table.set(key, v); v[exact ? 0 : 1]++;
  const e = examples.get(key) ?? []; examples.set(key, e);
  if (e.length < 8 && !e.includes(exact ? id : -id)) e.push(exact ? id : -id);
};
let total40 = 0, definitions40 = 0;
const split40: Record<string, number> = {};
const texts40 = new Map<string, number>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = (decodeAsHarness(def, def.storedProgram, storedNameTable(def)) as any).tokens; } catch { continue; }
  const app = isApplicationClass(def);
  const exact = !taxonomy.has(def.definitionId);
  const n40 = tokens.filter(t => t.opcode === 0x40).length;
  total40 += n40; if (n40 > 0) definitions40++;
  split40[app ? 'App Class' : 'ordinary'] = (split40[app ? 'App Class' : 'ordinary'] ?? 0) + n40;
  let inHeader = false;
  tokens.forEach((t, k) => {
    if (t.opcode === 0x5a || t.opcode === 0x70) inHeader = true;
    if (t.opcode === 0x5b || t.opcode === 0x71) inHeader = false;
    if (t.opcode === 0x40) texts40.set(String(t.text).toLowerCase(), (texts40.get(String(t.text).toLowerCase()) ?? 0) + 1);
    if (String(t.text ?? '').toLowerCase() !== 'array') return;
    const form = String(tokens[k + 1]?.text ?? '').toLowerCase() === 'of' ? 'array of' : 'bare array';
    const previous = tokens[k - 1];
    const after = previous?.opcode === 0x40 && String(previous.text).toLowerCase() === 'of' ? '`of`' : String(previous?.text ?? `0x${previous?.opcode.toString(16)}`);
    add(tallies.array, `${app ? 'App Class' : 'ordinary '} ${app ? (inHeader ? 'class header' : 'elsewhere   ') : '            '} ${form.padEnd(10)} after ${after.padEnd(10)} 0x${t.opcode.toString(16)}`, exact, def.definitionId);
  });

  if (!/^\s*#If\b/im.test(def.sourceText)) continue;
  const lines = def.sourceText.split('\n');
  const source: { kind: string; before: number; after: number; zone: string }[] = [];
  let zone = app ? 'top' : 'ordinary';
  lines.forEach((line, i) => {
    if (app) {
      if (/^\s*(?:class|interface)\s/i.test(line)) zone = 'header';
      else if (/^\s*end-(?:class|interface)/i.test(line)) zone = 'top';
      else if (zone !== 'header' && /^\s*(?:method|get|set)\s+\w+/i.test(line)) zone = 'body';
      else if (/^\s*end-(?:method|get|set)/i.test(line)) zone = 'top';
    }
    const m = /^\s*#(If|End-If)\b/i.exec(line);
    if (!m) return;
    let before = 0; for (let j = i - 1; j >= 0 && lines[j].trim() === ''; j--) before++;
    let after = 0; for (let j = i + 1; j < lines.length && lines[j].trim() === ''; j++) after++;
    source.push({ kind: m[1].toLowerCase(), before, after, zone });
  });
  const stored: { before: number; after: number }[] = [];
  tokens.forEach((t, k) => {
    if (t.opcode !== 0x75 && t.opcode !== 0x78) return;
    let before = 0; for (let j = k - 1; j >= 0 && tokens[j].opcode === 0x4f; j--) before++;
    let j = k + 1;
    if (t.opcode === 0x75) { while (j < tokens.length && tokens[j].opcode !== 0x76) j++; j++; } else if (tokens[j]?.opcode === 0x15) j++;
    let after = 0; for (; j < tokens.length && tokens[j].opcode === 0x4f; j++) after++;
    stored.push({ before, after });
  });
  if (source.length !== stored.length) { add(tallies.gaps, '(source / stored directive counts differ)', exact, def.definitionId); continue; }
  source.forEach((s, i) => {
    if (s.kind === 'if' && s.before > 0) add(tallies.gaps, `${s.zone.padEnd(8)} blank lines before #If     ${s.before} -> stored markers ${stored[i].before}`, exact, def.definitionId);
    if (s.kind === 'end-if' && s.after > 0) add(tallies.gaps, `${s.zone.padEnd(8)} blank lines after #End-If  ${s.after} -> stored markers ${stored[i].after}`, exact, def.definitionId);
  });
}
console.log(`stored 0x40: ${total40} in ${definitions40} definitions`, split40);
console.log('  texts: ' + [...texts40].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k} ${v}`).join(', '));
for (const [title, table] of [['stored `array` tokens', tallies.array], ['blank lines around directives', tallies.gaps]] as const) {
  console.log(`${title}                                                  EXACT / non-EXACT`);
  for (const [k, [e, n]] of [...table].sort()) console.log(`  ${k.padEnd(66)} ${String(e).padStart(5)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).join(' ')}`);
}
