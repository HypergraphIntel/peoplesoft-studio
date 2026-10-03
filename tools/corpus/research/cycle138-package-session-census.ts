/*
 * Cycle 138: where an Application Class program's stored PSPCMNAME list
 * opens a row again for a key it already holds -- the lifetime of App
 * Class reference rows (research only).
 *
 * For every Application Class program: the stored PACKAGE rows (wildcard
 * blank excluded) and their repeats per leaf, the repeats of every other
 * kind, and where the program's conditional-compilation directives sit --
 * outside the method bodies (before the class, in the class header, among
 * the top-level declarations, between implementations) or inside a body.
 * Tabulated EXACT / non-EXACT (by the taxonomy) x repeats x directive
 * position. With `--detail <ids>`: per program the implementation count,
 * the repeated leaves stored / generated, and the stored list against the
 * generated one.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle138-package-session-census.ts --taxonomy t.json [--detail 29724,30192]
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Map<number, string>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => [r.definitionId, r.primaryCategory]) : []);
const detail = new Set((args[args.indexOf('--detail') + 1] ?? '').split(',').filter(Boolean).map(Number));

const repeats = (keys: string[]): number => keys.length - new Set(keys).size;
const counts = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());

/** Directive positions: 'top' (outside every method body) or 'body'. */
function directivePositions(source: string): string[] {
  const positions: string[] = [];
  let zone: 'top' | 'header' | 'body' = 'top';
  for (const line of source.split('\n')) {
    if (/^\s*(?:class|interface)\s/i.test(line)) zone = 'header';
    else if (/^\s*end-(?:class|interface)/i.test(line)) zone = 'top';
    else if (zone !== 'header' && /^\s*(?:method|get|set)\s+\w+/i.test(line)) zone = 'body';
    else if (/^\s*end-(?:method|get|set)/i.test(line)) zone = 'top';
    if (/^\s*#If\b/i.test(line)) positions.push(zone === 'body' ? 'body' : 'top');
  }
  return positions;
}

const tally = new Map<string, number[]>();
const examples = new Map<string, number[]>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (!isApplicationClass(def)) continue;
  const stored = storedReferenceKeys(def);
  const packages = stored.filter(k => k.startsWith('PACKAGE.') && k !== 'PACKAGE.');
  const others = stored.filter(k => !k.startsWith('PACKAGE.'));
  const positions = directivePositions(def.sourceText);
  const directive = positions.includes('top') ? 'top-level directive' : positions.length > 0 ? 'body directives only' : 'no directive';
  const key = `${repeats(packages) > 0 ? 'repeated PACKAGE rows' : 'no repeated PACKAGE row'} | ${directive}`;
  const v = tally.get(key) ?? [0, 0]; tally.set(key, v);
  const exact = !taxonomy.has(def.definitionId);
  v[exact ? 0 : 1]++;
  if (repeats(packages) > 0 || positions.includes('top')) {
    const e = examples.get(key) ?? []; examples.set(key, e); e.push(exact ? def.definitionId : -def.definitionId);
  }
  if (detail.has(def.definitionId)) {
    const generated = (encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey);
    const implementations = [...def.sourceText.matchAll(/^\s*(method|get|set)\s+\w+\s*$/gim)].map(m => m[1].toLowerCase());
    const sc = counts(stored), gc = counts(generated);
    console.log(`== ${def.definitionId} ${taxonomy.get(def.definitionId) ?? 'EXACT'}: stored ${stored.length} rows (PACKAGE ${packages.length}, ${repeats(packages)} repeated; other kinds ${repeats(others)} repeated), generated ${generated.length}; implementations ${implementations.length} (method ${implementations.filter(k => k === 'method').length}, get ${implementations.filter(k => k === 'get').length}, set ${implementations.filter(k => k === 'set').length}); directives ${positions.join(' ') || '-'}`);
    console.log('   repeated PACKAGE leaves stored/generated: ' + [...sc].filter(([k, n]) => k.startsWith('PACKAGE.') && k !== 'PACKAGE.' && n > 1)
      .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.slice(8)} ${n}/${gc.get(k) ?? 0}`).join(', '));
    let firstDifference = -1;
    for (let i = 0; i < Math.max(stored.length, generated.length); i++) if (stored[i] !== generated[i]) { firstDifference = i; break; }
    console.log(`   first list difference: ${firstDifference < 0 ? 'none (list exact)' : `#${firstDifference + 1} stored ${stored[firstDifference] ?? '-'} / generated ${generated[firstDifference] ?? '-'}`}`);
  }
}
console.log('App Class programs                                        EXACT / non-EXACT   (negative = non-EXACT)');
for (const [k, [e, n]] of [...tally].sort()) {
  console.log(`  ${k.padEnd(58)} ${String(e).padStart(5)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).slice(0, 12).join(' ')}`);
}
