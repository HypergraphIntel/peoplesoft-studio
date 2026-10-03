/*
 * Cycle 146: ordinary RECORD.FIELD / owner provenance (research only).
 *
 *   1. owner row by key shape: the OBJECTID set of every non-App-Class
 *      definition, and whether the stored PSPCMNAME row 1 equals the
 *      harness owner (`harnessOwner`) -- `REC.FIELD`, `REC.` (no field id)
 *      or `.` (no record id);
 *   2. `.ParentRowset.GetRow(...).A.B` chains: whether stored / generated
 *      hold RECORD.A;
 *   3. a single member after a bare `GetRecord()` (`GetRecord().X`, not
 *      followed by `.` / `(`): whether stored / generated hold FIELD.X, by
 *      member name.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle146-record-field-provenance-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, generatedReferenceKey, harnessOwner, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

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
  const d = def as any;
  const exact = !taxonomy.has(def.definitionId);
  const stored = storedReferenceKeys(def);
  if (!isApplicationClass(def)) {
    const ids = [d.objectid1, d.objectid2, d.objectid3, d.objectid4, d.objectid5, d.objectid6, d.objectid7].filter(Boolean).join(',');
    const owner = harnessOwner(def);
    const harness = (owner.recordName || owner.fieldName) ? `${owner.recordName.toUpperCase()}.${owner.fieldName.toUpperCase()}` : '.';
    add(`1. owner, key ${ids.padEnd(20)} stored ${stored[0] === harness ? '= harness' : `${stored[0]} != harness ${harness}`}`.slice(0, 90), exact, def.definitionId);
  }
  const code = def.sourceText.replace(/\/\*[\s\S]*?\*\/|"[^"\n]*"/g, ' ').replace(/(?<![\w&])rem\b[^;]*;/gi, ' ');
  const m2 = [...code.matchAll(/\.\s*ParentRowset\s*\.\s*GetRow\s*\([^()]*(?:\([^()]*\))?[^()]*\)\s*\.\s*([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/gi)];
  const m3 = [...code.matchAll(/\bGetRecord\s*\(\s*\)\s*\.\s*([A-Za-z_]\w*)\b(?!\s*[.(])/gi)];
  if (m2.length === 0 && m3.length === 0) continue;
  const generated = (encodeAsHarness(ctx, def).artifacts?.references ?? []).map(generatedReferenceKey);
  for (const m of m2) {
    const key = `RECORD.${m[1].toUpperCase()}`;
    add(`2. ParentRowset.GetRow(..).A.B  RECORD.A stored ${stored.includes(key) ? 'y' : 'n'} generated ${generated.includes(key) ? 'y' : 'n'}`, exact, def.definitionId);
  }
  for (const m of m3) {
    const key = `FIELD.${m[1].toUpperCase()}`;
    const name = /^[A-Z0-9_]+$/.test(m[1]) ? 'FIELD-shaped' : m[1];
    add(`3. GetRecord().X  X=${name.padEnd(13)} FIELD.X stored ${stored.includes(key) ? 'y' : 'n'} generated ${generated.includes(key) ? 'y' : 'n'}`, exact, def.definitionId);
  }
}
console.log('                                                                                  EXACT / non-EXACT');
for (const [k, [e, n]] of [...tally].sort()) console.log(`  ${k.padEnd(80)} ${String(e).padStart(6)} / ${String(n).padEnd(4)} ${(examples.get(k) ?? []).join(' ')}`);
