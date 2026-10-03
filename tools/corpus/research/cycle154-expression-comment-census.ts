/*
 * Cycle 154: comments inside expressions (research only).
 *
 * Decodes every stored program and finds comment tokens (0x4E block /
 * 0x24 REM / 0x55 nested) whose next code token continues an expression --
 * a binary operator, `)`, `,`, `]`, `Then`, `And` / `Or` -- by (comment
 * opcode, previous token class, next token): EXACT / non-EXACT programs.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle154-expression-comment-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, storedNameTable, decodeAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const CONTINUES = /^(=|<>|<|>|<=|>=|\+|-|\*|\/|\||\)|,|\]|Then|And|Or|Not)$/i;
const ctx = openHarnessContext();
for (const def of ctx.definitions as any[]) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const exact = !taxonomy.has(def.definitionId);
  for (let i = 1; i < tokens.length - 1; i++) {
    if (![0x4e, 0x24, 0x55].includes(tokens[i].opcode)) continue;
    let k = i + 1;
    while (k < tokens.length && [0x4e, 0x24, 0x55, 0x4f].includes(tokens[k].opcode)) k++;
    const next = tokens[k]?.text ?? '';
    if (!CONTINUES.test(next)) continue;
    const prev = tokens[i - 1];
    const prevClass = /^(=|<>|<|>|<=|>=|\+|-|\*|\/|\||\(|,|\[|And|Or|Not|If|While|Until|When)$/i.test(prev.text ?? '') ? `after ${prev.text}` : 'after operand';
    add(`${tokens[i].opcode.toString(16)} ${prevClass.padEnd(14)} before ${next}`, exact, def.definitionId);
  }
}
console.log('                                              EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(42)} ${String(e.size).padStart(5)} / ${String(n.size).padEnd(4)} ${[...e].slice(0, 5).join(' ')} | ${[...n].slice(0, 7).join(' ')}`);
