/*
 * Cycle 144: ordinary PACKAGE row provenance (research only).
 *
 *   --targets <ids>  per definition: stored / generated PSPCMNAME row counts,
 *                    LCS edit distance, the rows only stored has and only
 *                    the generated list has (full-list classification:
 *                    order-only, missing, extra, substitution);
 *   (default)        every ordinary `As <Package:Class>` expression cast
 *                    (not a parameter or declaration type) by what follows
 *                    it -- a method call on the parenthesized result `).m(`,
 *                    a property `).p`, anything else -- and every ordinary
 *                    Function header `As array of` / `Returns array of`
 *                    an Application Class; per site whether the program is
 *                    EXACT, and whether its stored list holds the class
 *                    leaf at all.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle144-ordinary-package-provenance-census.ts --taxonomy t.json [--targets 14641,24800]
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const targets = args.includes('--targets') ? args[args.indexOf('--targets') + 1].split(',').map(Number) : undefined;
const ctx = openHarnessContext();

if (targets !== undefined) {
  for (const id of targets) {
    const def = ctx.definitions.find(d => d.definitionId === id);
    if (def === undefined) continue;
    const encoded = encodeAsHarness(ctx, def);
    const stored = storedReferenceKeys(def);
    const generated = (encoded.artifacts?.references ?? []).map(generatedReferenceKey);
    const lcs = Array.from({ length: stored.length + 1 }, () => new Int32Array(generated.length + 1));
    for (let i = stored.length - 1; i >= 0; i--) {
      for (let j = generated.length - 1; j >= 0; j--) {
        lcs[i][j] = stored[i] === generated[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const counts = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
    const sc = counts(stored), gc = counts(generated);
    const only = (a: Map<string, number>, b: Map<string, number>) =>
      [...a].flatMap(([k, n]) => Array.from({ length: Math.max(0, n - (b.get(k) ?? 0)) }, () => k));
    const onlyStored = only(sc, gc), onlyGenerated = only(gc, sc);
    const kind = onlyStored.length === 0 && onlyGenerated.length === 0
      ? (stored.join() === generated.join() ? 'exact' : 'order-only')
      : onlyGenerated.length === 0 ? 'stored has more' : onlyStored.length === 0 ? 'generated has more' : 'mixed';
    console.log(`${id} ${encoded.fallback ? 'fallback ' : ''}stored ${stored.length} generated ${generated.length} edits ${stored.length + generated.length - 2 * lcs[0][0]} ${kind} | only stored [${onlyStored.join(' ')}] | only generated [${onlyGenerated.join(' ')}]`);
  }
  process.exit(0);
}

const tally = new Map<string, number[]>();
const examples = new Map<string, number[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[exact ? 0 : 1]++;
  const e = examples.get(key) ?? []; examples.set(key, e);
  if (e.length < 8 && !e.includes(exact ? id : -id)) e.push(exact ? id : -id);
};
for (const def of ctx.definitions) {
  if (isApplicationClass(def)) continue;
  const code = def.sourceText.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|"[^"\n]*"/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(?<![A-Za-z0-9_&%#$])rem\b[^;]*;/gi, m => m.replace(/[^\n]/g, ' '));
  const stored = new Set(storedReferenceKeys(def));
  const exact = !taxonomy.has(def.definitionId);
  // expression casts: `<expr> As PKG:...:Class` not preceded by a parameter / declaration `&x As`
  for (const m of code.matchAll(/(\S)\s+As\s+([A-Za-z_][\w]*(?:\s*:\s*[A-Za-z_][\w]*)+)/gi)) {
    const lineStart = code.lastIndexOf('\n', m.index!) + 1;
    if (/^\s*(?:Declare\s+)?Function\b/i.test(code.slice(lineStart))) continue; // a parameter type
    const after = code.slice(m.index! + m[0].length);
    const follow = /^\s*\)\s*\.\s*[A-Za-z_]\w*\s*\(/.test(after) ? 'method call on the result' : /^\s*\)\s*\.\s*[A-Za-z_]\w*/.test(after) ? 'property of the result' : 'no member (argument / assignment)';
    const leaf = m[2].split(':').at(-1)!.trim().toUpperCase();
    add(`cast, ${follow.padEnd(34)} stored has the class row: ${stored.has(`PACKAGE.${leaf}`) ? 'yes' : 'NO '}`, exact, def.definitionId);
  }
  for (const m of code.matchAll(/^\s*Function\b[^\n]*/gim)) {
    for (const t of m[0].matchAll(/(As|Returns)\s+array\s+of\s+(?:array\s+of\s+)*([A-Za-z_][\w]*(?:\s*:\s*[A-Za-z_][\w]*)+)/gi)) {
      const leaf = t[2].split(':').at(-1)!.trim().toUpperCase();
      add(`Function header ${t[1]} array of <Class>                stored has the class row: ${stored.has(`PACKAGE.${leaf}`) ? 'yes' : 'NO '}`, exact, def.definitionId);
    }
  }
}
console.log('ordinary class-type sites                                                   EXACT / non-EXACT');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(80)} ${String(e).padStart(5)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).join(' ')}`);
