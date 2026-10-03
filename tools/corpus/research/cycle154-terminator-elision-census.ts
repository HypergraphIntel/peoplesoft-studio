/*
 * Cycle 154: statements stored without a terminator before a block closer
 * (research only).
 *
 * Decodes every stored program and finds each block keyword (End-If, Else,
 * End-For, End-While, Until, When-Other, End-Evaluate, catch, end-try,
 * End-Function, end-method, and a When that follows a branch body) whose
 * preceding code token (comments / blank-line markers skipped) is not a
 * `;` (0x15), a header boundary (0x2D) or a header keyword. Per (preceding
 * statement kind, closer): EXACT / non-EXACT programs.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle154-terminator-elision-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, storedNameTable, decodeAsHarness, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const CLOSERS = /^(End-If|Else|End-For|End-While|Until|When|When-Other|End-Evaluate|catch|end-try|End-Function|end-method|End-Get|End-Set)$/i;
const ctx = openHarnessContext();
for (const def of ctx.definitions as any[]) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const exact = !taxonomy.has(def.definitionId);
  let evaluateSubject = false;
  for (let i = 1; i < tokens.length; i++) {
    const text = tokens[i].text ?? '';
    if (/^Evaluate$/i.test(text)) evaluateSubject = true;
    if (!CLOSERS.test(text)) continue;
    if (/^When$/i.test(text) && evaluateSubject) { evaluateSubject = false; continue; } // first When after the subject
    let k = i - 1;
    while (k > 0 && [0x4e, 0x4f, 0x24, 0x55].includes(tokens[k].opcode)) k--;
    const prev = tokens[k];
    if (prev.opcode === 0x15 || prev.opcode === 0x2d || prev.opcode === 0x1f) continue;
    if (/^(Then|Else|Do|try|Of|When-Other|Repeat)$/i.test(prev.text ?? '')) continue;
    const kind = /^(Return|Break|Continue|Exit|End-If|End-For|End-While|End-Evaluate|end-try|Until)$/i.test(prev.text ?? '')
      ? (prev.text as string)
      : prev.opcode === 0x14 ? 'call / ) end' : 'expression end';
    add(`${kind.padEnd(14)} -> ${text}`, exact, def.definitionId);
  }
}
console.log('                                        EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(36)} ${String(e.size).padStart(5)} / ${String(n.size).padEnd(4)} ${[...e].slice(0, 5).join(' ')} | ${[...n].slice(0, 7).join(' ')}`);
