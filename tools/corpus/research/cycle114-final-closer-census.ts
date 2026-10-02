/*
 * Cycle 114: Application Class programs whose last implementation closer
 * has no `;` at the end of the source (research only).
 *
 * For every Application Class program: the source ending, whether the last
 * `end-method` / `end-get` / `end-set` is terminated, the implementation
 * headers in the source vs the implementations the parser returns, the
 * stored statement-stream ending (the bytes before the 0x07 directory
 * separator), the generated ending, the stored / generated PSPCMNAME row
 * counts, and forward exactness under the current encoder.
 *
 * Usage: npx tsx tools/corpus/research/cycle114-final-closer-census.ts <out.jsonl>
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';

const ending = (program: Buffer): string => {
  const statementsEnd = 37 + program.readUInt32LE(5) - 1;
  return program.subarray(Math.max(37, statementsEnd - 3), statementsEnd + 1).toString('hex');
};

const db = openSnapshotDatabase();
const provider = snapshotApplicationClassTypeMetadata(db);
const out = fs.openSync(process.argv[2], 'w');
const tally = new Map<string, number>();
for (const def of listSnapshotDefinitions(db) as any[]) {
  if (def.objectid1 !== 104) continue;
  const source = String(def.sourceText ?? '');
  const closers = [...source.matchAll(/\bend-(method|get|set)\b(\s*;)?/gi)];
  const last = closers.at(-1);
  const unterminated = last !== undefined && last[2] === undefined && source.slice(last.index! + last[0].length).trim() === '';
  const headers = [...source.matchAll(/^[ \t]*(method|get|set)\s+[A-Za-z_]\w*\s*$/gim)].length;
  const parsed = parseApplicationClassSource(source);
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const owner = { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, event < 0 ? values.length : event).filter(Boolean) };
  let generatedEnding = 'ERR', generatedRows = -1, exact = false;
  try {
    const artifacts = encodeProgramArtifacts(source, { owner, applicationClassTypeMetadata: provider });
    generatedEnding = ending(artifacts.program);
    generatedRows = artifacts.references.filter(r => r.kind !== 'owner').length;
    exact = artifacts.program.equals(def.storedProgram);
  } catch { /* encode error */ }
  const storedEnding = ending(def.storedProgram);
  const key = `${unterminated ? 'unterminated' : 'terminated'} stored-ends ${storedEnding.slice(-4)}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
  if (!unterminated) continue;
  fs.writeSync(out, JSON.stringify({
    id: def.definitionId, path: values.filter(Boolean).join(':'), sourceEnding: source.slice(-40),
    implementationHeaders: headers, parsedImplementations: parsed?.implementations.length ?? 0,
    storedEnding, generatedEnding, storedRows: def.names.length - 1, generatedRows, exact
  }) + '\n');
}
fs.closeSync(out);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String(n).padStart(6), k);
