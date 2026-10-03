/*
 * Cycle 148: one name spelled both quoted (`MenuName."X"`, a 0x48 row,
 * deduplicated per control group) and unquoted (`MenuName.X`, an ordinary
 * symbolic row) in one program (research only).
 *
 * Per program and name: which spelling comes first, and the stored against
 * the generated row count of the name. `--verbose` prints every site. The
 * ordinary BARNAME/MENUNAME pair (23684, 23724) is one such name: stored
 * shares one row where the generated list allocates one per spelling.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle148-quoted-unquoted-reference-census.ts --taxonomy t.json [--verbose]
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const verbose = args.includes('--verbose');
const QUALIFIERS = 'MenuName|BarName|ItemName|Page|Panel|PanelGroup|Component|Operation|BusProcess|BusActivity|BusEvent';
const tally = new Map<string, number[][]>();
const ctx = openHarnessContext();
const push = (map: Map<string, number[]>, key: string, at: number) => (map.get(key) ?? map.set(key, []).get(key)!).push(at);
for (const def of ctx.definitions) {
  if (!new RegExp(`\\b(${QUALIFIERS})\\s*\\.\\s*"`, 'i').test(def.sourceText)) continue;
  const masked = maskNonCode(def.sourceText);
  const quoted = new Map<string, number[]>(), unquoted = new Map<string, number[]>();
  for (const m of def.sourceText.matchAll(new RegExp(`\\b(${QUALIFIERS})\\s*\\.\\s*"([A-Za-z_][A-Za-z0-9_]*)"`, 'gi'))) {
    if (masked[m.index!] !== ' ') push(quoted, `${m[1]}.${m[2]}`.toUpperCase(), m.index!);
  }
  for (const m of masked.matchAll(new RegExp(`\\b(${QUALIFIERS})\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)\\b`, 'gi'))) {
    push(unquoted, `${m[1]}.${m[2]}`.toUpperCase(), m.index!);
  }
  const both = [...quoted.keys()].filter(k => unquoted.has(k));
  if (both.length === 0) continue;
  const stored = storedReferenceKeys(def);
  const generated = (encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey);
  for (const key of both) {
    const first = Math.min(...quoted.get(key)!) < Math.min(...unquoted.get(key)!) ? 'quoted first' : 'unquoted first';
    const s = stored.filter(k => k === key).length, g = generated.filter(k => k === key).length;
    const bucket = `${first.padEnd(15)} stored ${s} ${s === g ? '=' : s < g ? '<' : '>'} generated ${g}`;
    const v = tally.get(bucket) ?? [[], []]; tally.set(bucket, v);
    v[taxonomy.has(def.definitionId) ? 1 : 0].push(def.definitionId);
    if (verbose) console.log(`  ${taxonomy.has(def.definitionId) ? '-' : ' '}${def.definitionId} ${key} quoted ${quoted.get(key)!.length} unquoted ${unquoted.get(key)!.length}  ${bucket}`);
  }
}
console.log('                                              EXACT / non-EXACT sites');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(44)} ${String(e.length).padStart(3)} / ${String(n.length).padEnd(3)} ${[...new Set(e)].slice(0, 6).join(' ')} | ${[...new Set(n)].slice(0, 8).join(' ')}`);
