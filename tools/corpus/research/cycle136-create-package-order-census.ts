/*
 * Cycle 136: where a `create <Class>(...)`'s PACKAGE dependency row sits
 * relative to the reference rows its arguments first use (research only).
 *
 * For every stored `create` (0x69) the class leaf is the last name of its
 * path; the PACKAGE.<LEAF> row is looked up in the stored PSPCMNAME list.
 * The reference operands (0x21 / 0x4A / 0x48) inside the argument list
 * whose NAMENUM is used for the first time in the program are "new rows
 * of the arguments". The create is classed by whether its PACKAGE row
 * comes after all of them, before all of them, or between, and whether
 * the PACKAGE row was already allocated before the create (then
 * the create allocates nothing): the PACKAGE row precedes a row first used
 * before the create's statement. EXACT / non-EXACT by the taxonomy.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle136-create-package-order-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Map<number, string>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => [r.definitionId, r.primaryCategory]) : []);
const OPERANDS = new Set([0x21, 0x4a, 0x48]);
const tally = new Map<string, number[]>();
const examples = new Map<string, Set<number>>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  if (!tokens.some(t => t.opcode === 0x69)) continue;
  const keys = storedReferenceKeys(def); // NAMENUM order, index 0 = NAMENUM 1
  const firstUse = new Map<number, number>();
  tokens.forEach((t, k) => { if (OPERANDS.has(t.opcode) && t.nameNum !== undefined && !firstUse.has(t.nameNum)) firstUse.set(t.nameNum, k); });
  const category = taxonomy.get(def.definitionId);
  tokens.forEach((t, k) => {
    if (t.opcode !== 0x69) return;
    let j = k + 1, leaf: string | undefined;
    while (j < tokens.length && (tokens[j].opcode === 0x0a || tokens[j].opcode === 0x57)) { if (tokens[j].opcode === 0x0a) leaf = tokens[j].text; j++; }
    if (leaf === undefined || tokens[j]?.opcode !== 0x0b) return;
    let depth = 0, end = j;
    for (; end < tokens.length; end++) {
      if (tokens[end].opcode === 0x0b) depth++;
      else if (tokens[end].opcode === 0x14 && --depth === 0) break;
    }
    const packageNameNum = keys.findIndex(key => key === `PACKAGE.${String(leaf).toUpperCase()}`) + 1;
    const newRows = tokens.slice(j, end).filter((x, i) => OPERANDS.has(x.opcode) && x.nameNum !== undefined && firstUse.get(x.nameNum) === j + i).map(x => x.nameNum as number);
    if (newRows.length === 0) return;
    // statement start: back to the previous `;` / line marker / header
    let start = k; while (start > 0 && ![0x15, 0x2d, 0x4f, 0x1f, 0x19].includes(tokens[start - 1].opcode)) start--;
    const usedBefore = packageNameNum > 0 && [...firstUse].some(([n, at]) => at < start && n > packageNameNum);
    const position = packageNameNum === 0 ? 'no PACKAGE row'
      : newRows.every(n => n < packageNameNum) ? 'PACKAGE after the arguments\' new rows'
        : newRows.every(n => n > packageNameNum) ? 'PACKAGE before the arguments\' new rows'
          : 'PACKAGE between them';
    const key = `${isApplicationClass(def) ? 'App Class' : 'ordinary '} ${position}${usedBefore ? ' [PACKAGE allocated before the statement]' : ' [PACKAGE first allocated here]'}`;
    const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[category === undefined ? 0 : 1]++;
    const e = examples.get(key) ?? new Set(); examples.set(key, e); if (e.size < 12) e.add(category === undefined ? def.definitionId : -def.definitionId);
  });
}
console.log('create sites whose arguments use a reference row for the first time   (EXACT / non-EXACT; negative = non-EXACT)');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(70)} ${String(e).padStart(5)} / ${String(n).padEnd(4)} ${[...(examples.get(k) ?? [])].join(' ')}`);
