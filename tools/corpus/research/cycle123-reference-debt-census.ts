/*
 * Cycle 123: byte-exact programs whose generated PSPCMNAME list differs
 * from stored (research only).
 *
 * The harness EXACT verdict compares program bytes (and the decode /
 * roundtrip), not the reference list: a program can be byte-exact while
 * its generated PSPCMNAME rows differ -- typically trailing rows stored
 * but never referenced by the program, or a compensating row (13525's
 * wildcard blank standing where its missing POPULATIONMANAGER row
 * belongs). This lists every forward-exact program whose reference list
 * (the taxonomy comparator, owner excluded) is not exact.
 *
 * Usage: npx tsx tools/corpus/research/cycle123-reference-debt-census.ts
 */
import { openHarnessContext, encodeAsHarness, storedReferenceKeys, generatedReferenceKey, isApplicationClass } from './lib/harnessContext';

const ctx = openHarnessContext();
let forwardExact = 0;
const debt: any[] = [];
for (const def of ctx.definitions) {
  const encoded = encodeAsHarness(ctx, def);
  if (!encoded.artifacts || Buffer.compare(encoded.artifacts.program, def.storedProgram) !== 0) continue;
  forwardExact++;
  const stored = storedReferenceKeys(def).slice(1);
  const generated = encoded.artifacts.references.filter((r: any) => r.kind !== 'owner').map(generatedReferenceKey);
  if (stored.join('|') === generated.join('|')) continue;
  debt.push({
    id: def.definitionId, app: isApplicationClass(def), fallback: encoded.fallback, stored: stored.length, generated: generated.length,
    generatedIsPrefix: stored.length > generated.length && generated.every((k: string, i: number) => stored[i] === k)
  });
}
console.log(`forward-exact ${forwardExact}; reference list not exact ${debt.length} (App Class ${debt.filter(d => d.app).length}, fallback ${debt.filter(d => d.fallback).length}, generated a strict prefix of stored ${debt.filter(d => d.generatedIsPrefix).length})`);
for (const d of debt) console.log(`  ${d.id} ${d.app ? 'App Class' : 'ordinary'}${d.fallback ? ' fallback' : ''} stored ${d.stored} generated ${d.generated}${d.generatedIsPrefix ? ' (prefix)' : ''}`);
