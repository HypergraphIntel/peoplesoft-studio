/*
 * Compiler-completion goal: census of the REFERENCE_ACTIVE_PACKAGE
 * population (current #1 divergence IS a package-kind reference, unlike
 * REFERENCE_ACTIVE_RECORD_FIELD where the divergence is downstream of a
 * missing package allocation). Clusters by the missing PACKAGE.<name>
 * identity and by source form, reusing the same comparator as
 * recordfield-census.ts.
 *
 * Usage: npx tsx tools/corpus/research/package-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition, snapshotToCorpusDefinition } from '../snapshot/reader';
import { validateDefinition } from '../validator';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const TAXONOMY_PATH = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');

function ownerContextOf(snap: any) {
  const values = [snap.objectvalue1, snap.objectvalue2, snap.objectvalue3, snap.objectvalue4, snap.objectvalue5, snap.objectvalue6, snap.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const packagePath = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
  return { recordName: values[0], fieldName: values[1], packagePath };
}

function sKeyOf(row: any): string {
  return `${row.recname.trim().toUpperCase()}.${row.refname.trim().toUpperCase()}`;
}
function gKeyOf(g: any): string {
  switch (g.kind) {
    case 'owner': return (g.recordName || g.fieldName) ? `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}` : '.';
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'record-field': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    case 'declare-function': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    case 'quoted-reference': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    default: return JSON.stringify(g);
  }
}

async function main() {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const ids: number[] = taxonomy.rows
    .filter((r: any) => r.primaryCategory === 'REFERENCE_ACTIVE_PACKAGE')
    .map((r: any) => r.definitionId);

  console.log(`REFERENCE_ACTIVE_PACKAGE population: ${ids.length}`);

  const db = openSnapshotDatabase();
  const pkgClusters: Record<string, number> = {};
  const rows: any[] = [];

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    const owner = ownerContextOf(snap);
    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(snap.sourceText, { owner } as any);
    } catch {
      continue;
    }
    const generatedNoOwner = artifacts.references.filter((r: any) => r.kind !== 'owner');
    const stored = snap.names.slice(1).map(sKeyOf);
    const generated = generatedNoOwner.map(gKeyOf);
    let firstDivergenceIndex = -1;
    const n = Math.max(stored.length, generated.length);
    for (let i = 0; i < n; i++) {
      if (stored[i] !== generated[i]) { firstDivergenceIndex = i; break; }
    }
    const firstDivStoredKey = stored[firstDivergenceIndex];
    if (firstDivStoredKey && firstDivStoredKey.startsWith('PACKAGE.')) {
      const pkgName = firstDivStoredKey.split('.')[1];
      pkgClusters[pkgName] = (pkgClusters[pkgName] ?? 0) + 1;
    }
    rows.push({ definitionId: id, appClass: snap.objectid1 === 104, firstDivStoredKey });
  }

  const sorted = Object.entries(pkgClusters).sort((a, b) => b[1] - a[1]);
  console.log('PACKAGE.<X> breakdown (top 30):');
  for (const [k, v] of sorted.slice(0, 30)) console.log(' ', k, v);
  console.log('total PACKAGE cases:', sorted.reduce((a, [, v]) => a + v, 0), '/ total pop:', rows.length);

  fs.writeFileSync(
    path.join(__dirname, '../../../.claude/package-census.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)
  );
}

main();
