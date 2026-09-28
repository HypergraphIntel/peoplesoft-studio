/*
 * Cycle 70 Part A/B/C/G: reconstructing the 8-candidate residual left by
 * Cycle 69's own `cycle69-getfield-argument-reuse-census.ts` found only 2
 * definitions (29445, 29457) -- both involving a DIRECT
 * `.GetRecord(Record.X).GetField(Field.Y)` chain (the
 * `fieldMemberFromGetRecord && expectedReferenceMember === 'field'` case
 * that sets `reuseFieldReferenceWithinControlGroup`), with the SAME field
 * reused via that chain shape across TWO OR MORE DIFFERENT METHODS of the
 * same Application Class.
 *
 * `fieldReference()`'s `reuseFieldReferenceWithinControlGroup` branch only
 * consults `fieldDependencyScope.lookupField()` (method-wide, via
 * `fieldScopeId()`) -- unlike its sibling branch (the one Cycle 69 fixed),
 * it never falls back to the class-wide `applicationClassTypeReferenceSession`
 * facade, so cross-method reuse for this specific chain shape never
 * happens. `--trace-refs` on 29445 confirms: `RECIPIENT_ID` gets ONE
 * correctly-deduped identity within `AddRecipientInfo`, and a SEPARATE
 * fresh identity within `SetRecipientID` -- stored has exactly ONE row
 * total, shared by both methods.
 *
 * This census finds every (definition, field name) pair reached via this
 * exact DIRECT chain shape in 2+ different methods, and compares stored
 * vs. generated identity counts for that field across the WHOLE
 * definition.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle70-getfield-chain-classwide-census.ts
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

  // Direct .GetRecord(Record.X).GetField(Field.Y) chain (possibly with a
  // receiver before .GetRecord, e.g. `&row.GetRecord(...).GetField(...)`
  // or a bare `GetRecord(...).GetField(...)`).
  const directChainRegex = /GetRecord\s*\(\s*Record\.[A-Z][A-Z0-9_]*\s*\)\s*\.GetField\s*\(\s*Field\.([A-Z][A-Z0-9_]*)\s*\)/gi;

  let candidates = 0;
  let matched = 0;
  let mismatched = 0;
  let contradictions = 0;
  const mismatchExamples: any[] = [];

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    const methodsByField = new Map<string, Set<string>>();
    for (const impl of parsed.implementations as any[]) {
      const names = new Set([...impl.body.matchAll(directChainRegex)].map((m: any) => m[1].toLowerCase()));
      for (const name of names) {
        if (!methodsByField.has(name)) methodsByField.set(name, new Set());
        methodsByField.get(name)!.add(impl.name);
      }
    }
    const crossMethodFields = [...methodsByField.entries()].filter(([, methods]) => methods.size >= 2);
    if (crossMethodFields.length === 0) continue;

    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      continue;
    }

    for (const [fieldName, methods] of crossMethodFields) {
      const storedCount = def.names.filter((r: any) =>
        r.recname.trim().toLowerCase() === 'field' && r.refname.trim().toLowerCase() === fieldName
      ).length;
      const generatedCount = artifacts.references.filter((r: any) =>
        r.kind === 'field' && (r.fieldName ?? '').toLowerCase() === fieldName
      ).length;
      if (storedCount === 0 && generatedCount === 0) continue;

      candidates++;
      const example = { definitionId: def.definitionId, fieldName: fieldName.toUpperCase(), methodCount: methods.size, storedCount, generatedCount };
      if (storedCount === generatedCount) {
        matched++;
      } else if (generatedCount > storedCount) {
        mismatched++;
        mismatchExamples.push(example);
      } else {
        contradictions++;
        mismatchExamples.push({ ...example, contradiction: true });
      }
    }
  }
  db.close();

  console.log(`Candidates (definition, field) via direct .GetRecord(...).GetField(...) chain, 2+ methods: ${candidates}`);
  console.log(`Matched (stored === generated): ${matched}`);
  console.log(`Mismatched (generated > stored, supports class-wide reuse): ${mismatched}`);
  console.log(`Contradictions (generated < stored): ${contradictions}`);
  console.log('\n--- examples ---');
  for (const e of mismatchExamples.slice(0, 40)) console.log('  ', JSON.stringify(e));
}

main();
