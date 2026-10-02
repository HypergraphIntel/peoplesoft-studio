/*
 * Cycle 127: the spacing after `]` (0x4D) (research only).
 *
 * Source and decoded text are lexed the same way (strings, comments and
 * REM statements skipped); the k-th code `]` of each is paired with the
 * k-th stored 0x4D token (programs whose counts differ are skipped and
 * counted). Per site: the next stored token, what follows `]` in the
 * source (next code character class) and whether the source / decoder put
 * a space (or a line break) between them. Matrix by next token, split
 * EXACT / non-EXACT by the taxonomy, with the sites where the decoder
 * disagrees with the source.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle127-index-spacing-census.ts --taxonomy t.json [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const out = args[2] ? fs.openSync(args[2], 'w') : undefined;

/** Every code `]`: the gap after it ('' / ' ' / '\n') and the next code character run. */
function closingBrackets(text: string): { gap: string; next: string }[] {
  const found: { gap: string; next: string }[] = [];
  let i = 0, statementStart = true;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let end = text.indexOf('"', i + 1);
      while (end >= 0 && text[end + 1] === '"') end = text.indexOf('"', end + 2);
      i = end < 0 ? text.length : end + 1; statementStart = false; continue;
    }
    const close = text.startsWith('/*', i) ? '*/' : text.startsWith('<*', i) ? '*>' : text.startsWith('/+', i) ? '+/' : undefined;
    if (close !== undefined) { const end = text.indexOf(close, i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (statementStart && /^rem(ark)?\b/i.test(text.slice(i, i + 7))) { const end = text.indexOf(';', i); i = end < 0 ? text.length : end + 1; continue; }
    if (/\s/.test(c)) { i++; continue; }
    statementStart = c === ';';
    if (c === ']') {
      let j = i + 1;
      while (j < text.length && /[ \t]/.test(text[j])) j++;
      const gap = j === i + 1 ? '' : ' ';
      const lineBreak = /[\r\n]/.test(text[j] ?? '');
      let k = j; while (k < text.length && /\s/.test(text[k])) k++;
      const word = /^[A-Za-z][A-Za-z-]*/.exec(text.slice(k, k + 20))?.[0];
      found.push({ gap: lineBreak ? '\n' : gap, next: word ?? (text.slice(k, k + 2).match(/^(<>|<=|>=)/)?.[0] ?? text[k] ?? '<end>') });
    }
    i++;
  }
  return found;
}

const hex = (n: number) => n.toString(16).padStart(2, '0');
type Cell = { exactTight: number; exactSpaced: number; exactBreak: number; non: [number, number, number]; disagree: number; examples: Set<string> };
const matrix = new Map<string, Cell>();
const ctx = openHarnessContext();
let sites = 0, programs = 0, app = 0, skipped = 0;
for (const def of ctx.definitions) {
  let decoded: { text: string; tokens: any[] };
  try { decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def)); } catch { continue; }
  const stored = decoded.tokens.map((t, k) => ({ t, k })).filter(({ t }) => t.opcode === 0x4d);
  if (stored.length === 0) continue;
  programs++;
  if (isApplicationClass(def)) app++;
  const inSource = closingBrackets(def.sourceText), inDecoded = closingBrackets(decoded.text);
  if (inSource.length !== stored.length || inDecoded.length !== stored.length) { skipped++; continue; }
  const exact = !taxonomy.has(def.definitionId);
  stored.forEach(({ t, k }, n) => {
    sites++;
    const next = decoded.tokens[k + 1];
    const key = next === undefined ? '<end>' : `${hex(next.opcode)} ${next.text ? JSON.stringify(String(next.text).slice(0, 10)) : ''}`.replace(/ "(&|%)[^"]*"| "[^"]*"(?= *$)/, (m: string) => /^ "[&%]/.test(m) ? ' operand' : m);
    const label = `${key.padEnd(18)} src next ${JSON.stringify(inSource[n].next)}`;
    const cell = matrix.get(label) ?? { exactTight: 0, exactSpaced: 0, exactBreak: 0, non: [0, 0, 0], disagree: 0, examples: new Set() };
    matrix.set(label, cell);
    const g = inSource[n].gap, column = g === '' ? 0 : g === ' ' ? 1 : 2;
    if (exact) cell[(['exactTight', 'exactSpaced', 'exactBreak'] as const)[column]]++; else cell.non[column]++;
    if (inDecoded[n].gap !== g) { cell.disagree++; if (cell.examples.size < 10) cell.examples.add(`${def.definitionId}${exact ? '' : '*'}`); }
    if (out !== undefined) {
      fs.writeSync(out, JSON.stringify({ id: def.definitionId, app: isApplicationClass(def), exact, offset: t.offset, previous: decoded.tokens[k - 1] ? hex(decoded.tokens[k - 1].opcode) : '--', next: key, sourceNext: inSource[n].next, sourceGap: g, decodedGap: inDecoded[n].gap }) + '\n');
    }
  });
}
console.log(`0x4D in ${programs} programs (App Class ${app}); ${sites} sites aligned in ${programs - skipped} programs, ${skipped} programs skipped (\`]\` counts differ)`);
console.log(`\n  ${'next stored token / next source code'.padEnd(46)} EXACT tight / spaced / break   non tight / spaced / break   decoder disagrees (* non-EXACT)`);
for (const [k, c] of [...matrix].sort((a, b) => (b[1].exactTight + b[1].exactSpaced + b[1].exactBreak + b[1].non[0] + b[1].non[1] + b[1].non[2]) - (a[1].exactTight + a[1].exactSpaced + a[1].exactBreak + a[1].non[0] + a[1].non[1] + a[1].non[2]))) {
  console.log(`  ${k.padEnd(46)} ${String(c.exactTight).padStart(5)} / ${String(c.exactSpaced).padStart(5)} / ${String(c.exactBreak).padEnd(5)}   ${String(c.non[0]).padStart(4)} / ${String(c.non[1]).padStart(4)} / ${String(c.non[2]).padEnd(4)}   ${c.disagree ? `${c.disagree}  ${[...c.examples].join(' ')}` : ''}`);
}
if (out !== undefined) fs.closeSync(out);
