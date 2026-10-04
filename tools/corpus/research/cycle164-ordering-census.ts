/*
 * Cycle 164: STRUCTURAL_ORDERING rows and the condition-boundary comment
 * placement (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   order     each listed program (`--ids a,b`; default STRUCTURAL_ORDERING
 *             rows): row multiset equality and every displaced row with the
 *             source line of its generated allocation;
 *   relation  App Class headers declaring a member with the same type as
 *             `extends` (wildcard-imported or not): stored row of the type;
 *   global    top-level Global / Component declarations of an App Class
 *             type (scalar / `array of`): stored row present, and whether
 *             the generated row sits at the stored position;
 *   create    `Local A &x = create B(...)` with A != B: which class row
 *             stored / generated opens first;
 *   comment   control-structure headers followed by an own-line comment
 *             and then a `<* *>` comment.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle164-ordering-census.ts --taxonomy t.json [--section <name>] [--ids 1,2]
 */
import fs from 'node:fs';

import { maskNonCode, parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, isApplicationClass, storedReferenceKeys, generatedReferenceKey } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = option('--section');
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
    console.log(`  ${label.padEnd(60)} EXACT ${String(exact.size).padStart(4)}  non ${String(non.size).padStart(3)}  e.g. ${[...exact].slice(0, 4).join(' ')}${non.size ? ` | non ${[...non].slice(0, 10).join(' ')}` : ''}`);
  }
};
const leafOf = (path: string) => path.split(':').at(-1)!.trim().toUpperCase();
const storedPackages = (def: any) => [...def.names].sort((a: any, b: any) => a.namenum - b.namenum)
  .map((r: any) => `${String(r.recname).trim()}.${String(r.refname).trim()}`.toUpperCase());

if (run('order')) {
  const ids = option('--ids')?.split(',').map(Number) ?? taxonomyRows.filter(r => r.primaryCategory === 'STRUCTURAL_ORDERING').map(r => r.definitionId);
  console.log('== order: displaced rows');
  for (const id of ids) {
    const def = ctx.definitions.find(d => d.definitionId === id)! as any;
    const lineOf = (offset: number) => def.sourceText.slice(0, offset).split('\n').length;
    const allocated = new Map<number, number>();
    const r = encodeAsHarness(ctx, def, { referenceTrace: (e: any) => { if (e.action === 'ALLOC' && !allocated.has(e.reference.index)) allocated.set(e.reference.index, lineOf(e.sourceOffset)); } } as any);
    const s = storedReferenceKeys(def), g = (r.artifacts?.references ?? []).map(generatedReferenceKey);
    const sameMultiset = [...s].sort().join('|') === [...g].sort().join('|');
    console.log(`  ${id} rows ${s.length}/${g.length} multiset ${sameMultiset ? 'equal' : 'differs'}`);
    s.forEach((key, i) => {
      if (g[i] === key) return;
      const j = g.indexOf(key);
      if (j !== i && j >= 0 && s.indexOf(key) === i) console.log(`    ${key}: stored #${i + 1}, generated #${j + 1} (allocated L${allocated.get(j)}: ${def.sourceText.split('\n')[(allocated.get(j) ?? 1) - 1]?.trim().slice(0, 90)})`);
    });
  }
}

for (const def of ctx.definitions as any[]) {
  const appClass = isApplicationClass(def);
  const code = maskNonCode(def.sourceText);
  section = 'relation';
  if (run('relation') && appClass) {
    const parsed = parseApplicationClassSource(def.sourceText);
    const base = parsed?.extendsType?.trim();
    if (parsed && base && base.includes(':')) {
      const header = code.slice(parsed.unitStart, parsed.unitEnd).replace(/\bextends\s+[\w:]+/i, '');
      if (new RegExp(`\\b${base.replace(/:/g, '\\s*:\\s*')}\\b`, 'i').test(header)) {
        const wildcard = new RegExp(`\\bimport\\s+${base.split(':')[0]}\\s*:[\\w:]*\\*`, 'i').test(code);
        add(`member typed like extends (${wildcard ? 'wildcard import' : 'no wildcard'}) stored row ${storedPackages(def).includes(`PACKAGE.${leafOf(base)}`)}`, def.definitionId);
      }
    }
  }
  section = 'global';
  if (run('global') && appClass) {
    const parsed = parseApplicationClassSource(def.sourceText);
    if (parsed) {
      const region = code.slice(parsed.unitEnd, (parsed.implementations[0] as any)?.sourceIndex ?? code.length);
      for (const x of region.matchAll(/\b(Global|Component)\s+((?:array\s+of\s+)*)([A-Za-z_]\w*(?:\s*:\s*\w+)+)\s+&\w+/gi)) {
        const key = `PACKAGE.${leafOf(x[3])}`;
        const stored = storedPackages(def).indexOf(key);
        const generated = (encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey).indexOf(key);
        add(`${x[1]} ${x[2] ? 'array of ' : ''}class: stored row ${stored < 0 ? 'none' : stored === generated ? 'at generated position' : 'elsewhere'}`, def.definitionId);
      }
    }
  }
  section = 'create';
  if (run('create')) {
    for (const x of code.matchAll(/\bLocal\s+([A-Za-z_]\w*(?:\s*:\s*\w+)+)\s+&\w+\s*=\s*create\s+([A-Za-z_]\w*(?:\s*:\s*\w+)+)\s*\(/gi)) {
      const a = `PACKAGE.${leafOf(x[1])}`, b = `PACKAGE.${leafOf(x[2])}`; if (a === b) continue;
      const s = storedPackages(def), g = (encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey);
      const order = (list: string[]) => list.indexOf(a) < 0 || list.indexOf(b) < 0 ? 'one absent' : list.indexOf(a) < list.indexOf(b) ? 'declared first' : 'created first';
      add(`${appClass ? 'App Class' : 'ordinary'} stored ${order(s)} / generated ${order(g)}`, def.definitionId);
    }
  }
  section = 'comment';
  if (run('comment')) {
    for (const x of def.sourceText.matchAll(/^[ \t]*(While|If|For|Evaluate|When|Else)\b[^\n;]*\r?\n[ \t]*(\/\*[^\n]*\*\/|rem\b[^\n]*;)[ \t]*\r?\n[ \t]*<\*/gim)) {
      add(`${x[1]} header, own-line ${x[2].startsWith('/*') ? '/* */' : 'REM'}, then <* *>`, def.definitionId);
    }
  }
}
if (run('relation')) flush('relation', 'App Class header members typed like the extends class');
if (run('global')) flush('global', 'top-level Global / Component App Class declarations');
if (run('create')) flush('create', 'Local A = create B order');
if (run('comment')) flush('comment', 'header, own-line comment, <* *>');
