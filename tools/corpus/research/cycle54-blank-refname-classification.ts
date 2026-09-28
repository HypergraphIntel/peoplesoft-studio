/*
 * Cycle 54 Phases 4/5/6/7/8/9: classify the 614-definition blank-REFNAME
 * PACKAGE row population.
 *
 * Key finding this script encodes: `tools/corpus/validator.ts` builds its
 * decode name table from ONLY (RECNAME, REFNAME) -- PACKAGEROOT/
 * QUALIFYPATH/APPCLASSMETHOD are read into `capture.names` but never
 * compared anywhere. `sourceEncodeExact` is a raw generated-vs-stored
 * PSPCMPROG buffer comparison, which only depends on reference COUNT and
 * ORDER, not on packageroot/qualifypath content. So the harness-relevant
 * shape of a "blank-REFNAME PACKAGE row" is just (RECNAME=PACKAGE,
 * REFNAME="") -- decodes to the bare token "PACKAGE" -- and the only
 * question that matters for correctness is whether the encoder allocates
 * ONE such reference at the right ordinal position.
 *
 * This script splits the population by:
 *  - hasWildcardImport: source contains `import ...:*;` (Cycle 33's
 *    already-solved mechanism)
 *  - current sourceEncodeExact status (already-passing vs failing)
 *  - executable operand usage of the blank row's namenum
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle54-blank-refname-classification.ts [--json]
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions, getSnapshotDefinition, snapshotToCorpusDefinition } from '../snapshot/reader';
import { LocalCorpusDataSource } from '../local-datasource';
import { validateDefinition } from '../validator';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const APPLICATION_CLASS_OBJECT_ID = 104;

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const db = openSnapshotDatabase();
  const appClassDefs = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);

  interface Row {
    definitionId: number;
    namenum: number;
    hasWildcardImport: boolean;
    operandUsed: boolean;
    sourceEncodeExact: boolean;
    classification: string;
  }

  const dataSource = new LocalCorpusDataSource();
  const rows: Row[] = [];

  for (const def of appClassDefs) {
    const blankRow = def.names.find(r => r.recname.trim() === 'PACKAGE' && r.refname.trim() === '');
    if (blankRow === undefined) continue;

    const hasWildcardImport = /\bimport\s+[A-Za-z_][A-Za-z0-9_:]*:\*\s*;/i.test(def.sourceText);

    const names = new NameTable();
    for (const row of def.names) {
      const name = row.recname.trim() && row.refname.trim()
        ? `${row.recname.trim()}.${row.refname.trim()}`
        : (row.refname.trim() || row.recname.trim());
      names.add(row.namenum, name);
    }
    let operandUsed = false;
    try {
      const decoded = decodeProgram(def.storedProgram, names, { mode: 'auto' });
      operandUsed = decoded.tokens.some((t: any) => t.nameNum === blankRow.namenum);
    } catch { /* leave false */ }

    const snapshot = getSnapshotDefinition(db, def.definitionId);
    const corpusDefinition = snapshotToCorpusDefinition(snapshot, def.definitionId);
    const capture = await dataSource.capture({ definitionId: def.definitionId, definition: corpusDefinition });
    const result = await validateDefinition(capture, {});

    rows.push({
      definitionId: def.definitionId,
      namenum: blankRow.namenum,
      hasWildcardImport,
      operandUsed,
      sourceEncodeExact: result.sourceEncodeExact,
      classification: result.classification
    });
  }
  await dataSource.close();
  db.close();

  if (asJson) { console.log(JSON.stringify(rows, null, 2)); return; }

  console.log(`Total definitions with a blank-REFNAME PACKAGE row: ${rows.length}`);
  const wildcard = rows.filter(r => r.hasWildcardImport);
  const nonWildcard = rows.filter(r => !r.hasWildcardImport);
  console.log(`  hasWildcardImport: ${wildcard.length}`);
  console.log(`  NOT hasWildcardImport (residual): ${nonWildcard.length}`);

  console.log('\n--- Executable operand usage ---');
  console.log(`  operand-used (any cluster): ${rows.filter(r => r.operandUsed).length}`);
  console.log(`  metadata-only (any cluster): ${rows.filter(r => !r.operandUsed).length}`);
  console.log(`  wildcard & operand-used: ${wildcard.filter(r => r.operandUsed).length}`);
  console.log(`  non-wildcard & operand-used: ${nonWildcard.filter(r => r.operandUsed).length}`);

  console.log('\n--- sourceEncodeExact status ---');
  console.log(`  wildcard & EXACT: ${wildcard.filter(r => r.sourceEncodeExact).length} / ${wildcard.length}`);
  console.log(`  wildcard & NOT exact: ${wildcard.filter(r => !r.sourceEncodeExact).length}`);
  console.log(`  non-wildcard & EXACT: ${nonWildcard.filter(r => r.sourceEncodeExact).length} / ${nonWildcard.length}`);
  console.log(`  non-wildcard & NOT exact: ${nonWildcard.filter(r => !r.sourceEncodeExact).length}`);

  console.log('\n--- non-wildcard, NOT sourceEncodeExact (the active residual population) ---');
  const activeResidual = nonWildcard.filter(r => !r.sourceEncodeExact);
  console.log(`count: ${activeResidual.length}`);
  for (const r of activeResidual.slice(0, 40)) console.log('  ', JSON.stringify(r));

  console.log('\n--- non-wildcard, sourceEncodeExact=true (positive controls for the non-wildcard mechanism) ---');
  const nonWildcardControls = nonWildcard.filter(r => r.sourceEncodeExact);
  console.log(`count: ${nonWildcardControls.length}`);
  for (const r of nonWildcardControls.slice(0, 15)) console.log('  ', JSON.stringify(r));

  console.log('\n--- wildcard, NOT sourceEncodeExact (check whether Cycle 33 mechanism itself has residual gaps) ---');
  const wildcardFailing = wildcard.filter(r => !r.sourceEncodeExact);
  console.log(`count: ${wildcardFailing.length}`);
  for (const r of wildcardFailing.slice(0, 15)) console.log('  ', JSON.stringify(r));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
