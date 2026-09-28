/*
 * Cycle 68 Phase 16/17/18/19 (mandatory census): reconstructing 29389's
 * post-Cycle-67 first divergence found `ordinaryRecordFieldReference()`
 * (the bare, explicit `RECORD.FIELD` symbolic-reference allocator, kind
 * 'record-field' -- distinct from `Record.X`/`Field.X`/`Scroll.X`'s own
 * explicit syntax and from bare-member access) keys its reuse pool
 * (`ordinaryRecordFieldsByControlGroup`) by RAW `controlGroup` --
 * unlike `recordScopeId()`/`fieldScopeId()` (Cycle 43/46's own
 * already-proven method-wide override for `dependencyScope`/
 * `fieldDependencyScope`), which this allocator never consults at all.
 * `29389`'s own `GetRowset(Scroll.GPS_POST).Sort(GPS_POST.SETID, "A",
 * GPS_POST.YEAR, "A", ...)` call appears TWICE in one method
 * (`runAction`), each time NESTED inside a DIFFERENT top-level `If` block
 * (controlDepth 2 and 1 respectively, never 0) -- stored reuses the SAME
 * 8 identities both times; generated currently allocates a fresh set the
 * second time, because the two occurrences fall in different raw control
 * groups (3 and 7) and the reuse-pool key includes that raw group number.
 *
 * This census finds every (definition, recordName, fieldName) triple
 * referenced via this bare `RECORD.FIELD` syntax 2+ times, ACROSS
 * DIFFERENT raw control groups (the exact shape the current key would
 * miss), within one Application Class method, and compares stored vs
 * generated identity counts.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle68-record-field-classwide-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const APPLICATION_CLASS_OBJECT_ID = 104;

// Keywords that have their OWN explicit-syntax code path (Record.X,
// Field.X, Scroll.X, Component.X, HTML.X, quoted-reference qualifiers) --
// a bare "KEYWORD.identifier" match must be excluded, it is not an
// `ordinaryRecordFieldReference()` occurrence.
const EXCLUDED_ROOTS = new Set([
  'record', 'field', 'scroll', 'component', 'html', 'page', 'menuname',
  'barname', 'itemname', 'panelgroupname', 'panelname', 'businessprocess',
  'busactivity', 'busevent', 'operation', 'messagename', 'submenuname'
]);

function ownerContext(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  // Bare RECORD.FIELD shape: two ALL-CAPS (PeopleSoft naming convention)
  // identifiers joined by a dot, not preceded by a `.` (so it is a
  // PRIMARY expression start, not a further postfix step), not preceded
  // by `Local `/`As ` (a type declaration), and not one of the excluded
  // keyword roots.
  const bareRecordFieldRegex = /(?<![.\w])([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/g;

  let candidates = 0;
  let matched = 0;
  let mismatched = 0;
  let contradictions = 0;
  const mismatchExamples: any[] = [];
  const contradictionExamples: any[] = [];

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    // Per-method: does the SAME (record, field) pair appear 2+ times in
    // DIFFERENT raw source positions that plausibly land in different
    // control groups? Approximate "different control group" as "not on
    // the exact same source line run" -- crude but sufficient as a
    // pre-filter; the actual stored/generated comparison below is exact.
    for (const impl of parsed.implementations as any[]) {
      const matches = [...impl.body.matchAll(bareRecordFieldRegex)]
        .filter(m => !EXCLUDED_ROOTS.has(m[1].toLowerCase()));
      const byPair = new Map<string, number>();
      for (const m of matches) {
        const key = `${m[1].toLowerCase()}:${m[2].toLowerCase()}`;
        byPair.set(key, (byPair.get(key) ?? 0) + 1);
      }
      const repeated = [...byPair.entries()].filter(([, count]) => count >= 2);
      if (repeated.length === 0) continue;

      let artifacts;
      try {
        artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      } catch {
        continue;
      }

      for (const [pairKey] of repeated) {
        const [recordName, fieldName] = pairKey.split(':');
        const storedCount = def.names.filter((r: any) =>
          r.recname.trim().toLowerCase() === recordName && r.refname.trim().toLowerCase() === fieldName
        ).length;
        const generatedCount = artifacts.references.filter((r: any) =>
          r.kind === 'record-field' &&
          (r.recordName ?? '').toLowerCase() === recordName &&
          (r.fieldName ?? '').toLowerCase() === fieldName
        ).length;
        if (storedCount === 0 && generatedCount === 0) continue;

        candidates++;
        const example = { definitionId: def.definitionId, method: impl.name, recordName: recordName.toUpperCase(), fieldName: fieldName.toUpperCase(), storedCount, generatedCount };
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

  console.log(`Candidates (definition, method, record.field) with 2+ occurrences in one method: ${candidates}`);
  console.log(`Matched (stored === generated): ${matched}`);
  console.log(`Mismatched (generated > stored, supports class/method-wide reuse): ${mismatched}`);
  console.log(`Contradictions (generated < stored): ${contradictions}`);

  console.log('\n--- mismatch examples ---');
  for (const e of mismatchExamples.slice(0, 40)) console.log('  ', JSON.stringify(e));

  console.log('\n--- contradiction examples ---');
  for (const e of contradictionExamples.slice(0, 40)) console.log('  ', JSON.stringify(e));
}

main();
