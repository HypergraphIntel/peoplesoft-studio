/*
 * Cycle 167: where DECODE_SOURCE_MISMATCH source loss sits (research only;
 * READ-ONLY live HCDEV, SELECT only).
 *
 * For each listed definition: the database character sets, then at every
 * snapshot source character that differs from the decoded stored program
 * (first 4), PSPCMTXT.PCTEXT's own bytes there -- DUMP(..., 1016), LENGTH,
 * LENGTHB, ASCIISTR -- beside the snapshot's and the program's character.
 * If PCTEXT itself holds the replacement byte, the loss is in HCDEV's
 * source column, not in the capture, and a re-capture cannot recover it.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle167-dsm-source-bytes.ts <definitionId> ...
 */
import oracledb from 'oracledb';

import { getConnectionConfig, openCorpusConnection } from '../discovery';
import { openHarnessContext, decodeAsHarness, storedNameTable } from './lib/harnessContext';

const OBJECT = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

async function main(): Promise<void> {
  const ctx = openHarnessContext();
  const connection = await openCorpusConnection(getConnectionConfig());
  try {
    const nls = (await connection.execute(`SELECT parameter, value FROM nls_database_parameters WHERE parameter LIKE '%CHARACTERSET' ORDER BY parameter`, {}, OBJECT)).rows as any[];
    for (const row of nls) console.log(`${row.PARAMETER} = ${row.VALUE}`);
    for (const id of process.argv.slice(2).map(Number)) {
      const def = ctx.definitions.find(d => d.definitionId === id) as any;
      const source: string = def.sourceText;
      const program = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).text;
      console.log(`== ${id} ${def.displayName}`);
      const binds: Record<string, unknown> = {}; const predicate: string[] = [];
      for (let i = 1; i <= 7; i++) {
        predicate.push(`OBJECTID${i} = :i${i} AND OBJECTVALUE${i} = :v${i}`);
        binds[`i${i}`] = def[`objectid${i}`]; binds[`v${i}`] = def[`objectvalue${i}`];
      }
      const rows = (await connection.execute(`SELECT PROGSEQ, LENGTH(PCTEXT) AS LEN FROM SYSADM.PSPCMTXT WHERE ${predicate.join(' AND ')} ORDER BY PROGSEQ`, binds, OBJECT)).rows as any[];
      /* Lossy characters: non-ASCII snapshot characters whose 12-character left context recurs in the program with a different next character. */
      const lossy: Array<{ offset: number; programChar: number }> = [];
      for (const m of source.matchAll(/[^\x00-\x7f]/g)) {
        const left = source.slice(Math.max(0, m.index! - 12), m.index!);
        const at = program.indexOf(left);
        if (left.length === 12 && at >= 0 && program.charCodeAt(at + 12) !== source.charCodeAt(m.index!)) lossy.push({ offset: m.index!, programChar: program.charCodeAt(at + 12) });
        if (lossy.length === 4) break;
      }
      let base = 0;
      for (const row of rows) {
        for (const { offset, programChar } of lossy.filter(l => l.offset >= base && l.offset < base + row.LEN)) {
          const position = offset - base + 1;
          const result = (await connection.execute(
            `SELECT DUMP(DBMS_LOB.SUBSTR(PCTEXT, 1, :p), 1016) AS D, LENGTH(DBMS_LOB.SUBSTR(PCTEXT, 1, :p)) AS L, LENGTHB(DBMS_LOB.SUBSTR(PCTEXT, 1, :p)) AS LB, ASCIISTR(DBMS_LOB.SUBSTR(PCTEXT, 12, :s)) AS A
               FROM SYSADM.PSPCMTXT WHERE ${predicate.join(' AND ')} AND PROGSEQ = :seq`,
            { ...binds, p: position, s: Math.max(1, position - 5), seq: row.PROGSEQ }, OBJECT)).rows as any[];
          const r = result[0];
          console.log(`  offset ${offset} (PROGSEQ ${row.PROGSEQ} position ${position}): snapshot ${hex(source.charCodeAt(offset))}, program ${hex(programChar)}; PCTEXT ${r.D}, LENGTH ${r.L}, LENGTHB ${r.LB}, ASCIISTR "${r.A}"`);
        }
        base += row.LEN;
      }
    }
  } finally {
    await connection.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
