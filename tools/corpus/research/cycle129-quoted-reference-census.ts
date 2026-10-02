/*
 * Cycle 129: opcode 0x48 quoted qualified references (research only).
 *
 * Byte side: every 0x48 the tokenizer reaches as an opcode -- its NAMENUM
 * (little-endian index + 1), the raw PSPCMNAME row (RECNAME / REFNAME,
 * shape blank / nonblank), and what the decoder made of it (the rendered
 * reference, or unmapped). Source side: every code `Qualifier."name"`
 * (strings, comments, REM skipped) by qualifier and whether the name is
 * empty; per program the 0x48 count is compared with the quoted-reference
 * count. Split EXACT / non-EXACT by the taxonomy.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle129-quoted-reference-census.ts --taxonomy t.json [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const out = args[2] ? fs.openSync(args[2], 'w') : undefined;

/** Every code `Qualifier."name"`: qualifier and name. */
function quotedReferences(text: string): { qualifier: string; name: string }[] {
  const found: { qualifier: string; name: string }[] = [];
  let i = 0, statementStart = true;
  while (i < text.length) {
    const c = text[i];
    const close = text.startsWith('/*', i) ? '*/' : text.startsWith('<*', i) ? '*>' : text.startsWith('/+', i) ? '+/' : undefined;
    if (close !== undefined) { const end = text.indexOf(close, i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (statementStart && /^rem(ark)?\b/i.test(text.slice(i, i + 7))) { const end = text.indexOf(';', i); i = end < 0 ? text.length : end + 1; continue; }
    if (c === '"') {
      let end = text.indexOf('"', i + 1);
      while (end >= 0 && text[end + 1] === '"') end = text.indexOf('"', end + 2);
      end = end < 0 ? text.length : end + 1;
      const before = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(text.slice(Math.max(0, i - 40), i));
      if (before !== null) found.push({ qualifier: before[1].toUpperCase(), name: text.slice(i + 1, end - 1) });
      i = end; statementStart = false; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    statementStart = c === ';';
    i++;
  }
  return found;
}

const tally = new Map<string, number[]>();
const bump = (k: string, exact: boolean) => { const v = tally.get(k) ?? [0, 0]; tally.set(k, v); v[exact ? 0 : 1]++; };
const ctx = openHarnessContext();
let sites = 0, programs = 0, app = 0, exactPrograms = 0;
const countMismatch: string[] = [], sourceOnlyEmpty: string[] = [];
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const exact = !taxonomy.has(def.definitionId);
  const quoted = quotedReferences(def.sourceText);
  const sites48 = tokens.filter(t => t.opcode === 0x48);
  for (const q of quoted.filter(q => q.name === '')) bump(`source ${q.qualifier}."" (program has ${sites48.length ? '' : 'no '}0x48)`, exact);
  if (sites48.length === 0) {
    if (quoted.some(q => q.name === '')) sourceOnlyEmpty.push(String(def.definitionId));
    continue;
  }
  programs++;
  if (isApplicationClass(def)) app++;
  if (exact) exactPrograms++;
  if (quoted.length !== sites48.length) countMismatch.push(`${def.definitionId}${exact ? '' : '*'}(0x48 ${sites48.length} / quoted ${quoted.length})`);
  const rows = new Map<number, any>((def as any).names.map((r: any) => [Number(r.namenum), r]));
  for (const t of sites48) {
    sites++;
    const nameNum = (def.storedProgram[t.offset + 1] | (def.storedProgram[t.offset + 2] << 8)) + 1;
    const row = rows.get(nameNum);
    const rec = String(row?.recname ?? '').trim(), ref = String(row?.refname ?? '').trim();
    const shape = row === undefined ? 'no row' : `${rec ? 'qualifier' : 'blank qualifier'} / ${ref ? 'name' : 'blank name'}`;
    const decoded = t.kind === 'unknown' ? 'unmapped' : 'rendered';
    bump(`shape ${shape}: ${decoded}`, exact);
    bump(`qualifier ${rec || '<blank>'}${ref ? '' : ' (blank name)'}: ${decoded}`, exact);
    if (out !== undefined) fs.writeSync(out, JSON.stringify({ id: def.definitionId, app: isApplicationClass(def), exact, offset: t.offset, nameNum, recname: rec, refname: ref, decoded: t.kind === 'unknown' ? null : t.text }) + '\n');
  }
}
console.log(`0x48 at an opcode position: ${sites} in ${programs} programs (App Class ${app}; EXACT ${exactPrograms})`);
console.log('\n  (EXACT / non-EXACT)');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(60)} ${String(e).padStart(4)} / ${n}`);
console.log(`\nprograms whose 0x48 count differs from their source Qualifier."name" count (* non-EXACT): ${countMismatch.length ? countMismatch.slice(0, 40).join(' ') : 'none'}${countMismatch.length > 40 ? ' ...' : ''} [${countMismatch.length}]`);
console.log(`programs with a source Qualifier."" and no 0x48: ${sourceOnlyEmpty.length ? sourceOnlyEmpty.join(' ') : 'none'}`);
if (out !== undefined) fs.closeSync(out);
