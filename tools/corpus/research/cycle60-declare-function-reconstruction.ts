/*
 * Cycle 60 Phase 1/2/3: reconstruct fresh the 5 declare-function
 * misrecognition targets (28755, 28964, 29099, 29518, 30196).
 *
 * For each: locate the generated 'declare-function' kind references, find
 * the corresponding source text (recordName.fieldName / eventName), and
 * show the surrounding source context to determine the exact construct.
 *
 * Read-only, no encoder changes.
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const TARGETS = [28755, 28964, 29099, 29518, 30196];

function ownerContext(snapshot: any) {
  const values = [snapshot.objectvalue1, snapshot.objectvalue2, snapshot.objectvalue3, snapshot.objectvalue4, snapshot.objectvalue5, snapshot.objectvalue6, snapshot.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

const db = openSnapshotDatabase();
for (const id of TARGETS) {
  const snap = getSnapshotDefinition(db, id);
  console.log(`\n================ ${id} ================`);

  let artifacts;
  try {
    artifacts = encodeProgramArtifacts(snap.sourceText, { owner: ownerContext(snap) });
  } catch (error) {
    console.log('ENCODE ERROR:', error instanceof Error ? error.message : String(error));
    continue;
  }

  const declareFnRefs = artifacts.references.filter((r: any) => r.kind === 'declare-function');
  console.log(`declare-function references found: ${declareFnRefs.length}`);
  for (const r of declareFnRefs.slice(0, 5) as any[]) {
    console.log('  ref:', JSON.stringify(r));
    const needle = `${r.recordName}.${r.fieldName}`;
    const idx = snap.sourceText.indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(snap.sourceText.length, idx + 100);
      console.log('  source context:', JSON.stringify(snap.sourceText.slice(start, end)));
    } else {
      // Try case-insensitive / partial match
      const re = new RegExp(r.recordName + '\\s*\\.\\s*' + r.fieldName, 'i');
      const m = re.exec(snap.sourceText);
      if (m) {
        const start = Math.max(0, m.index - 80);
        const end = Math.min(snap.sourceText.length, m.index + 100);
        console.log('  source context (case-insens):', JSON.stringify(snap.sourceText.slice(start, end)));
      } else {
        console.log('  (could not locate literal source text for this reference)');
      }
    }
  }

  // Also show what stored expects at the same position (RECORD.FIELD row).
  console.log('\n  stored rows around the divergence (first 20):');
  for (const row of snap.names.slice(0, 20)) {
    console.log(`    ${row.namenum}: ${row.recname.trim()}.${row.refname.trim()}`);
  }
}
db.close();
