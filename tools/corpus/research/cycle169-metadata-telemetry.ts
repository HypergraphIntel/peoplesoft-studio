/*
 * Cycle 169: every failed App Class type-metadata lookup during a corpus
 * encode, with a reason (research only). Cycle 168 found that a missing
 * superclass hid `%Super` lookups entirely -- the encoder's own trace sees
 * only lookups it makes. This wraps the provider itself, so every
 * `memberType` / `methodReturnType` / `superclassOf` miss is recorded.
 *
 * Reasons (expected misses are not metadata gaps):
 *   expected  %metadata system class; member inherited from a built-in base
 *             (`extends Rowset` -> GetRow); a class with no `extends`
 *             asked for its superclass;
 *   unexpected class absent (neither corpus nor captured); ancestor
 *             unresolved; member absent from a fully resolved chain.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle169-metadata-telemetry.ts --taxonomy t.json [--all]
 */
import fs from 'node:fs';

import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import type { ApplicationClassTypeMetadataProvider } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { listSnapshotApplicationClassDefinitions } from '../snapshot/applicationClassTypeMetadata';
import { decodeCapturedApplicationClass, listSnapshotCapturedApplicationClasses } from '../snapshot/capturedApplicationClasses';
import { openSnapshotDatabase } from '../snapshot/store';
import { openHarnessContext, encodeAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const db = openSnapshotDatabase();
const sources = new Map<string, string>();
for (const d of listSnapshotApplicationClassDefinitions(db)) sources.set(d.path.join(':').toLowerCase(), d.source);
for (const c of listSnapshotCapturedApplicationClasses(db)) {
  const key = c.path.join(':').toLowerCase();
  if (sources.has(key)) continue;
  const decoded = decodeCapturedApplicationClass(c);
  if (decoded !== undefined) sources.set(key, decoded.source);
}
const ctx = openHarnessContext();
const provider: ApplicationClassTypeMetadataProvider = ctx.applicationClassTypeMetadata;

const declaredExtends = (path: readonly string[]) => {
  const source = sources.get(path.join(':').toLowerCase());
  return source === undefined ? undefined : parseApplicationClassSource(source)?.extendsType?.trim();
};
/* The class at the top of the resolvable chain, and why the chain stops there. */
const chainEnd = (path: readonly string[]) => {
  let current: readonly string[] = path;
  for (let i = 0; i < 50; i++) {
    const parent = provider.superclassOf(current);
    if (parent === undefined) break;
    current = parent;
  }
  const written = declaredExtends(current);
  if (written === undefined) return 'no extends';
  if (provider.builtinBaseOf?.(current) !== undefined) return `built-in ${provider.builtinBaseOf!(current)}`;
  return `unresolved ancestor ${written} (of ${current.join(':')})`;
};
const reasonFor = (kind: string, path: readonly string[], member: string): { expected: boolean; reason: string } => {
  const key = path.join(':');
  if (/^%metadata/i.test(key)) return { expected: true, reason: '%metadata system class' };
  if (!sources.has(key.toLowerCase())) return { expected: false, reason: 'class absent' };
  const end = chainEnd(path);
  if (kind === 'superclassOf') {
    return end === 'no extends' || end.startsWith('built-in')
      ? { expected: true, reason: `superclass: ${end}` }
      : { expected: false, reason: `superclass: ${end}` };
  }
  if (end.startsWith('unresolved')) return { expected: false, reason: end };
  if (end.startsWith('built-in')) return { expected: true, reason: `member of ${end} base` };
  return { expected: false, reason: `member absent (${kind})` };
};

const events = new Map<string, { expected: boolean; reason: string; programs: Set<number>; non: Set<number> }>();
let current = 0;
const record = (kind: string, path: readonly string[], member: string) => {
  const r = reasonFor(kind, path, member);
  const key = `${r.expected ? 'expected' : 'UNEXPECTED'} | ${r.reason} | ${path.join(':')}${member ? `.${member}` : ''}`;
  const v = events.get(key) ?? { ...r, programs: new Set(), non: new Set() };
  events.set(key, v);
  (nonexact.has(current) ? v.non : v.programs).add(current);
};
const wrapped: ApplicationClassTypeMetadataProvider = {
  memberType: (path, member) => { const r = provider.memberType(path, member); if (r === undefined) record('member', path, member); return r; },
  methodReturnType: (path, method) => { const r = provider.methodReturnType(path, method); if (r === undefined) record('method', path, method); return r; },
  superclassOf: path => { const r = provider.superclassOf(path); if (r === undefined) record('superclassOf', path, ''); return r; },
  builtinBaseOf: path => provider.builtinBaseOf?.(path)
};
(ctx as any).applicationClassTypeMetadata = wrapped;
for (const def of ctx.definitions as any[]) {
  current = def.definitionId;
  encodeAsHarness(ctx, def);
}
const rows = [...events].sort((a, b) => b[1].non.size - a[1].non.size || b[1].programs.size - a[1].programs.size);
const unexpected = rows.filter(([, v]) => !v.expected);
console.log(`failed lookups: ${rows.length} distinct (${rows.filter(([, v]) => v.expected).length} expected, ${unexpected.length} unexpected); unexpected in non-EXACT programs: ${unexpected.filter(([, v]) => v.non.size).length}`);
const tally = new Map<string, number>();
for (const [, v] of rows) tally.set(`${v.expected ? 'expected' : 'UNEXPECTED'} | ${v.reason.replace(/ \(of .*\)| [A-Z_]+:.*$/, '')}`, (tally.get(`${v.expected ? 'expected' : 'UNEXPECTED'} | ${v.reason.replace(/ \(of .*\)| [A-Z_]+:.*$/, '')}`) ?? 0) + 1);
for (const [k, n] of [...tally].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
for (const [key, v] of (args.includes('--all') ? rows : unexpected).slice(0, args.includes('--all') ? rows.length : 60)) {
  console.log(`  ${key} | EXACT ${v.programs.size} non ${v.non.size}${v.non.size ? ` (${[...v.non].slice(0, 6).join(' ')})` : ''}`);
}
