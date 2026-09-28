/*
 * Cycle 55 Phase 4: corpus-wide census of repeated local declarations of
 * the same Application-Class (or qualifying builtin) leaf type within one
 * Application Class method body.
 *
 * For each method body (raw text from `parsed.implementations`), regex-scan
 * for `Local [array of] <Type> &var` declarations, group by leaf type
 * (colon-qualified types only, i.e. shaped like Package:Path:Leaf, plus
 * the specific scalar-vs-array-of-same-leaf pattern), and flag methods with
 * 2+ declarations of the same leaf. Cross-reference stored PSPCMNAME row
 * count for that leaf against the current encoder's generated count.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle55-repeated-local-census.ts [--json]
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
  leaf: string;
  declarations: { type: string; isArray: boolean }[];
  storedRowCount: number;
  generatedRowCount: number;
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const candidates: Candidate[] = [];
  let methodsScanned = 0;
  let parseErrors = 0;

  for (const def of appClassDefs) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed === undefined) continue;

    for (const impl of parsed.implementations) {
      if (impl.kind !== 'method') continue;
      methodsScanned++;
      const body: string = impl.body;

      // Match `Local [array of] Type[:Type...] &var` where Type is
      // colon-qualified (an Application Class type) -- ignore bare scalar
      // Local declarations entirely.
      const localRegex = /\bLocal\s+((?:array\s+of\s+)?[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s+&/gi;
      const declByLeaf = new Map<string, { type: string; isArray: boolean }[]>();
      let m: RegExpExecArray | null;
      while ((m = localRegex.exec(body)) !== null) {
        const type = m[1];
        const leaf = leafOf(type).toLowerCase();
        const isArray = /^array\s+of\s+/i.test(type);
        if (!declByLeaf.has(leaf)) declByLeaf.set(leaf, []);
        declByLeaf.get(leaf)!.push({ type, isArray });
      }

      for (const [leaf, decls] of declByLeaf) {
        if (decls.length < 2) continue;

        let artifacts;
        try {
          artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
        } catch {
          parseErrors++;
          continue;
        }
        // Cycle 55 correction: a method-dependency reference (methodName
        // set / stored appclassmethod non-blank) is a DIFFERENT, separate
        // mechanism (per-method-call allocation, not the type-declaration
        // row this census targets) -- exclude it from both sides so the
        // comparison isolates the plain type-dependency row only.
        const generatedRowCount = artifacts.references.filter(r =>
          r.kind === 'package' && (r as any).className?.toLowerCase() === leaf && (r as any).methodName === undefined
        ).length;
        const storedRowCount = def.names.filter(r =>
          r.recname.trim() === 'PACKAGE' && r.refname.trim().toLowerCase() === leaf && r.appclassmethod.trim() === ''
        ).length;

        candidates.push({
          definitionId: def.definitionId,
          method: impl.name,
          leaf,
          declarations: decls,
          storedRowCount,
          generatedRowCount
        });
      }
    }
  }
  db.close();

  if (asJson) { console.log(JSON.stringify(candidates, null, 2)); return; }

  console.log(`Application Class definitions scanned: ${appClassDefs.length}`);
  console.log(`Method implementations scanned: ${methodsScanned}`);
  console.log(`Candidates (2+ locals of same leaf type in one method): ${candidates.length}`);
  console.log(`Encode errors while cross-referencing (skipped): ${parseErrors}`);

  const mismatches = candidates.filter(c => c.storedRowCount !== c.generatedRowCount);
  const matches = candidates.filter(c => c.storedRowCount === c.generatedRowCount);
  console.log(`\nMismatched (stored count != generated count): ${mismatches.length}`);
  console.log(`Matched (stored count == generated count): ${matches.length}`);

  console.log('\n--- distribution of (storedRowCount, generatedRowCount) pairs ---');
  const dist = new Map<string, number>();
  for (const c of candidates) {
    const key = `stored=${c.storedRowCount} generated=${c.generatedRowCount}`;
    dist.set(key, (dist.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${count}`);

  console.log('\n--- all candidates ---');
  for (const c of candidates) {
    console.log(`  ${c.definitionId}\t${c.method}\t${c.leaf}\tstored=${c.storedRowCount}\tgenerated=${c.generatedRowCount}\tdecls=${c.declarations.map(d => (d.isArray ? 'array-of' : 'scalar')).join(',')}`);
  }
}

main();
