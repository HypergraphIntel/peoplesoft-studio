/*
 * Cycle 165: App Class reference-row lifetime -- the Cycle 138 duplicate
 * family (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   format   App Class stored lists by store format (PACKAGEROOT filled /
 *            blank, APPCLASSMETHOD column used / blank), repeated PACKAGE
 *            identities and top-level directives;
 *   methods  every class whose name occurs in two or more method bodies:
 *            stored rows of the class (1, fewer than the methods, at least
 *            one per method), by store format;
 *   paren    parenthesized typed chains `(&x.M(...)).Next...`.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle165-lifetime-census.ts --taxonomy t.json [--section <name>]
 */
import fs from 'node:fs';

import { maskNonCode, parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const sectionArg = args.indexOf('--section');
const only = sectionArg >= 0 ? args[sectionArg + 1] : undefined;
const run = (name: string) => only === undefined || only === name;
const ctx = openHarnessContext();
let section = '';
const tally = new Map<string, Set<number>[]>();
const add = (label: string, id: number) => {
  const key = `${section}\u0000${label}`;
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[nonexact.has(id) ? 1 : 0].add(id);
};
const flush = (name: string, title: string) => {
  console.log(`== ${name}: ${title}`);
  for (const [key, [exact, non]] of [...tally].sort()) {
    const [owner, label] = key.split('\u0000'); if (owner !== name) continue;
    console.log(`  ${label.padEnd(66)} EXACT ${String(exact.size).padStart(4)}  non ${String(non.size).padStart(3)}  e.g. ${[...exact].slice(0, 4).join(' ')}${non.size ? ` | non ${[...non].slice(0, 10).join(' ')}` : ''}`);
  }
};

for (const def of ctx.definitions as any[]) {
  const appClass = isApplicationClass(def);
  const code = maskNonCode(def.sourceText);
  if (appClass && (run('format') || run('methods'))) {
    const packages = [...def.names].filter((r: any) => String(r.recname).trim() === 'PACKAGE' && String(r.refname).trim() !== '');
    if (packages.length) {
      const rooted = packages.some((r: any) => String(r.packageroot).trim() !== '');
      const methodColumn = [...def.names].some((r: any) => String(r.appclassmethod).trim() !== '');
      const format = rooted && methodColumn ? 'descriptive' : !rooted && !methodColumn ? 'blank' : rooted ? 'root only' : 'method only';
      const counts = new Map<string, number>();
      for (const r of packages) { const key = String(r.refname).trim().toUpperCase(); counts.set(key, (counts.get(key) ?? 0) + 1); }
      section = 'format';
      if (run('format')) {
        const repeats = [...counts.values()].reduce((sum, n) => sum + n - 1, 0);
        const directive = /(^|\n)\s*#(If|Else|End-If)\b/i.test(def.sourceText);
        add(`${format} format | ${repeats === 0 ? 'no repeated PACKAGE' : repeats < 5 ? 'repeats 1-4' : 'repeats 5+'}${directive ? ' | #If' : ''}`, def.definitionId);
      }
      section = 'methods';
      const parsed = run('methods') ? parseApplicationClassSource(def.sourceText) : undefined;
      if (parsed) {
        for (const [leaf, n] of counts) {
          const methods = (parsed.implementations as any[]).filter(im => new RegExp(`\\b${leaf}\\b`, 'i').test(code.slice(im.sourceIndex, im.sourceEnd))).length;
          if (methods < 2) continue;
          add(`${format} format | class in ${methods >= 5 ? '5+' : methods} methods | stored rows ${n === 1 ? '1' : n >= methods ? 'one per method or more' : 'between'}`, def.definitionId);
        }
      }
    }
  }
  section = 'paren';
  if (run('paren')) {
    const text = code.replace(/"(?:[^"\n]|"")*"/g, m => ' '.repeat(m.length));
    for (const x of text.matchAll(/\(\s*&\w+(?:\s*\.\s*\w+\s*\([^()]*\))+\s*\)\s*\.\s*(\w+)\s*(\()?/g)) {
      add(`${appClass ? 'App Class' : 'ordinary'} (typed chain).${/^(GetRow|GetRecord|GetRowset|GetField)$/i.test(x[1]) ? `${x[1]}()` : x[2] ? 'other method' : 'bare member'}`, def.definitionId);
    }
  }
}
if (run('format')) flush('format', 'App Class store format and repeated PACKAGE identities');
if (run('methods')) flush('methods', 'class rows across method bodies');
if (run('paren')) flush('paren', 'parenthesized typed chains');
