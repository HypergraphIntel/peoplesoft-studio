/*
 * Cycle 145: two ordinary PACKAGE row owners (research only).
 *
 *   1. `%metadata` system classes: per ordinary program using them, per
 *      class leaf -- stored PACKAGE rows, generated rows, and the source's
 *      `Local %metadata:...` declarations, `create %metadata:...` and method
 *      calls on a receiver declared with the class (`&x.Method(`).
 *   2. Declaration-only top-level `Local` runs after a Function definition
 *      (before any top-level executable statement) that repeat a class
 *      leaf: stored rows of the leaf against the run's declarations.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle145-metadata-local-run-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const count = (keys: string[], key: string) => keys.filter(k => k === key).length;
const ctx = openHarnessContext();

console.log('1. ordinary %metadata classes: leaf  stored / generated rows  | declarations, creates, method calls');
for (const def of ctx.definitions) {
  if (isApplicationClass(def) || !/%metadata\s*:/i.test(def.sourceText)) continue;
  const code = def.sourceText.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|"[^"\n]*"/g, m => m.replace(/[^\n]/g, ' '));
  const stored = storedReferenceKeys(def);
  const generated = (encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey);
  const receivers = new Map<string, string>();
  for (const m of code.matchAll(/\bLocal\s+%metadata\s*:\s*([\w:]+)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    for (const name of m[2].split(',')) receivers.set(name.trim().toLowerCase(), m[1].split(':').at(-1)!.toUpperCase());
  }
  const leaves = new Set([...code.matchAll(/%metadata\s*:\s*([\w:]+)/gi)].map(m => m[1].split(':').at(-1)!.toUpperCase()).filter(l => l !== '*'));
  const parts: string[] = [];
  for (const leaf of leaves) {
    const declarations = [...code.matchAll(/\bLocal\s+%metadata\s*:\s*([\w:]+)\s/gi)].filter(m => m[1].split(':').at(-1)!.toUpperCase() === leaf).length;
    const creates = [...code.matchAll(/\bcreate\s+%metadata\s*:\s*([\w:]+)/gi)].filter(m => m[1].split(':').at(-1)!.toUpperCase() === leaf).length;
    const calls = [...code.matchAll(/(&\w+)\s*\.\s*\w+\s*\(/g)].filter(m => receivers.get(m[1].toLowerCase()) === leaf).length;
    parts.push(`${leaf} ${count(stored, `PACKAGE.${leaf}`)}/${count(generated, `PACKAGE.${leaf}`)} | ${declarations}, ${creates}, ${calls}`);
  }
  console.log(`  ${taxonomy.has(def.definitionId) ? '-' : ' '}${def.definitionId}  ${parts.join('   ')}`);
}

console.log('2. post-Function top-level declaration-only Local runs repeating a class: leaf  stored rows / declarations');
for (const def of ctx.definitions) {
  if (isApplicationClass(def)) continue;
  const lines = def.sourceText.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n');
  let depth = 0, afterFunction = false, sawExecutable = false;
  let run: string[] = [];
  const flush = () => {
    const leaves = run.map(l => /^\s*Local\s+(?:array\s+of\s+)*([\w%]+(?:\s*:\s*\w+)+)/i.exec(l)?.[1]?.split(':').at(-1)?.trim().toUpperCase()).filter((x): x is string => x !== undefined);
    const repeated = [...new Set(leaves)].filter(l => leaves.filter(x => x === l).length > 1);
    if (repeated.length > 0) {
      const stored = storedReferenceKeys(def);
      console.log(`  ${taxonomy.has(def.definitionId) ? '-' : ' '}${def.definitionId}  ${repeated.map(l => `${l} ${count(stored, `PACKAGE.${l}`)} / ${leaves.filter(x => x === l).length}`).join('  ')}`);
    }
    run = [];
  };
  for (const line of lines) {
    if (/^\s*Function\b/i.test(line)) { depth++; continue; }
    if (/^\s*End-Function\b/i.test(line)) { depth--; afterFunction = true; continue; }
    if (depth > 0 || /^\s*$/.test(line)) continue;
    if (afterFunction && !sawExecutable && /^\s*Local\b[^=]*;\s*$/i.test(line)) { run.push(line); continue; }
    if (run.length > 0) flush();
    if (!/^\s*(?:Local|Global|Component|Declare|import|rem\b)/i.test(line)) sawExecutable = true;
  }
  if (run.length > 0) flush();
}
