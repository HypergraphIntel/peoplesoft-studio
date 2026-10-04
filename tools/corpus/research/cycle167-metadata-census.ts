/*
 * Cycle 167: Application Class type metadata the corpus lacks (research
 * only).
 *
 * Every receiver class the encoder looks up in the type-metadata provider
 * and does not find (`applicationClassTypeMetadataTrace`), with the EXACT /
 * non-EXACT programs that look it up and the members asked for, ranked by
 * non-EXACT programs. Captured classes (snapshot_appclass_metadata) count
 * as present when their program decodes. `--paths` prints only the class paths: the seed list
 * for `capture-appclass-metadata.ts --transitive`.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle167-metadata-census.ts --taxonomy t.json [--paths]
 */
import fs from 'node:fs';

import { listSnapshotApplicationClassDefinitions } from '../snapshot/applicationClassTypeMetadata';
import { decodeCapturedApplicationClass, listSnapshotCapturedApplicationClasses } from '../snapshot/capturedApplicationClasses';
import { openSnapshotDatabase } from '../snapshot/store';
import { openHarnessContext, encodeAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const db = openSnapshotDatabase();
const captured = listSnapshotCapturedApplicationClasses(db);
/* Captured classes whose program does not decode completely are not in the provider: still absent. */
const undecodable = new Set(captured.filter(c => decodeCapturedApplicationClass(c) === undefined).map(c => c.path.join(':').toLowerCase()));
const known = new Set([
  ...listSnapshotApplicationClassDefinitions(db).map(d => d.path.join(':').toLowerCase()),
  ...captured.map(c => c.path.join(':').toLowerCase()).filter(path => !undecodable.has(path))
]);
const ctx = openHarnessContext();
const absent = new Map<string, { exact: Set<number>; non: Set<number>; members: Set<string> }>();
for (const def of ctx.definitions as any[]) {
  encodeAsHarness(ctx, def, {
    applicationClassTypeMetadataTrace: (e: any) => {
      const path = (e.receiver as string[]).join(':').toLowerCase();
      if (known.has(path)) return;
      const v = absent.get(path) ?? { exact: new Set(), non: new Set(), members: new Set() };
      absent.set(path, v);
      (nonexact.has(def.definitionId) ? v.non : v.exact).add(def.definitionId);
      v.members.add(e.kind === 'member' ? `.${e.member}` : `${e.member}()`);
    }
  } as any);
}
const rows = [...absent].sort((a, b) => b[1].non.size - a[1].non.size || b[1].exact.size - a[1].exact.size || (a[0] < b[0] ? -1 : 1));
if (args.includes('--paths')) {
  for (const [path] of rows) if (!path.startsWith('%')) console.log(path);
} else {
  const programs = new Set(rows.flatMap(([, v]) => [...v.non]));
  console.log(`== absent receiver classes ${rows.length} (%metadata ${rows.filter(([p]) => p.startsWith('%')).length}); non-EXACT programs looking one up ${programs.size}`);
  for (const [path, v] of rows) {
    console.log(`  ${String(v.non.size).padStart(3)} ${String(v.exact.size).padStart(4)}  ${(path + (undecodable.has(path) ? ' (captured, undecodable)' : '')).padEnd(56)} ${[...v.members].slice(0, 6).join(' ')}${v.non.size ? ` | non ${[...v.non].slice(0, 8).join(' ')}` : ''}`);
  }
}
