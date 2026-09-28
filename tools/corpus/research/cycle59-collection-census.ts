/*
 * Cycle 59 Phase 7: corpus-wide census of the Application-Class leaf
 * "Collection" -- using ROBUST reference matching (className ?? packageName,
 * matching encoder.ts's own `applicationClassReferenceKey` logic) rather
 * than the naive className-only filter that produced Cycle 58's false
 * "never allocated" signal.
 *
 * For every Application Class definition whose source contains a
 * qualified "X:Collection" type reference, report whether stored
 * PSPCMNAME has a PACKAGE.COLLECTION row (type-dependency shaped,
 * appclassmethod blank) and whether the CURRENT encoder's generated
 * references contain a matching one (by the same className-or-packageName
 * identity the encoder itself uses for cross-fragment dedup).
 *
 * Read-only, no encoder changes.
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const APPLICATION_CLASS_OBJECT_ID = 104;

function ownerContext(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function packageIdentity(ref: any): string {
  return ((ref.className ?? ref.packageName ?? '') as string).toLowerCase();
}

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  let candidateCount = 0;
  let storedHasRow = 0;
  let storedMissingRow = 0;
  let generatedHasRow = 0;
  let generatedMissingRow = 0;
  let bothPresent = 0;
  let onlyStoredPresent = 0;
  let onlyGeneratedPresent = 0;
  let neitherPresent = 0;
  const mismatches: any[] = [];
  let encodeErrors = 0;

  for (const def of appClassDefs) {
    const hasQualifiedCollection = /[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*:Collection\b/i.test(def.sourceText);
    if (!hasQualifiedCollection) continue;
    candidateCount++;

    const storedRow = def.names.find(r =>
      r.recname.trim() === 'PACKAGE' && r.refname.trim().toUpperCase() === 'COLLECTION' && r.appclassmethod.trim() === ''
    );
    const storedPresent = storedRow !== undefined;

    let generatedPresent = false;
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      generatedPresent = artifacts.references.some((r: any) =>
        r.kind === 'package' && packageIdentity(r) === 'collection' && r.methodName === undefined
      );
    } catch {
      encodeErrors++;
      continue;
    }

    if (storedPresent) storedHasRow++; else storedMissingRow++;
    if (generatedPresent) generatedHasRow++; else generatedMissingRow++;

    if (storedPresent && generatedPresent) bothPresent++;
    else if (storedPresent && !generatedPresent) { onlyStoredPresent++; mismatches.push({ definitionId: def.definitionId, issue: 'stored has row, generated does not' }); }
    else if (!storedPresent && generatedPresent) { onlyGeneratedPresent++; mismatches.push({ definitionId: def.definitionId, issue: 'generated has row, stored does not' }); }
    else neitherPresent++;
  }
  db.close();

  console.log(`Application Class definitions with a qualified "X:Collection" type reference: ${candidateCount}`);
  console.log(`Encode errors (skipped): ${encodeErrors}`);
  console.log(`Stored has PACKAGE.COLLECTION row: ${storedHasRow}`);
  console.log(`Stored missing PACKAGE.COLLECTION row: ${storedMissingRow}`);
  console.log(`Generated has PACKAGE.COLLECTION row: ${generatedHasRow}`);
  console.log(`Generated missing PACKAGE.COLLECTION row: ${generatedMissingRow}`);
  console.log(`\nBoth present (correct): ${bothPresent}`);
  console.log(`Only stored present (generated missing -- TRUE BUG): ${onlyStoredPresent}`);
  console.log(`Only generated present (generated over-allocates): ${onlyGeneratedPresent}`);
  console.log(`Neither present (Collection type declared but never needs a row -- e.g. metadata-only, no declaration-phase trigger): ${neitherPresent}`);
  console.log('\nmismatches:');
  for (const m of mismatches) console.log('  ', JSON.stringify(m));
}

main();
