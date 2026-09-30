/*
 * Cycle 99: Declare Function reference identity (research only).
 *
 * For every ordinary program, the stored and generated Declare Function
 * operands (`Declare Function f PeopleCode REC.FIELD Event` -- the name
 * operand after the 0x3A PeopleCode token, and the event keyword after it)
 * are collected. Over every PAIR of stored declarations in a program the
 * census tests four candidate identity keys against whether stored gave the
 * two the same PSPCMNAME row:
 *
 *   A  REC + FIELD + EVENT      B  REC + FIELD
 *   C  REC only                 D  FIELD only
 *
 * A key is contradiction-free when "key equal" always means "same row" and
 * "key differs" always means "different rows". It then compares, per
 * aligned occurrence, the stored and generated allocate / reuse decision.
 *
 * Usage: npx tsx tools/corpus/research/cycle99-declare-function-identity-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

function ownerOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return { recordName: recordIndex >= 0 ? values[recordIndex] : values[0], fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1] };
}

interface Declaration { nn: number; key: string; event: string }

function declarations(bytes: Buffer, keys: Map<number, string>): Declaration[] {
  const names = new NameTable();
  for (const [n, k] of keys) names.add(n, k);
  const tokens = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass: false }).tokens;
  const out: Declaration[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].opcode !== 0x3a || tokens[i + 1]?.nameNum === undefined) continue;
    out.push({ nn: tokens[i + 1].nameNum!, key: keys.get(tokens[i + 1].nameNum!) ?? '?', event: String(tokens[i + 2]?.text ?? '').trim().toUpperCase() });
  }
  return out;
}

const matrix = new Map<string, number>();
const bump = (k: string) => matrix.set(k, (matrix.get(k) ?? 0) + 1);
let programs = 0, operands = 0, aligned = 0;
const disagreements: string[] = [];
for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (def.objectid1 === 104 || !/Declare\s+Function/i.test(def.sourceText)) continue;
  const storedKeys = new Map<number, string>();
  for (const r of def.names) storedKeys.set(Number(r.namenum), `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);
  let stored: Declaration[];
  try { stored = declarations(def.storedProgram, storedKeys); } catch { continue; }
  programs++;
  operands += stored.length;
  for (let i = 0; i < stored.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = stored[j], b = stored[i];
      const sameRow = a.nn === b.nn ? 'same row' : 'different rows';
      const [ra, fa] = a.key.split('.');
      const [rb, fb] = b.key.split('.');
      const keys: Record<string, boolean> = {
        'A REC+FIELD+EVENT': a.key === b.key && a.event === b.event,
        'B REC+FIELD': a.key === b.key,
        'C REC': ra === rb,
        'D FIELD': fa === fb
      };
      for (const [name, equal] of Object.entries(keys)) bump(`${name} | ${equal ? 'key equal' : 'key differs'} | ${sameRow}`);
    }
  }
  try {
    const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerOf(def) } as any) as any;
    const generatedKeys = new Map<number, string>();
    for (const r of artifacts.references) generatedKeys.set(r.sequence, `${(r.recordName ?? '').toUpperCase()}.${(r.fieldName ?? '').toUpperCase()}`);
    const generated = declarations(artifacts.program, generatedKeys);
    if (generated.length !== stored.length) continue;
    const s = new Set<number>(), g = new Set<number>();
    stored.forEach((d, k) => {
      aligned++;
      const storedNew = !s.has(d.nn), generatedNew = !g.has(generated[k].nn);
      s.add(d.nn); g.add(generated[k].nn);
      if (storedNew !== generatedNew) disagreements.push(`${def.definitionId} ${d.key} ${d.event} stored ${storedNew ? 'new' : 'reuse'}`);
    });
  } catch { /* unsupported syntax */ }
}
console.log(`${operands} stored Declare Function operands in ${programs} ordinary programs`);
for (const [k, v] of [...matrix].sort()) console.log(String(v).padStart(7), k);
console.log(`aligned operands ${aligned}; stored/generated decision disagreements ${disagreements.length}`);
for (const d of disagreements) console.log('  ', d);
