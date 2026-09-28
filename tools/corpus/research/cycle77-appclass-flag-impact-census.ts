/*
 * Cycle 77 Phase 45+ impact census (read-only): re-validates the exact
 * 1,994-definition population Cycle 73's taxonomy classified as
 * DECODER_BARE_IDENTIFIER or DECODE_SOURCE_MISMATCH, using the current
 * (post-fix) validator, and tabulates the new classification
 * distribution plus a handful of concrete before/after examples.
 *
 * Usage: npx tsx tools/corpus/research/cycle77-appclass-flag-impact-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition, snapshotToCorpusDefinition } from '../snapshot/reader';
import { validateDefinition } from '../validator';

function loadIds(): number[] {
  const taxonomyPath = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
  const data = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
  return data.rows
    .filter((r: any) => r.primaryCategory === 'DECODER_BARE_IDENTIFIER' || r.primaryCategory === 'DECODE_SOURCE_MISMATCH')
    .map((r: any) => r.definitionId);
}

async function main() {
  const db = openSnapshotDatabase();
  const ids = loadIds();
  console.log(`Loaded ${ids.length} definitions previously classified DECODER_BARE_IDENTIFIER/DECODE_SOURCE_MISMATCH`);

  const counts: Record<string, number> = {};
  const newlyExact: number[] = [];
  const remainingMismatchByAppClass = { appClass: 0, ordinary: 0 };

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    const capture = {
      definition: snapshotToCorpusDefinition(snap, 0),
      sourceRows: 1,
      source: snap.sourceText,
      programRows: 1,
      program: snap.storedProgram,
      names: snap.names.map(row => ({
        NAMENUM: row.namenum,
        RECNAME: row.recname,
        REFNAME: row.refname,
        PACKAGEROOT: row.packageroot,
        QUALIFYPATH: row.qualifypath,
        APPCLASSMETHOD: row.appclassmethod
      }))
    };

    const result = await validateDefinition(capture as any);
    const classification = result.classification;
    counts[classification] = (counts[classification] ?? 0) + 1;
    if (classification === 'EXACT') newlyExact.push(id);
    if (classification === 'DECODE_SOURCE_MISMATCH') {
      if (snap.objectid1 === 104) remainingMismatchByAppClass.appClass++;
      else remainingMismatchByAppClass.ordinary++;
    }
  }

  console.log('\n=== New classification distribution ===');
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }

  console.log(`\nNewly EXACT: ${newlyExact.length}`);
  console.log('Examples:', newlyExact.slice(0, 20));

  console.log('\nRemaining DECODE_SOURCE_MISMATCH split:', remainingMismatchByAppClass);
}

main();
