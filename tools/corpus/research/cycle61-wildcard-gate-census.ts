/*
 * Cycle 61 Phase 5/6/7/8: corpus-wide census testing whether
 * `claimWildcardImportMetadata()`'s fallback (`context?.applicationClassReferenceSession
 * !== undefined ? ...claim() : true`) causes duplicate blank-REFNAME
 * wildcard-import PACKAGE rows for classes with an inherited (not-own-
 * declared) %This.method() call AND 2+ wildcard imports -- a fourth
 * instance of the same overbroad `hasUnmodeledThisMethodDependencies`
 * gate pattern found in Cycles 52/57/60.
 *
 * For every Application Class definition with an inherited %This call
 * AND 2+ wildcard imports, reports stored vs generated blank-REFNAME
 * PACKAGE row count.
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

function main(): void {
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  const candidates: any[] = [];
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
    const wildcardImports = importTargets.filter((t: string) => t.endsWith(':*'));
    if (wildcardImports.length < 2) continue;

    const storedBlankRows = def.names.filter((r: any) => r.recname.trim() === 'PACKAGE' && r.refname.trim() === '').length;

    let generatedBlankRows = 0;
    try {
      const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerContext(def) });
      generatedBlankRows = artifacts.references.filter((r: any) =>
        r.kind === 'package' && (r.className ?? r.packageName ?? '') === ''
      ).length;
    } catch {
      encodeErrors++;
      continue;
    }

    candidates.push({
      definitionId: def.definitionId,
      wildcardImportCount: wildcardImports.length,
      storedBlankRows,
      generatedBlankRows
    });
  }
  db.close();

  console.log(`Candidates (inherited %This call AND 2+ wildcard imports): ${candidates.length}`);
  console.log(`Encode errors: ${encodeErrors}`);
  const matched = candidates.filter(c => c.storedBlankRows === c.generatedBlankRows);
  const mismatched = candidates.filter(c => c.storedBlankRows !== c.generatedBlankRows);
  console.log(`Matched (stored === generated): ${matched.length}`);
  console.log(`Mismatched: ${mismatched.length}`);
  console.log('\n--- all candidates ---');
  for (const c of candidates) console.log('  ', JSON.stringify(c));
}

main();
