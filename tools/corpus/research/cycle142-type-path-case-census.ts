/*
 * Cycle 142: the spelling of Application Class type-path names in the
 * stored name table (research only).
 *
 * For every stored type-path name (a name-table entry with `:`) of every
 * Application Class program, three predictors of its spelling:
 *   P0  the declaration's own spelling (its first source occurrence), root
 *       upper-cased (`%Metadata` for the system root) -- the Cycle 113 rule;
 *   P1  every package prefix in the snapshot's own spelling (the class
 *       definitions' package path), P0 where the snapshot has none;
 *   P2  every sub-package in the program's FIRST spelling of that package
 *       path (masked of comments and strings), P0 otherwise.
 * The class leaf is the declaration's spelling in all three. Reports
 * matches / misses (EXACT / non-EXACT) and up to 6 misses each.
 *
 * `--rem`: stored 0x24 REM comments by what follows `rem` (whitespace or a
 * punctuation character), program kind and App Class region (Cycle 143).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle142-type-path-case-census.ts --taxonomy t.json [--rem]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const ctx = openHarnessContext();

const classPath = (d: any): string[] => {
  const values = [d.objectvalue1, d.objectvalue2, d.objectvalue3, d.objectvalue4, d.objectvalue5, d.objectvalue6, d.objectvalue7]
    .map((v: unknown) => String(v ?? '').trim());
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  return values.slice(0, event < 0 ? values.length : event).filter(Boolean);
};
const storedNames = (program: Buffer): string[] => {
  const nameLength = program.readUInt32LE(13), slotCount = program.readUInt32LE(21), recordCount = program.readUInt32LE(29);
  const trailer = program.subarray(program.length - (nameLength + recordCount * 16 + slotCount * 4));
  return trailer.subarray(0, nameLength).toString('utf16le').split('\0');
};
const masked = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|"(?:[^"]|"")*"/g, m => ' '.repeat(m.length));
const escape = (text: string) => text.replace(/[%$#]/g, '\\$&');

if (args.includes('--rem')) {
  const tally = new Map<string, number[]>();
  for (const def of ctx.definitions) {
    let tokens: any[];
    try { tokens = (decodeAsHarness(def, def.storedProgram, storedNameTable(def)) as any).tokens; } catch { continue; }
    const app = isApplicationClass(def);
    let inHeader = false;
    for (const t of tokens) {
      if (t.opcode === 0x5a || t.opcode === 0x70) inHeader = true;
      if (t.opcode === 0x5b || t.opcode === 0x71) inHeader = false;
      const m = t.opcode === 0x24 ? /^rem(.)/i.exec(String(t.text)) : null;
      if (!m) continue;
      const key = `${app ? (inHeader ? 'App Class header' : 'App Class other ') : 'ordinary        '} rem + ${/\s/.test(m[1]) ? 'whitespace' : m[1]}`;
      const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[taxonomy.has(def.definitionId) ? 1 : 0]++;
    }
  }
  console.log('stored REM comments (0x24)                      EXACT / non-EXACT');
  for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(44)} ${String(e).padStart(6)} / ${n}`);
  process.exit(0);
}

const snapshotPackages = new Map<string, string>();
for (const def of ctx.definitions) {
  if (!isApplicationClass(def)) continue;
  const path = classPath(def);
  for (let i = 1; i < path.length; i++) {
    const prefix = path.slice(0, i).join(':');
    if (!snapshotPackages.has(prefix.toUpperCase())) snapshotPackages.set(prefix.toUpperCase(), prefix);
  }
}
const tally = new Map<string, number[]>();
const misses = new Map<string, string[]>();
for (const def of ctx.definitions) {
  if (!isApplicationClass(def)) continue;
  let names: string[];
  try { names = storedNames(def.storedProgram); } catch { continue; }
  const code = masked(def.sourceText);
  const exact = !taxonomy.has(def.definitionId);
  for (const name of names.slice(1)) {
    if (!name.includes(':')) continue;
    const parts = name.split(':');
    const declaration = (new RegExp(escape(name).replace(/:/g, '\\s*:\\s*') + '\\b', 'i').exec(code)?.[0] ?? name).replace(/\s+/g, '').split(':');
    const root = /^%metadata$/i.test(declaration[0]) ? '%Metadata' : declaration[0].toUpperCase();
    const predictions: Record<string, string[]> = { P0: [root], P1: [snapshotPackages.get(parts[0].toUpperCase())?.split(':')[0] ?? root], P2: [root] };
    for (let i = 1; i < parts.length - 1; i++) {
      const prefix = parts.slice(0, i + 1).join(':');
      predictions.P0.push(declaration[i]);
      predictions.P1.push(snapshotPackages.get(prefix.toUpperCase())?.split(':')[i] ?? declaration[i]);
      const first = new RegExp('(?<![\\w%])' + escape(prefix).replace(/:/g, '\\s*:\\s*') + '\\s*:', 'i').exec(code)?.[0];
      predictions.P2.push(first?.replace(/[\s:]+$/, '').replace(/\s+/g, '').split(':')[i] ?? declaration[i]);
    }
    for (const [predictor, components] of Object.entries(predictions)) {
      const predicted = [...components, declaration[parts.length - 1]].join(':');
      const key = `${predictor} ${predicted === name ? 'match' : 'MISS '}`;
      const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[exact ? 0 : 1]++;
      if (predicted !== name) {
        const list = misses.get(predictor) ?? []; misses.set(predictor, list);
        if (list.length < 6) list.push(`${exact ? '' : '-'}${def.definitionId} stored ${name} predicted ${predicted}`);
      }
    }
  }
}
console.log('stored type-path names                EXACT / non-EXACT');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(34)} ${String(e).padStart(6)} / ${n}`);
for (const [predictor, list] of misses) console.log(`  ${predictor} misses:\n    ${list.join('\n    ')}`);
