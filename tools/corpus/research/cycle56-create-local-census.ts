/*
 * Cycle 56 Phase 4/5/6/7/8/12: corpus-wide census of Application-Class
 * `create Package:X:Y(...)` expressions inside Application Class method
 * bodies, cross-referenced against:
 *  - whether the SAME leaf type is also introduced via a plain/array-of
 *    Local declaration (in the SAME method, or a DIFFERENT method),
 *  - whether the class explicitly imports that same leaf type,
 *  - stored vs generated identity cardinality for that leaf, at BOTH the
 *    per-method and whole-definition granularity (to test method-wide vs
 *    class-wide reuse).
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle56-create-local-census.ts [--json]
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

function leafOf(typeName: string): string {
  return typeName.replace(/^(?:array\s+of\s+)+/i, '').trim().split(':').at(-1) ?? '';
}

interface Candidate {
  definitionId: number;
  method: string;
  createTargetType: string;
  createLeaf: string;
  hasPriorLocalDeclSameMethod: boolean;
  hasLocalDeclOtherMethod: boolean;
  hasImportSameLeaf: boolean;
  hasMultipleCreatesSameLeafSameMethod: boolean;
  // whole-definition granularity
  storedIdentityCountWholeDefinition: number;
  generatedIdentityCountWholeDefinition: number;
  // per-method granularity (this method's own type-dependency refs for the leaf)
  generatedIdentityCountThisMethod: number;
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const candidates: Candidate[] = [];
  let methodsScanned = 0;
  let encodeErrors = 0;

  const createRegex = /\bcreate\s+([A-Za-z_%][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*\(/gi;
  const localDeclRegex = /\bLocal\s+((?:array\s+of\s+)?[A-Za-z_%][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s+&/gi;

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    const importTargets = [...def.sourceText.slice(0, parsed.unitStart).matchAll(/\bimport\s+([^;]+);/gi)]
      .map((m: any) => m[1].trim());
    const importedLeaves = new Set(
      importTargets.filter((t: string) => !t.endsWith(':*')).map((t: string) => leafOf(t).toLowerCase())
    );

    // Local-declared leaves per method (for same-method / other-method checks).
    const localLeavesByMethod = new Map<string, Set<string>>();
    for (const impl of parsed.implementations) {
      if (impl.kind !== 'method') continue;
      const leaves = new Set<string>();
      let lm: RegExpExecArray | null;
      localDeclRegex.lastIndex = 0;
      while ((lm = localDeclRegex.exec(impl.body)) !== null) {
        leaves.add(leafOf(lm[1]).toLowerCase());
      }
      localLeavesByMethod.set(impl.name, leaves);
    }

    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    for (const impl of parsed.implementations) {
      if (impl.kind !== 'method') continue;
      methodsScanned++;
      const body: string = impl.body;

      const createsInMethod: string[] = [];
      let m: RegExpExecArray | null;
      createRegex.lastIndex = 0;
      while ((m = createRegex.exec(body)) !== null) {
        createsInMethod.push(m[1]);
      }
      if (createsInMethod.length === 0) continue;

      const seenLeaves = new Set<string>();
      for (const createTargetType of createsInMethod) {
        const createLeaf = leafOf(createTargetType).toLowerCase();
        if (seenLeaves.has(createLeaf)) continue; // report once per (method, leaf)
        seenLeaves.add(createLeaf);

        const sameMethodLocalLeaves = localLeavesByMethod.get(impl.name) ?? new Set();
        const hasPriorLocalDeclSameMethod = sameMethodLocalLeaves.has(createLeaf);
        const hasLocalDeclOtherMethod = [...localLeavesByMethod.entries()]
          .some(([name, leaves]) => name !== impl.name && leaves.has(createLeaf));
        const hasImportSameLeaf = importedLeaves.has(createLeaf);
        const hasMultipleCreatesSameLeafSameMethod =
          createsInMethod.filter(t => leafOf(t).toLowerCase() === createLeaf).length > 1;

        const storedIdentityCountWholeDefinition = def.names.filter(r =>
          r.recname.trim() === 'PACKAGE' && r.refname.trim().toLowerCase() === createLeaf && r.appclassmethod.trim() === ''
        ).length;
        const generatedIdentityCountWholeDefinition = artifacts.references.filter(r =>
          r.kind === 'package' && (r as any).className?.toLowerCase() === createLeaf && (r as any).methodName === undefined
        ).length;

        candidates.push({
          definitionId: def.definitionId,
          method: impl.name,
          createTargetType,
          createLeaf,
          hasPriorLocalDeclSameMethod,
          hasLocalDeclOtherMethod,
          hasImportSameLeaf,
          hasMultipleCreatesSameLeafSameMethod,
          storedIdentityCountWholeDefinition,
          generatedIdentityCountWholeDefinition,
          generatedIdentityCountThisMethod: -1 // not used at this granularity; kept for schema stability
        });
      }
    }
  }
  db.close();

  if (asJson) { console.log(JSON.stringify(candidates, null, 2)); return; }

  console.log(`Application Class definitions scanned: ${appClassDefs.length}`);
  console.log(`Method implementations scanned: ${methodsScanned}`);
  console.log(`Encode errors (skipped): ${encodeErrors}`);
  console.log(`Create-local candidates (method, leaf) pairs: ${candidates.length}`);

  const storedAlwaysOne = candidates.filter(c => c.storedIdentityCountWholeDefinition === 1);
  const storedOther = candidates.filter(c => c.storedIdentityCountWholeDefinition !== 1);
  console.log(`\nstoredIdentityCountWholeDefinition === 1: ${storedAlwaysOne.length} / ${candidates.length}`);
  console.log(`storedIdentityCountWholeDefinition !== 1 (contradicts "always 1 per class"): ${storedOther.length}`);
  for (const c of storedOther.slice(0, 20)) console.log('  ', JSON.stringify(c));

  const mismatched = candidates.filter(c => c.storedIdentityCountWholeDefinition !== c.generatedIdentityCountWholeDefinition);
  const matched = candidates.filter(c => c.storedIdentityCountWholeDefinition === c.generatedIdentityCountWholeDefinition);
  console.log(`\nWhole-definition matched (stored === generated): ${matched.length}`);
  console.log(`Whole-definition mismatched: ${mismatched.length}`);

  console.log('\n--- crosstab: hasPriorLocalDeclSameMethod ---');
  console.log('  matched & hasPriorLocalDeclSameMethod:', matched.filter(c => c.hasPriorLocalDeclSameMethod).length);
  console.log('  matched & !hasPriorLocalDeclSameMethod:', matched.filter(c => !c.hasPriorLocalDeclSameMethod).length);
  console.log('  mismatched & hasPriorLocalDeclSameMethod:', mismatched.filter(c => c.hasPriorLocalDeclSameMethod).length);
  console.log('  mismatched & !hasPriorLocalDeclSameMethod:', mismatched.filter(c => !c.hasPriorLocalDeclSameMethod).length);

  console.log('\n--- crosstab: hasImportSameLeaf ---');
  console.log('  matched & hasImportSameLeaf:', matched.filter(c => c.hasImportSameLeaf).length);
  console.log('  matched & !hasImportSameLeaf:', matched.filter(c => !c.hasImportSameLeaf).length);
  console.log('  mismatched & hasImportSameLeaf:', mismatched.filter(c => c.hasImportSameLeaf).length);
  console.log('  mismatched & !hasImportSameLeaf:', mismatched.filter(c => !c.hasImportSameLeaf).length);

  console.log('\n--- crosstab: hasLocalDeclOtherMethod ---');
  console.log('  matched & hasLocalDeclOtherMethod:', matched.filter(c => c.hasLocalDeclOtherMethod).length);
  console.log('  mismatched & hasLocalDeclOtherMethod:', mismatched.filter(c => c.hasLocalDeclOtherMethod).length);

  console.log('\n--- distribution of (stored, generated) whole-definition pairs ---');
  const dist = new Map<string, number>();
  for (const c of candidates) {
    const key = `stored=${c.storedIdentityCountWholeDefinition} generated=${c.generatedIdentityCountWholeDefinition}`;
    dist.set(key, (dist.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${count}`);

  console.log('\n--- all mismatched candidates ---');
  for (const c of mismatched) {
    console.log(`  ${c.definitionId}\t${c.method}\t${c.createLeaf}\tstored=${c.storedIdentityCountWholeDefinition}\tgenerated=${c.generatedIdentityCountWholeDefinition}\tpriorLocalSameMethod=${c.hasPriorLocalDeclSameMethod}\tlocalOtherMethod=${c.hasLocalDeclOtherMethod}\timport=${c.hasImportSameLeaf}\tmultiCreateSameMethod=${c.hasMultipleCreatesSameLeafSameMethod}`);
  }
}

main();
