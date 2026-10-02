/*
 * Cycle 123: the external-metadata fallback population and its triggers
 * (research only).
 *
 * An ordinary program takes the fallback (`encodeOrdinaryProgramFragment`)
 * when a method call's receiver class is external metadata the provider
 * cannot resolve (`externalClassMetadata.unresolvedReceiverCalls`); the
 * re-encode differs from the normal one only in
 * `externalMetadataWildcardClaims` (read once, by the wildcard-import
 * claim). For each fallback program the type-metadata lookups that
 * returned nothing are classified: the receiver class is absent from the
 * snapshot (`class-absent`), or present but the member / an ancestor is not
 * (`class-present/member-missing`); `no-provider-miss` means the external
 * receiver came from source typing alone.
 *
 * Usage: npx tsx tools/corpus/research/cycle123-fallback-trigger-census.ts [taxonomy.json]
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness } from './lib/harnessContext';
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotApplicationClassDefinitions } from '../snapshot/applicationClassTypeMetadata';

const ctx = openHarnessContext();
const known = new Set(listSnapshotApplicationClassDefinitions(openSnapshotDatabase()).map(d => d.path.map(c => c.toUpperCase()).join(':')));
const taxonomy = new Map<number, string>(process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).rows.map((r: any) => [r.definitionId, r.primaryCategory]) : []);
const triggers = new Map<string, number[]>();
const categories = new Map<string, number>();
for (const def of ctx.definitions) {
  const misses = new Set<string>();
  const encoded = encodeAsHarness(ctx, def, {
    applicationClassTypeMetadataTrace: (event: any) => {
      if (event.result === undefined) misses.add(known.has(event.receiver.map((c: string) => c.toUpperCase()).join(':')) ? 'class-present/member-missing' : 'class-absent');
    }
  });
  if (!encoded.fallback) continue;
  const key = [...misses].sort().join(' + ') || 'no-provider-miss';
  triggers.set(key, [...(triggers.get(key) ?? []), def.definitionId]);
  const category = taxonomy.get(def.definitionId) ?? 'EXACT';
  categories.set(category, (categories.get(category) ?? 0) + 1);
}
console.log(`fallback programs ${[...triggers.values()].reduce((a, b) => a + b.length, 0)}; 13525 in: ${[...triggers.values()].some(ids => ids.includes(13525))}`);
for (const [k, ids] of [...triggers].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${ids.length} ${k}: ${ids.slice(0, 12).join(' ')}`);
console.log(`  by category: ${[...categories].map(([k, v]) => `${k} ${v}`).join(', ')}`);
