/*
 * Cycle 185: validate the PSPCMTXT.HASH_SIGNATURE candidate against a
 * database's native saves. READ ONLY: one SELECT inside a READ ONLY
 * transaction, rolled back; nothing is written anywhere but the report.
 *
 * Every PSPCMTXT row was written by PeopleTools itself, so every stored
 * signature is a native-save sample. For each program (seven-part key) the
 * stored signatures are compared with predictSourceSignature under three
 * readings of a multi-row program:
 *   - per-row:  each row's signature covers that row's PCTEXT;
 *   - whole:    each row's signature covers the whole program's text;
 *   - first:    PROGSEQ 0's signature covers the whole text (others ignored).
 * A single-row program is the same under all three.
 *
 * Connection: PS_CONNECT_STRING / PS_USER / PS_PASSWORD (as the other
 * corpus tools). Those usually point at HCDEV, so --database is required:
 * the scan refuses unless the connected DB_NAME equals it, and refuses the
 * protected institutional databases outright (as openLab does).
 *
 *   PS_CONNECT_STRING=127.0.0.1:15210/hrdmo PS_USER=... PS_PASSWORD=... \
 *     npx tsx tools/corpus/source-signature/validate.ts --database HRDMO \
 *     [--prefix ZZ_PCODE_LAB] [--limit N] [--out file.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import oracledb from 'oracledb';

import { getConnectionConfig, openCorpusConnection } from '../discovery';
import { predictSourceSignature } from '../../../src/peoplecode/sourceSignature';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';

const KEY_COLUMNS = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`OBJECTID${n}`, `OBJECTVALUE${n}`]);

interface Row {
  key: string;
  progseq: number;
  text: string;
  signature: string;
}

interface ProgramResult {
  key: string;
  rows: number;
  length: number;
  nonAscii: boolean;
  perRow: boolean;
  whole: boolean;
  first: boolean;
  stored: string[];
  predictedWhole: string;
}

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function evaluate(rows: Row[]): ProgramResult {
  const whole = rows.map((r) => r.text).join('');
  const predictedWhole = predictSourceSignature(whole);
  return {
    key: rows[0].key,
    rows: rows.length,
    length: whole.length,
    nonAscii: /[^\x00-\x7f]/.test(whole),
    perRow: rows.every((r) => r.signature === predictSourceSignature(r.text)),
    whole: rows.every((r) => r.signature === predictedWhole),
    first: rows[0].progseq === 0 && rows[0].signature === predictedWhole,
    stored: rows.map((r) => r.signature),
    predictedWhole
  };
}

async function main(): Promise<void> {
  const expected = argument('database');
  if (!expected) throw new Error('--database <DB_NAME> is required (PS_CONNECT_STRING usually points at HCDEV).');
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const prefix = argument('prefix');
  const limit = argument('limit') !== undefined ? Number(argument('limit')) : undefined;

  const connection = await openCorpusConnection(getConnectionConfig());
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    const [identity] = (await connection.execute<{ DB_NAME: string; TOOLSREL: string; PTPATCHREL: number }>(
      `SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB_NAME, TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS`,
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [];
    const database = String(identity?.DB_NAME ?? '').trim();
    if (PROTECTED_DATABASE_PATTERN.test(database)) throw new Error(`Connected to ${database}, a protected institutional database: refusing.`);
    if (database.toUpperCase() !== expected.toUpperCase()) {
      throw new Error(`Connected to ${database}, not ${expected}: refusing.`);
    }
    const release = `${String(identity?.TOOLSREL ?? '').trim()}.${String(identity?.PTPATCHREL ?? '').padStart(2, '0')}`;
    console.log(`${database} (PeopleTools ${release}): scanning PSPCMTXT${prefix ? ` where OBJECTVALUE1 LIKE '${prefix}%'` : ''}...`);

    const where = prefix ? `WHERE OBJECTVALUE1 LIKE :prefix ESCAPE '\\'` : '';
    const binds = prefix ? { prefix: `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%` } : {};
    const result = await connection.execute(
      `SELECT ${KEY_COLUMNS.join(', ')}, PROGSEQ, PCTEXT, HASH_SIGNATURE
         FROM SYSADM.PSPCMTXT ${where}
        ORDER BY ${KEY_COLUMNS.join(', ')}, PROGSEQ`,
      binds,
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        resultSet: true,
        fetchInfo: { PCTEXT: { type: oracledb.STRING } }
      });
    const resultSet = result.resultSet!;

    const programs: ProgramResult[] = [];
    let current: Row[] = [];
    const flush = () => {
      if (current.length > 0) programs.push(evaluate(current));
      current = [];
    };

    for (;;) {
      const batch = (await resultSet.getRows(1000)) as Record<string, unknown>[];
      if (batch.length === 0) break;
      for (const r of batch) {
        const key = KEY_COLUMNS.map((c) => String(r[c] ?? '').trim()).join('|');
        if (current.length > 0 && current[0].key !== key) {
          flush();
          if (limit !== undefined && programs.length >= limit) break;
        }
        current.push({
          key,
          progseq: Number(r.PROGSEQ),
          text: String(r.PCTEXT ?? ''),
          signature: String(r.HASH_SIGNATURE ?? '').trim()
        });
      }
      if (limit !== undefined && programs.length >= limit) break;
    }
    if (limit === undefined || programs.length < limit) flush();
    await resultSet.close();

    const single = programs.filter((p) => p.rows === 1);
    const multi = programs.filter((p) => p.rows > 1);
    const matches = (p: ProgramResult) => p.perRow || p.whole || p.first;
    const mismatches = programs.filter((p) => !matches(p));
    const summary = {
      programs: programs.length,
      singleRow: { total: single.length, match: single.filter((p) => p.whole).length },
      multiRow: {
        total: multi.length,
        perRow: multi.filter((p) => p.perRow).length,
        whole: multi.filter((p) => p.whole).length,
        first: multi.filter((p) => p.first).length
      },
      nonAscii: {
        total: programs.filter((p) => p.nonAscii).length,
        match: programs.filter((p) => p.nonAscii && matches(p)).length
      },
      empty: programs.filter((p) => p.length === 0).length,
      mismatches: mismatches.length
    };

    const report = {
      format: 'pspcmtxt-signature-validation/1',
      database,
      peopleToolsRelease: release,
      scope: prefix ? `OBJECTVALUE1 LIKE '${prefix}%'` : 'all of PSPCMTXT',
      limit: limit ?? null,
      candidate: 'base64(SHA-1(UTF-16LE(PCTEXT)) || 0x00)',
      scannedAt: new Date().toISOString(),
      summary,
      mismatchSamples: mismatches.slice(0, 200)
    };

    const out = argument('out') ??
      path.join('tools', 'corpus', 'source-signature', 'results', `${database}-${new Date().toISOString().slice(0, 10)}.json`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify(summary, null, 2));
    console.log(mismatches.length === 0
      ? `Zero mismatches across ${programs.length} programs.`
      : `${mismatches.length} mismatch(es); samples in ${out}.`);
    console.log(`Report: ${out}`);
    process.exitCode = mismatches.length === 0 ? 0 : 1;
  } finally {
    await connection.rollback();
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
