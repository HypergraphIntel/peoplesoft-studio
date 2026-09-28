/*
 * Cycle 59 Phase 1/2/3: reconstruct fresh the 7-definition "Collection"
 * never-allocated cluster surfaced by Cycle 58's cross-population overlap
 * analysis (29886, 29890, 29891, 29885, 30194, 30196, 30209).
 *
 * For each: full source context around the Collection occurrence, stored
 * PSPCMNAME rows matching "COLLECTION", generated references, and
 * executable operand usage.
 *
 * Read-only, no encoder changes.
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const TARGETS = [29886, 29890, 29891, 29885, 30194, 30196, 30209];

function ownerContext(snapshot: any) {
  const values = [snapshot.objectvalue1, snapshot.objectvalue2, snapshot.objectvalue3, snapshot.objectvalue4, snapshot.objectvalue5, snapshot.objectvalue6, snapshot.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

const db = openSnapshotDatabase();
for (const id of TARGETS) {
  const snap = getSnapshotDefinition(db, id);
  const parsed = parseApplicationClassSource(snap.sourceText);
  console.log(`\n================ ${id} ================`);
  console.log('className:', parsed?.className, 'extends:', parsed?.extendsType);

  // Find all fully-qualified occurrences ending in ":Collection" or bare "Collection".
  const qualified = [...snap.sourceText.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*:Collection\b/gi)];
  const bareCollection = [...snap.sourceText.matchAll(/\bCollection\b/gi)];
  console.log('qualified "X:Collection" occurrences:', [...new Set(qualified.map(m => m[0]))]);
  console.log('bare "Collection" occurrence count:', bareCollection.length);
  console.log('context around each bare occurrence:');
  for (const m of bareCollection.slice(0, 10)) {
    const start = Math.max(0, m.index! - 60);
    console.log('  ...' + snap.sourceText.slice(start, m.index! + 60).replace(/\n/g, '\\n') + '...');
  }

  console.log('\nstored rows matching COLLECTION:');
  for (const r of snap.names) {
    if (r.refname.trim().toUpperCase() === 'COLLECTION') {
      console.log(`  namenum=${r.namenum} recname=${JSON.stringify(r.recname.trim())} refname=${JSON.stringify(r.refname.trim())} appclassmethod=${JSON.stringify(r.appclassmethod.trim())}`);
    }
  }

  let artifacts;
  try {
    artifacts = encodeProgramArtifacts(snap.sourceText, { owner: ownerContext(snap) });
    console.log('\ngenerated refs matching COLLECTION:');
    for (const r of artifacts.references as any[]) {
      if (r.className?.toUpperCase() === 'COLLECTION' || r.packageName?.toUpperCase() === 'COLLECTION') {
        console.log('  ', JSON.stringify(r));
      }
    }
    if (!artifacts.references.some((r: any) => r.className?.toUpperCase() === 'COLLECTION' || r.packageName?.toUpperCase() === 'COLLECTION')) {
      console.log('  (none -- Collection never appears in generated references at all)');
    }
  } catch (error) {
    console.log('ENCODE ERROR:', error instanceof Error ? error.message : String(error));
  }

  // Operand usage of stored COLLECTION rows.
  const names = new NameTable();
  for (const row of snap.names) {
    const name = row.recname.trim() && row.refname.trim() ? `${row.recname.trim()}.${row.refname.trim()}` : (row.refname.trim() || row.recname.trim());
    names.add(row.namenum, name);
  }
  try {
    const decoded = decodeProgram(snap.storedProgram, names, { mode: 'auto' });
    const collectionRows = snap.names.filter(r => r.refname.trim().toUpperCase() === 'COLLECTION');
    for (const r of collectionRows) {
      const used = decoded.tokens.filter((t: any) => t.nameNum === r.namenum);
      console.log(`  operand usage of namenum=${r.namenum}: ${used.length}`);
    }
  } catch (error) {
    console.log('decode failed:', error instanceof Error ? error.message : String(error));
  }
}
db.close();
