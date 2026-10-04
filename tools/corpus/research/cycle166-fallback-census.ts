/*
 * Cycle 166: the ordinary external-metadata fallback pass (Cycle 93 / 112)
 * re-derived from current HEAD (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   members   every program the encoder sends through the fallback pass:
 *             category, non-%metadata wildcard imports, stored / generated
 *             blank PACKAGE rows, stored PACKAGE rows the generated list
 *             lacks and whether their class is in the snapshot;
 *   wildcard  every program with a non-%metadata wildcard import: stored
 *             blank PACKAGE rows (the one-claim rule), by fallback / not;
 *   summary   the members grouped by mechanism.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle166-fallback-census.ts --taxonomy t.json [--section <name>]
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotApplicationClassDefinitions } from '../snapshot/applicationClassTypeMetadata';
import { openSnapshotDatabase } from '../snapshot/store';
import { openHarnessContext, encodeAsHarness, isApplicationClass, storedReferenceKeys, generatedReferenceKey } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const category = new Map<number, string>(taxonomyRows.map(r => [r.definitionId, String(r.primaryCategory).replace('REFERENCE_', '')]));
const sectionArg = args.indexOf('--section');
const only = sectionArg >= 0 ? args[sectionArg + 1] : undefined;
const run = (name: string) => only === undefined || only === name;
const ctx = openHarnessContext();
const snapshotLeaves = new Set(listSnapshotApplicationClassDefinitions(openSnapshotDatabase()).map(d => d.path.at(-1)!.toUpperCase()));
const wildcards = (source: string) => [...maskNonCode(source).matchAll(/\bimport\s+([%\w:]+):\*\s*;/gi)].filter(m => !/^%metadata/i.test(m[1])).length;
const minus = (a: string[], b: string[]) => {
  const left = new Map<string, number>(); for (const k of b) left.set(k, (left.get(k) ?? 0) + 1);
  return a.filter(k => { const n = left.get(k) ?? 0; if (n > 0) { left.set(k, n - 1); return false; } return true; });
};

const groups = new Map<string, number[]>();
const wildcardTally = new Map<string, Set<number>[]>();
if (run('members') || run('summary')) console.log('== members: programs taking the fallback pass');
for (const def of ctx.definitions as any[]) {
  const needsWildcard = run('wildcard');
  const w = needsWildcard || run('members') || run('summary') ? wildcards(def.sourceText) : 0;
  const r = (run('members') || run('summary') || (needsWildcard && w > 0)) ? encodeAsHarness(ctx, def) : undefined;
  const storedBlank = storedReferenceKeys(def).filter(k => k === 'PACKAGE.').length;
  if (needsWildcard && w > 0) {
    const key = `${isApplicationClass(def) ? 'App Class' : 'ordinary'}${r?.fallback ? ' fallback' : ''} | ${w > 1 ? '2+' : '1'} wildcard | stored blank rows ${storedBlank}`;
    const v = wildcardTally.get(key) ?? [new Set(), new Set()]; wildcardTally.set(key, v); v[category.has(def.definitionId) ? 1 : 0].add(def.definitionId);
  }
  if (!r?.fallback || !(run('members') || run('summary'))) continue;
  const s = storedReferenceKeys(def), g = (r.artifacts?.references ?? []).map(generatedReferenceKey);
  const generatedBlank = g.filter(k => k === 'PACKAGE.').length;
  const missing = minus(s, g).filter(k => k.startsWith('PACKAGE.') && k !== 'PACKAGE.').map(k => k.slice(8));
  const absent = missing.filter(c => !snapshotLeaves.has(c));
  const cat = category.get(def.definitionId) ?? 'EXACT';
  if (run('members')) {
    console.log(`  ${String(def.definitionId).padEnd(6)} ${cat.padEnd(24)} wildcards ${w} blank rows stored ${storedBlank} / generated ${generatedBlank} | missing ${missing.join(',') || '-'}${absent.length ? ` (absent from snapshot: ${absent.length})` : ''}`);
  }
  const mechanism = cat === 'EXACT'
    ? (generatedBlank > storedBlank ? 'EXACT by compensation (over-claim + missing row)' : 'EXACT')
    : absent.length ? `missing rows of classes absent from the snapshot${generatedBlank > storedBlank ? ' + over-claim' : ''}`
      : missing.length ? `missing rows of snapshot classes${generatedBlank > storedBlank ? ' + over-claim' : ''}`
        : generatedBlank > storedBlank ? 'over-claim only' : `other (${cat})`;
  groups.set(mechanism, [...(groups.get(mechanism) ?? []), def.definitionId]);
}
if (run('summary')) {
  console.log('== summary: fallback members by mechanism');
  for (const [k, ids] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(ids.length).padStart(3)} ${k.padEnd(62)} ${ids.join(' ')}`);
}
if (run('wildcard')) {
  console.log('== wildcard: stored blank PACKAGE rows of programs with a non-%metadata wildcard import');
  for (const [k, [exact, non]] of [...wildcardTally].sort()) console.log(`  ${k.padEnd(56)} EXACT ${String(exact.size).padStart(5)}  non ${String(non.size).padStart(3)}${non.size && non.size < 12 ? ` | non ${[...non].join(' ')}` : ''}`);
}
