/*
 * Cycle 66 Phase 7/8/9/10/11/12: rebuilding Cycle 65's "Population B" fresh,
 * grouped by the ENCLOSING FUNCTION/METHOD CALL each repeated explicit
 * `Field.X` reference is an argument to, to determine whether the reuse
 * rule is a `CreateArray`-specific special case or a broader
 * generic-expression-vs-FIELD-aware-consumer distinction (Cycle 65's own
 * Phase 15/16 hypothesis).
 *
 * For every Application Class definition, find the SAME field name
 * appearing as a BARE `Field.X` argument (never `GetField(Field.X)`) 2+
 * times, and for EACH occurrence record the nearest enclosing call's
 * head identifier (the token immediately before the `(` that contains
 * this specific `Field.X`). Compare stored vs generated FIELD row count
 * for that field name across the whole definition, and report the
 * enclosing-call breakdown for mismatched (duplicate) cases.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle66-field-consumer-context-census.ts
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

/**
 * Given a source string and the character offset of a `Field.X` match's
 * start, find the identifier immediately preceding the nearest enclosing
 * unmatched `(` -- i.e. the head of the call this Field.X is an argument
 * to. Returns undefined if no enclosing paren is found (e.g. top-level
 * statement position, not inside any call).
 */
function enclosingCallName(source: string, matchStart: number): string | undefined {
  let depth = 0;
  for (let i = matchStart - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        // Found the unmatched enclosing '('. Walk back over whitespace,
        // then read the identifier (possibly dotted, e.g. &x.GetField).
        let j = i - 1;
        while (j >= 0 && /\s/.test(source[j])) j--;
        let end = j + 1;
        while (j >= 0 && /[A-Za-z0-9_]/.test(source[j])) j--;
        const name = source.slice(j + 1, end);
        return name || undefined;
      }
      depth--;
    }
  }
  return undefined;
}

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  // Bare Field.X, NOT immediately preceded by "GetField(" (a negative
  // lookbehind on the whole "GetField(Field.X" shape) -- matches Cycle
  // 65's own Population B inclusion criterion.
  const bareFieldRegex = /\bField\.([A-Za-z_][A-Za-z0-9_]*)\b/g;

  let candidates = 0;
  let matched = 0;
  let mismatched = 0;
  let encodeErrors = 0;
  const byEnclosingCall = new Map<string, { matched: number; mismatched: number }>();
  const mismatchExamples: any[] = [];
  const contradictions: any[] = [];
  const matchExamples: any[] = [];

  for (const def of appClassDefs) {
    const matches = [...def.sourceText.matchAll(bareFieldRegex)];
    const byName = new Map<string, { offset: number; enclosing: string | undefined }[]>();
    for (const m of matches) {
      const name = m[1].toLowerCase();
      const enclosing = enclosingCallName(def.sourceText, m.index!);
      // Exclude GetField(...) arguments -- Population B is specifically
      // about NON-GetField consumers; GetField is the established
      // negative control (occurrence-based, Cycle 46).
      if (enclosing !== undefined && /^GetField$/i.test(enclosing)) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push({ offset: m.index!, enclosing });
    }

    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    for (const [name, occurrences] of byName.entries()) {
      if (occurrences.length < 2) continue;

      const storedCount = def.names.filter((r: any) => r.recname.trim() === 'FIELD' && r.refname.trim().toLowerCase() === name).length;
      const generatedCount = artifacts.references.filter((r: any) => r.kind === 'field' && (r.fieldName ?? '').toLowerCase() === name).length;
      if (storedCount === 0 && generatedCount === 0) continue;

      candidates++;
      const enclosingSet = [...new Set(occurrences.map(o => o.enclosing ?? '(none)'))];
      const example = { definitionId: def.definitionId, fieldName: name.toUpperCase(), occurrenceCount: occurrences.length, enclosingCalls: enclosingSet, storedCount, generatedCount };

      const bucketKey = enclosingSet.length === 1 ? enclosingSet[0] : `MIXED(${enclosingSet.join(',')})`;
      if (!byEnclosingCall.has(bucketKey)) byEnclosingCall.set(bucketKey, { matched: 0, mismatched: 0 });

      if (storedCount === generatedCount) {
        matched++;
        byEnclosingCall.get(bucketKey)!.matched++;
        matchExamples.push(example);
      } else {
        mismatched++;
        byEnclosingCall.get(bucketKey)!.mismatched++;
        mismatchExamples.push(example);
        if (generatedCount < storedCount) {
          contradictions.push(example);
        }
      }
    }
  }
  db.close();

  console.log(`Candidates (definition, field-name) pairs, 2+ NON-GetField bare Field.X occurrences: ${candidates}`);
  console.log(`Encode errors: ${encodeErrors}`);
  console.log(`Matched: ${matched}`);
  console.log(`Mismatched: ${mismatched}`);
  console.log(`Contradictions (generated < stored): ${contradictions.length}`);

  console.log('\n--- breakdown by enclosing call ---');
  for (const [call, counts] of [...byEnclosingCall.entries()].sort((a, b) => (b[1].matched + b[1].mismatched) - (a[1].matched + a[1].mismatched))) {
    console.log(`  ${call}: matched=${counts.matched} mismatched=${counts.mismatched}`);
  }

  console.log('\n--- contradiction examples ---');
  for (const e of contradictions) console.log('  ', JSON.stringify(e));

  console.log('\n--- mismatch examples (first 60) ---');
  for (const e of mismatchExamples.slice(0, 60)) console.log('  ', JSON.stringify(e));

  console.log('\n--- match examples (non-(none)/CreateArray enclosing calls) ---');
  for (const e of matchExamples.filter((e: any) => e.enclosingCalls[0] !== '(none)')) console.log('  ', JSON.stringify(e));
}

main();
