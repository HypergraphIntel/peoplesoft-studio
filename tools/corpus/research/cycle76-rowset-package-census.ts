/*
 * Cycle 76 (forensic-first, per the brief's own explicit instruction: "do
 * not implement until this is answered with zero contradictions"):
 * reconstructs the ~880-definition ROWSET-missing population within
 * `REFERENCE_ACTIVE_PACKAGE`, classifying every candidate by declaration
 * source form, to find whether PACKAGE.ROWSET allocation is
 * declaration-driven, usage-driven, or contextual -- and, if contextual,
 * which specific source forms are already clean (positive) vs which
 * remain genuinely mixed (matching Cycle 7's own historical finding for
 * Rowset-typed parameters: 4/48 already-EXACT definitions with NO
 * PACKAGE.ROWSET for their own parameter).
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle76-rowset-package-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

function ownerContextOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

type SourceForm =
  | 'Local Rowset'
  | 'Global Rowset'
  | 'Component Rowset'
  | 'Function/Method parameter As Rowset'
  | 'array of Rowset'
  | 'other/undetermined';

function classifySourceForms(sourceText: string): Set<SourceForm> {
  const forms = new Set<SourceForm>();
  if (/\bLocal\s+Rowset\b/i.test(sourceText)) forms.add('Local Rowset');
  if (/\bGlobal\s+Rowset\b/i.test(sourceText)) forms.add('Global Rowset');
  if (/\bComponent\s+Rowset\b/i.test(sourceText)) forms.add('Component Rowset');
  if (/\bAs\s+Rowset\b/i.test(sourceText)) forms.add('Function/Method parameter As Rowset');
  if (/\barray\s+of\s+Rowset\b/i.test(sourceText)) forms.add('array of Rowset');
  if (forms.size === 0) forms.add('other/undetermined');
  return forms;
}

function main(): void {
  const db = openSnapshotDatabase();
  const allDefs = listSnapshotDefinitions(db);

  let candidates = 0;
  let matched = 0;
  let mismatched = 0;
  let contradictions = 0;
  const formCounts = new Map<SourceForm, { total: number; mismatched: number; matched: number }>();
  const programTypeCounts = new Map<number, number>();
  const appClassSplit = { appClass: 0, ordinary: 0, appClassMismatched: 0, ordinaryMismatched: 0 };
  const mismatchExamples: any[] = [];
  const contradictionExamples: any[] = [];

  for (const def of allDefs) {
    const storedRowsetCount = def.names.filter((r: any) => r.recname.trim().toUpperCase() === 'PACKAGE' && r.refname.trim().toUpperCase() === 'ROWSET').length;
    const hasRowsetText = /\bRowset\b/i.test(def.sourceText);
    if (storedRowsetCount === 0 && !hasRowsetText) continue;

    const owner = ownerContextOf(def);
    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner } as any);
    } catch {
      continue;
    }
    const generatedRowsetCount = artifacts.references.filter((r: any) => r.kind === 'package' && (r.packageName ?? '').toUpperCase() === 'ROWSET').length;

    if (storedRowsetCount === 0 && generatedRowsetCount === 0) continue; // not a candidate at all

    candidates++;
    const isAppClass = def.objectid1 === 104;
    (isAppClass ? appClassSplit : appClassSplit).appClass += isAppClass ? 1 : 0;
    if (!isAppClass) appClassSplit.ordinary++;
    programTypeCounts.set(def.objectid1, (programTypeCounts.get(def.objectid1) ?? 0) + 1);

    const forms = classifySourceForms(def.sourceText);
    for (const form of forms) {
      if (!formCounts.has(form)) formCounts.set(form, { total: 0, mismatched: 0, matched: 0 });
      formCounts.get(form)!.total++;
    }

    const example = { id: def.definitionId, objectid1: def.objectid1, storedRowsetCount, generatedRowsetCount, forms: [...forms] };
    if (storedRowsetCount === generatedRowsetCount) {
      matched++;
      for (const form of forms) formCounts.get(form)!.matched++;
    } else if (generatedRowsetCount < storedRowsetCount) {
      mismatched++;
      if (isAppClass) appClassSplit.appClassMismatched++; else appClassSplit.ordinaryMismatched++;
      for (const form of forms) formCounts.get(form)!.mismatched++;
      mismatchExamples.push(example);
    } else {
      contradictions++;
      contradictionExamples.push(example);
    }
  }

  db.close();

  console.log(`Candidates (any ROWSET signal, stored or generated > 0): ${candidates}`);
  console.log(`Matched: ${matched}  Mismatched (generated<stored): ${mismatched}  Contradictions (generated>stored): ${contradictions}`);

  console.log('\n=== Ordinary vs Application Class ===');
  console.log(`Application Class: ${appClassSplit.appClass} total, ${appClassSplit.appClassMismatched} mismatched`);
  console.log(`Ordinary PeopleCode: ${appClassSplit.ordinary} total, ${appClassSplit.ordinaryMismatched} mismatched`);

  console.log('\n=== Program-type breakdown (objectid1) ===');
  for (const [type, count] of [...programTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  objectid1=${type}: ${count}`);
  }

  console.log('\n=== Source-form breakdown (a definition may match multiple forms) ===');
  for (const [form, counts] of formCounts.entries()) {
    console.log(`  ${form.padEnd(40)} total=${counts.total.toString().padEnd(6)} matched=${counts.matched.toString().padEnd(6)} mismatched=${counts.mismatched}`);
  }

  console.log('\n--- mismatch examples (first 20) ---');
  for (const e of mismatchExamples.slice(0, 20)) console.log('  ', JSON.stringify(e));

  console.log('\n--- contradiction examples (all) ---');
  for (const e of contradictionExamples) console.log('  ', JSON.stringify(e));
}

main();
