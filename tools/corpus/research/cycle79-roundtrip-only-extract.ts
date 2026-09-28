/*
 * Cycle 79 Phase 1-5 (mandatory population extraction + three-way
 * comparison + byte-divergence census, read-only, no decoder/renderer
 * changes yet).
 *
 * ROUNDTRIP_ONLY (per cycle73-nonexact-taxonomy.ts's own definition) is
 * exactly: sourceEncodeExact === true && roundtripExact === false --
 * i.e. original source encodes byte-identically, but decoding the
 * stored bytes and re-encoding THAT text does not reproduce the stored
 * bytes. This script extracts that population directly from the
 * taxonomy, then for each member performs the three-way comparison the
 * brief requires: original source, decoded/rendered source, and the
 * bytes re-encoded from that decoded source -- clustering both the
 * textual (source) diff and the first true re-encode byte divergence.
 *
 * Usage: npx tsx tools/corpus/research/cycle79-roundtrip-only-extract.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { encodeProgram } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const TAXONOMY_PATH = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
const OUT_PATH = path.join(__dirname, '../../../.claude/cycle79-roundtrip-only.json');

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

function firstDiffByte(a: Buffer, b: Buffer): number | undefined {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  if (a.length !== b.length) return n;
  return undefined;
}

function firstDiffChar(a: string, b: string): number | undefined {
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

function ctx(s: string, offset: number, radius = 60): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(s.length, offset + radius);
  return s.slice(start, end).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

async function main() {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const ids: number[] = taxonomy.rows
    .filter((r: any) => r.primaryCategory === 'ROUNDTRIP_ONLY')
    .map((r: any) => r.definitionId);

  console.log(`ROUNDTRIP_ONLY population: ${ids.length}`);

  const db = openSnapshotDatabase();
  const rows: any[] = [];

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    const eContext = buildEncodeContext(snap);
    const names = buildNames(snap.names as any);
    const isAppClass = snap.objectid1 === 104;

    const decoded = decodeProgram(snap.storedProgram, names, { mode: 'auto', isApplicationClass: isAppClass });
    const reencoded = encodeProgram(decoded.text, eContext);

    const sourceDiffOffset = firstDiffChar(snap.sourceText, decoded.text);
    const byteDiffOffset = firstDiffByte(snap.storedProgram, reencoded);

    let storedByte: string | null = null;
    let reencodedByte: string | null = null;
    let storedWindow = '';
    let reencodedWindow = '';

    if (byteDiffOffset !== undefined) {
      storedByte = byteDiffOffset < snap.storedProgram.length ? snap.storedProgram[byteDiffOffset].toString(16).padStart(2, '0') : null;
      reencodedByte = byteDiffOffset < reencoded.length ? reencoded[byteDiffOffset].toString(16).padStart(2, '0') : null;
      storedWindow = hexAt(snap.storedProgram, byteDiffOffset);
      reencodedWindow = hexAt(reencoded, byteDiffOffset);
    }

    rows.push({
      definitionId: id,
      objectid1: snap.objectid1,
      appClass: isAppClass,
      lengthDeltaBytes: reencoded.length - snap.storedProgram.length,
      sourceDiffOffset,
      sourceContextOriginal: sourceDiffOffset !== undefined ? ctx(snap.sourceText, sourceDiffOffset) : '',
      sourceContextDecoded: sourceDiffOffset !== undefined ? ctx(decoded.text, sourceDiffOffset) : '',
      byteDiffOffset,
      storedByte,
      reencodedByte,
      storedWindow,
      reencodedWindow
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);

  const appClassCount = rows.filter(r => r.appClass).length;
  console.log(`App Class: ${appClassCount} / Ordinary: ${rows.length - appClassCount}`);

  const noSourceDiff = rows.filter(r => r.sourceDiffOffset === undefined).length;
  console.log(`Source text identical (original === decoded): ${noSourceDiff}`);
  console.log(`Source text differs: ${rows.length - noSourceDiff}`);

  const lengthDeltaCounts: Record<string, number> = {};
  for (const r of rows) {
    const key = r.lengthDeltaBytes === 0 ? 'same' : r.lengthDeltaBytes > 0 ? 'longer' : 'shorter';
    lengthDeltaCounts[key] = (lengthDeltaCounts[key] ?? 0) + 1;
  }
  console.log('Length delta (re-encoded vs stored):', lengthDeltaCounts);

  const clusters: Record<string, number> = {};
  for (const r of rows) {
    if (r.byteDiffOffset === undefined) continue;
    const key = `${r.storedByte}->${r.reencodedByte}`;
    clusters[key] = (clusters[key] ?? 0) + 1;
  }
  console.log('\nTop 25 stored->re-encoded byte clusters at first divergence:');
  for (const [k, v] of Object.entries(clusters).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(' ', k, v);
  }
}

main();
