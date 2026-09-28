/*
 * Cycle 78 Phase 3/4 (read-only): accurate first-true-byte-divergence
 * census over the 1,042-definition newly exposed encoder-side
 * population (see cycle78-encoder-population-extract.ts). Recomputes
 * diffs directly (rather than relying on CorpusResult's packed,
 * truncation-prone hex windows) so the differing byte value itself is
 * always correctly identified regardless of its position near a buffer
 * boundary.
 *
 * Usage: npx tsx tools/corpus/research/cycle78-byte-divergence-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { encodeProgram } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const POP_PATH = path.join(__dirname, '../../../.claude/cycle78-encoder-population.json');
const OUT_PATH = path.join(__dirname, '../../../.claude/cycle78-byte-divergence.json');

function buildEncodeContext(snap: any) {
  const values = [snap.objectvalue1, snap.objectvalue2, snap.objectvalue3, snap.objectvalue4, snap.objectvalue5, snap.objectvalue6, snap.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const packagePath = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
  return { owner: { recordName: values[0], fieldName: values[1], packagePath } };
}

function buildNames(nameRows: any[]): NameTable {
  const names = new NameTable();
  for (const row of nameRows) {
    const recname = String(row.recname ?? '').trim();
    const refname = String(row.refname ?? '').trim();
    let name: string;
    if (recname && refname) name = `${recname}.${refname}`;
    else if (refname) name = refname;
    else name = recname;
    names.add(Number(row.namenum), name);
  }
  return names;
}

function firstDiff(a: Buffer, b: Buffer): number | undefined {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  if (a.length !== b.length) return n;
  return undefined;
}

function hexAt(buf: Buffer, offset: number, before = 16, after = 24): string {
  const start = Math.max(0, offset - before);
  const end = Math.min(buf.length, offset + after);
  return buf.subarray(start, end).toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';
}

function sourceCtx(source: string, offset: number, radius = 80): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(source.length, offset + radius);
  return source.slice(start, end).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

async function main() {
  const pop = JSON.parse(fs.readFileSync(POP_PATH, 'utf8'));
  const db = openSnapshotDatabase();

  const rows: any[] = [];

  for (const r of pop.rows) {
    const snap = getSnapshotDefinition(db, r.definitionId);
    const ctx = buildEncodeContext(snap);
    const names = buildNames(snap.names as any);

    let stage: 'sourceEncode' | 'roundtrip';
    let storedBuf: Buffer;
    let generatedBuf: Buffer;

    const sourceEncoded = encodeProgram(snap.sourceText, ctx);
    const sourceDiffOffset = firstDiff(snap.storedProgram, sourceEncoded);

    if (sourceDiffOffset !== undefined) {
      stage = 'sourceEncode';
      storedBuf = snap.storedProgram;
      generatedBuf = sourceEncoded;
    } else {
      stage = 'roundtrip';
      const decoded = decodeProgram(snap.storedProgram, names, { mode: 'auto', isApplicationClass: snap.objectid1 === 104 });
      const roundtripEncoded = encodeProgram(decoded.text, ctx);
      storedBuf = snap.storedProgram;
      generatedBuf = roundtripEncoded;
    }

    const offset = firstDiff(storedBuf, generatedBuf);
    if (offset === undefined) {
      rows.push({ definitionId: r.definitionId, stage, note: 'no-diff-found (unexpected)' });
      continue;
    }

    const storedByte = offset < storedBuf.length ? storedBuf[offset] : undefined;
    const generatedByte = offset < generatedBuf.length ? generatedBuf[offset] : undefined;

    rows.push({
      definitionId: r.definitionId,
      stage,
      offset,
      storedByte: storedByte !== undefined ? storedByte.toString(16).padStart(2, '0') : null,
      generatedByte: generatedByte !== undefined ? generatedByte.toString(16).padStart(2, '0') : null,
      lengthDelta: generatedBuf.length - storedBuf.length,
      storedWindow: hexAt(storedBuf, offset),
      generatedWindow: hexAt(generatedBuf, offset),
      sourceContext: sourceCtx(snap.sourceText, offset > 37 ? offset : 0)
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(`Wrote ${OUT_PATH}, ${rows.length} rows`);

  const byStage: Record<string, number> = {};
  const clusters: Record<string, number> = {};
  for (const row of rows) {
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    if (row.offset !== undefined) {
      const key = `${row.storedByte}->${row.generatedByte}`;
      clusters[key] = (clusters[key] ?? 0) + 1;
    }
  }
  console.log('By stage:', byStage);
  console.log('\nTop 25 stored->generated byte clusters:');
  for (const [k, v] of Object.entries(clusters).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(' ', k, v);
  }
}

main();
