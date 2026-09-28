/*
 * Cycle 64 Phase 9/17/22 (mandatory census): reconstructing 28755/28964's
 * new first divergence after Cycle 60/61/62/63 found a duplicate
 * allocation pattern for built-in-object-typed (`Record`/`Rowset`/`Row`/
 * `Field`/`SQL`/`File`/`XmlDoc`/`XmlNode`) Local declarations: Cycle 36's
 * `ensureLocalObjectPackageReference` already gives these METHOD-WIDE
 * lifetime (`builtinObjectDeclarationsHaveMethodWideLifetime`), but never
 * consults the CLASS-WIDE `applicationClassTypeReferenceSession` facade
 * Cycle 57 built for Application Class leaf types -- so the SAME builtin
 * type declared via `Local` in a SECOND method allocates a fresh,
 * duplicate PACKAGE row instead of reusing the class-wide identity
 * already established (by an earlier method's own declaration, or by the
 * declaration-dependency prepass for a parameter/return type of the same
 * builtin leaf).
 *
 * For every Application Class definition, find built-in-object leaves
 * (Record/Rowset/Row/Field/SQL/File/XmlDoc/XmlNode) declared via `Local`
 * in 2+ DIFFERENT methods, and compare stored vs generated PACKAGE row
 * count for that leaf across the WHOLE definition.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle64-builtin-classwide-reuse-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const APPLICATION_CLASS_OBJECT_ID = 104;
const BUILTIN_LEAVES = ['record', 'rowset', 'row', 'field', 'sql', 'file', 'xmldoc', 'xmlnode'];

function ownerContext(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const localDeclRegex = /\bLocal\s+([A-Za-z_][A-Za-z0-9_]*)\s+&/gi;

  let candidateCount = 0;
  let matched = 0;
  let mismatched = 0;
  let encodeErrors = 0;
  const mismatchExamples: any[] = [];

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    // For each builtin leaf, which methods declare it via a bare `Local <Leaf> &x;`?
    const methodsByLeaf = new Map<string, Set<string>>();
    for (const impl of parsed.implementations as any[]) {
      if (impl.kind !== 'method') continue;
      localDeclRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = localDeclRegex.exec(impl.body)) !== null) {
        const leaf = m[1].toLowerCase();
        if (!BUILTIN_LEAVES.includes(leaf)) continue;
        if (!methodsByLeaf.has(leaf)) methodsByLeaf.set(leaf, new Set());
        methodsByLeaf.get(leaf)!.add(impl.name);
      }
    }

    const multiMethodLeaves = [...methodsByLeaf.entries()].filter(([, methods]) => methods.size >= 2);
    if (multiMethodLeaves.length === 0) continue;

    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
    } catch {
      encodeErrors++;
      continue;
    }

    for (const [leaf, methods] of multiMethodLeaves) {
      const properLeaf = leaf.charAt(0).toUpperCase() + leaf.slice(1);
      const storedCount = def.names.filter((r: any) =>
        r.recname.trim() === 'PACKAGE' && r.refname.trim().toUpperCase() === properLeaf.toUpperCase()
      ).length;
      const generatedCount = artifacts.references.filter((r: any) =>
        r.kind === 'package' && (r.className ?? r.packageName ?? '').toUpperCase() === properLeaf.toUpperCase()
      ).length;

      candidateCount++;
      const example = { definitionId: def.definitionId, leaf: properLeaf, methodCount: methods.size, storedCount, generatedCount };
      if (storedCount === generatedCount) {
        matched++;
      } else {
        mismatched++;
        if (mismatchExamples.length < 100) mismatchExamples.push(example);
      }
    }
  }
  db.close();

  console.log(`Candidates (definition, builtin-leaf) pairs declared via Local in 2+ methods: ${candidateCount}`);
  console.log(`Encode errors: ${encodeErrors}`);
  console.log(`Matched (stored === generated): ${matched}`);
  console.log(`Mismatched: ${mismatched}`);
  console.log('\n--- mismatch examples ---');
  for (const e of mismatchExamples) console.log('  ', JSON.stringify(e));
}

main();
