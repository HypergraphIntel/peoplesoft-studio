/*
 * Cycle 67 Phase 7/8/13/14/31 (mandatory census): reconstructing 28964's
 * own `%Super.TxtCat`/`%Super.CreditUtility`/`%Super.FormatAmount` etc.
 * gap found the DECLARING ANCESTOR class
 * (`BNE_OPEN_ENROLL_FL:Page:SubPage:EnrollElect`) is not present ANYWHERE
 * in the local HCDEV snapshot at all -- meaning the property's declared
 * type cannot be determined from local repository metadata for this
 * specific definition.
 *
 * This census determines how common that "unresolved ancestor" situation
 * is across the whole corpus: for every Application Class definition
 * using `%Super.<property>`, walks the `extends` chain as far as it
 * remains locally resolvable, builds a property-name -> declared-type map
 * from every resolved ancestor's own declarations (innermost/nearest
 * ancestor wins on a name collision, matching ordinary inheritance
 * shadowing), and compares stored vs generated PACKAGE-row presence for
 * each Application-Class-typed property, BOTH before and after the
 * Cycle 67 encoder fix (which consults `context.inheritedPropertyTypes`).
 *
 * Read-only from the encoder's own perspective (calls the real encoder,
 * but only to compare, never to mutate the corpus).
 *
 * Usage: npx tsx tools/corpus/research/cycle67-super-property-census.ts
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
  const allDefs = listSnapshotDefinitions(db);
  const appClassDefs = allDefs.filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const byQualifiedName = new Map<string, typeof appClassDefs[number]>();
  for (const def of appClassDefs) {
    const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
      .map(v => (v ?? '').trim());
    const eventIndex = values.findIndex(v => v.toLowerCase() === 'onexecute');
    const path = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
    if (path.length === 0) continue;
    byQualifiedName.set(path.join(':').toLowerCase(), def);
  }

  const parsedCache = new Map<string, ReturnType<typeof parseApplicationClassSource>>();
  function parsedOf(def: typeof appClassDefs[number]) {
    if (!parsedCache.has(String(def.definitionId))) {
      parsedCache.set(String(def.definitionId), parseApplicationClassSource(def.sourceText));
    }
    return parsedCache.get(String(def.definitionId));
  }

  // Walk `extends` as far as locally resolvable, returning a
  // property-name -> declared-type map (nearest ancestor wins) and
  // whether the FULL chain (up to a genuine root with no `extends`) was
  // resolved, or stopped early at an unresolved ancestor.
  function resolveInheritedProperties(startExtends: string | undefined): { types: Map<string, string>; fullyResolved: boolean } {
    const types = new Map<string, string>();
    let current = startExtends;
    let fullyResolved = true;
    const seen = new Set<string>();
    while (current !== undefined) {
      if (seen.has(current.toLowerCase())) break; // cycle guard
      seen.add(current.toLowerCase());
      const parentDef = byQualifiedName.get(current.toLowerCase());
      if (parentDef === undefined) {
        fullyResolved = false;
        break;
      }
      const parentParsed = parsedOf(parentDef);
      if (parentParsed === undefined) {
        fullyResolved = false;
        break;
      }
      for (const s of parentParsed.statements as any[]) {
        if (s.kind === 'property' && !types.has(s.name.toLowerCase())) {
          types.set(s.name.toLowerCase(), s.type);
        }
      }
      current = parentParsed.extendsType;
    }
    return { types, fullyResolved };
  }

  let definitionsWithSuper = 0;
  let occurrenceCount = 0;
  let fullyResolvedChain = 0;
  let partiallyOrUnresolvedChain = 0;
  const propertyTypeCategories = new Map<string, number>();
  const unresolvedExamples: any[] = [];
  const allAppClassExamples: any[] = [];

  const superPropertyRegex = /%Super\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b\s*(\()?/g;

  for (const def of appClassDefs) {
    const parsed = parsedOf(def);
    if (parsed === undefined) continue;
    if (parsed.extendsType === undefined) continue;

    const superMatches = [...def.sourceText.matchAll(superPropertyRegex)]
      .filter(m => m[2] === undefined);
    if (superMatches.length === 0) continue;

    definitionsWithSuper++;
    occurrenceCount += superMatches.length;

    const { types: inheritedPropertyTypes, fullyResolved } = resolveInheritedProperties(parsed.extendsType);
    if (fullyResolved) fullyResolvedChain++; else partiallyOrUnresolvedChain++;

    if (inheritedPropertyTypes.size === 0) {
      if (unresolvedExamples.length < 15) {
        unresolvedExamples.push({
          definitionId: def.definitionId,
          extends: parsed.extendsType,
          properties: [...new Set(superMatches.map(m => m[1]))]
        });
      }
      continue;
    }

    for (const propName of new Set(superMatches.map(m => m[1]))) {
      const propType = inheritedPropertyTypes.get(propName.toLowerCase());
      if (propType === undefined) continue;

      const category = /:/.test(propType)
        ? 'application-class'
        : /^(?:Record|Row|Rowset|Field|SQL|File|XmlDoc|XmlNode)$/i.test(propType)
          ? 'built-in-object'
          : 'primitive-or-other';
      propertyTypeCategories.set(category, (propertyTypeCategories.get(category) ?? 0) + 1);
      if (category !== 'application-class') continue;

      const leaf = leafOf(propType).toUpperCase();
      const storedHasLeaf = def.names.some((r: any) => r.recname.trim() === 'PACKAGE' && r.refname.trim().toUpperCase() === leaf);

      let generatedHasLeafBefore = false;
      let generatedHasLeafAfter = false;
      let encodeError = false;
      try {
        const before = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
        generatedHasLeafBefore = before.references.some((r: any) => r.kind === 'package' && (r.className ?? r.packageName ?? '').toUpperCase() === leaf);

        const after = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def), inheritedPropertyTypes });
        generatedHasLeafAfter = after.references.some((r: any) => r.kind === 'package' && (r.className ?? r.packageName ?? '').toUpperCase() === leaf);
      } catch {
        encodeError = true;
      }

      allAppClassExamples.push({
        definitionId: def.definitionId,
        extends: parsed.extendsType,
        property: propName,
        propertyType: propType,
        leaf,
        storedHasLeaf,
        generatedHasLeafBefore,
        generatedHasLeafAfter,
        encodeError
      });
    }
  }
  db.close();

  console.log(`Definitions using bare %Super.<property> (non-call): ${definitionsWithSuper}`);
  console.log(`Total %Super.<property> occurrences: ${occurrenceCount}`);
  console.log(`\nFull ancestor chain resolved locally (up to a real root): ${fullyResolvedChain}`);
  console.log(`Chain stopped early at an unresolved ancestor: ${partiallyOrUnresolvedChain}`);
  console.log('\n--- property type category breakdown (any resolved ancestor in the chain) ---');
  for (const [cat, count] of propertyTypeCategories) console.log(`  ${cat}: ${count}`);

  console.log('\n--- examples with NO resolved property at all (fully unresolved for this %Super usage) ---');
  for (const e of unresolvedExamples) console.log('  ', JSON.stringify(e));

  const validExamples = allAppClassExamples.filter(e => !e.encodeError);
  const storedTrue = validExamples.filter(e => e.storedHasLeaf);
  const supportingBefore = storedTrue.filter(e => !e.generatedHasLeafBefore);
  const nowFixed = supportingBefore.filter(e => e.generatedHasLeafAfter);
  const stillMissingAfterFix = supportingBefore.filter(e => !e.generatedHasLeafAfter);
  const alreadyMatchedBefore = storedTrue.filter(e => e.generatedHasLeafBefore);
  const regressedByFix = alreadyMatchedBefore.filter(e => !e.generatedHasLeafAfter);
  const contradictions = validExamples.filter(e => !e.storedHasLeaf && e.generatedHasLeafAfter);

  console.log(`\n--- stored-vs-generated summary (Application-Class-typed %Super.Property) ---`);
  console.log(`Total (definition, property) pairs (encode errors excluded): ${validExamples.length}  (encode errors: ${allAppClassExamples.length - validExamples.length})`);
  console.log(`Stored has PACKAGE row for leaf: ${storedTrue.length}`);
  console.log(`  already matched BEFORE the fix: ${alreadyMatchedBefore.length}`);
  console.log(`  missing BEFORE the fix (candidates): ${supportingBefore.length}`);
  console.log(`    of those, FIXED (now matched with inheritedPropertyTypes supplied): ${nowFixed.length}`);
  console.log(`    of those, STILL missing after the fix (contradiction/gap in the fix): ${stillMissingAfterFix.length}`);
  console.log(`  regressed by the fix (was matched, now not): ${regressedByFix.length}`);
  console.log(`Genuine contradictions (stored does NOT have leaf, fix WOULD add it): ${contradictions.length}`);

  console.log('\n--- still-missing-after-fix examples ---');
  for (const e of stillMissingAfterFix) console.log('  ', JSON.stringify(e));

  console.log('\n--- contradiction examples ---');
  for (const e of contradictions) console.log('  ', JSON.stringify(e));

  console.log('\n--- fixed examples (sample) ---');
  for (const e of nowFixed.slice(0, 15)) console.log('  ', JSON.stringify(e));
}

main();
