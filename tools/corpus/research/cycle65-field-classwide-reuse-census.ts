/*
 * Cycle 65 Phase 8/9/10/11 (mandatory census): reconstructing 29099's
 * FIELD-kind divergence found `fieldDependencyScope` (Cycle 46's own
 * method-wide FIELD reuse pool, governed by `fieldScopeId()`) is scoped
 * per-fragment (i.e. per METHOD, since each Application Class method body
 * is its own `encodeFragmentInternal` call) and never consults the
 * class-wide `applicationClassTypeReferenceSession` facade (Cycle 57) --
 * the same "canonical facade exists, this consumer was never wired to
 * it" shape as Cycles 57/60/61/62/64, now for `kind: 'field'` references.
 *
 * This project's OWN `PeopleCodeReference` type for `kind: 'field'` has
 * NO `recordName` field at all -- field identity is ALREADY modeled as
 * "field name only" within one scope (Cycle 9's own established design).
 * This census tests whether that SAME name-only identity should ALSO be
 * class-wide (not just method-wide) for Application Class method bodies,
 * exactly mirroring Cycle 64's PACKAGE-kind extension.
 *
 * For every Application Class definition, find field names produced by a
 * 'field'-kind reference (via EITHER the explicit `Field.X` syntax OR a
 * Record-typed variable's bare-member access) occurring in 2+ different
 * methods, and compare stored vs generated FIELD row count for that
 * field name across the whole definition.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle65-field-classwide-reuse-census.ts
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

  // Matches BOTH `Field.X` (explicit) and `&var.X` (bare member) source
  // forms broadly -- this is a HEURISTIC pre-filter only; the actual
  // stored/generated comparison below uses the encoder's own real
  // reference list, so over-matching here only wastes a little work, it
  // never corrupts the result.
  const fieldNameRegex = /\bField\.([A-Za-z_][A-Za-z0-9_]*)\b|\.([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*Value\b/g;

  let candidateCount = 0;
  let matched = 0;
  let mismatched = 0;
  let encodeErrors = 0;
  const mismatchExamples: any[] = [];
  const directionCounts = new Map<string, number>();
  const underAllocatedExamples: any[] = [];

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    // Field names appearing (via either heuristic form) in 2+ DIFFERENT
    // method implementations.
    const methodsByFieldName = new Map<string, Set<string>>();
    for (const impl of parsed.implementations as any[]) {
      if (impl.kind !== 'method') continue;
      fieldNameRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      const seenInMethod = new Set<string>();
      while ((m = fieldNameRegex.exec(impl.body)) !== null) {
        const name = (m[1] ?? m[2])?.toLowerCase();
        if (!name) continue;
        seenInMethod.add(name);
      }
      for (const name of seenInMethod) {
        if (!methodsByFieldName.has(name)) methodsByFieldName.set(name, new Set());
        methodsByFieldName.get(name)!.add(impl.name);
      }
    }

    const multiMethodFields = [...methodsByFieldName.entries()].filter(([, methods]) => methods.size >= 2);
    if (multiMethodFields.length === 0) continue;

    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    for (const [fieldName, methods] of multiMethodFields) {
      const storedCount = def.names.filter((r: any) =>
        r.recname.trim() === 'FIELD' && r.refname.trim().toLowerCase() === fieldName
      ).length;
      const generatedCount = artifacts.references.filter((r: any) =>
        r.kind === 'field' && (r.fieldName ?? '').toLowerCase() === fieldName
      ).length;

      // Only meaningful if the field genuinely resolves to a 'field'-kind
      // reference at all (avoids counting a `.Value`/false heuristic
      // match that never became a real dependency in EITHER stream).
      if (storedCount === 0 && generatedCount === 0) continue;

      candidateCount++;
      const example = { definitionId: def.definitionId, fieldName: fieldName.toUpperCase(), methodCount: methods.size, storedCount, generatedCount };
      if (storedCount === generatedCount) {
        matched++;
      } else {
        mismatched++;
        const direction = generatedCount === 0 ? 'generated=0 (missing)' : generatedCount > storedCount ? 'generated>stored (duplicate)' : 'generated<stored (under-allocated, non-zero)';
        directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);
        if (mismatchExamples.length < 400) mismatchExamples.push(example);
        if (direction === 'generated<stored (under-allocated, non-zero)') underAllocatedExamples.push(example);
      }
    }
  }
  db.close();

  console.log(`Candidates (definition, field-name) pairs referenced in 2+ methods: ${candidateCount}`);
  console.log(`Encode errors: ${encodeErrors}`);
  console.log(`Matched (stored === generated): ${matched}`);
  console.log(`Mismatched: ${mismatched}`);
  console.log('\n--- mismatch direction breakdown ---');
  for (const [direction, count] of directionCounts) console.log(`  ${direction}: ${count}`);
  console.log('\n--- under-allocated (non-zero) examples -- potential genuine negative controls ---');
  for (const e of underAllocatedExamples) console.log('  ', JSON.stringify(e));
  console.log('\n--- mismatch examples ---');
  for (const e of mismatchExamples) console.log('  ', JSON.stringify(e));
}

main();
