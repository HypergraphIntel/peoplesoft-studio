/*
 * Cycle 62 Phase 9/11/17: testing a hypothesis discovered while
 * reconstructing 29144/29202 fresh: when a method-dependency (methodName-
 * qualified) PACKAGE reference is about to be allocated for an
 * Application-Class method call (`addApplicationClassReference(...,
 * methodName)`, encoder.ts's `isMethodCall` branch), does stored PeopleTools
 * instead REUSE an already-existing TYPE-ONLY (non-method) PACKAGE row for
 * the SAME leaf (established anywhere else in the class -- import,
 * property, instance, earlier occurrence), rather than allocating a
 * separate, method-qualified row?
 *
 * For every GENERATED method-dependency reference (kind='package',
 * methodName set), look up stored PSPCMNAME rows sharing the same
 * (PACKAGEROOT, REFNAME) leaf:
 *   - typeOnlyRows: rows with blank APPCLASSMETHOD
 *   - matchingMethodRows: rows with APPCLASSMETHOD === this reference's
 *     method name
 *
 * If typeOnlyRows >= 1 AND matchingMethodRows === 0: stored likely reused
 * the type-only row instead of allocating a fresh method-qualified one --
 * supports the reuse hypothesis.
 *
 * If matchingMethodRows >= 1: stored DOES have its own separate
 * method-qualified row -- the current encoder behavior is correct for this
 * case (negative control).
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle62-method-dependency-typeonly-reuse-census.ts
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

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  let candidateCount = 0;
  let reuseHypothesisSupported = 0; // typeOnlyRows>=1 && matchingMethodRows===0
  let storedHasOwnMethodRow = 0; // matchingMethodRows>=1 (negative control: current behavior correct)
  let neitherRowExists = 0; // typeOnlyRows===0 && matchingMethodRows===0 (leaf missing entirely -- different, unrelated gap)
  let encodeErrors = 0;

  const supportingExamples: any[] = [];
  const negativeControlExamples: any[] = [];
  const neitherExamples: any[] = [];

  for (const def of appClassDefs) {
    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    const methodDependencyRefs = artifacts.references.filter(
      (r: any) => r.kind === 'package' && r.methodName !== undefined
    );

    for (const ref of methodDependencyRefs as any[]) {
      const leaf = (ref.className ?? ref.packageName ?? '').toUpperCase();
      const root = (ref.packagePath?.[0] ?? ref.objectName ?? '').toUpperCase();
      if (leaf === '') continue;

      const matchingLeafRows = def.names.filter((r: any) =>
        r.recname.trim() === 'PACKAGE' &&
        r.refname.trim().toUpperCase() === leaf &&
        r.packageroot.trim().toUpperCase() === root
      );
      const typeOnlyRows = matchingLeafRows.filter((r: any) => r.appclassmethod.trim() === '');
      const matchingMethodRows = matchingLeafRows.filter((r: any) => r.appclassmethod.trim().toUpperCase() === ref.methodName);

      candidateCount++;

      const example = {
        definitionId: def.definitionId,
        leaf,
        root,
        method: ref.methodName,
        typeOnlyRowCount: typeOnlyRows.length,
        matchingMethodRowCount: matchingMethodRows.length,
        totalLeafRowCount: matchingLeafRows.length
      };

      if (matchingMethodRows.length >= 1) {
        storedHasOwnMethodRow++;
        if (negativeControlExamples.length < 10) negativeControlExamples.push(example);
      } else if (typeOnlyRows.length >= 1) {
        reuseHypothesisSupported++;
        if (supportingExamples.length < 15) supportingExamples.push(example);
      } else {
        neitherRowExists++;
        if (neitherExamples.length < 10) neitherExamples.push(example);
      }
    }
  }
  db.close();

  console.log(`Candidates (generated method-dependency references): ${candidateCount}`);
  console.log(`Encode errors: ${encodeErrors}`);
  console.log(`\nReuse hypothesis supported (stored has type-only row, NO separate method row): ${reuseHypothesisSupported}`);
  console.log(`Stored HAS its own separate method-qualified row (negative control -- current behavior correct): ${storedHasOwnMethodRow}`);
  console.log(`Neither row exists in stored (leaf missing entirely -- unrelated gap): ${neitherRowExists}`);

  console.log('\n--- reuse-hypothesis-supported examples ---');
  for (const e of supportingExamples) console.log('  ', JSON.stringify(e));

  console.log('\n--- negative-control examples (stored has own method row) ---');
  for (const e of negativeControlExamples) console.log('  ', JSON.stringify(e));

  console.log('\n--- neither-row examples ---');
  for (const e of neitherExamples) console.log('  ', JSON.stringify(e));
}

main();
