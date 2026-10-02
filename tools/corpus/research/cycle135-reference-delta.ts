/*
 * Cycle 135: reference-list (PSPCMNAME) deltas of an encoder change
 * (research only).
 *
 *   capture <ids> <out.json>  -- per definition: stored reference keys
 *                                (NAMENUM order, owner row excluded), the
 *                                generated keys, the program's first
 *                                difference and exactness; run once per
 *                                encoder (`RESEARCH_ENCODER_MODULE`).
 *   compare <before.json> <after.json>
 *                             -- per definition: the generated list's edit
 *                                distance to the stored list before / after
 *                                (closer / farther / same / exact), rows
 *                                added and removed by kind, duplicate keys,
 *                                order-only mismatches; the same for the
 *                                program bytes (first difference).
 *
 * <ids>: comma-separated definition ids, or `@file` with one per line.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle135-reference-delta.ts capture 29415,30107 out.json
 *   npx tsx tools/corpus/research/cycle135-reference-delta.ts compare before.json after.json
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, storedReferenceKeys, generatedReferenceKey, referenceKeyKind, PROGRAM_HEADER_LENGTH } from './lib/harnessContext';

type Capture = Record<string, { stored: string[]; generated: string[]; programExact: boolean; firstDiff: number; error?: string }>;

const editDistance = (a: string[], b: string[]): number => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};
const multiset = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'capture') {
  const [idsArg, out] = rest;
  const ids = new Set((idsArg.startsWith('@') ? fs.readFileSync(idsArg.slice(1), 'utf8') : idsArg).split(/[\s,]+/).filter(Boolean).map(Number));
  const ctx = openHarnessContext();
  const capture: Capture = {};
  for (const def of ctx.definitions) {
    if (!ids.has(def.definitionId)) continue;
    const encoded = encodeAsHarness(ctx, def);
    const stored = storedReferenceKeys(def).slice(1);
    if (encoded.artifacts === undefined) { capture[def.definitionId] = { stored, generated: [], programExact: false, firstDiff: -1, error: encoded.error }; continue; }
    const g = encoded.artifacts.program, s = def.storedProgram;
    let d = PROGRAM_HEADER_LENGTH;
    while (d < g.length && d < s.length && g[d] === s[d]) d++;
    capture[def.definitionId] = {
      stored,
      generated: encoded.artifacts.references.filter((r: any) => r.kind !== 'owner').map(generatedReferenceKey),
      programExact: Buffer.compare(g, s) === 0,
      firstDiff: Buffer.compare(g, s) === 0 ? -1 : d
    };
  }
  fs.writeFileSync(out, JSON.stringify(capture));
  console.log(`captured ${Object.keys(capture).length} definitions`);
} else if (mode === 'compare') {
  const before: Capture = JSON.parse(fs.readFileSync(rest[0], 'utf8')), after: Capture = JSON.parse(fs.readFileSync(rest[1], 'utf8'));
  const counts = { refs: { closer: 0, farther: 0, same: 0, exact: 0 }, bytes: { closer: 0, farther: 0, same: 0, exact: 0 } };
  const kinds = new Map<string, number[]>();
  for (const id of Object.keys(after)) {
    const b = before[id], a = after[id];
    const db = editDistance(b.generated, b.stored), da = editDistance(a.generated, a.stored);
    const refs = da === 0 ? 'exact' : da < db ? 'closer' : da > db ? 'farther' : 'same';
    counts.refs[refs]++;
    const bytes = a.programExact ? 'exact' : b.firstDiff < 0 ? 'farther' : a.firstDiff > b.firstDiff ? 'closer' : a.firstDiff < b.firstDiff ? 'farther' : 'same';
    counts.bytes[bytes]++;
    const mb = multiset(b.generated), ma = multiset(a.generated), stored = multiset(a.stored);
    const added: string[] = [], removed: string[] = [];
    for (const [k, n] of ma) for (let i = mb.get(k) ?? 0; i < n; i++) added.push(k);
    for (const [k, n] of mb) for (let i = ma.get(k) ?? 0; i < n; i++) removed.push(k);
    for (const k of added) { const v = kinds.get(referenceKeyKind(k)) ?? [0, 0, 0]; kinds.set(referenceKeyKind(k), v); v[0]++; if ((stored.get(k) ?? 0) >= (ma.get(k) ?? 0)) v[2]++; }
    for (const k of removed) { const v = kinds.get(referenceKeyKind(k)) ?? [0, 0, 0]; kinds.set(referenceKeyKind(k), v); v[1]++; }
    const duplicates = [...ma].filter(([k, n]) => n > (stored.get(k) ?? 0)).map(([k]) => k);
    const orderOnly = da > 0 && [...a.generated].sort().join('|') === [...a.stored].sort().join('|');
    console.log(`${id.padStart(6)} refs ${String(db).padStart(3)} -> ${String(da).padEnd(3)} ${refs.padEnd(7)} bytes ${bytes.padEnd(7)} +[${added.join(' ')}] -[${removed.join(' ')}]${duplicates.length ? ` OVER-STORED ${duplicates.join(' ')}` : ''}${orderOnly ? ' ORDER-ONLY' : ''}`);
  }
  console.log(`\nreference lists: ${JSON.stringify(counts.refs)}; program bytes: ${JSON.stringify(counts.bytes)}`);
  console.log('rows by kind (added / removed / added that the stored list holds):');
  for (const [k, [ad, rm, ok]] of kinds) console.log(`  ${k.padEnd(10)} +${ad} -${rm}  stored-backed ${ok}/${ad}`);
}
