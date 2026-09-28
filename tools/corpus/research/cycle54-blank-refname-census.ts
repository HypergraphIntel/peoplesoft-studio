/*
 * Cycle 54 Phase 1/2: reproduce and precisely define the blank-REFNAME
 * PACKAGE row population surfaced incidentally by Cycle 53's self-class-row
 * census. That census only checked whether a blank-refname PACKAGE row
 * existed ANYWHERE in a definition's stored PSPCMNAME -- this script
 * reproduces that count fresh, reports exact row counts (not just
 * definition counts), flags definitions with multiple such rows, and
 * dumps full field-level shape (recname, refname, packageroot, qualifypath,
 * appclassmethod, namenum, row index) for representative rows.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle54-blank-refname-census.ts [--json]
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';

const APPLICATION_CLASS_OBJECT_ID = 104;

function main(): void {
  const asJson = process.argv.includes('--json');
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db);
  const appClassDefs = definitions.filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  console.log(`Total definitions in snapshot: ${definitions.length}`);
  console.log(`Application Class definitions (objectid1=${APPLICATION_CLASS_OBJECT_ID}): ${appClassDefs.length}`);

  interface Hit {
    definitionId: number;
    rowIndex: number; // position within the definition's names array (0-based)
    namenum: number;
    recname: string;
    refname: string;
    packageroot: string;
    qualifypath: string;
    appclassmethod: string;
  }

  const hits: Hit[] = [];
  const defsWithHit = new Set<number>();

  for (const def of appClassDefs) {
    def.names.forEach((row, rowIndex) => {
      if (row.recname.trim() === 'PACKAGE' && row.refname.trim() === '') {
        hits.push({
          definitionId: def.definitionId,
          rowIndex,
          namenum: row.namenum,
          recname: row.recname.trim(),
          refname: row.refname.trim(),
          packageroot: row.packageroot.trim(),
          qualifypath: row.qualifypath.trim(),
          appclassmethod: row.appclassmethod.trim()
        });
        defsWithHit.add(def.definitionId);
      }
    });
  }

  console.log(`\nDefinitions containing >=1 blank-REFNAME PACKAGE row: ${defsWithHit.size}`);
  console.log(`Total blank-REFNAME PACKAGE rows (all definitions): ${hits.length}`);

  const byDef = new Map<number, Hit[]>();
  for (const h of hits) {
    if (!byDef.has(h.definitionId)) byDef.set(h.definitionId, []);
    byDef.get(h.definitionId)!.push(h);
  }
  const multiRowDefs = [...byDef.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`Definitions with 2+ blank-REFNAME PACKAGE rows: ${multiRowDefs.length}`);
  const rowCountDistribution = new Map<number, number>();
  for (const rows of byDef.values()) {
    rowCountDistribution.set(rows.length, (rowCountDistribution.get(rows.length) ?? 0) + 1);
  }
  console.log('Row-count-per-definition distribution:');
  for (const [count, defs] of [...rowCountDistribution.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${count} row(s): ${defs} definition(s)`);
  }

  if (asJson) {
    console.log(JSON.stringify({ hits, multiRowDefs: multiRowDefs.map(([id, rows]) => ({ id, rows })) }, null, 2));
    return;
  }

  console.log('\n--- All field values seen for packageroot/qualifypath/appclassmethod on these rows ---');
  console.log('distinct packageroot values:', [...new Set(hits.map(h => h.packageroot))]);
  console.log('distinct qualifypath values:', [...new Set(hits.map(h => h.qualifypath))]);
  console.log('distinct appclassmethod values:', [...new Set(hits.map(h => h.appclassmethod))]);

  console.log('\n--- 15 representative rows (full field detail) ---');
  for (const h of hits.slice(0, 15)) console.log(' ', JSON.stringify(h));

  console.log('\n--- 10 representative multi-row definitions ---');
  for (const [id, rows] of multiRowDefs.slice(0, 10)) {
    console.log(`  ${id}: ${rows.length} rows at namenum=[${rows.map(r => r.namenum).join(',')}]`);
  }
}

main();
