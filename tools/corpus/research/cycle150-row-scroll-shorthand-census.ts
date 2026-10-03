/*
 * Cycle 150: a Row's child-rowset shorthand `<row>.SCROLLNAME (n)` (research
 * only).
 *
 * For every upper-case member immediately followed by `(` -- the shape of a
 * Row's child rowset indexed to a row, `GetLevel0()(1).REC (&i)`,
 * `GetRow(n).REC (n)`, `&row.REC (n)` -- by receiver shape: whether the
 * stored list has SCROLL.NAME / RECORD.NAME, and whether the generated one
 * does. Counts are occurrence-level presence (the program's list holds the
 * row), per site.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle150-row-scroll-shorthand-census.ts --taxonomy t.json [--app-class]
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const appClass = args.includes('--app-class');
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (isApplicationClass(def) !== appClass) continue;
  const code = maskNonCode(def.sourceText);
  const sites = [...code.matchAll(/([\w&)\]]+)\s*\.\s*([A-Z][A-Z0-9_]*)\s*\(/g)].filter(m => /[A-Z].*[A-Z_0-9]$/.test(m[2]) && m[2].length > 2);
  if (sites.length === 0) continue;
  const exact = !taxonomy.has(def.definitionId);
  const stored = new Set(storedReferenceKeys(def));
  let generated: Set<string> | undefined;
  for (const m of sites) {
    const before = code.slice(Math.max(0, m.index! - 80), m.index! + m[1].length);
    const receiver =
      /GetLevel0\s*\(\s*\)\s*\(\s*[^()]*\)$/i.test(before) ? 'GetLevel0()(n)' :
      /GetRow\s*\((?:[^()]|\([^()]*\))*\)$/i.test(before) ? 'GetRow(..)' :
      /\)$/.test(before) ? '(..) other call / index' :
      /^&/.test(m[1]) ? '&variable' : 'name';
    const name = m[2];
    generated ??= new Set((encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey));
    const s = `${stored.has(`SCROLL.${name}`) ? 'S' : '-'}${stored.has(`RECORD.${name}`) ? 'R' : '-'}`;
    const g = `${generated.has(`SCROLL.${name}`) ? 'S' : '-'}${generated.has(`RECORD.${name}`) ? 'R' : '-'}`;
    add(`${receiver.padEnd(24)} .NAME (  stored SCROLL/RECORD ${s}  generated ${g}`, exact, def.definitionId);
  }
}
console.log('                                                                   EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(64)} ${String(e.size).padStart(5)} / ${String(n.size).padEnd(4)} ${[...e].slice(0, 5).join(' ')} | ${[...n].slice(0, 8).join(' ')}`);
