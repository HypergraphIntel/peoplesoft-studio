/*
 * Cycle 60 Phase 8: corpus-wide census testing the hypothesis that
 * `allocateModeledDeclarationDependency()`'s guard on
 * `hasModeledApplicationClassReferenceScope` (which reduces to
 * `!hasUnmodeledThisMethodDependencies` after Cycle 52) is too broad --
 * blocking declaration-dependency TYPE discovery for classes with an
 * inherited %This.method() call, even though that discovery has nothing
 * to do with the method-dependency-resolution uncertainty Cycle 32/34
 * established the gate for.
 *
 * For every Application Class definition with `hasUnmodeledThisMethodDependencies
 * = true` AND a non-empty `missingDeclarationDependencies` set, checks
 * whether stored PSPCMNAME allocates those types EARLY (in the same
 * first-occurrence order the array is built in, per Cycle 52's own
 * already-proven population evidence for the non-gated case) -- i.e.
 * whether removing the gate would make generated MORE correct or less.
 *
 * Read-only, no encoder changes.
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

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const scalarDeclarationTypes = new Set([
    'string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'exception', 'array'
  ]);

  interface Candidate {
    definitionId: number;
    missingLeaves: string[];
    storedHasAllEarly: boolean;
    storedFirstMissingLeafNamenum: number | undefined;
    storedNamenumOfFirstOtherDeclPhaseRow: number | undefined;
    generatedAlreadyCorrect: boolean; // sourceEncodeExact regardless
  }

  const candidates: Candidate[] = [];
  let encodeErrors = 0;

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    const ownMethodNames = new Set(
      parsed.members.filter((m: any) => m.kind === 'method').map((m: any) => m.name.toLowerCase())
    );
    const hasUnmodeledThisMethodDependencies = [
      ...def.sourceText.matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)
    ].some(m => !ownMethodNames.has(m[1].toLowerCase()));
    if (!hasUnmodeledThisMethodDependencies) continue;

    const importTargets = [...def.sourceText.slice(0, parsed.unitStart).matchAll(/\bimport\s+([^;]+);/gi)]
      .map((m: any) => m[1].trim());
    const importedClassLeaves = new Set(
      importTargets.map((t: string) => t.split(':').at(-1)?.trim().toLowerCase()).filter((l: string) => l && l !== '*')
    );
    const importedWildcardRoots = new Set(
      importTargets.filter((t: string) => t.endsWith(':*')).map((t: string) => t.slice(0, -2).split(':')[0].toLowerCase())
    );

    const declarationTypes: string[] = [
      parsed.extendsType,
      parsed.implementsType,
      ...(parsed.statements as any[]).flatMap(s => {
        if (s.kind === 'method') return [...s.parameters.map((p: any) => p.type), s.returnType];
        if (s.kind === 'property' || s.kind === 'instance' || s.kind === 'instance-statement') return [s.type];
        return [];
      })
    ].filter((t): t is string => t !== undefined);

    const declarationDependencyTypes = declarationTypes.filter(typeName => {
      const normalized = typeName.replace(/^(?:array\s+of\s+)+/i, '').trim();
      const leaf = leafOf(typeName);
      const root = normalized.split(':')[0].toLowerCase();
      const isRelationship = [parsed.extendsType, parsed.implementsType].some(r => r?.toLowerCase() === typeName.toLowerCase());
      return leaf !== '' &&
        !scalarDeclarationTypes.has(leaf.toLowerCase()) &&
        !importedClassLeaves.has(leaf.toLowerCase()) &&
        !(isRelationship && importedWildcardRoots.has(root));
    });
    const missingDeclarationDependencies = [...new Map(
      declarationDependencyTypes.map(t => [leafOf(t).toLowerCase(), t])
    ).values()];
    if (missingDeclarationDependencies.length === 0) continue;

    const missingLeaves = missingDeclarationDependencies.map(leafOf);

    // Does stored have a PACKAGE row for each missing leaf?
    const firstLeaf = missingLeaves[0].toLowerCase();
    const firstLeafRow = def.names.find(r => r.recname.trim() === 'PACKAGE' && r.refname.trim().toLowerCase() === firstLeaf);
    const storedHasAllEarly = missingLeaves.every(leaf =>
      def.names.some(r => r.recname.trim() === 'PACKAGE' && r.refname.trim().toLowerCase() === leaf.toLowerCase())
    );

    let generatedAlreadyCorrect = false;
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      generatedAlreadyCorrect = artifacts.program.equals(def.storedProgram);
    } catch {
      encodeErrors++;
    }

    candidates.push({
      definitionId: def.definitionId,
      missingLeaves,
      storedHasAllEarly,
      storedFirstMissingLeafNamenum: firstLeafRow?.namenum,
      storedNamenumOfFirstOtherDeclPhaseRow: undefined,
      generatedAlreadyCorrect
    });
  }
  db.close();

  console.log(`Candidates (hasUnmodeledThisMethodDependencies=true AND missingDeclarationDependencies.length>0): ${candidates.length}`);
  console.log(`Encode errors: ${encodeErrors}`);
  const storedHasRow = candidates.filter(c => c.storedHasAllEarly).length;
  const storedMissingRow = candidates.length - storedHasRow;
  console.log(`Stored has a PACKAGE row for EVERY missing-declaration leaf: ${storedHasRow}`);
  console.log(`Stored missing at least one: ${storedMissingRow}`);
  console.log(`Already sourceEncodeExact despite the gate (positive-ish controls, should be rare/explainable): ${candidates.filter(c => c.generatedAlreadyCorrect).length}`);

  console.log('\n--- all candidates ---');
  for (const c of candidates) {
    console.log(`  ${c.definitionId}\tmissingLeaves=[${c.missingLeaves.join(',')}]\tstoredHasAllEarly=${c.storedHasAllEarly}\tfirstLeafNamenum=${c.storedFirstMissingLeafNamenum}\talreadyExact=${c.generatedAlreadyCorrect}`);
  }
}

main();
