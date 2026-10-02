/*
 * Cycle 133: inline comment (0x4E) vs statement terminator (0x15) order
 * (research only).
 *
 * Every stored adjacent `4E 15` and `15 4E` token pair, the comment aligned
 * to the source by its text (in order). Source position: is the next code
 * character after the comment a `;` (comment before its statement's
 * semicolon), or is the code character before the comment a `;` (comment
 * after an already terminated statement)? Matrix by order x position x
 * program kind x EXACT; the predictor "comment before `;` -> 4E 15, after
 * -> 15 4E" is scored. Class-header member declarations (`property`,
 * `instance`, `method` / `get` / `set` signature, `Constant` before
 * `end-class`) are marked: the App Class wrapper emits them itself.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle133-comment-terminator-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);

const tally = new Map<string, number[]>();
const examples = new Map<string, Set<number>>();
const bump = (k: string, exact: boolean, id: number) => {
  const v = tally.get(k) ?? [0, 0]; tally.set(k, v); v[exact ? 0 : 1]++;
  if (!exact) { const e = examples.get(k) ?? new Set(); examples.set(k, e); if (e.size < 10) e.add(id); }
};
const ctx = openHarnessContext();
let pairs = 0;
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  if (!tokens.some((t, k) => t.opcode === 0x4e && (tokens[k + 1]?.opcode === 0x15 || tokens[k - 1]?.opcode === 0x15))) continue;
  const exact = !taxonomy.has(def.definitionId);
  const app = isApplicationClass(def);
  const s = def.sourceText;
  const headerEnd = app ? s.search(/\bend-(class|interface)\b/i) : -1;
  let cursor = 0;
  tokens.forEach((t, k) => {
    if (t.opcode !== 0x24 && t.opcode !== 0x4e) return;
    const at = s.indexOf(t.text, cursor);
    if (at < 0) return;
    cursor = at + t.text.length;
    if (t.opcode !== 0x4e) return;
    const order = tokens[k + 1]?.opcode === 0x15 ? '4E 15' : tokens[k - 1]?.opcode === 0x15 ? '15 4E' : undefined;
    if (order === undefined) return;
    pairs++;
    const after = s.slice(cursor).match(/^\s*(\S)/)?.[1];
    const before = s.slice(0, at).match(/(\S)\s*$/)?.[1];
    const position = after === ';' ? 'comment before `;`' : before === ';' ? 'comment after `;`' : 'other';
    const where = app ? (at < headerEnd ? 'App Class header' : 'App Class body') : 'ordinary';
    bump(`${order}  ${position.padEnd(20)} ${where}`, exact, def.definitionId);
  });
}
console.log(`stored 0x4E adjacent to 0x15: ${pairs}   (EXACT / non-EXACT)`);
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(56)} ${String(e).padStart(5)} / ${String(n).padEnd(4)} ${examples.has(k) ? [...examples.get(k)!].join(' ') : ''}`);
