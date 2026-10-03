/*
 * Cycle 155: built-in type names in ordinary Function headers (research
 * only).
 *
 * Every `As <type>` parameter and `Returns <type>` of an ordinary Function
 * header (a single-word type, not `array of` or a class path), by type
 * (lower case) and context: programs EXACT / non-EXACT, and in how many the
 * stored PSPCMNAME list holds PACKAGE.<TYPE>. The trailer descriptor each
 * type stores was read with a sentinel encode (an unknown type written as
 * 0x0fedcba9, the stored word at the same offset read back): time 0x0a,
 * object 0x0d, Message 0x8000e, CubeCollection 0x80033, Document 0x8003f,
 * DocumentKey 0x80040, Primitive 0x80041, Compound 0x80042,
 * CompositeQuery 0x80048 (parameter slots | 0xc0000000).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle155-function-type-descriptor-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const tally = new Map<string, { exact: Set<number>; other: Set<number>; withRow: Set<number> }>();
const ctx = openHarnessContext();
for (const def of ctx.definitions) {
  if (isApplicationClass(def)) continue;
  const code = maskNonCode(def.sourceText);
  const exact = !taxonomy.has(def.definitionId);
  const stored = new Set(storedReferenceKeys(def));
  for (const m of code.matchAll(/^\s*Function\s+\w+\s*(?:\(([^)]*)\))?([^\n]*)/gim)) {
    const uses: [string, string][] = [];
    for (const p of (m[1] ?? '').split(',')) {
      const t = /\bAs\s+([A-Za-z_]\w*)\s*$/i.exec(p)?.[1];
      if (t !== undefined) uses.push([t, 'parameter']);
    }
    const r = /\bReturns\s+([A-Za-z_]\w*)\b(?!\s*:)/i.exec(m[2] ?? '')?.[1];
    if (r !== undefined && !/^array$/i.test(r)) uses.push([r, 'return']);
    for (const [type, context] of uses) {
      const key = `${type.toLowerCase().padEnd(16)} ${context}`;
      const v = tally.get(key) ?? { exact: new Set(), other: new Set(), withRow: new Set() };
      tally.set(key, v);
      (exact ? v.exact : v.other).add(def.definitionId);
      if (stored.has(`PACKAGE.${type.toUpperCase()}`)) v.withRow.add(def.definitionId);
    }
  }
}
console.log('type             context     EXACT / non-EXACT programs, stored PACKAGE.<TYPE> in');
for (const [k, v] of [...tally].sort()) {
  console.log(`  ${k.padEnd(28)} ${String(v.exact.size).padStart(5)} / ${String(v.other.size).padEnd(4)} row in ${String(v.withRow.size).padStart(4)}   ${[...v.other].slice(0, 6).join(' ')}`);
}
