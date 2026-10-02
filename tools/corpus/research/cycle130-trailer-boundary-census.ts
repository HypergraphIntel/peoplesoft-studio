/*
 * Cycle 130: the program body / trailer boundary (research only).
 *
 * The encoder writes the statement length into the header (uint32 at 5 =
 * statements.length + 1) and then the 0x07 separator and the trailer
 * (declaration names, records, slots); so the stored header names the
 * separator offset, 36 + header[5]. Per program: whether that byte is
 * 0x07, the trailer length after it, the byte before it, and the
 * decoder's own boundary (trailerOffset + 1). Every `14 07` in a program
 * is classed as the header separator or not.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle130-trailer-boundary-census.ts --taxonomy t.json [out.jsonl]
 */
import fs from 'node:fs';

import { openHarnessContext, decodeAsHarness, storedNameTable, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const out = args[2] ? fs.openSync(args[2], 'w') : undefined;

const hex = (n: number | undefined) => n === undefined ? '--' : n.toString(16).padStart(2, '0');
const tally = new Map<string, number[]>();
const bump = (k: string, exact: boolean) => { const v = tally.get(k) ?? [0, 0]; tally.set(k, v); v[exact ? 0 : 1]++; };
const disagreements: string[] = [];
const ctx = openHarnessContext();
let total = 0, app = 0;
for (const def of ctx.definitions) {
  const b: Buffer = def.storedProgram;
  const exact = !taxonomy.has(def.definitionId);
  total++;
  if (isApplicationClass(def)) app++;
  const separator = b.length >= 37 ? 36 + b.readUInt32LE(5) : -1;
  const valid = separator >= 37 && separator < b.length && b[separator] === 0x07;
  const trailerLength = valid ? b.length - separator - 1 : -1;
  let decoderSeparator: number | undefined;
  try {
    const t = decodeAsHarness(def, b, storedNameTable(def)).trailerOffset;
    decoderSeparator = t === undefined ? undefined : t + 1;
  } catch { /* undecodable */ }
  const before = valid ? hex(b[separator - 1]) : '--';
  const agrees = decoderSeparator === separator || (decoderSeparator === undefined && trailerLength === 0);
  bump(`header separator ${valid ? 'valid' : 'INVALID'}; trailer ${trailerLength > 0 ? 'present' : trailerLength === 0 ? 'empty' : '?'}; byte before ${before}; decoder ${decoderSeparator === undefined ? 'no trailer' : decoderSeparator === separator ? 'same boundary' : 'OTHER boundary'}`, exact);
  if (!agrees) disagreements.push(`${def.definitionId}${exact ? '' : '*'}(header ${separator}, decoder ${decoderSeparator ?? '-'}, before ${before}, trailer ${trailerLength})`);
  for (let k = 38; k < b.length; k++) {
    if (b[k] === 0x07 && b[k - 1] === 0x14) bump(`14 07 ${k === separator ? `= header separator (trailer ${trailerLength > 0 ? 'present' : 'empty'})` : 'inside the body / trailer'}`, exact);
  }
  if (out !== undefined) fs.writeSync(out, JSON.stringify({ id: def.definitionId, app: isApplicationClass(def), exact, separator, valid, trailerLength, before, decoderSeparator, agrees }) + '\n');
}
console.log(`${total} programs (App Class ${app})\n  (EXACT / non-EXACT)`);
for (const [k, [e, n]] of [...tally].sort((x, y) => y[1][0] + y[1][1] - x[1][0] - x[1][1])) console.log(`  ${k.padEnd(96)} ${String(e).padStart(5)} / ${n}`);
console.log(`\nprograms whose decoder boundary differs from the header's (* non-EXACT): ${disagreements.length} ${disagreements.slice(0, 40).join(' ')}`);
if (out !== undefined) fs.closeSync(out);
