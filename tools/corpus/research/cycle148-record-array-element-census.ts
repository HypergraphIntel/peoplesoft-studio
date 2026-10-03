/*
 * Cycle 148: members of an indexed `array of Record` element (research only).
 *
 * For every `array of Record` variable declaration -- by scope (Local,
 * Global, Component, App Class header) and program kind -- every indexed
 * member access `&x [ ... ].MEMBER` (not a method: no `(` after the member):
 * whether the stored list has FIELD.MEMBER, and whether the generated one
 * does. Members are bucketed as FIELD-shaped (upper case) or a Record
 * property spelling. Also, as a control, the bare (unindexed) members of the
 * same variables (`&x.Len`): whether stored has FIELD.MEMBER.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle148-record-array-element-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const tally = new Map<string, number[]>();
const examples = new Map<string, number[]>();
const add = (key: string, exact: boolean, id: number) => {
  const v = tally.get(key) ?? [0, 0]; tally.set(key, v); v[exact ? 0 : 1]++;
  const e = examples.get(key) ?? []; examples.set(key, e);
  if (e.length < 8 && !e.includes(exact ? id : -id)) e.push(exact ? id : -id);
};
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (!/array\s+of\s+Record\b/i.test(def.sourceText)) continue;
  const code = maskNonCode(def.sourceText);
  const kind = isApplicationClass(def) ? 'App Class' : 'ordinary ';
  const scopes = new Map<string, string>();
  for (const m of code.matchAll(/\b(Local|Global|Component|instance|property)\s+array\s+of\s+Record\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    for (const name of m[2].split(',')) scopes.set(name.trim().toLowerCase(), m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
  }
  if (scopes.size === 0) continue;
  const exact = !taxonomy.has(def.definitionId);
  const stored = new Set(storedReferenceKeys(def));
  let generated: Set<string> | undefined;
  for (const m of code.matchAll(/&\w+/g)) {
    const scope = scopes.get(m[0].toLowerCase());
    if (scope === undefined) continue;
    let p = m.index! + m[0].length;
    while (/\s/.test(code[p] ?? '')) p++;
    let indexed = false;
    if (code[p] === '[') {
      let depth = 0;
      for (; p < code.length; p++) {
        if (code[p] === '[') depth++;
        else if (code[p] === ']' && --depth === 0) { p++; break; }
      }
      indexed = true;
    }
    const member = /^\s*\.\s*([A-Za-z_]\w*)(\s*\()?/.exec(code.slice(p));
    if (member === null || member[2] !== undefined) continue;
    const name = member[1];
    const shape = /^[A-Z0-9_]+$/.test(name) ? 'FIELD-shaped' : `property ${name}`;
    const key = `FIELD.${name.toUpperCase()}`;
    generated ??= new Set((encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey));
    add(`${kind} ${scope.padEnd(9)} ${indexed ? '&x[..].M' : '&x.M    '} ${shape.padEnd(18)} FIELD.M stored ${stored.has(key) ? 'y' : 'n'} generated ${generated.has(key) ? 'y' : 'n'}`, exact, def.definitionId);
  }
}
console.log('                                                                                  EXACT / non-EXACT');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(80)} ${String(e).padStart(6)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).join(' ')}`);
