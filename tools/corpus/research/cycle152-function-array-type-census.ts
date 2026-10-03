/*
 * Cycle 152: built-in `array of <type>` Function header types (research
 * only).
 *
 * Every ordinary Function header parameter `As array of <type>` and return
 * `Returns array of <type>` whose element is a built-in (not a class), by
 * element type, header position (first Function / later), and whether the
 * same header also has the other form or a second array-of-same-type
 * parameter. Programs are marked EXACT / non-EXACT against the taxonomy.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle152-function-array-type-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (isApplicationClass(def)) continue;
  const code = maskNonCode(def.sourceText);
  const exact = !taxonomy.has(def.definitionId);
  let ordinal = 0;
  for (const m of code.matchAll(/^\s*Function\s+\w+\s*(?:\(([^)]*)\))?([^\n]*)/gim)) {
    ordinal++;
    const position = ordinal === 1 ? 'first Function' : 'later Function';
    const params = (m[1] ?? '').split(',').map(p => /\bAs\s+array\s+of\s+(?:array\s+of\s+)*([A-Za-z_]\w*)\s*$/i.exec(p)?.[1]).filter((t): t is string => t !== undefined);
    const ret = /\bReturns\s+array\s+of\s+(?:array\s+of\s+)*([A-Za-z_]\w*)\b(?!\s*:)/i.exec(m[2] ?? '')?.[1];
    for (const t of new Set(params)) {
      const n = params.filter(x => x.toLowerCase() === t.toLowerCase()).length;
      add(`param  As array of ${t.padEnd(10)} ${position}  ${n > 1 ? `${n} such params` : '1 param      '} ${ret?.toLowerCase() === t.toLowerCase() ? '+ same Returns' : ''}`, exact, def.definitionId);
    }
    if (ret !== undefined && !params.some(t => t.toLowerCase() === ret.toLowerCase())) add(`return Returns array of ${ret.padEnd(10)} ${position}`, exact, def.definitionId);
  }
}
console.log('                                                                   EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(66)} ${String(e.size).padStart(4)} / ${String(n.size).padEnd(3)} ${[...e].slice(0, 6).join(' ')} | ${[...n].slice(0, 6).join(' ')}`);
