/*
 * Cycle 137: which source-visible type uses give an Application Class
 * program a PACKAGE row (research only).
 *
 * For every Application Class program, every type name used by a
 * declaration construct -- `catch <T> &e`, `Global` / `Component <T> &x`,
 * header `instance` / `property <T>`, a method parameter `&p As <T>`, a
 * method `Returns <T>`, a body `Local <T> &x` -- is keyed by its leaf and
 * the set of constructs it appears in (an `array of <T>` counts as <T>).
 * Per (program, leaf): whether the stored / generated PSPCMNAME list holds
 * a PACKAGE.<LEAF> row. Tabulated by leaf kind (built-in type or
 * Application Class path) x construct set, EXACT / non-EXACT, with the
 * programs where stored and generated disagree.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle137-appclass-package-provenance-census.ts --taxonomy t.json [leaf-regex]
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, storedReferenceKeys, generatedReferenceKey, isApplicationClass } from './lib/harnessContext';
import { isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const leafFilter = args[2] !== undefined ? new RegExp(`^(?:${args[2]})$`, 'i') : undefined;

const CONSTRUCTS: [string, RegExp][] = [
  ['catch', /\bcatch\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)\s+&/gi],
  ['Global/Component', /\b(?:Global|Component)\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)\s+&/gi],
  ['instance/property', /^\s*(?:instance|property)\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)\s+&?\w/gim],
  ['parameter', /&\w+\s+As\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)/gi],
  ['Returns', /\)\s*Returns\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)/gi],
  ['Local', /\bLocal\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)\s+&/gi]
];
const tally = new Map<string, number[]>();
const disagree = new Map<string, Set<string>>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (!isApplicationClass(def)) continue;
  const code = def.sourceText.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\/\+[\s\S]*?\+\//g, ' ');
  const uses = new Map<string, Set<string>>();
  for (const [construct, re] of CONSTRUCTS) {
    for (const m of code.matchAll(re)) {
      const type = m[1].replace(/^(?:array\s+of\s+)+/i, '');
      if (/^(?:string|number|integer|boolean|date|datetime|time|any|float|object)$/i.test(type)) continue;
      const leaf = type.split(':').pop()!.toUpperCase();
      if (leafFilter && !leafFilter.test(leaf)) continue;
      const set = uses.get(leaf) ?? new Set(); uses.set(leaf, set); set.add(`${construct}${type.includes(':') ? '' : isBuiltinObjectTypeName(type) ? ' (built-in)' : ' (bare name)'}`);
    }
  }
  if (uses.size === 0) continue;
  const stored = new Set(storedReferenceKeys(def));
  const exact = !taxonomy.has(def.definitionId);
  const generated = exact ? stored : new Set((encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey));
  for (const [leaf, set] of uses) {
    const key = `${[...set].sort().join(' + ')}`;
    const s = stored.has(`PACKAGE.${leaf}`), g = generated.has(`PACKAGE.${leaf}`);
    const v = tally.get(key) ?? [0, 0, 0, 0, 0, 0]; tally.set(key, v);
    v[(exact ? 0 : 2) + (s ? 0 : 1)]++;
    if (!exact && s !== g) { v[s ? 4 : 5]++; const d = disagree.get(key) ?? new Set(); disagree.set(key, d); if (d.size < 10) d.add(`${def.definitionId}:${leaf}${s ? '-missing' : '-extra'}`); }
  }
}
console.log('(program, type leaf) pairs by construct set   EXACT stored-row / no-row   non-EXACT stored-row / no-row   generated missing / extra');
for (const [k, v] of [...tally].sort((a, b) => b[1][0] + b[1][1] + b[1][2] + b[1][3] - a[1][0] - a[1][1] - a[1][2] - a[1][3])) {
  console.log(`  ${k.padEnd(64)} ${String(v[0]).padStart(5)} / ${String(v[1]).padEnd(5)} ${String(v[2]).padStart(4)} / ${String(v[3]).padEnd(4)} ${String(v[4]).padStart(3)} / ${String(v[5]).padEnd(3)} ${[...(disagree.get(k) ?? [])].join(' ')}`);
}
