/*
 * Cycle 53 Phase 1/2/4/5: exact row reconstruction for the 3 self-class-name
 * PACKAGE-row targets (28972, 28975, 30104).
 *
 * For each: parse source, get stored PSPCMNAME rows, get CURRENT generated
 * references, locate the class's own package/class identity, find the
 * stored row (if any) matching that identity, check whether the generated
 * reference set contains a matching row, and check executable usage via
 * decodeProgram.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle53-self-class-row-analysis.ts [id ...]
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const DEFAULT_TARGETS = [28972, 28975, 30104];

function ownerContext(snapshot: any) {
  const values = [
    snapshot.objectvalue1, snapshot.objectvalue2, snapshot.objectvalue3,
    snapshot.objectvalue4, snapshot.objectvalue5, snapshot.objectvalue6,
    snapshot.objectvalue7
  ].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function main(): void {
  const args = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
  const targets = args.length > 0 ? args : DEFAULT_TARGETS;
  const db = openSnapshotDatabase();
  for (const definitionId of targets) {
    const snapshot = getSnapshotDefinition(db, definitionId);
    const parsed = parseApplicationClassSource(snapshot.sourceText);
    const owner = ownerContext(snapshot);
    console.log(`\n================ ${definitionId} ================`);
    if (parsed === undefined) {
      console.log('parseApplicationClassSource returned undefined -- not parsed as Application Class shape');
      continue;
    }
    console.log('className:', parsed.className);
    console.log('extendsType:', parsed.extendsType);
    console.log('implementsType:', parsed.implementsType);
    console.log('ownerPackagePath:', owner.packagePath);
    console.log('members:', parsed.members.map((m: any) => `${m.kind}:${m.name ?? ''}${m.type ? ':' + m.type : ''}`));
    console.log('statements (declarations):', parsed.statements.map((s: any) => JSON.stringify(s)).slice(0, 30));

    console.log('\n--- stored PSPCMNAME rows ---');
    for (const row of snapshot.names) {
      console.log(
        `  namenum=${row.namenum}\trecname=${JSON.stringify(row.recname)}\trefname=${JSON.stringify(row.refname)}\tpackageroot=${JSON.stringify(row.packageroot)}\tqualifypath=${JSON.stringify(row.qualifypath)}\tappclassmethod=${JSON.stringify(row.appclassmethod)}`
      );
    }

    // Candidate self-identity match: recname === 'PACKAGE' and refname/packageroot/qualifypath referencing the class's own name.
    const classNameLower = parsed.className.toLowerCase();
    const selfRows = snapshot.names.filter(row =>
      row.recname.trim() === 'PACKAGE' &&
      [row.refname, row.packageroot, row.qualifypath].some(v => v.trim().toLowerCase() === classNameLower)
    );
    console.log('\n--- candidate self-identity stored rows (recname=PACKAGE, some field == class name) ---');
    for (const row of selfRows) {
      console.log('  ', JSON.stringify(row));
    }

    // Generated references (current encoder).
    const artifacts = encodeProgramArtifacts(snapshot.sourceText, { owner });
    console.log('\n--- generated references (current encoder) ---');
    for (const ref of artifacts.references) {
      console.log('  ', JSON.stringify(ref));
    }

    // Executable usage audit: does any operand in stored PSPCMPROG reference the self row's namenum?
    if (selfRows.length > 0) {
      const names = new NameTable();
      for (const row of snapshot.names) {
        const name = row.recname.trim() && row.refname.trim()
          ? `${row.recname.trim()}.${row.refname.trim()}`
          : (row.refname.trim() || row.recname.trim());
        names.add(row.namenum, name);
      }
      try {
        const decoded = decodeProgram(snapshot.storedProgram, names, { mode: 'auto' });
        for (const selfRow of selfRows) {
          const used = decoded.tokens.filter((t: any) => t.nameNum === selfRow.namenum);
          console.log(`\n  operand usage of namenum=${selfRow.namenum}: ${used.length} occurrence(s)`);
          for (const u of used.slice(0, 5)) console.log('    ', JSON.stringify(u));
        }
      } catch (error) {
        console.log('  decodeProgram failed:', error instanceof Error ? error.message : String(error));
      }
    }

    // Earliest source occurrence of the class's own name (case-insensitive).
    const classDeclIndex = snapshot.sourceText.search(new RegExp(`class\\s+${parsed.className}\\b`, 'i'));
    const nameRegex = new RegExp(`\\b${parsed.className}\\b`, 'gi');
    console.log('\n--- occurrences of own class name in source ---');
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = nameRegex.exec(snapshot.sourceText)) !== null && count < 15) {
      const contextStart = Math.max(0, match.index - 60);
      const contextEnd = Math.min(snapshot.sourceText.length, match.index + 60);
      console.log(`  offset=${match.index}${match.index === classDeclIndex ? ' (class decl header)' : ''}: ...${snapshot.sourceText.slice(contextStart, contextEnd).replace(/\n/g, '\\n')}...`);
      count++;
    }
  }
  db.close();
}

main();
