/*
 * Cycle 106: PACKAGE rows of `%metadata` imports (research only).
 *
 * Cycle 105 found programs whose only wildcard imports are `%metadata...:*`
 * storing no blank wildcard metadata row. This census asks, from STORED
 * rows alone, what an import contributes, comparing `%metadata` imports
 * with ordinary ones (controls) in every definition that has either:
 *
 *   named-unused    a named import `import ROOT:...:Class;` whose class is
 *                   named nowhere else in the source (masked: comments and
 *                   strings removed) -- the only possible origin of a stored
 *                   row for that class is the import itself. Stored: does
 *                   a PACKAGE row with that REFNAME exist?
 *   wildcard        the stored blank-REFNAME rows of the program against
 *                   two models of the one-time "first wildcard claims the
 *                   metadata row" state (Cycle 93):
 *                     A  a `%metadata` wildcard consumes the claim without
 *                        a row (rows = 0 when a `%metadata` wildcard is
 *                        first, else 1)
 *                     B  a `%metadata` wildcard neither allocates nor
 *                        consumes it (rows = 1 iff an ordinary wildcard
 *                        exists)
 *                   and the ordinary rule (rows = 1 iff any wildcard).
 *
 * Generated rows (current encoder) are reported beside stored. Application
 * Class programs (OBJECTID1 104) are kept apart from ordinary ones.
 *
 * Usage: npx tsx tools/corpus/research/cycle106-metadata-import-census.ts [--json out.jsonl]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { maskSource } from './cycle103-builtin-package-lifetime-census';

function context(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

const jsonIndex = process.argv.indexOf('--json');
const out = jsonIndex >= 0 ? fs.openSync(process.argv[jsonIndex + 1], 'w') : undefined;
const tally = new Map<string, number[]>();
const add = (key: string, id: number) => { const l = tally.get(key) ?? []; l.push(id); tally.set(key, l); };

for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  const source = String(def.sourceText ?? '');
  if (!/\bimport\b/i.test(source)) continue;
  const masked = maskSource(source);
  const imports = [...masked.matchAll(/\bimport\s+([%A-Za-z0-9_:\s]+?)\s*:\s*(\*|[A-Za-z0-9_]+)\s*;/gi)].map(m => ({
    at: m.index!, end: m.index! + m[0].length,
    path: m[1].replace(/\s+/g, '').split(':'), leaf: m[2], wildcard: m[2] === '*',
    metadata: /^%metadata$/i.test(m[1].replace(/\s+/g, '').split(':')[0])
  }));
  if (imports.length === 0) continue;
  const hasMetadata = imports.some(i => i.metadata);
  const app = def.objectid1 === 104;
  const scope = `${app ? 'app' : 'ord'} ${hasMetadata ? 'has-%metadata' : 'control     '}`;

  const stored = def.names.slice(1).map((r: any) => ({
    refname: String(r.refname ?? '').trim().toUpperCase(), isPackage: String(r.recname ?? '').trim() === 'PACKAGE'
  }));
  let generated: any[] | undefined;
  if (hasMetadata) {
    try { generated = (encodeProgramArtifacts(source, { owner: context(def) } as any) as any).references.filter((r: any) => r.kind === 'package'); } catch { generated = undefined; }
  }

  /* named imports whose class appears nowhere else in the masked source */
  const rest = imports.reduceRight((text, i) => text.slice(0, i.at) + ' '.repeat(i.end - i.at) + text.slice(i.end), masked);
  const records: any[] = [];
  for (const i of imports.filter(x => !x.wildcard)) {
    if (new RegExp(`(?<![A-Za-z0-9_&])${i.leaf}(?![A-Za-z0-9_])`, 'i').test(rest)) continue;
    const storedRow = stored.some((r: any) => r.isPackage && r.refname === i.leaf.toUpperCase());
    const generatedRow = generated?.some((r: any) => String(r.packageName ?? '').toUpperCase() === i.leaf.toUpperCase());
    const key = `${scope} named-unused ${i.metadata ? '%metadata' : 'ordinary '} stored row: ${storedRow ? 'YES' : 'no '}` +
      `${hasMetadata ? ` generated row: ${generatedRow === undefined ? 'err' : generatedRow ? 'YES' : 'no '}` : ''}`;
    add(key, def.definitionId);
    records.push({ kind: 'named-unused', leaf: i.leaf, metadata: i.metadata, storedRow, generatedRow });
  }

  /* wildcard metadata rows */
  const wildcards = imports.filter(i => i.wildcard);
  if (wildcards.length > 0) {
    const storedBlank = stored.filter((r: any) => r.isPackage && r.refname === '').length;
    const firstIsMetadata = wildcards[0].metadata;
    const anyOrdinary = wildcards.some(w => !w.metadata);
    const anyMetadata = wildcards.some(w => w.metadata);
    const modelA = firstIsMetadata ? 0 : 1;
    const modelB = anyOrdinary ? 1 : 0;
    const shape = !anyMetadata ? 'ordinary wildcards only' : !anyOrdinary ? '%metadata wildcards only' : firstIsMetadata ? 'mixed, %metadata first' : 'mixed, ordinary first';
    const generatedBlank = generated === undefined ? undefined : generated.filter((r: any) => !r.packageName).length;
    const key = `${scope} wildcard ${shape.padEnd(24)} stored blank=${storedBlank}` +
      (anyMetadata ? ` | model A ${modelA === storedBlank ? 'ok' : 'NO'} | model B ${modelB === storedBlank ? 'ok' : 'NO'} | generated blank=${generatedBlank ?? 'err'}` : '');
    add(key, def.definitionId);
    records.push({ kind: 'wildcard', shape, storedBlank, modelA, modelB, generatedBlank });
  }
  if (out !== undefined && hasMetadata) fs.writeSync(out, JSON.stringify({ id: def.definitionId, app, imports: imports.map(i => `${i.path.join(':')}:${i.leaf}`), records }) + '\n');
}
if (out !== undefined) fs.closeSync(out);
for (const [key, ids] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) console.log(String(ids.length).padStart(6), key, [...new Set(ids)].slice(0, 8).join(','));
