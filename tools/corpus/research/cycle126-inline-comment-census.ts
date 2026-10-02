/*
 * Cycle 126: what follows an inline comment (0x4E) on its source line?
 * (research only).
 *
 * Every decoded comment token (0x24 / 0x4E / 0x6D) is aligned to the
 * source in order by its text; for each 0x4E the census records what the
 * SOURCE has after the comment on the same line (code -- "same line" --
 * or nothing -- "new line"), whether a space separates them, and what
 * the current decoder renders there (the decoded text is aligned the
 * same way). Grouped by the next token's opcode (and by previous / next
 * pair), split EXACT / non-EXACT by the taxonomy, with the disagreeing
 * sites listed.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle126-inline-comment-census.ts --taxonomy t.json [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const out = args[2] ? fs.openSync(args[2], 'w') : undefined;

const hex = (n: number | undefined) => n === undefined ? '--' : n.toString(16).padStart(2, '0');
const label = (t: any) => t === undefined ? '<end>' : `${hex(t.opcode)}${t.text ? ` ${JSON.stringify(String(t.text).slice(0, 14))}` : ''}`;
const opcodeLabel = (t: any) => t === undefined ? '<end>' : ['01', '0a', '12', '16', '21', '50', '4a', '48'].includes(hex(t.opcode)) ? `${hex(t.opcode)} (operand)` : `${hex(t.opcode)} ${String(t.text ?? '').slice(0, 12)}`;

/** Where each comment token's text sits in `text`, in token order; undefined once alignment is lost. */
function align(text: string, comments: any[]): (number | undefined)[] {
  let cursor = 0;
  return comments.map(c => {
    const at = text.indexOf(c.text, cursor);
    if (at < 0) return undefined;
    cursor = at + c.text.length;
    return at;
  });
}
/** The rest of the line after the comment ending at `end`. */
const restOfLine = (text: string, end: number) => {
  const nl = text.indexOf('\n', end);
  return text.slice(end, nl < 0 ? text.length : nl).replace(/\r$/, '');
};

type Cell = { exactSame: number; exactNew: number; nonSame: number; nonNew: number; disagree: number; examples: Set<string> };
const matrix = new Map<string, Cell>(), pairs = new Map<string, Cell>();
const bump = (m: Map<string, Cell>, key: string, exact: boolean, same: boolean, disagree: boolean, example: string) => {
  const c = m.get(key) ?? { exactSame: 0, exactNew: 0, nonSame: 0, nonNew: 0, disagree: 0, examples: new Set() };
  m.set(key, c);
  c[`${exact ? 'exact' : 'non'}${same ? 'Same' : 'New'}`]++;
  if (disagree) { c.disagree++; if (c.examples.size < 10) c.examples.add(example); }
};

const ctx = openHarnessContext();
let total = 0, programs = 0, app = 0, unaligned = 0, spaced = 0, tight = 0;
for (const def of ctx.definitions) {
  let decoded: { text: string; tokens: any[] };
  try { decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def)); } catch { continue; }
  const tokens = decoded.tokens;
  if (!tokens.some(t => t.opcode === 0x4e)) continue;
  programs++;
  if (isApplicationClass(def)) app++;
  const comments = tokens.filter(t => t.opcode === 0x24 || t.opcode === 0x4e || t.opcode === 0x6d || t.opcode === 0x55);
  const inSource = align(def.sourceText, comments), inDecoded = align(decoded.text, comments);
  const exact = !taxonomy.has(def.definitionId);
  comments.forEach((c, k) => {
    if (c.opcode !== 0x4e) return;
    total++;
    const index = tokens.indexOf(c);
    const previous = tokens[index - 1], next = tokens[index + 1];
    const s = inSource[k], d = inDecoded[k];
    if (s === undefined) { unaligned++; return; }
    const sourceRest = restOfLine(def.sourceText, s + c.text.length);
    const same = sourceRest.trim() !== '';
    if (same) { if (/^\s/.test(sourceRest)) spaced++; else tight++; }
    const decodedSame = d === undefined ? undefined : restOfLine(decoded.text, d + c.text.length).trim() !== '';
    const disagree = decodedSame !== same;
    const example = `${def.definitionId}${disagree ? `(decoder ${decodedSame === undefined ? '?' : decodedSame ? 'same' : 'new'})` : ''}`;
    bump(matrix, opcodeLabel(next), exact, same, disagree, example);
    bump(pairs, `${opcodeLabel(previous)} -> ${opcodeLabel(next)}`, exact, same, disagree, example);
    if (out !== undefined) {
      fs.writeSync(out, JSON.stringify({
        id: def.definitionId, app: isApplicationClass(def), exact, offset: c.offset,
        previous: label(previous), next: label(next), after: label(tokens[index + 2]),
        same, spaced: same ? /^\s/.test(sourceRest) : undefined, decodedSame,
        sourceRest: sourceRest.slice(0, 60), comment: c.text.slice(0, 40)
      }) + '\n');
    }
  });
}

console.log(`0x4E occurrences ${total} in ${programs} programs (App Class ${app}); unaligned ${unaligned}; code after the comment on its line: spaced ${spaced}, tight ${tight}`);
const print = (title: string, m: Map<string, Cell>) => {
  console.log(`\n== ${title}\n  ${'key'.padEnd(40)} EXACT same / new   non same / new   decoder disagrees`);
  for (const [k, c] of [...m].sort((a, b) => (b[1].exactSame + b[1].exactNew + b[1].nonSame + b[1].nonNew) - (a[1].exactSame + a[1].exactNew + a[1].nonSame + a[1].nonNew))) {
    console.log(`  ${k.padEnd(40)} ${String(c.exactSame).padStart(5)} / ${String(c.exactNew).padEnd(5)} ${String(c.nonSame).padStart(5)} / ${String(c.nonNew).padEnd(5)}  ${c.disagree ? `${c.disagree}  ${[...c.examples].join(' ')}` : ''}`);
  }
};
print('next token after 0x4E: source same line / new line', matrix);
print('previous -> next token', pairs);
if (out !== undefined) fs.closeSync(out);
