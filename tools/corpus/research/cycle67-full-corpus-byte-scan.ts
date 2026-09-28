/*
 * Cycle 67: full 30,209-definition byte-identical-encode scan, WITH
 * ancestor-property-type resolution wired in (via `context.inheritedPropertyTypes`,
 * this cycle's own new encoder context field). Unlike
 * `cycle55-full-corpus-byte-scan.ts` (used broadly by every other cycle,
 * left unmodified), this variant additionally resolves each Application
 * Class definition's own `extends` chain -- as far as it remains locally
 * resolvable -- to a property-name -> declared-type map, exactly mirroring
 * `cycle67-super-property-census.ts`'s own `resolveInheritedProperties`
 * helper, so the fix's TRUE, honest full-corpus byte-identical effect can
 * be measured (the ordinary encoder entry points the corpus harness/
 * `corpus:verify` currently use never supply this new field at all, so
 * they alone would show +0/-0 regardless of whether the fix is correct).
 *
 * Run once before the fix (via `git stash` on encoder.ts) and once after,
 * diff the two JSON outputs, matching every prior cycle's own validation
 * methodology.
 *
 * Usage: npx tsx tools/corpus/research/cycle67-full-corpus-byte-scan.ts > /tmp/scan-after.json
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
  const defs = listSnapshotDefinitions(db);
  const appClassDefs = defs.filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

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
    const key = String(def.definitionId);
    if (!parsedCache.has(key)) parsedCache.set(key, parseApplicationClassSource(def.sourceText));
    return parsedCache.get(key);
  }

  function resolveInheritedProperties(startExtends: string | undefined): Map<string, string> {
    const types = new Map<string, string>();
    let current = startExtends;
    const seen = new Set<string>();
    while (current !== undefined) {
      if (seen.has(current.toLowerCase())) break;
      seen.add(current.toLowerCase());
      const parentDef = byQualifiedName.get(current.toLowerCase());
      if (parentDef === undefined) break;
      const parentParsed = parsedOf(parentDef);
      if (parentParsed === undefined) break;
      for (const s of parentParsed.statements as any[]) {
        if (s.kind === 'property' && !types.has(s.name.toLowerCase())) {
          types.set(s.name.toLowerCase(), s.type);
        }
      }
      current = parentParsed.extendsType;
    }
    return types;
  }

  const result: Record<number, boolean> = {};

  for (const def of defs) {
    let byteIdentical = false;
    try {
      let inheritedPropertyTypes: Map<string, string> | undefined;
      if (def.objectid1 === APPLICATION_CLASS_OBJECT_ID) {
        const parsed = parsedOf(def as any);
        if (parsed?.extendsType !== undefined) {
          inheritedPropertyTypes = resolveInheritedProperties(parsed.extendsType);
        }
      }
      const artifacts = encodeProgramArtifacts(def.sourceText, {
        owner: ownerContext(def),
        inheritedPropertyTypes
      });
      byteIdentical = artifacts.program.equals(def.storedProgram);
    } catch {
      byteIdentical = false;
    }
    result[def.definitionId] = byteIdentical;
  }
  db.close();

  console.log(JSON.stringify(result));
}

main();
