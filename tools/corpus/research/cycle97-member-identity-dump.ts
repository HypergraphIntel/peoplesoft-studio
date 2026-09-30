/*
 * Cycle 97: stored and generated token streams of every ordinary
 * definition, with name operands resolved to their PSPCMNAME identity
 * (research only). Input for `cycle97-member-identity-census.py`.
 *
 * Each token is "<opcode hex>:<text>" or, for a name operand,
 * "N<opcode hex>:<RECNAME.REFNAME>". The owner row (NAMENUM 1) is written
 * as "N<opcode>:OWNER" on both sides.
 *
 * Usage: npx tsx tools/corpus/research/cycle97-member-identity-dump.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

function ownerOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function generatedKeyOf(g: any): string {
  switch (g.kind) {
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    default: return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
  }
}

function signature(bytes: Buffer, keys: Map<number, string>): string[] {
  const names = new NameTable();
  for (const [n, k] of keys) names.add(n, k);
  return decodeProgram(bytes, names, { mode: 'auto', isApplicationClass: false }).tokens.map(t =>
    t.nameNum !== undefined
      ? `N${t.opcode.toString(16)}:${t.nameNum === 1 ? 'OWNER' : keys.get(t.nameNum) ?? '?'}`
      : `${t.opcode.toString(16)}:${String(t.text ?? '').slice(0, 40)}`
  );
}

const out = fs.openSync(process.argv[2], 'w');
let written = 0;
for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (def.objectid1 === 104) continue;
  const storedKeys = new Map<number, string>();
  for (const r of def.names) storedKeys.set(Number(r.namenum), `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);
  try {
    const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerOf(def) } as any) as any;
    const generatedKeys = new Map<number, string>();
    for (const r of artifacts.references) generatedKeys.set(r.sequence, generatedKeyOf(r));
    fs.writeSync(out, JSON.stringify({
      id: def.definitionId,
      exact: artifacts.program.equals(def.storedProgram),
      s: signature(def.storedProgram, storedKeys),
      g: signature(artifacts.program, generatedKeys)
    }) + '\n');
    written++;
  } catch { /* unsupported syntax / encode error */ }
}
fs.closeSync(out);
console.log(`${written} definitions written`);
