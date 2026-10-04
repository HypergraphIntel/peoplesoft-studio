/*
 * Cycle 162: COMPONENT reference rows and Message GetRowset chains
 * (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   component  stored COMPONENT row repetition in App Class lists; quoted
 *              `Component."X"` sources; names written more than once
 *              (`Component.X`): stored / generated rows of the name;
 *   message    variables declared Message (Local / Global / Component /
 *              instance / property / parameter); calls on them; what
 *              follows `GetRowset()` and whether a bare record / field
 *              member there has its stored RECORD / FIELD row;
 *   extends    App Classes extending a built-in object type other than
 *              Exception.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle162-component-message-census.ts --taxonomy t.json [--section <name>]
 */
import fs from 'node:fs';

import { maskNonCode, parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const sectionArg = args.indexOf('--section');
const only = sectionArg >= 0 ? args[sectionArg + 1] : undefined;
const run = (name: string) => only === undefined || only === name;
const ctx = openHarnessContext();
const tally = new Map<string, { programs: Set<number>[]; sites: number }>();
let section = '';
const add = (label: string, id: number) => {
  const key = `${section}\u0000${label}`;
  const v = tally.get(key) ?? { programs: [new Set(), new Set()], sites: 0 }; tally.set(key, v);
  v.programs[nonexact.has(id) ? 1 : 0].add(id); v.sites++;
};
const flush = (name: string, title: string) => {
  console.log(`== ${name}: ${title}`);
  for (const [key, { programs: [exact, non], sites }] of [...tally].sort()) {
    const [owner, k] = key.split('\u0000');
    if (owner !== name) continue;
    console.log(`  ${k.padEnd(52)} sites ${String(sites).padStart(4)}  EXACT ${String(exact.size).padStart(4)}  non ${String(non.size).padStart(3)}  e.g. ${[...exact].slice(0, 3).join(' ')}${non.size ? ` | non ${[...non].slice(0, 10).join(' ')}` : ''}`);
  }
};
const storedNames = (def: any, rec: string) => [...def.names].filter((r: any) => String(r.recname).trim().toUpperCase() === rec).map((r: any) => String(r.refname).trim().toUpperCase());
const balancedEnd = (text: string, open: number) => {
  let i = open + 1, depth = 1;
  while (i < text.length && depth > 0) { if (text[i] === '(') depth++; else if (text[i] === ')') depth--; i++; }
  return i;
};

for (const def of ctx.definitions as any[]) {
  const appClass = isApplicationClass(def);
  const kind = appClass ? 'App Class' : 'ordinary';
  const code = maskNonCode(def.sourceText).replace(/"(?:[^"\n]|"")*"/g, m => ' '.repeat(m.length));
  section = 'component';
  if (run('component')) {
    const stored = new Map<string, number>();
    for (const name of storedNames(def, 'COMPONENT')) stored.set(name, (stored.get(name) ?? 0) + 1);
    if (appClass) for (const n of stored.values()) add(`App Class stored COMPONENT identity ${n > 1 ? 'repeated' : 'once'}`, def.definitionId);
    if (/\bComponent\s*\.\s*"/i.test(maskNonCode(def.sourceText))) add(`${kind} quoted Component."X"`, def.definitionId);
    const uses = new Map<string, number>();
    for (const x of code.matchAll(/\bComponent\s*\.\s*(\w+)/gi)) uses.set(x[1].toUpperCase(), (uses.get(x[1].toUpperCase()) ?? 0) + 1);
    const repeated = [...uses].filter(([, n]) => n > 1);
    if (repeated.length) {
      const generated = encodeAsHarness(ctx, def).artifacts?.references ?? [];
      for (const [name] of repeated) {
        const s = stored.get(name) ?? 0;
        const g = generated.filter((r: any) => r.kind === 'component' && String(r.objectName ?? '').toUpperCase() === name).length;
        add(`${kind} repeated Component.X stored ${Math.min(s, 3)}${s > 2 ? '+' : ''} generated ${Math.min(g, 3)}${g > 2 ? '+' : ''}`, def.definitionId);
      }
    }
  }
  section = 'message';
  if (run('message')) {
    const messages = new Set<string>();
    for (const x of code.matchAll(/\b(Local|Global|Component|instance|property)\s+Message\s+(&?\w+(?:\s*,\s*&\w+)*)/gi)) {
      for (const v of x[2].split(',')) { messages.add(`&${v.trim().replace(/^&/, '').toLowerCase()}`); add(`${kind} declared ${x[1].toLowerCase()}`, def.definitionId); }
    }
    for (const x of code.matchAll(/(&\w+)\s+As\s+Message\b/gi)) { messages.add(x[1].toLowerCase()); add(`${kind} declared parameter`, def.definitionId); }
    if (messages.size) {
      const records = new Set(storedNames(def, 'RECORD')), fields = new Set(storedNames(def, 'FIELD'));
      for (const x of code.matchAll(/(&\w+)\s*\.\s*(\w+)\s*(\()?/g)) {
        if (!messages.has(x[1].toLowerCase())) continue;
        add(`${kind} call ${x[3] ? `${x[2]}()` : `.${x[2]}`}`, def.definitionId);
        if (!x[3] || !/^GetRowset$/i.test(x[2])) continue;
        let rest = code.slice(balancedEnd(code, x.index! + x[0].length - 1));
        let last = 'GetRowset'; const steps: string[] = [];
        while (steps.length < 6) {
          const call = /^\s*\(/.exec(rest);
          if (call) { rest = rest.slice(balancedEnd(rest, call[0].length - 1)); steps.push('(n)'); last = 'Row'; continue; }
          const member = /^\s*\.\s*(\w+)\s*(\()?/.exec(rest);
          if (!member) break;
          if (member[2]) { rest = rest.slice(balancedEnd(rest, member[0].length - 1)); steps.push(`${member[1]}()`); last = /^GetRecord$/i.test(member[1]) ? 'Record' : /^GetRow$/i.test(member[1]) ? 'Row' : member[1]; continue; }
          rest = rest.slice(member[0].length);
          if (last === 'Row' || last === 'Record') {
            const row = last === 'Row' ? records.has(member[1].toUpperCase()) : fields.has(member[1].toUpperCase());
            steps.push(`${last === 'Row' ? 'RECORD' : 'FIELD'} row ${row}`); last = last === 'Row' ? 'Record' : 'Field';
          } else { steps.push(`.${member[1]}`); break; }
        }
        add(`${kind} GetRowset() ${steps.join(' ') || '(end)'}`, def.definitionId);
      }
    }
  }
  section = 'extends';
  if (run('extends') && appClass) {
    const parsed = parseApplicationClassSource(def.sourceText);
    const base = parsed?.extendsType?.trim() ?? '';
    if (/^(Rowset|Row|Record|Field|Message|SQL|File|ApiObject|XmlDoc|JsonObject|Grid)$/i.test(base)) add(`App Class extends ${base}`, def.definitionId);
  }
}
if (run('component')) flush('component', 'COMPONENT rows');
if (run('message')) flush('message', 'declared Message receivers');
if (run('extends')) flush('extends', 'App Classes extending a built-in type');
