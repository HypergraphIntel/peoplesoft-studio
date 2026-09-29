/*
 * Shape census for REFERENCE_COMPLETE_DOWNSTREAM: for every definition in
 * that taxonomy bucket, run the REAL validator (same path corpus:harness
 * uses) and bucket by the single differing byte pair at the first
 * divergence, to find the dominant shared mechanism(s) rather than
 * sampling by hand.
 *
 * Usage: npx tsx tools/corpus/research/downstream-shape-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { validateDefinition } from '../validator';
import { LocalCorpusDataSource } from '../local-datasource';
import type { CorpusWorkItem, CorpusDefinition } from '../datasource';

const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../.claude/nonexact-taxonomy.json'), 'utf8'));
const ids: number[] = taxonomy.rows
  .filter((r: any) => r.primaryCategory === 'REFERENCE_COMPLETE_DOWNSTREAM')
  .map((r: any) => r.definitionId);

console.log('REFERENCE_COMPLETE_DOWNSTREAM population:', ids.length);

const resultsDb = new Database(path.join(__dirname, '../corpus-results.sqlite'), { readonly: true });

function definitionFor(id: number): CorpusDefinition {
  const row = resultsDb.prepare(`SELECT * FROM definition WHERE definition_id = ?`).get(id) as any;
  return {
    offset: 0,
    key: {
      objectId1: row.objectid1, objectValue1: row.objectvalue1,
      objectId2: row.objectid2, objectValue2: row.objectvalue2,
      objectId3: row.objectid3, objectValue3: row.objectvalue3,
      objectId4: row.objectid4, objectValue4: row.objectvalue4,
      objectId5: row.objectid5, objectValue5: row.objectvalue5,
      objectId6: row.objectid6, objectValue6: row.objectvalue6,
      objectId7: row.objectid7, objectValue7: row.objectvalue7
    },
    displayName: row.display_name ?? ''
  };
}

function byteAt(hex: string | undefined, index: number): string {
  if (!hex) return '--';
  const bytes = hex.trim().split(/\s+/);
  return bytes[index] ?? '--';
}

async function main() {
  const dataSource = new LocalCorpusDataSource();
  const shapeCounts: Record<string, number> = {};
  const shapeExamples: Record<string, number[]> = {};

  let processed = 0;
  for (const id of ids) {
    processed++;
    if (processed % 150 === 0) console.log('...', processed, '/', ids.length);

    const item: CorpusWorkItem = { definitionId: id, definition: definitionFor(id) };
    let capture;
    try {
      capture = await dataSource.capture(item);
    } catch {
      shapeCounts['CAPTURE_FAILED'] = (shapeCounts['CAPTURE_FAILED'] ?? 0) + 1;
      continue;
    }

    const result = await validateDefinition(capture, {});

    // storedDiffHex/generatedDiffHex are windows CENTERED on firstDiffOffset
    // (see hexWindow in binaryDiff.ts -- radius 12, so index 12 is the
    // reported first-difference byte when not clamped near a buffer edge).
    // Scan from the window start for the FIRST index where the two sides
    // actually differ, rather than trusting the center index blindly --
    // a length-changing diff means everything after the true divergence is
    // shifted, so the center byte can coincidentally match (very common in
    // UTF-16LE text, where every ASCII char's high byte is 0x00).
    const storedBytes = result.storedDiffHex?.trim().split(/\s+/) ?? [];
    const genBytes = result.generatedDiffHex?.trim().split(/\s+/) ?? [];
    let divIdx = storedBytes.findIndex((b, i) => b !== genBytes[i]);
    if (divIdx === -1) divIdx = 12;
    const storedByte = storedBytes[divIdx] ?? '--';
    const genByte = genBytes[divIdx] ?? '--';

    const key = `stored=0x${storedByte} gen=0x${genByte}`;

    shapeCounts[key] = (shapeCounts[key] ?? 0) + 1;
    if (!shapeExamples[key]) shapeExamples[key] = [];
    if (shapeExamples[key].length < 8) shapeExamples[key].push(id);
  }

  const sorted = Object.entries(shapeCounts).sort((a, b) => b[1] - a[1]);
  console.log('--- shape breakdown (top 40) ---');
  for (const [k, v] of sorted.slice(0, 40)) {
    console.log(v, k, shapeExamples[k] ?? []);
  }
}

main();
