/*
 * Cycle 105: the blank-REFNAME PACKAGE metadata row of wildcard imports,
 * stored vs generated (research only).
 *
 * The 12 "empty generated PACKAGE identity" rows of the Cycle 104 rerank
 * are not broken Application Class identities: they are wildcard-import
 * metadata rows (PACKAGE, REFNAME blank, PACKAGEROOT / QUALIFYPATH = the
 * wildcard's package), and every one of the 12 programs has two or more
 * wildcard imports. Cycle 93 found that only the FIRST wildcard import of a
 * program claims that row; the encoder applies it -- except in the
 * external-metadata fallback re-encode (`applicationClassRowsWithoutImportResolution`),
 * which keeps the pre-Cycle-93 "every wildcard import claims a row".
 *
 * For every definition with a wildcard import this records the wildcard
 * imports (in order, with their package path), the stored blank-REFNAME
 * PACKAGE rows (NAMENUM, PACKAGEROOT / QUALIFYPATH where the store is
 * descriptive, and whether the row sits where the first wildcard's row
 * would: before every row the source allocates after that import), and
 * the generated blank rows. A program whose generated blank rows exceed one
 * is encoded by the fallback pass (the only path that claims twice).
 *
 * Usage: npx tsx tools/corpus/research/cycle105-wildcard-metadata-row-census.ts [--json out.jsonl]
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
  if (!/\bimport\b[^;]*:\s*\*\s*;/i.test(source)) continue;
  const imports = [...maskSource(source).matchAll(/\bimport\s+([%A-Za-z0-9_:]+?)\s*:\s*(\*|[A-Za-z0-9_]+)\s*;/gi)]
    .map(m => ({ wildcard: m[2] === '*', path: m[1].split(':') }));
  const wildcards = imports.filter(i => i.wildcard);
  if (wildcards.length === 0) continue;

  const blank = (r: any) => String(r.recname ?? '').trim() === 'PACKAGE' && String(r.refname ?? '').trim() === '';
  const storedRows = def.names.slice(1);
  const storedBlank = storedRows
    .map((r: any, index: number) => ({ index, namenum: Number(r.namenum), root: String(r.packageroot ?? '').trim(), qualify: String(r.qualifypath ?? '').trim() }))
    .filter((_: any, index: number) => blank(storedRows[index]));
  const descriptive = storedBlank.some((r: any) => r.root !== '');
  const first = wildcards[0];
  const firstMatches = storedBlank.length === 1 && descriptive
    ? storedBlank[0].root.toUpperCase() === first.path[0].toUpperCase() &&
      storedBlank[0].qualify.toUpperCase() === first.path.slice(1).join(':').toUpperCase()
    : undefined;
  /* Named imports before the first wildcard allocate their rows first. */
  const namedBeforeFirstWildcard = imports.slice(0, imports.indexOf(first)).filter(i => !i.wildcard).length;
  const storedPositionIsFirstWildcard = storedBlank.length === 1 ? storedBlank[0].index === namedBeforeFirstWildcard : undefined;

  let generatedBlank = -1;
  try {
    const artifacts: any = encodeProgramArtifacts(source, { owner: context(def) } as any);
    generatedBlank = artifacts.references.filter((r: any) => r.kind === 'package' && !r.packageName).length;
  } catch { /* encode error: counted as such */ }

  const app = def.objectid1 === 104;
  const pass = generatedBlank < 0 ? 'encode-error' : generatedBlank > 1 ? 'fallback (claims every wildcard)' : 'normal';
  const record = {
    id: def.definitionId, app, wildcards: wildcards.length, imports: imports.length,
    storedBlank: storedBlank.length, descriptive, firstMatches, storedPositionIsFirstWildcard, generatedBlank, pass
  };
  if (out !== undefined) fs.writeSync(out, JSON.stringify(record) + '\n');
  add(
    `${app ? 'app     ' : 'ordinary'} wildcards=${wildcards.length > 1 ? '2+' : '1 '} ${pass.padEnd(32)} stored blank=${storedBlank.length} ` +
    `generated blank=${generatedBlank < 0 ? 'err' : generatedBlank > 1 ? 'n' : generatedBlank}` +
    `${firstMatches === undefined ? '' : firstMatches ? ' root=FIRST wildcard' : ' root=OTHER'}` +
    `${storedPositionIsFirstWildcard === undefined ? '' : storedPositionIsFirstWildcard ? ' at first-wildcard position' : ' ELSEWHERE'}`,
    def.definitionId
  );
}
if (out !== undefined) fs.closeSync(out);
for (const [key, ids] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) console.log(String(ids.length).padStart(6), key, ids.slice(0, 8).join(','));
