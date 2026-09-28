/*
 * Cycle 57 Phase 1/2/3/4/5: reconstruct fresh the population where an
 * Application-Class leaf type has an identity already established at
 * class/declaration scope (explicit import, property, instance, method
 * parameter/return type, or the Cycle 52 declaration-dependency prepass)
 * BEFORE a method-local (`Local`/`array of Local`/`create`) occurrence of
 * the SAME leaf is encountered, and determines whether stored PSPCMNAME
 * converges to one identity across that boundary.
 *
 * Builds on Cycle 55/56's census methodology but narrows specifically to
 * the "no same-method Local declaration" residual Cycle 56 left open (its
 * own approximate count of ~49), reconstructing the population fresh
 * rather than trusting that number.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle57-classwide-census.ts [--json]
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
  createOrLocalLeaf: string;
  provenances: string[]; // which declaration-phase sources establish this leaf
  hasExplicitImport: boolean;
  hasWildcardImportOnly: boolean;
  hasPropertyType: boolean;
  hasInstanceType: boolean;
  hasParamOrReturnTypeSameMethod: boolean;
  hasParamOrReturnTypeOtherMethod: boolean;
  hasConstructorParam: boolean;
  spansMultipleMethods: boolean; // same leaf used method-locally in 2+ methods
  hasUnmodeledThisMethodDependencies: boolean;
  storedIdentityCountWholeDefinition: number;
  generatedIdentityCountWholeDefinition: number;
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const localDeclRegex = /\bLocal\s+((?:array\s+of\s+)?[A-Za-z_%][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s+&/gi;
  const createRegex = /\bcreate\s+([A-Za-z_%][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*\(/gi;

  const candidates: Candidate[] = [];
  let encodeErrors = 0;

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    const importTargets = [...def.sourceText.slice(0, parsed.unitStart).matchAll(/\bimport\s+([^;]+);/gi)]
      .map((m: any) => m[1].trim());
    const explicitImportLeaves = new Set(
      importTargets.filter((t: string) => !t.endsWith(':*')).map((t: string) => leafOf(t).toLowerCase())
    );
    const wildcardImportRoots = new Set(
      importTargets.filter((t: string) => t.endsWith(':*')).map((t: string) => leafOf(t.slice(0, -2)).toLowerCase())
    );

    // Declaration-phase leaves: property/instance types, and method
    // parameter/return types, tagged by which method they belong to
    // (constructor == method whose name equals the class name).
    const classNameLower = parsed.className.toLowerCase();
    const propertyLeaves = new Set<string>();
    const instanceLeaves = new Set<string>();
    const paramOrReturnLeavesByMethod = new Map<string, Set<string>>();
    const constructorParamLeaves = new Set<string>();

    for (const s of parsed.statements as any[]) {
      if (s.kind === 'property') {
        propertyLeaves.add(leafOf(s.type).toLowerCase());
      } else if (s.kind === 'instance' || s.kind === 'instance-statement') {
        instanceLeaves.add(leafOf(s.type).toLowerCase());
      } else if (s.kind === 'method') {
        const leaves = new Set<string>();
        for (const p of s.parameters) leaves.add(leafOf(p.type).toLowerCase());
        if (s.returnType) leaves.add(leafOf(s.returnType).toLowerCase());
        paramOrReturnLeavesByMethod.set(s.name, leaves);
        if (s.name.toLowerCase() === classNameLower) {
          for (const l of leaves) constructorParamLeaves.add(l);
        }
      }
    }

    // Method-local (Local decl or create) leaves per method.
    const localLeavesByMethod = new Map<string, Set<string>>();
    for (const impl of parsed.implementations) {
      if (impl.kind !== 'method') continue;
      const leaves = new Set<string>();
      let m: RegExpExecArray | null;
      localDeclRegex.lastIndex = 0;
      while ((m = localDeclRegex.exec(impl.body)) !== null) leaves.add(leafOf(m[1]).toLowerCase());
      createRegex.lastIndex = 0;
      while ((m = createRegex.exec(impl.body)) !== null) leaves.add(leafOf(m[1]).toLowerCase());
      localLeavesByMethod.set(impl.name, leaves);
    }

    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    // Mirrors encoder.ts's own `hasUnmodeledThisMethodDependencies` check:
    // an inherited (not-own-declared) %This.method() call disables the
    // whole cross-fragment `applicationClassReferenceSession` for the
    // class (Cycle 32's own established rule, unchanged since).
    const ownMethodNames = new Set(
      (parsed.statements as any[]).filter(s => s.kind === 'method').map(s => s.name.toLowerCase())
    );
    const hasUnmodeledThisMethodDependencies = [
      ...def.sourceText.matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)
    ].some(m => !ownMethodNames.has(m[1].toLowerCase()));

    // All distinct method-local leaves across the whole definition.
    const allLocalLeaves = new Set<string>();
    for (const leaves of localLeavesByMethod.values()) for (const l of leaves) allLocalLeaves.add(l);

    for (const leaf of allLocalLeaves) {
      const hasExplicitImport = explicitImportLeaves.has(leaf);
      const hasWildcardImportOnly = !hasExplicitImport && wildcardImportRoots.has(leaf);
      const hasPropertyType = propertyLeaves.has(leaf);
      const hasInstanceType = instanceLeaves.has(leaf);
      const hasConstructorParam = constructorParamLeaves.has(leaf);

      const methodsUsingLeafLocally = [...localLeavesByMethod.entries()].filter(([, s]) => s.has(leaf)).map(([name]) => name);
      const spansMultipleMethods = methodsUsingLeafLocally.length > 1;

      let hasParamOrReturnTypeSameMethod = false;
      let hasParamOrReturnTypeOtherMethod = false;
      for (const [methodName, leaves] of paramOrReturnLeavesByMethod) {
        if (!leaves.has(leaf)) continue;
        if (methodsUsingLeafLocally.includes(methodName)) hasParamOrReturnTypeSameMethod = true;
        else hasParamOrReturnTypeOtherMethod = true;
      }

      const hasAnyClassWideProvenance = hasExplicitImport || hasPropertyType || hasInstanceType || hasParamOrReturnTypeOtherMethod || hasConstructorParam;
      // Only interested in candidates where a class-wide (not just
      // same-method) provenance exists -- same-method param/return overlap
      // is a DIFFERENT, not-yet-tested dimension (Phase 9), tracked but not
      // required for inclusion.
      if (!hasAnyClassWideProvenance && !hasWildcardImportOnly) continue;

      const provenances: string[] = [];
      if (hasExplicitImport) provenances.push('explicit-import');
      if (hasWildcardImportOnly) provenances.push('wildcard-import');
      if (hasPropertyType) provenances.push('property');
      if (hasInstanceType) provenances.push('instance');
      if (hasParamOrReturnTypeSameMethod) provenances.push('param-or-return-same-method');
      if (hasParamOrReturnTypeOtherMethod) provenances.push('param-or-return-other-method');
      if (hasConstructorParam) provenances.push('constructor-param');

      const storedIdentityCountWholeDefinition = def.names.filter(r =>
        r.recname.trim() === 'PACKAGE' && r.refname.trim().toLowerCase() === leaf && r.appclassmethod.trim() === ''
      ).length;
      const generatedIdentityCountWholeDefinition = artifacts.references.filter(r =>
        r.kind === 'package' && (r as any).className?.toLowerCase() === leaf && (r as any).methodName === undefined
      ).length;

      candidates.push({
        definitionId: def.definitionId,
        method: methodsUsingLeafLocally.join(','),
        createOrLocalLeaf: leaf,
        provenances,
        hasExplicitImport,
        hasWildcardImportOnly,
        hasPropertyType,
        hasInstanceType,
        hasParamOrReturnTypeSameMethod,
        hasParamOrReturnTypeOtherMethod,
        hasConstructorParam,
        spansMultipleMethods,
        hasUnmodeledThisMethodDependencies,
        storedIdentityCountWholeDefinition,
        generatedIdentityCountWholeDefinition
      });
    }
  }
  db.close();

  if (asJson) { console.log(JSON.stringify(candidates, null, 2)); return; }

  console.log(`Application Class definitions scanned: ${appClassDefs.length}`);
  console.log(`Encode errors (skipped): ${encodeErrors}`);
  console.log(`Class-wide/import-established candidates (definition, leaf) pairs: ${candidates.length}`);

  const namedOnly = candidates.filter(c => !c.hasWildcardImportOnly);
  console.log(`\nNamed (non-wildcard-only) candidates: ${namedOnly.length}`);
  console.log(`Wildcard-import-only candidates (excluded per Phase 3/33): ${candidates.length - namedOnly.length}`);

  console.log('\n--- provenance breakdown (named candidates) ---');
  console.log('hasExplicitImport:', namedOnly.filter(c => c.hasExplicitImport).length);
  console.log('hasPropertyType:', namedOnly.filter(c => c.hasPropertyType).length);
  console.log('hasInstanceType:', namedOnly.filter(c => c.hasInstanceType).length);
  console.log('hasParamOrReturnTypeSameMethod:', namedOnly.filter(c => c.hasParamOrReturnTypeSameMethod).length);
  console.log('hasParamOrReturnTypeOtherMethod:', namedOnly.filter(c => c.hasParamOrReturnTypeOtherMethod).length);
  console.log('hasConstructorParam:', namedOnly.filter(c => c.hasConstructorParam).length);
  console.log('spansMultipleMethods:', namedOnly.filter(c => c.spansMultipleMethods).length);

  const matched = namedOnly.filter(c => c.storedIdentityCountWholeDefinition === c.generatedIdentityCountWholeDefinition);
  const mismatched = namedOnly.filter(c => c.storedIdentityCountWholeDefinition !== c.generatedIdentityCountWholeDefinition);
  console.log(`\nMatched: ${matched.length}`);
  console.log(`Mismatched: ${mismatched.length}`);

  console.log('\n--- crosstab: hasUnmodeledThisMethodDependencies (disables applicationClassReferenceSession) ---');
  console.log('  matched & hasUnmodeledThisMethodDependencies:', matched.filter(c => c.hasUnmodeledThisMethodDependencies).length);
  console.log('  matched & !hasUnmodeledThisMethodDependencies:', matched.filter(c => !c.hasUnmodeledThisMethodDependencies).length);
  console.log('  mismatched & hasUnmodeledThisMethodDependencies:', mismatched.filter(c => c.hasUnmodeledThisMethodDependencies).length);
  console.log('  mismatched & !hasUnmodeledThisMethodDependencies:', mismatched.filter(c => !c.hasUnmodeledThisMethodDependencies).length);

  console.log('\n--- stored identity count distribution (named candidates) ---');
  const storedDist = new Map<number, number>();
  for (const c of namedOnly) storedDist.set(c.storedIdentityCountWholeDefinition, (storedDist.get(c.storedIdentityCountWholeDefinition) ?? 0) + 1);
  for (const [k, v] of [...storedDist.entries()].sort((a, b) => a[0] - b[0])) console.log(`  stored=${k}: ${v}`);

  console.log('\n--- all named candidates ---');
  for (const c of namedOnly) {
    console.log(`  ${c.definitionId}\t[${c.method}]\t${c.createOrLocalLeaf}\tstored=${c.storedIdentityCountWholeDefinition}\tgenerated=${c.generatedIdentityCountWholeDefinition}\tprovenance=${c.provenances.join('|')}\tspansMethods=${c.spansMultipleMethods}`);
  }
}

main();
