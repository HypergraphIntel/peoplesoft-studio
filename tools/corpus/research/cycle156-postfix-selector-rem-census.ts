/*
 * Cycle 156: two encode-failure shapes (research only).
 *
 *   1. a direct postfix `(...)` selector after a call result in a chain,
 *      `<root>.member(...)(...)`, by chain root (`&variable`, `%This`,
 *      other `%` system object, bare call): programs that encode / fail.
 *      The parser permits the postfix only after an `&` root or a bare
 *      call (`allowDirectPostfixCall`); stored writes `14 ) 0B ( ... 14 )`
 *      for every root.
 *   2. a REM right after a boolean operator (`And` / `Or` then `rem ...;`)
 *      in stored programs: `<op> 24 <rem>` followed by the next operand,
 *      EXACT / non-EXACT programs.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle156-postfix-selector-rem-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, isApplicationClass, storedNameTable, decodeAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const tally = new Map<string, Set<number>[]>();
const add = (key: string, first: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[first ? 0 : 1].add(id);
};
const ctx = openHarnessContext();
// root, then members / calls, the last step a call `(...)`, then a direct `(`
const ARGS = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
const CALL_CHAIN = new RegExp(String.raw`(&\w+|%\w+|\b[A-Za-z_]\w*(?=\s*\())((?:\s*\.\s*\w+\s*(?:${ARGS})?|\s*${ARGS})*?\s*${ARGS})\s*\(`, 'g');
for (const def of ctx.definitions as any[]) {
  const code = maskNonCode(def.sourceText);
  const roots = new Set<string>();
  for (const m of code.matchAll(CALL_CHAIN)) {
    const root = m[1].startsWith('&') ? '&variable' : /^%This$/i.test(m[1]) ? '%This' : m[1].startsWith('%') ? '% system object' : 'bare call';
    if (root === 'bare call' && !/\./.test(m[0])) continue;
    roots.add(`${root} ${isApplicationClass(def) ? 'App Class' : 'ordinary'}`);
  }
  if (roots.size > 0) {
    const encodes = !encodeAsHarness(ctx, def).error;
    for (const r of roots) add(`1. selector after a call, root ${r}`.padEnd(56) + ' encodes / fails', encodes, def.definitionId);
  }
  if (!/\b(?:And|Or)\s*\n\s*rem\b/i.test(def.sourceText)) continue;
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].opcode !== 0x24 || !/^(And|Or)$/i.test(tokens[i - 1].text ?? '')) continue;
    add(`2. REM after ${tokens[i - 1].text}`.padEnd(56) + ' EXACT / non-EXACT', !taxonomy.has(def.definitionId), def.definitionId);
  }
}
for (const [k, [a, b]] of [...tally].sort()) console.log(`  ${k}  ${String(a.size).padStart(4)} / ${String(b.size).padEnd(3)} ${[...a].slice(0, 4).join(' ')} | ${[...b].slice(0, 9).join(' ')}`);
