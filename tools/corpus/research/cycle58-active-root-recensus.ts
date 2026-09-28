/*
 * Cycle 58 Phase 1/2/3: fresh re-census of the Cycle 48 20-root
 * "genuinely active reference-identity/allocation mismatch" population,
 * against the current encoder (post Cycles 52/55/56/57).
 *
 * For each root, compares the STORED PSPCMNAME identity sequence (the
 * same (RECNAME, REFNAME) text the validator's own decoder uses, per
 * Cycle 54's finding) against the GENERATED reference identity sequence,
 * to determine "reference-stream exact" independent of downstream
 * byte-level differences (markers, statement encoding, decoder
 * limitations). Also reports sourceEncodeExact (full forward-encode byte
 * match) and the causal tag of the first byte divergence.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle58-active-root-recensus.ts [id ...]
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const DEFAULT_IDS = [
  28713, 28752, 28755, 28801, 28802, 28862, 28904, 28925, 28964, 28972,
  28975, 29044, 29099, 29144, 29202, 29389, 29518, 29542, 29614, 30104
];

function ownerContext(snapshot: any) {
  const values = [snapshot.objectvalue1, snapshot.objectvalue2, snapshot.objectvalue3, snapshot.objectvalue4, snapshot.objectvalue5, snapshot.objectvalue6, snapshot.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function storedIdentity(row: any): string {
  const recname = row.recname.trim();
  const refname = row.refname.trim();
  if (recname && refname) return `${recname}.${refname}`;
  return refname || recname;
}

function generatedIdentity(ref: any): string {
  if (ref.kind === 'owner') return '.';
  if (ref.kind === 'package') {
    const name = (ref.className || ref.packageName || '').toUpperCase();
    return name ? `PACKAGE.${name}` : 'PACKAGE';
  }
  if (ref.kind === 'record') return `RECORD.${ref.recordName?.toUpperCase() ?? ''}`;
  if (ref.kind === 'field') return `FIELD.${ref.fieldName?.toUpperCase() ?? ''}`;
  if (ref.kind === 'record-field') return `${ref.recordName?.toUpperCase() ?? ''}.${ref.fieldName?.toUpperCase() ?? ''}`;
  if (ref.kind === 'scroll') return `SCROLL.${ref.recordName?.toUpperCase() ?? ''}`;
  if (ref.kind === 'declare-function') return `${ref.recordName?.toUpperCase() ?? ''}.${ref.fieldName?.toUpperCase() ?? ''}`;
  return JSON.stringify(ref);
}

function main(): void {
  const argIds = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const ids = argIds.length > 0 ? argIds : DEFAULT_IDS;
  const db = openSnapshotDatabase();

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(snap.sourceText, { owner: ownerContext(snap) });
    } catch (error) {
      console.log(`${id}\tENCODE_ERROR\t${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const storedSeq = snap.names.slice(1).map(storedIdentity); // skip owner
    const generatedSeq = artifacts.references.slice(1).map(generatedIdentity); // skip owner

    let firstDiffIndex = -1;
    const minLen = Math.min(storedSeq.length, generatedSeq.length);
    for (let i = 0; i < minLen; i++) {
      if (storedSeq[i] !== generatedSeq[i]) { firstDiffIndex = i; break; }
    }
    const referenceStreamExact = firstDiffIndex === -1 && storedSeq.length === generatedSeq.length;

    const sourceEncodeExact = artifacts.program.equals(snap.storedProgram);

    console.log(`\n=== ${id} ===`);
    console.log(`  sourceEncodeExact: ${sourceEncodeExact}`);
    console.log(`  referenceStreamExact: ${referenceStreamExact}`);
    console.log(`  stored identity count: ${storedSeq.length}, generated identity count: ${generatedSeq.length}`);
    if (!referenceStreamExact) {
      console.log(`  first identity divergence at index ${firstDiffIndex < 0 ? minLen : firstDiffIndex}:`);
      console.log(`    stored:    ${storedSeq.slice(Math.max(0, (firstDiffIndex < 0 ? minLen : firstDiffIndex) - 2), (firstDiffIndex < 0 ? minLen : firstDiffIndex) + 4).join(' | ')}`);
      console.log(`    generated: ${generatedSeq.slice(Math.max(0, (firstDiffIndex < 0 ? minLen : firstDiffIndex) - 2), (firstDiffIndex < 0 ? minLen : firstDiffIndex) + 4).join(' | ')}`);
    }
  }
  db.close();
}

main();
