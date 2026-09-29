/*
 * Cycle 80 Phase 1-4 (mandatory population extraction + three-way
 * comparison + byte-divergence census, read-only, no decoder/encoder
 * changes yet).
 *
 * Cycle 79 closed the dominant ROUNDTRIP_ONLY family (missing end-class/
 * end-method in decoder.ts's followsDeclaration list), leaving a 73-
 * definition residual, ~50 of which showed a first-divergence pattern of
 * stored opcode 0x4E vs re-encoded opcode 0x24 for what looks like the
 * same comment. This script re-extracts the CURRENT ROUNDTRIP_ONLY
 * population fresh (not reusing Cycle 79's stale 482-population file),
 * finds the true first BODY-level byte divergence (header excluded, same
 * method as Cycle 79) for each, and reports directionality/occurrence
 * counts for the 0x4E/0x24 family specifically.
 *
 * Usage: npx tsx tools/corpus/research/cycle80-comment-opcode-extract.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { encodeProgram } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const TAXONOMY_PATH = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
const OUT_PATH = path.join(__dirname, '../../../.claude/cycle80-roundtrip-residual.json');

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

function hexAt(buf: Buffer, offset: number, before = 12, after = 20): string {
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

    const storedBody = snap.storedProgram.subarray(37);
    const reencodedBody = reencoded.subarray(37);
    const off = firstDiffByte(storedBody, reencodedBody);

    let storedByte: string | null = null;
    let reencodedByte: string | null = null;
    let storedWindow = '';
    let reencodedWindow = '';

    if (off !== undefined) {
      storedByte = off < storedBody.length ? storedBody[off].toString(16).padStart(2, '0') : null;
      reencodedByte = off < reencodedBody.length ? reencodedBody[off].toString(16).padStart(2, '0') : null;
      storedWindow = hexAt(storedBody, off);
      reencodedWindow = hexAt(reencodedBody, off);
    }

    rows.push({
      definitionId: id,
      objectid1: snap.objectid1,
      appClass: isAppClass,
      bodyOff: off,
      storedByte,
      reencodedByte,
      storedWindow,
      reencodedWindow,
      decodedTextCtx: off !== undefined ? ctx(decoded.text, Math.floor(decoded.text.length * (off / Math.max(1, storedBody.length)))) : ''
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);

  const clusters: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.storedByte}->${r.reencodedByte}`;
    clusters[key] = (clusters[key] ?? 0) + 1;
  }
  console.log('\nBody-level first-divergence clusters:');
  for (const [k, v] of Object.entries(clusters).sort((a, b) => b[1] - a[1])) {
    console.log(' ', k, v);
  }

  const commentFamily = rows.filter(r => r.storedByte === '4e' && r.reencodedByte === '24');
  const inverseFamily = rows.filter(r => r.storedByte === '24' && r.reencodedByte === '4e');
  console.log(`\n0x4E -> 0x24: ${commentFamily.length}`);
  console.log(`0x24 -> 0x4E: ${inverseFamily.length}`);
  console.log('appClass split (0x4E->0x24):', {
    appClass: commentFamily.filter(r => r.appClass).length,
    ordinary: commentFamily.filter(r => !r.appClass).length
  });
}

main();
