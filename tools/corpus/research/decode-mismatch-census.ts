/*
 * Compiler-completion goal: census of DECODE_SOURCE_MISMATCH (923
 * definitions, the largest completely untouched category since Cycle
 * 77's own isApplicationClass wiring fix). For each candidate, finds
 * the first true TEXTUAL divergence between original source and
 * decoded source, and clusters by program type / App-Class flag /
 * nearby construct, to identify the largest coherent rendering family.
 *
 * Usage: npx tsx tools/corpus/research/decode-mismatch-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition } from '../snapshot/reader';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import { normalizePeopleCodeSource } from '../../../src/peoplecode/corpus/sourceNormalize';

const TAXONOMY_PATH = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
const OUT_PATH = path.join(__dirname, '../../../.claude/decode-mismatch-census.json');

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

function firstDiffChar(a: string, b: string): number | undefined {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  if (a.length !== b.length) return n;
  return undefined;
}

function ctx(s: string, offset: number, radius = 50): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(s.length, offset + radius);
  return s.slice(start, end).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

async function main() {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const ids: number[] = taxonomy.rows
    .filter((r: any) => r.primaryCategory === 'DECODE_SOURCE_MISMATCH')
    .map((r: any) => r.definitionId);

  console.log(`DECODE_SOURCE_MISMATCH population: ${ids.length}`);

  const db = openSnapshotDatabase();
  const rows: any[] = [];
  let hasUnmapped = 0, noUnmapped = 0;

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    const names = buildNames(snap.names as any);
    const isAppClass = snap.objectid1 === 104;

    const decoded = decodeProgram(snap.storedProgram, names, { mode: 'auto', isApplicationClass: isAppClass });
    if (decoded.unknownOpcodes.length > 0) hasUnmapped++; else noUnmapped++;

    const normOrig = normalizePeopleCodeSource(snap.sourceText);
    const normDec = normalizePeopleCodeSource(decoded.text);
    const off = firstDiffChar(normOrig, normDec);
    rows.push({
      definitionId: id,
      appClass: isAppClass,
      objectid1: snap.objectid1,
      unmappedOpcodeCount: decoded.unknownOpcodes.length,
      firstUnmappedOpcode: decoded.unknownOpcodes[0]?.opcode,
      diffOffset: off,
      origCtx: off !== undefined ? ctx(normOrig, off) : '',
      decCtx: off !== undefined ? ctx(normDec, off) : ''
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Has unmapped opcodes (genuine decode failure): ${hasUnmapped} / No unmapped opcodes (pure rendering mismatch): ${noUnmapped}`);

  const appClassCount = rows.filter(r => r.appClass).length;
  console.log(`App Class: ${appClassCount} / Ordinary: ${rows.length - appClassCount}`);

  const opcodeHist: Record<string, number> = {};
  for (const r of rows) {
    if (r.firstUnmappedOpcode !== undefined) {
      const key = '0x' + r.firstUnmappedOpcode.toString(16);
      opcodeHist[key] = (opcodeHist[key] ?? 0) + 1;
    }
  }
  console.log('\nFirst unmapped opcode histogram (top 20):');
  for (const [k, v] of Object.entries(opcodeHist).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(' ', k, v);
  }

  console.log('\nSample no-unmapped-opcode rows (pure rendering mismatch, first 15):');
  for (const r of rows.filter(r => r.unmappedOpcodeCount === 0).slice(0, 15)) {
    console.log(' ', r.definitionId, 'appClass=' + r.appClass);
    console.log('   orig:', JSON.stringify(r.origCtx));
    console.log('   dec :', JSON.stringify(r.decCtx));
  }
}

main();
