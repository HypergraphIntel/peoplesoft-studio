/*
 * Cycle 69 Phase 1 (mandatory fresh reconstruction): `29389` extends
 * `GPS_EDITFUNCTIONS:BaseEditFunction` and uses `%Super`-derived
 * declaration dependencies that Cycle 67's `inheritedPropertyTypes`
 * mechanism resolves -- but NEITHER the standard corpus harness
 * (`tools/corpus/validator.ts`) NOR a plain `encodeProgramArtifacts` call
 * supplies that context (Cycle 67's own documented, deliberate scoping).
 * Without it, `29389`'s reference stream shows a misleading early
 * divergence that just re-exposes the ALREADY-FIXED Cycle 67 gap, not
 * `29389`'s TRUE current first divergence.
 *
 * This script reconstructs `29389`'s reference stream fresh on top of
 * Cycle 68 (HEAD 9771a98), WITH ancestor resolution correctly supplied
 * (mirroring `cycle67-super-property-census.ts`'s own
 * `resolveInheritedProperties` helper), to find the TRUE current first
 * divergence for Cycle 69.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle69-29389-reconstruction.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const APPLICATION_CLASS_OBJECT_ID = 104;
const TARGET_DEFINITION_ID = 29389;

function ownerContext(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function gKeyOf(g: any): string {
  switch (g.kind) {
    case 'owner': return '.';
    case 'package': return `PACKAGE.${g.packageName ?? ''}`;
    case 'scroll': return `SCROLL.${g.recordName ?? ''}`;
    case 'record': return `RECORD.${g.recordName ?? ''}`;
    case 'field': return `FIELD.${g.fieldName ?? ''}`;
    case 'record-field': return `${g.recordName ?? ''}.${g.fieldName ?? ''}`;
    case 'component': return `COMPONENT.${g.recordName ?? g.fieldName ?? ''}`;
    case 'declare-function': return `DECLARE.${g.fieldName ?? ''}`;
    case 'quoted-reference': return `QUOTED.${g.fieldName ?? ''}`;
    default: return JSON.stringify(g);
  }
}

function main(): void {
  const db = openSnapshotDatabase();
  const allDefs = listSnapshotDefinitions(db);
  const appClassDefs = allDefs.filter((d: any) => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  const byQualifiedName = new Map<string, any>();
  for (const def of appClassDefs) {
    const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
    const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
    const path = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
    if (path.length === 0) continue;
    byQualifiedName.set(path.join(':').toLowerCase(), def);
  }
  const parsedCache = new Map<string, any>();
  function parsedOf(def: any) {
    if (!parsedCache.has(String(def.definitionId))) {
      parsedCache.set(String(def.definitionId), parseApplicationClassSource(def.sourceText));
    }
    return parsedCache.get(String(def.definitionId));
  }
  function resolveInheritedProperties(startExtends: string | undefined) {
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

  const def = appClassDefs.find((d: any) => d.definitionId === TARGET_DEFINITION_ID);
  if (!def) { console.log('not found'); process.exit(1); }
  const parsed = parsedOf(def)!;
  const inheritedPropertyTypes = resolveInheritedProperties(parsed.extendsType);

  const artifacts = encodeProgramArtifacts(def.sourceText, {
    owner: ownerContext(def),
    inheritedPropertyTypes
  } as any);

  const stored = def.names as any[];
  const generated = artifacts.references;

  console.log('definitionId:', def.definitionId);
  console.log('class:', parsed.className, 'extends:', parsed.extendsType);
  console.log('stored count:', stored.length, 'generated count:', generated.length);

  const n = Math.max(stored.length, generated.length);
  let firstDiff = -1;
  for (let i = 0; i < n; i++) {
    const s = stored[i];
    const g = generated[i];
    const sKey = s ? `${s.recname.trim()}.${s.refname.trim()}` : '(none)';
    const gKey = g ? gKeyOf(g) : '(none)';
    if (sKey !== gKey) { firstDiff = i; break; }
  }
  console.log('first diff at index:', firstDiff);
  console.log();
  for (let i = 0; i < n; i++) {
    const s = stored[i];
    const g = generated[i];
    const marker = i === firstDiff ? ' <<<< FIRST DIFF' : '';
    console.log(
      i,
      'stored=', (s ? `${s.recname.trim()}.${s.refname.trim()}` : '(none)').padEnd(30),
      'generated=', (g ? gKeyOf(g) : '(none)').padEnd(30),
      marker
    );
  }
  db.close();
}
main();
