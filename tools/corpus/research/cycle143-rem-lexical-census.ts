/*
 * Cycle 143: the lexical boundary of a REM comment (research only).
 *
 * Every source `rem` that starts a token (not preceded by an identifier
 * character, outside block / disabled-code comments and strings) is
 * classified by the character after it (space, tab, a punctuation
 * character, a letter / digit, end of line) and by context (ordinary;
 * App Class class header or elsewhere). Its stored outcome: a 0x24
 * comment whose text is the source span `rem...;` (matched as a multiset
 * per program), a name token (an identifier such as `RemoveRow`), or not
 * found. EXACT / non-EXACT by the taxonomy, with the case variants.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle143-rem-lexical-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const delimiter = (c: string | undefined): string =>
  c === undefined ? 'EOF' : c === '\n' || c === '\r' ? 'EOL' : c === ' ' ? 'space' : c === '\t' ? 'tab'
    : /[A-Za-z]/.test(c) ? 'letter' : /[0-9]/.test(c) ? 'digit' : c;
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

const tally = new Map<string, number[]>();
const examples = new Map<string, string[]>();
const variants = new Map<string, number>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = (decodeAsHarness(def, def.storedProgram, storedNameTable(def)) as any).tokens; } catch { continue; }
  const app = isApplicationClass(def);
  const exact = !taxonomy.has(def.definitionId);
  const remComments = new Map<string, number>();
  for (const t of tokens) {
    if (t.opcode === 0x24 && /^rem/i.test(String(t.text))) {
      const key = normalize(String(t.text));
      remComments.set(key, (remComments.get(key) ?? 0) + 1);
    }
  }
  const names = tokens.filter(t => t.opcode !== 0x24 && /^rem/i.test(String(t.text ?? ''))).map(t => String(t.text).toLowerCase());
  const source = def.sourceText;
  const masked = source.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|"[^"\n]*"/g, m => m.replace(/[^\n]/g, ' '));
  const headerStart = app ? masked.search(/^\s*class\s/im) : -1;
  const headerEnd = app ? masked.search(/^\s*end-class/im) : -1;
  for (const m of masked.matchAll(/(?<![A-Za-z0-9_&%#$.])rem/gi)) {
    const at = m.index!;
    const after = delimiter(source[at + 3]);
    const semicolon = source.indexOf(';', at);
    const text = normalize(source.slice(at, semicolon < 0 ? source.length : semicolon + 1));
    let outcome = 'not found';
    if ((remComments.get(text) ?? 0) > 0) {
      outcome = '0x24 comment';
      remComments.set(text, remComments.get(text)! - 1);
    } else if (/letter|digit|_/.test(after) && names.some(n => n.startsWith(source.slice(at, at + 4).toLowerCase()))) {
      outcome = 'name token';
    }
    const where = !app ? 'ordinary  ' : at > headerStart && at < headerEnd ? 'App header' : 'App other ';
    const key = `${where} rem + ${after.padEnd(6)} -> ${outcome}`;
    const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[exact ? 0 : 1]++;
    const e = examples.get(key) ?? []; examples.set(key, e);
    if (e.length < 4) e.push(`${exact ? '' : '-'}${def.definitionId}:${JSON.stringify(source.slice(at, at + 14))}`);
    variants.set(source.slice(at, at + 3), (variants.get(source.slice(at, at + 3)) ?? 0) + 1);
  }
}
console.log('case variants', Object.fromEntries(variants));
console.log('source `rem` at a token start                      EXACT / non-EXACT');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(48)} ${String(e).padStart(6)} / ${String(n).padEnd(5)} ${(examples.get(k) ?? []).join(' ')}`);
