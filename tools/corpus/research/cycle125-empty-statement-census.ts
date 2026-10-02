/*
 * Cycle 125: where does a `;` (0x15) that follows a comment, another `;` or
 * a block header render? (research only).
 *
 *   census (default)  -- byte side: every stored 0x15 whose previous decoded
 *                        token carries NEWLINE_AFTER (the decoder would end
 *                        the line before the `;`), by that token; source
 *                        side: every source `;` whose previous lexeme is a
 *                        comment / REM statement / `;` / Then / Else / try /
 *                        When-Other / doc comment, by whether a line break
 *                        separates them. Both split EXACT / non-EXACT by the
 *                        taxonomy.
 *   --sweep <out>     -- per definition: decoded-text sha1, normalized source
 *                        match, harness roundtrip exact (validator TEST B);
 *                        run once per decoder (`RESEARCH_DECODER_MODULE`).
 *   --compare a b     -- definitions whose decoded text changed, and those
 *                        whose source match / roundtrip moved.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle125-empty-statement-census.ts --taxonomy t.json
 *   npx tsx tools/corpus/research/cycle125-empty-statement-census.ts --sweep out.json
 *   npx tsx tools/corpus/research/cycle125-empty-statement-census.ts --compare a.json b.json
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, roundtripAsHarness } from './lib/harnessContext';
import { FMT as F } from '../../../src/peoplecode/format';
import { sourcesMatch } from '../../../src/peoplecode/corpus/sourceNormalize';

const args = process.argv.slice(2);

if (args[0] === '--compare') {
  const a = JSON.parse(fs.readFileSync(args[1], 'utf8')), b = JSON.parse(fs.readFileSync(args[2], 'utf8'));
  const ids = Object.keys(a);
  const ok = (v: any[]) => v[1] && v[2];
  const changed = ids.filter(k => a[k][0] !== b[k][0]);
  const gained = ids.filter(k => !ok(a[k]) && ok(b[k])), lost = ids.filter(k => ok(a[k]) && !ok(b[k]));
  const roundtripLost = ids.filter(k => a[k][2] && !b[k][2]), matchLost = ids.filter(k => a[k][1] && !b[k][1]);
  console.log(`definitions ${ids.length}; decoded text changed ${changed.length}; source+roundtrip gained ${gained.length} lost ${lost.length}; roundtrip lost ${roundtripLost.length}; source match lost ${matchLost.length}`);
  for (const [label, list] of [['gained', gained], ['lost', lost], ['roundtrip lost', roundtripLost], ['source match lost', matchLost]] as const) {
    if (list.length) console.log(`  ${label}: ${list.slice(0, 80).join(' ')}`);
  }
  process.exit(0);
}

const ctx = openHarnessContext();
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

if (args[0] === '--sweep') {
  const sweep: Record<number, [string, boolean, boolean]> = {};
  for (const def of ctx.definitions) {
    const roundtrip = roundtripAsHarness(ctx, def);
    sweep[def.definitionId] = roundtrip.decodedText === undefined
      ? ['ERR', false, false]
      : [sha1(roundtrip.decodedText), sourcesMatch(def.sourceText, roundtrip.decodedText), roundtrip.exact];
  }
  fs.writeFileSync(args[1], JSON.stringify(sweep));
  const values = Object.values(sweep);
  console.log(`${values.length} definitions; source match ${values.filter(v => v[1]).length}; roundtrip exact ${values.filter(v => v[2]).length}; both ${values.filter(v => v[1] && v[2]).length}`);
  process.exit(0);
}

const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
type Tally = { exact: number; non: number; exactIds: number[]; nonIds: number[] };
const tally = (m: Map<string, Tally>, key: string, id: number) => {
  const e = m.get(key) ?? { exact: 0, non: 0, exactIds: [], nonIds: [] };
  m.set(key, e);
  const [count, list] = taxonomy.has(id) ? ['non', e.nonIds] as const : ['exact', e.exactIds] as const;
  e[count]++;
  if (list.length < 10 && !list.includes(id)) list.push(id);
};
const print = (title: string, m: Map<string, Tally>) => {
  console.log(`\n== ${title}`);
  for (const [k, e] of [...m].sort((x, y) => y[1].exact + y[1].non - x[1].exact - x[1].non)) {
    console.log(`  ${k.padEnd(34)} EXACT ${String(e.exact).padStart(5)}  non ${String(e.non).padStart(4)}  e.g. ${e.exactIds.slice(0, 4).join(' ')} | ${e.nonIds.join(' ')}`);
  }
};

const byteSide = new Map<string, Tally>(), sourceSide = new Map<string, Tally>();
const HEADERS = /^(then|else|try|when-other)$/i;
for (const def of ctx.definitions) {
  const id = def.definitionId;
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { tokens = []; }
  tokens.forEach((t, k) => {
    const p = tokens[k - 1];
    if (t.opcode !== 0x15 || p === undefined || !(p.format & F.NEWLINE_AFTER)) return;
    const what = p.opcode === 0x24 ? (/^rem/i.test(p.text) ? 'REM statement' : 'standalone comment') : p.opcode === 0x6d ? 'doc comment' : p.opcode === 0x4e ? 'inline comment' : String(p.text || ';');
    tally(byteSide, `${p.opcode.toString(16).padStart(2, '0')} ${what}`, id);
  });

  // source lexemes: strings, comments, REM statements, `;`, words
  const s = def.sourceText;
  let previous = '', gap = '', i = 0, statementStart = true;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { gap += c; i++; continue; }
    let lexeme: string, end: number;
    if (c === '"') {
      end = s.indexOf('"', i + 1);
      while (end >= 0 && s[end + 1] === '"') end = s.indexOf('"', end + 2);
      end = end < 0 ? s.length : end + 1; lexeme = 'string';
    } else if (s.startsWith('/*', i) || s.startsWith('<*', i) || s.startsWith('/+', i)) {
      const close = s.startsWith('/*', i) ? '*/' : s.startsWith('<*', i) ? '*>' : '+/';
      end = s.indexOf(close, i + 2); end = end < 0 ? s.length : end + 2;
      lexeme = close === '+/' ? 'doc comment' : 'comment';
    } else if (statementStart && /^rem(ark)?\b/i.test(s.slice(i, i + 7))) {
      end = s.indexOf(';', i); end = end < 0 ? s.length : end + 1; lexeme = 'REM statement';
    } else if (c === ';') {
      end = i + 1; lexeme = ';';
    } else if (/[A-Za-z_%&#]/.test(c)) {
      const word = /^[A-Za-z0-9_%&#$-]+/.exec(s.slice(i, i + 80))![0].replace(/^((?!when-other|end-)[^-]*)-.*$/i, '$1');
      end = i + word.length; lexeme = HEADERS.test(word) ? word.toLowerCase() : 'word';
    } else { end = i + 1; lexeme = 'punctuation'; }
    if (lexeme === ';' && (HEADERS.test(previous) || ['comment', 'doc comment', 'REM statement', ';'].includes(previous))) {
      tally(sourceSide, `${previous} ${gap.includes('\n') ? '<newline>' : '<same line>'} ;`, id);
    }
    statementStart = lexeme === ';' || HEADERS.test(lexeme) || lexeme === 'REM statement' || (statementStart && lexeme.endsWith('comment'));
    previous = lexeme; gap = ''; i = end;
  }
}
print('byte side: stored 0x15 after a NEWLINE_AFTER token', byteSide);
print('source side: `;` after a comment / REM / `;` / header keyword', sourceSide);
