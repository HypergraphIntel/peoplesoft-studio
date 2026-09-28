/*
 * Cycle 55: full 30,209-definition byte-identical-encode scan, independent
 * of the harness's richer EXACT classification (which also requires a
 * successful decode-roundtrip). Run once before the fix (via `git stash`)
 * and once after, diff the two JSON outputs, to measure the fix's true
 * population-wide blast radius the same way Cycle 52 validated its own
 * declaration-dependency-prepass change.
 *
 * Usage: npx tsx tools/corpus/research/cycle55-full-corpus-byte-scan.ts > /tmp/scan-after.json
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

function ownerContext(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function main(): void {
  const db = openSnapshotDatabase();
  const defs = listSnapshotDefinitions(db);
  const result: Record<number, boolean> = {};

  for (const def of defs) {
    let byteIdentical = false;
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      byteIdentical = artifacts.program.equals(def.storedProgram);
    } catch {
      byteIdentical = false;
    }
    result[def.definitionId] = byteIdentical;
  }
  db.close();

  console.log(JSON.stringify(result));
}

main();
