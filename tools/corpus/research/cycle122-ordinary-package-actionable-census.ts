/*
 * Cycle 122: split the ordinary programs whose first reference divergence
 * is a PACKAGE row into (A) actionable source-local failures, (B) programs
 * on the external-metadata fallback path and (C) metadata-blocked
 * programs (research only).
 *
 * Input: the PACKAGE census JSON of `cycle102-package-mechanism-census.ts`
 * (`--json`), whose rows carry the mechanism (STORED_REUSES_GENERATED_OPENS,
 * STORED_OPENS_GENERATED_REUSES, GENERATED_MISSING_IDENTITY, ORDERING ...)
 * and the identity's source (named-import, wildcard-import, builtin,
 * external, self). The fallback path is re-checked here with the
 * harness-equivalent encode (`onExternalMetadataFallback`). A
 * non-fallback row whose class identity is `external` (a class known only
 * from metadata the snapshot lacks) is metadata-blocked; every other
 * non-fallback row -- named import, wildcard import, built-in -- is
 * actionable. For the actionable rows the stored and generated PACKAGE
 * row lists are printed.
 *
 * Usage: npx tsx tools/corpus/research/cycle122-ordinary-package-actionable-census.ts <package-census.json>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { snapshotConditionalCompilation } from '../snapshot/toolsRelease';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

interface CensusRow { id: number; app: boolean; mechanism: string; source: string; identity: string; category: string }

const rows = (JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as CensusRow[]).filter(row => !row.app);
const wanted = new Map(rows.map(row => [row.id, row]));
const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const conditionalCompilation = snapshotConditionalCompilation(db);
const groups = { fallback: [] as CensusRow[], metadataBlocked: [] as CensusRow[], actionable: [] as CensusRow[] };
const lists = new Map<number, { stored: string[]; generated: string[] }>();

for (const def of listSnapshotDefinitions(db) as any[]) {
  const row = wanted.get(def.definitionId);
  if (row === undefined) continue;
  let fallback = false;
  let generated: string[] = [];
  try {
    const values = [def.objectvalue1, def.objectvalue2].map((v: string) => (v ?? '').trim());
    const artifacts = encodeProgramArtifacts(String(def.sourceText), {
      owner: { recordName: values[0], fieldName: values[1] }, applicationClassTypeMetadata: provider, conditionalCompilation,
      onExternalMetadataFallback: () => { fallback = true; }
    } as any);
    generated = artifacts.references.filter((r: any) => r.kind === 'package').map((r: any) => String(r.packageName ?? '').toUpperCase());
  } catch { /* not encodable */ }
  const stored = [...def.names].sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum))
    .filter((r: any) => String(r.recname ?? '').trim().toUpperCase() === 'PACKAGE')
    .map((r: any) => String(r.refname ?? '').trim().toUpperCase());
  if (fallback) groups.fallback.push(row);
  else if (row.source.startsWith('external')) groups.metadataBlocked.push(row);
  else { groups.actionable.push(row); lists.set(row.id, { stored, generated }); }
}

const count = (list: CensusRow[], key: (row: CensusRow) => string) => {
  const m = new Map<string, number>();
  for (const row of list) m.set(key(row), (m.get(key(row)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join('; ');
};
console.log(`ordinary first-PACKAGE ${rows.length}: fallback ${groups.fallback.length}, metadata-blocked ${groups.metadataBlocked.length}, actionable ${groups.actionable.length}`);
console.log(`actionable by mechanism / source: ${count(groups.actionable, row => `${row.mechanism} / ${row.source}`)}`);
console.log(`metadata-blocked: ${count(groups.metadataBlocked, row => row.mechanism)}`);
for (const row of groups.actionable.sort((a, b) => a.id - b.id)) {
  const l = lists.get(row.id)!;
  console.log(`  ${row.id} ${row.category} ${row.mechanism} ${row.source} ${row.identity}`);
  console.log(`      stored    ${l.stored.join(' ')}`);
  console.log(`      generated ${l.generated.join(' ')}`);
}
