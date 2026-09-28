/*
 * Cycle 72 Phase 19-23 (mandatory census): Cycle 71 fixed
 * `dependencyScope.lookupRecord`/`lookupScroll`'s single gated read sites
 * (triggered by `.GetRecord(...)`/`.Select(...)`/`GetSetId(...)`/
 * `.GetRowset(...)`) to consult the class-wide `applicationClassTypeReferenceSession`
 * facade. The remaining 27 RECORD/SCROLL mismatches this left behind
 * mostly MIX these already-fixed "RECORD-aware" occurrences with
 * "generic" occurrences (Record.X/Scroll.X passed as a plain argument to
 * something OTHER than CreateRecord/GetRecord/CreateRowset/GetRowset/
 * Select/GetSetId, e.g. `%This.SomeMethod(Record.X)`) that never read OR
 * write any reuse pool at all today, always allocating fresh -- this
 * mirrors Cycle 66's OWN proven "Field.X is an ordinary symbolic constant
 * for every non-GetField consumer" rule, but for RECORD/SCROLL, never
 * separately tested.
 *
 * This census finds every (definition, record/scroll name) pair reached
 * via a GENERIC (non-RECORD-aware-consumer, non-CreateRecord/CreateRowset)
 * argument position 2+ times, and compares stored vs. generated identity
 * counts for that name across the whole definition -- deliberately
 * EXCLUDING CreateRecord/CreateRowset (Cycle 43's own known, separately
 * mixed/occurrence-based population) from the "generic" bucket, per this
 * cycle's own explicit caution against assuming they share the same rule.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle72-generic-record-argument-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const APPLICATION_CLASS_OBJECT_ID = 104;
const RECORD_AWARE_CONSUMERS = /^(?:GetRecord|GetRowset|Select|GetSetId|CreateRecord|CreateRowset)$/i;

function ownerContext(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  for (const [label, primaryWord, kind] of [
    ['RECORD', 'Record', 'record'],
    ['SCROLL', 'Scroll', 'scroll']
  ] as const) {
    // A bare Record.X / Scroll.X NOT immediately preceded by one of the
    // RECORD-aware consumer names' own opening paren.
    const genericRegex = new RegExp(`(\\w+)?\\s*\\(?\\s*${primaryWord}\\.([A-Z][A-Z0-9_]*)\\b`, 'gi');

    let candidates = 0;
    let matched = 0;
    let mismatched = 0;
    let contradictions = 0;
    const mismatchExamples: any[] = [];

    for (const def of appClassDefs) {
      const parsed = parseApplicationClassSource(def.sourceText);
      if (parsed === undefined) continue;

      const genericCountByName = new Map<string, number>();
      for (const impl of parsed.implementations as any[]) {
        for (const m of impl.body.matchAll(genericRegex)) {
          const enclosingFn = m[1];
          const name = m[2].toLowerCase();
          const isRecordAware = enclosingFn !== undefined && RECORD_AWARE_CONSUMERS.test(enclosingFn) &&
            impl.body.slice(m.index! + m[0].length - (m[2].length + primaryWord.length + 1) - enclosingFn.length, m.index! + m[0].length).includes('(');
          // Simpler, robust re-check: was this Name.X immediately preceded by "<consumer>("?
          const before = impl.body.slice(Math.max(0, m.index! - 40), m.index!);
          const consumerMatch = /(\w+)\s*\(\s*$/.exec(before);
          const reallyRecordAware = consumerMatch !== undefined && consumerMatch !== null && RECORD_AWARE_CONSUMERS.test(consumerMatch[1]);
          if (reallyRecordAware) continue;
          genericCountByName.set(name, (genericCountByName.get(name) ?? 0) + 1);
        }
      }
      const repeated = [...genericCountByName.entries()].filter(([, count]) => count >= 2);
      if (repeated.length === 0) continue;

      let artifacts;
      try {
        artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      } catch {
        continue;
      }

      for (const [name] of repeated) {
        const storedCount = def.names.filter((r: any) =>
          r.recname.trim().toLowerCase() === kind && r.refname.trim().toLowerCase() === name
        ).length;
        const generatedCount = artifacts.references.filter((r: any) =>
          r.kind === kind && (r.recordName ?? '').toLowerCase() === name
        ).length;
        if (storedCount === 0 && generatedCount === 0) continue;

        candidates++;
        const example = { definitionId: def.definitionId, name: name.toUpperCase(), storedCount, generatedCount };
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

    console.log(`=== ${label} generic (non-RECORD-aware-consumer) argument, repeated 2+ times ===`);
    console.log(`Candidates: ${candidates}`);
    console.log(`Matched (stored === generated): ${matched}`);
    console.log(`Mismatched (generated > stored): ${mismatched}`);
    console.log(`Contradictions (generated < stored): ${contradictions}`);
    for (const e of mismatchExamples.slice(0, 30)) console.log('  ', JSON.stringify(e));
    console.log();
  }

  db.close();
}

main();
