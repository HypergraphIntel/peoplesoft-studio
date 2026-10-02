/*
 * Cycle 132: Application Class type descriptors in the trailer (research
 * only).
 *
 * A trailer record's return kind (int32 at +12) and a declaration's
 * parameter slots hold type descriptors; an Application Class type is
 * 0x80000 + (0x100 + charOffset), charOffset = the class name's character
 * offset in the trailer's name run (decoder.ts decodeReturnType). For every
 * such stored descriptor: whether 0x100 + charOffset lands on a name in the
 * run (and `0x100 | charOffset` would too), by charOffset range and bit 8,
 * split EXACT / non-EXACT, and what the encoder generates for it when the
 * program's trailer has the same length.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle132-trailer-type-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);

const tally = new Map<string, number[]>();
const bump = (k: string, exact: boolean) => { const v = tally.get(k) ?? [0, 0]; tally.set(k, v); v[exact ? 0 : 1]++; };
const programs = new Map<string, Set<number>>();
const note = (k: string, id: number) => { const s = programs.get(k) ?? new Set(); programs.set(k, s); s.add(id); };
const ctx = openHarnessContext();
let descriptors = 0;
for (const def of ctx.definitions) {
  const s: Buffer = def.storedProgram;
  const separator = 36 + s.readUInt32LE(5);
  const runStart = separator + 1, nameBytes = s.readUInt32LE(13), records = s.readUInt32LE(29);
  if (records === 0) continue;
  const tableStart = runStart + nameBytes, slotsStart = tableStart + records * 16;
  if (slotsStart > s.length) continue;
  const names = new Set<number>();
  for (let i = runStart; i < tableStart;) {
    let j = i; while (j + 1 < tableStart && !(s[j] === 0 && s[j + 1] === 0)) j += 2;
    names.add((i - runStart) / 2); i = j + 2;
  }
  const exact = !taxonomy.has(def.definitionId);
  let generated: Buffer | undefined;
  const fields: number[] = [];
  for (let r = 0; r < records; r++) fields.push(tableStart + r * 16 + 12);
  for (let o = slotsStart; o + 4 <= s.length; o += 4) fields.push(o);
  for (const o of fields) {
    const value = s.readUInt32LE(o) & ~0xc0000000 & ~0x80000000;
    if ((value & 0x80000) === 0) continue;
    const sub = value & ~0x80000 & 0xfffff;
    if (sub < 0x100) continue;
    descriptors++;
    const charOffset = sub - 0x100;
    const kind = `${o < slotsStart ? 'record return' : 'parameter slot'}; charOffset ${charOffset < 256 ? '< 256' : charOffset < 512 ? '256-511' : charOffset < 768 ? '512-767' : '>= 768'}`;
    const landsAdd = names.has(charOffset);
    const orValue = 0x100 | charOffset, landsOr = (orValue - 0x100) === charOffset;
    if (generated === undefined && !exact) generated = encodeAsHarness(ctx, def).artifacts?.program ?? Buffer.alloc(0);
    const generatedMatches = exact || (generated !== undefined && generated.length === s.length && generated.readUInt32LE(o) === s.readUInt32LE(o));
    const key = `${isApplicationClass(def) ? 'App Class' : 'ordinary'} ${kind}; 0x100 + offset ${landsAdd ? 'names a class' : 'NOT a name'}; 0x100 | offset ${landsOr ? 'same' : 'differs'}; generated ${generatedMatches ? 'same' : 'DIFFERS'}`;
    bump(key, exact);
    if (!generatedMatches) note(key, def.definitionId);
  }
}
console.log(`Application Class type descriptors in trailers: ${descriptors}   (EXACT / non-EXACT)`);
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(110)} ${String(e).padStart(5)} / ${n}${programs.has(k) ? `   ${[...programs.get(k)!].join(' ')}` : ''}`);
