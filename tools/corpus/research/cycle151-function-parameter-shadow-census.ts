/*
 * Cycle 151: an ordinary Function parameter that shares its name with an
 * outer (top-level Local / Global / Component) declaration (research only).
 *
 * Per program and (parameter, Function): the outer declaration's scope and
 * type, the parameter form (untyped, `As any`, `As <type>`), how many
 * member accesses `&x.` the Function body makes on it, and whether any are
 * made outside every Function (the outer variable after End-Function).
 * Programs are marked EXACT / non-EXACT against the taxonomy.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle151-function-parameter-shadow-census.ts --taxonomy t.json [--verbose]
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const verbose = args.includes('--verbose');
const tally = new Map<string, Set<number>[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [new Set(), new Set()]; tally.set(key, v); v[exact ? 0 : 1].add(id);
};
const typeClass = (t: string) =>
  /^(Record|Row|Rowset|Field)$/i.test(t) ? t[0].toUpperCase() + t.slice(1).toLowerCase()
    : /^array\s+of\s+/i.test(t) ? `array of ${/(Record|Row|Rowset|Field)$/i.test(t) ? t.split(/\s+/).at(-1) : 'other'}`
      : /:/.test(t) ? 'App Class' : /^any$/i.test(t) ? 'any' : 'primitive/other';
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (isApplicationClass(def)) continue;
  const code = maskNonCode(def.sourceText);
  if (!/^\s*Function\b/im.test(code)) continue;
  // Function spans
  const spans: { name: string; params: string; start: number; end: number }[] = [];
  for (const m of code.matchAll(/^\s*Function\s+(\w+)\s*(\(([^)]*)\))?/gim)) {
    const end = code.slice(m.index!).search(/^\s*End-Function\b/im);
    spans.push({ name: m[1], params: m[3] ?? '', start: m.index!, end: end < 0 ? code.length : m.index! + end });
  }
  const inFunction = (at: number) => spans.some(s => at >= s.start && at < s.end);
  const outer = new Map<string, { scope: string; type: string }>();
  for (const m of code.matchAll(/^\s*(Local|Global|Component)\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gim)) {
    if (inFunction(m.index!)) continue;
    for (const n of m[3].split(',')) outer.set(n.trim().toLowerCase(), { scope: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), type: m[2] });
  }
  if (outer.size === 0) continue;
  const exact = !taxonomy.has(def.definitionId);
  for (const span of spans) {
    for (const p of span.params.split(',')) {
      const pm = /^\s*(&\w+)(?:\s+As\s+(.+?))?\s*$/i.exec(p);
      if (!pm) continue;
      const o = outer.get(pm[1].toLowerCase());
      if (o === undefined) continue;
      const form = pm[2] === undefined ? 'untyped' : /^any$/i.test(pm[2].trim()) ? 'As any' : `As ${typeClass(pm[2].trim())}`;
      const body = code.slice(span.start, span.end);
      const esc = pm[1].replace(/[$]/g, '\\$&');
      const uses = [...body.matchAll(new RegExp(`${esc}\\s*[.(\\[]`, 'gi'))].length;
      const outerUses = [...code.matchAll(new RegExp(`${esc}\\s*[.(\\[]`, 'gi'))].filter(m => !inFunction(m.index!)).length;
      const key = `${o.scope.padEnd(9)} ${typeClass(o.type).padEnd(16)} param ${form.padEnd(18)} body member uses ${uses > 0 ? 'yes' : 'no '}  outer uses ${outerUses > 0 ? 'yes' : 'no '}`;
      add(key, exact, def.definitionId);
      if (verbose) console.log(`  ${exact ? ' ' : '-'}${def.definitionId} ${span.name}(${pm[1]}) ${key}`);
    }
  }
}
console.log('                                                                                        EXACT / non-EXACT programs');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(86)} ${String(e.size).padStart(4)} / ${String(n.size).padEnd(3)} ${[...e].slice(0, 6).join(' ')} | ${[...n].slice(0, 8).join(' ')}`);
