/*
 * Cycle 159: identifiers containing `#` or `$` (research only).
 *
 * Every identifier-like token in code (comments / strings masked;
 * conditional-compilation directives `#If` / `#Else` / `#End-If` / `#Then`
 * excluded) that contains `#` or `$`, by role -- `&variable`, Function
 * name (after `Function` / `Declare Function`), member (after `.`), bare
 * name -- and by where the character sits (trailing `#` only, or inside):
 * EXACT / non-EXACT programs.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle159-special-identifier-census.ts --taxonomy t.json [--verbose]
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
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  const code = maskNonCode(def.sourceText).replace(/"(?:[^"\n]|"")*"/g, m => ' '.repeat(m.length));
  if (!/[#$]/.test(code)) continue;
  const exact = !taxonomy.has(def.definitionId);
  for (const m of code.matchAll(/(&|\.\s*|\b)([A-Za-z_$#][\w#$]*)/g)) {
    const [, lead, name] = m;
    if (!/[#$]/.test(name) || /^#(If|Else|End-If|Then)$/i.test(name)) continue;
    if (lead === '' && /^#/.test(name)) continue; // a directive
    const before = code.slice(Math.max(0, m.index! - 30), m.index!);
    const role = lead === '&' ? '&variable'
      : lead.startsWith('.') ? 'member'
        : /\bFunction\s+$/i.test(before) ? 'Function name' : 'bare name';
    const where = /^[^#$]*#$/.test(name) ? 'trailing # only' : /[#$]/.test(name.slice(0, -1)) ? `inside (${[...new Set(name.match(/[#$]/g))].join('')})` : 'trailing';
    add(`${role.padEnd(14)} ${where}`, exact, def.definitionId);
    if (verbose && !exact) console.log(`  -${def.definitionId} ${isApplicationClass(def) ? 'AC ' : 'ord'} ${role} ${lead.trim()}${name}`);
  }
}
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(40)} ${String(e.size).padStart(5)} / ${String(n.size).padEnd(3)} ${[...e].slice(0, 6).join(' ')} | ${[...n].slice(0, 8).join(' ')}`);
