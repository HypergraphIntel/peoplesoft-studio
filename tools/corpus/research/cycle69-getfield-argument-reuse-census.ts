/*
 * Cycle 69 Phase 5-22: `29389`'s new first divergence (index 33, post
 * Cycle 68) is two `SQLExec(...)` calls in `runAction`, both passing
 * `&_recDtl.GetField(Field.EFFDT).Value` and
 * `&_recDtl.GetField(Field.GPS_POST_ID).Value` as bind arguments (SAME
 * receiver local `&_recDtl`, receiver-based `.GetField(...)` calls).
 * Stored PSPCMNAME does NOT allocate fresh FIELD rows for either
 * occurrence at all -- it reuses the identities ALREADY allocated much
 * earlier in the SAME method, from an entirely different receiver-based
 * `.GetField(Field.EFFDT)`/`.GetField(Field.GPS_POST_ID)` call in a
 * different loop.
 *
 * This appears to conflict with Cycle 66's own shipped rule
 * (`fieldReferenceOccurrenceOwnedByGetField`, set for ANY receiver-based
 * `.GetField(...)` call to keep its own Field.X argument occurrence-based,
 * never reused) and its own regression test ('Application Class
 * GetField(Field.CODE) called twice remains occurrence-based'). That
 * test's SAME-receiver, SAME-field, twice-called shape was never itself
 * corpus-validated as a POSITIVE claim -- Cycle 66's own census targeted
 * only the ABSENCE of bare/receiverless GetField repeats, not whether a
 * receiver-based repeat reuses.
 *
 * This census finds every (definition, method, fieldName) triple where a
 * RECEIVER-based `.GetField(Field.X)` call (i.e. preceded by `.`, to
 * exclude bare/receiverless calls, which Cycle 66 already separately
 * confirmed have zero candidates) appears 2+ times with the SAME field
 * name in one method, and compares stored vs. generated FIELD-kind
 * identity counts for that field within the method.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle69-getfield-argument-reuse-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
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

  // Receiver-based .GetField(Field.X) -- must be preceded by `.` to
  // exclude bare/receiverless calls (Cycle 66 already confirmed zero
  // candidates exist for the receiverless shape).
  const receiverGetFieldRegex = /\.GetField\s*\(\s*Field\.([A-Z][A-Z0-9_]*)\s*\)/gi;

  let candidates = 0;
  let matched = 0;
  let mismatched = 0;
  let contradictions = 0;
  const mismatchExamples: any[] = [];
  const contradictionExamples: any[] = [];

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    for (const impl of parsed.implementations as any[]) {
      const matches = [...impl.body.matchAll(receiverGetFieldRegex)];
      const byField = new Map<string, number>();
      for (const m of matches) {
        const key = m[1].toLowerCase();
        byField.set(key, (byField.get(key) ?? 0) + 1);
      }
      const repeated = [...byField.entries()].filter(([, count]) => count >= 2);
      if (repeated.length === 0) continue;

      let artifacts;
      try {
        artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      } catch {
        continue;
      }

      for (const [fieldName] of repeated) {
        const storedCount = def.names.filter((r: any) =>
          r.recname.trim().toLowerCase() === 'field' && r.refname.trim().toLowerCase() === fieldName
        ).length;
        const generatedCount = artifacts.references.filter((r: any) =>
          r.kind === 'field' && (r.fieldName ?? '').toLowerCase() === fieldName
        ).length;
        if (storedCount === 0 && generatedCount === 0) continue;

        candidates++;
        const example = { definitionId: def.definitionId, method: impl.name, fieldName: fieldName.toUpperCase(), storedCount, generatedCount };
        if (storedCount === generatedCount) {
          matched++;
        } else if (generatedCount > storedCount) {
          mismatched++;
          mismatchExamples.push(example);
        } else {
          contradictions++;
          contradictionExamples.push(example);
        }
      }
    }
  }
  db.close();

  console.log(`Candidates (definition, method, field) with receiver-based .GetField(Field.X) 2+ times, same field: ${candidates}`);
  console.log(`Matched (stored === generated): ${matched}`);
  console.log(`Mismatched (generated > stored, supports reuse hypothesis): ${mismatched}`);
  console.log(`Contradictions (generated < stored): ${contradictions}`);

  console.log('\n--- mismatch examples ---');
  for (const e of mismatchExamples.slice(0, 40)) console.log('  ', JSON.stringify(e));

  console.log('\n--- contradiction examples ---');
  for (const e of contradictionExamples.slice(0, 40)) console.log('  ', JSON.stringify(e));
}

main();
