/*
 * Cycle 149: row sharing between quoted (`MenuName."X"`, 0x48) and unquoted
 * (`MenuName.X`, 0x21) spellings of one reference (research only).
 *
 * For every ordinary program with a 0x48 operand, every row identity
 * (KIND.NAME) a quoted operand uses: the stored operands of that identity
 * (0x48 / 0x21, NAMENUM) are aligned in source order with the generated
 * USE events (allocation unit, control group); programs whose occurrence
 * counts differ are reported as unaligned. Per occurrence after the first:
 * its spelling, the spellings already used in the same allocation unit /
 * only in the same control group / only earlier, and whether stored reuses
 * an earlier occurrence's row or opens a new one.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle149-quoted-symbolic-row-census.ts --taxonomy t.json [--verbose]
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedNameTable, storedReferenceKeys, decodeAsHarness, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const verbose = args.includes('--verbose');
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const form = (opcode: number) => (opcode === 0x48 ? 'quoted' : 'unquoted');
const ctx = openHarnessContext();
let unaligned = 0;
for (const def of ctx.definitions as any[]) {
  if (isApplicationClass(def) || !def.storedProgram.includes(0x48)) continue;
  let decoded;
  try { decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def)); } catch { continue; }
  const keys = storedReferenceKeys(def);
  const stored = decoded.tokens.filter((t: any) => (t.opcode === 0x48 || t.opcode === 0x21) && t.nameNum !== undefined);
  const quotedKeys = new Set(stored.filter((t: any) => t.opcode === 0x48).map((t: any) => keys[t.nameNum - 1]));
  if (quotedKeys.size === 0) continue;
  const uses: any[] = [];
  encodeAsHarness(ctx, def, { referenceTrace: (e: any) => { if (e.action === 'USE') uses.push(e); } });
  const exact = !taxonomy.has(def.definitionId);
  for (const key of quotedKeys) {
    const s = stored.filter((t: any) => keys[t.nameNum - 1] === key);
    const g = uses.filter(e => generatedReferenceKey(e.reference) === key);
    if (s.length !== g.length || s.some((t: any, i: number) => (t.opcode === 0x48) !== (g[i].reference.kind === 'quoted-reference'))) {
      unaligned++;
      if (verbose) console.log(`  ${exact ? ' ' : '-'}${def.definitionId} ${key} unaligned: stored ${s.length} generated ${g.length}`);
      continue;
    }
    for (let i = 1; i < s.length; i++) {
      const earlier = s.slice(0, i).map((t: any, j: number) => ({ t, e: g[j] }));
      const inUnit = earlier.filter(x => x.e.allocationUnit === g[i].allocationUnit);
      const inGroup = earlier.filter(x => x.e.controlGroup === g[i].controlGroup && x.e.allocationUnit !== g[i].allocationUnit);
      const spellings = (xs: typeof earlier) => [...new Set(xs.map(x => form(x.t.opcode)))].sort().join('+') || '-';
      const reused = earlier.find(x => x.t.nameNum === s[i].nameNum);
      const outcome = reused === undefined ? 'NEW row' : `reuses ${form(reused.t.opcode)} row${reused.e.allocationUnit === g[i].allocationUnit ? ' (same unit)' : ' (other unit)'}`;
      const bucket = `${key.split('.')[0].padEnd(10)} ${form(s[i].opcode).padEnd(8)} earlier in unit: ${spellings(inUnit).padEnd(15)} in group only: ${spellings(inGroup).padEnd(15)} -> ${outcome}`;
      add(bucket, exact, def.definitionId);
      if (verbose) console.log(`  ${exact ? ' ' : '-'}${def.definitionId} ${key} #${i + 1} unit ${g[i].allocationUnit} group ${g[i].controlGroup}  ${bucket}`);
    }
  }
}
console.log(`unaligned (program, identity) pairs: ${unaligned}`);
console.log('                                                                                                 EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(96)} ${String(e.size).padStart(4)} / ${String(n.size).padEnd(3)} ${[...e].slice(0, 5).join(' ')} | ${[...n].slice(0, 7).join(' ')}`);
