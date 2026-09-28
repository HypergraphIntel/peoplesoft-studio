/*
 * Cycle 63 Phase 6/7/8/9 (mandatory): corpus-wide census of bare `.Name`
 * postfix member access on a Record-typed receiver (the ONLY receiver
 * shape that currently sets `expectedReferenceMember`/`dependencyKind ===
 * 'field'` for a plain, non-`create` Local/parameter -- see
 * `encoder.ts`'s `recordVariables`/`recordArrayIndexedFieldAccess`/
 * `explicitRecordRootName`/`bareGetRecordCallResult` arms).
 *
 * For every GENERATED 'field'-kind reference with fieldName === 'NAME',
 * check whether stored PSPCMNAME has a matching FIELD row at all (i.e.
 * whether stored treats `.Name` as a genuine symbolic field reference) --
 * this is Phase 9's critical negative control: does the corpus contain
 * ANY genuine field literally named NAME accessed this way, which the
 * encoder must not incorrectly suppress?
 *
 * Read-only, no encoder changes. Scans the FULL local snapshot (not just
 * Application Class definitions), since `.Name` on a Record-typed
 * variable is not an Application-Class-specific construct.
 *
 * Usage: npx tsx tools/corpus/research/cycle63-name-intrinsic-census.ts
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

  let candidateCount = 0;
  let storedHasNoFieldNameRow = 0; // supports "always intrinsic"
  let storedHasFieldNameRow = 0; // genuine negative control -- real field named NAME
  let encodeErrors = 0;

  const supportingExamples: any[] = [];
  const negativeControlExamples: any[] = [];

  for (const def of defs) {
    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    const nameFieldRefs = artifacts.references.filter(
      (r: any) => r.kind === 'field' && (r.fieldName ?? '').toUpperCase() === 'NAME'
    );
    if (nameFieldRefs.length === 0) continue;

    candidateCount++;

    // Stored: does ANY row have RECNAME blank/anything with REFNAME='NAME'
    // in a FIELD-shaped position? Field-kind references render with a
    // blank RECNAME and REFNAME = field name (per the validator's own
    // (recname && refname ? recname.refname : refname||recname) rule --
    // a bare field reference has recname='', so the visible identity is
    // just the field name).
    const storedNameFieldRows = def.names.filter((r: any) =>
      r.recname.trim() === '' && r.refname.trim().toUpperCase() === 'NAME'
    );

    const example = {
      definitionId: def.definitionId,
      generatedNameFieldRefCount: nameFieldRefs.length,
      storedNameFieldRowCount: storedNameFieldRows.length
    };

    if (storedNameFieldRows.length === 0) {
      storedHasNoFieldNameRow++;
      if (supportingExamples.length < 15) supportingExamples.push(example);
    } else {
      storedHasFieldNameRow++;
      if (negativeControlExamples.length < 15) negativeControlExamples.push(example);
    }
  }
  db.close();

  console.log(`Candidates (definitions with a generated field|NAME reference): ${candidateCount}`);
  console.log(`Encode errors: ${encodeErrors}`);
  console.log(`\nStored has NO matching field|NAME row (supports "always intrinsic" -- generated wrongly allocates a reference): ${storedHasNoFieldNameRow}`);
  console.log(`Stored HAS a matching field|NAME row (genuine negative control -- real field named NAME, current behavior correct): ${storedHasFieldNameRow}`);

  console.log('\n--- supporting examples (stored has no field|NAME row) ---');
  for (const e of supportingExamples) console.log('  ', JSON.stringify(e));

  console.log('\n--- negative-control examples (stored HAS a field|NAME row) ---');
  for (const e of negativeControlExamples) console.log('  ', JSON.stringify(e));
}

main();
