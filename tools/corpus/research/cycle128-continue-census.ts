/*
 * Cycle 128: every 0x6E at an opcode position (research only).
 *
 * A 0x6E the tokenizer reaches as an opcode is either the gated `Continue`
 * (next byte 0x15) or an unmapped opcode. Per program the 0x6E tokens are
 * paired in order with the source's `Continue` keywords (strings,
 * comments, REM statements skipped); per site: previous token, next byte,
 * the source's `Continue` spelling (with / without `;`, what follows on
 * the line), EXACT / non-EXACT by the taxonomy. Programs whose 0x6E count
 * differs from their `Continue` count are listed.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle128-continue-census.ts --taxonomy t.json [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const out = args[2] ? fs.openSync(args[2], 'w') : undefined;

/** Every code `Continue` keyword: what follows it (`;` or the next code text). */
function continues(text: string): string[] {
  const found: string[] = [];
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
    const word = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i, i + 40))?.[0];
    if (word !== undefined) {
      if (/^continue$/i.test(word) && !/[.&%]/.test(text[i - 1] ?? '')) {
        const rest = text.slice(i + word.length).replace(/^[ \t]*/, '');
        found.push(rest.startsWith(';') ? ';' : rest.startsWith('\n') || rest.startsWith('\r') ? '<newline>' : rest.slice(0, 12));
      }
      statementStart = /^(then|else|try|when-other|do)$/i.test(word);
      i += word.length; continue;
    }
    statementStart = c === ';';
    i++;
  }
  return found;
}

const hex = (n: number | undefined) => n === undefined ? '<eof>' : n.toString(16).padStart(2, '0');
const ctx = openHarnessContext();
const next = new Map<string, number[]>(), previous = new Map<string, number[]>(), spelling = new Map<string, number[]>();
const bump = (m: Map<string, number[]>, k: string, exact: boolean) => { const v = m.get(k) ?? [0, 0]; m.set(k, v); v[exact ? 0 : 1]++; };
const mismatched: string[] = [];
let sites = 0, programs = 0, app = 0, unknown = 0;
const exactPrograms: number[] = [];
for (const def of ctx.definitions) {
  let decoded: { text: string; tokens: any[]; unknownOpcodes: any[] };
  try { decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def)) as any; } catch { continue; }
  const sixE = decoded.tokens.map((t, k) => ({ t, k })).filter(({ t }) => t.opcode === 0x6e);
  if (sixE.length === 0) continue;
  programs++;
  if (isApplicationClass(def)) app++;
  const exact = !taxonomy.has(def.definitionId);
  if (exact) exactPrograms.push(def.definitionId);
  const inSource = continues(def.sourceText);
  if (inSource.length !== sixE.length) mismatched.push(`${def.definitionId}${exact ? '' : '*'}(0x6E ${sixE.length} / source Continue ${inSource.length})`);
  sixE.forEach(({ t, k }, n) => {
    sites++;
    const decodedAs = t.kind === 'unknown' ? 'unmapped' : 'Continue';
    if (decodedAs === 'unmapped') unknown++;
    const after = def.storedProgram[t.offset + 1];
    const p = decoded.tokens[k - 1];
    bump(next, `${hex(after)} -> decoded ${decodedAs}`, exact);
    bump(previous, `${hex(p?.opcode)} ${String(p?.text ?? '').slice(0, 12)}`, exact);
    bump(spelling, `next ${hex(after)}: source Continue ${inSource[n] ?? '<unpaired>'}`, exact);
    if (out !== undefined) fs.writeSync(out, JSON.stringify({ id: def.definitionId, app: isApplicationClass(def), exact, offset: t.offset, previous: `${hex(p?.opcode)} ${p?.text ?? ''}`, next: hex(after), decodedAs, source: inSource[n] }) + '\n');
  });
}
console.log(`0x6E at an opcode position: ${sites} in ${programs} programs (App Class ${app}); decoded Continue ${sites - unknown}, unmapped ${unknown}; EXACT programs ${exactPrograms.length}`);
const print = (title: string, m: Map<string, number[]>) => {
  console.log(`\n== ${title}   (EXACT / non-EXACT)`);
  for (const [k, [e, n]] of [...m].sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1])) console.log(`  ${k.padEnd(48)} ${String(e).padStart(4)} / ${n}`);
};
print('next byte', next);
print('previous token', previous);
print('source spelling by next byte', spelling);
console.log(`\nprograms whose 0x6E count differs from their source Continue count (* non-EXACT): ${mismatched.length ? mismatched.join(' ') : 'none'}`);
if (out !== undefined) fs.closeSync(out);
