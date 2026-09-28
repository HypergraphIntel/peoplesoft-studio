/*
 * Cycle 68 Phase 9/10/16-19 (mandatory census): the 29389 investigation
 * found `ordinaryRecordFieldReference()` (bare, explicit `RECORD.FIELD`
 * symbolic syntax, kind 'record-field') needed THREE fixes -- method-wide
 * key scoping, dropping the "top-level starts fresh" override for
 * Application Class bodies, and wiring to the class-wide
 * `applicationClassTypeReferenceSession` facade. This census checks
 * whether the SEPARATE, EXPLICIT `Record.X` / `Scroll.X` syntax (kinds
 * 'record' / 'scroll', allocated via `dependencyScope`, already
 * method-wide per Cycle 43) has the SAME residual CLASS-WIDE
 * (cross-method) gap `ordinaryRecordFieldReference()` had, or whether it
 * was already correctly wired.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle68-record-scroll-classwide-census.ts
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

  const recordRegex = /\bRecord\.([A-Z][A-Z0-9_]*)\b/gi;
  const scrollRegex = /\bScroll\.([A-Z][A-Z0-9_]*)\b/gi;

  for (const [label, regex, kind] of [
    ['RECORD', recordRegex, 'record'],
    ['SCROLL', scrollRegex, 'scroll']
  ] as const) {
    let candidates = 0;
    let matched = 0;
    let mismatched = 0;
    let contradictions = 0;
    const mismatchExamples: any[] = [];

    for (const def of appClassDefs) {
      const parsed = parseApplicationClassSource(def.sourceText);
      if (parsed === undefined) continue;

      // Which methods mention each record name?
      const methodsByRecord = new Map<string, Set<string>>();
      for (const impl of parsed.implementations as any[]) {
        const names = new Set([...impl.body.matchAll(regex)].map((m: any) => m[1].toLowerCase()));
        for (const name of names) {
          if (!methodsByRecord.has(name)) methodsByRecord.set(name, new Set());
          methodsByRecord.get(name)!.add(impl.name);
        }
      }
      const crossMethodRecords = [...methodsByRecord.entries()].filter(([, methods]) => methods.size >= 2);
      if (crossMethodRecords.length === 0) continue;

      let artifacts;
      try {
        artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      } catch {
        continue;
      }

      for (const [recordName] of crossMethodRecords) {
        const storedCount = def.names.filter((r: any) =>
          r.recname.trim().toLowerCase() === kind && r.refname.trim().toLowerCase() === recordName
        ).length;
        const generatedCount = artifacts.references.filter((r: any) =>
          r.kind === kind && (r.recordName ?? '').toLowerCase() === recordName
        ).length;
        if (storedCount === 0 && generatedCount === 0) continue;

        candidates++;
        const example = { definitionId: def.definitionId, recordName: recordName.toUpperCase(), storedCount, generatedCount };
        if (storedCount === generatedCount) {
          matched++;
        } else if (generatedCount > storedCount) {
          mismatched++;
          mismatchExamples.push(example);
        } else {
          contradictions++;
        }
      }
    }

    console.log(`=== ${label} (kind='${kind}') cross-method candidates ===`);
    console.log(`Candidates (definition, ${kind}) pairs referenced in 2+ methods: ${candidates}`);
    console.log(`Matched: ${matched}`);
    console.log(`Mismatched (generated > stored): ${mismatched}`);
    console.log(`Contradictions (generated < stored): ${contradictions}`);
    for (const e of mismatchExamples.slice(0, 15)) console.log('  ', JSON.stringify(e));
    console.log();
  }

  db.close();
}

main();
