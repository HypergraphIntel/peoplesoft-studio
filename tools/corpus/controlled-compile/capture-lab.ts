/*
 * Cycle 172: read the controlled-compile experiments back from a LAB
 * database, SELECT only, into the results format
 * (src/peoplecode/corpus/controlledCompile.ts, pcode-lab-results/1).
 *
 *   PS_CONNECT_STRING=<lab alias> PS_USER=<lab user> PS_PASSWORD=... \
 *     npx tsx tools/corpus/controlled-compile/capture-lab.ts \
 *       --database <LAB DB_NAME> --out lab-results.json
 *       [--experiments tools/corpus/controlled-compile/experiments.json]
 *
 * Safety:
 *   - only SELECT statements, inside a READ ONLY transaction;
 *   - only keys whose OBJECTVALUE1 starts with ZZ_PCODE_LAB;
 *   - `--database` must equal the connected database's DB_NAME, and the
 *     institutional databases (HCDEV, HCTST, ...) are refused outright --
 *     their programs are the corpus, never lab output.
 *
 * Compare with: npx tsx tools/corpus/compare-controlled-compile.ts --results lab-results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import oracledb from 'oracledb';

import { captureDefinition, getConnectionConfig, openCorpusConnection } from '../discovery';
import type { CorpusDefinition } from '../classifications';
import {
  CONTROLLED_COMPILE_RESULTS_FORMAT,
  type ControlledCompileDefinition,
  type ControlledCompileKey,
  type ControlledCompileResults,
  type ExperimentPack
} from '../../../src/peoplecode/corpus/controlledCompile';

/** Never a lab: the institutional databases in the local tnsnames.ora (Cycle 172 inventory). */
const PROTECTED_DATABASES = /^(HCDEV|HCTST|HCUAT|HCPRD\w*|HCPAY|HCPPY|HCTRN|FS\w*)$/i;
const LAB_PREFIX = 'ZZ_PCODE_LAB';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sameKey = (a: ControlledCompileKey, b: ControlledCompileKey): boolean =>
  a.objectIds.every((id, i) => Number(id) === Number(b.objectIds[i]) &&
    String(a.objectValues[i] ?? '').trim().toUpperCase() === String(b.objectValues[i] ?? '').trim().toUpperCase());

async function main(): Promise<void> {
  const expectedDatabase = argument('--database');
  const out = argument('--out');
  if (expectedDatabase === undefined || out === undefined) {
    console.error('usage: capture-lab.ts --database <LAB DB_NAME> --out <results.json> [--experiments <pack.json>]');
    process.exit(2);
  }
  if (PROTECTED_DATABASES.test(expectedDatabase)) throw new Error(`${expectedDatabase} is an institutional database, not a lab.`);
  const pack = JSON.parse(fs.readFileSync(argument('--experiments') ?? path.join(__dirname, 'experiments.json'), 'utf8')) as ExperimentPack;

  const connection = await openCorpusConnection(getConnectionConfig());
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    const select = async (sql: string, binds: oracledb.BindParameters = {}) =>
      ((await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Record<string, unknown>[];

    const [identity] = await select(`SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB_NAME FROM DUAL`);
    const database = String(identity?.DB_NAME ?? '').trim();
    if (PROTECTED_DATABASES.test(database)) throw new Error(`Connected to ${database}, an institutional database: refusing.`);
    if (database.toUpperCase() !== expectedDatabase.toUpperCase()) {
      throw new Error(`Connected to ${database}, not the lab ${expectedDatabase}: refusing.`);
    }
    const [status] = await select('SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS');
    const toolsRelease = String(status?.TOOLSREL ?? '').trim();
    const patch = Number(status?.PTPATCHREL);
    if (patch !== 15) console.warn(`warning: PeopleTools ${toolsRelease} patch ${patch}; HCDEV is 8.61.15 -- results are not authoritative for patch 15.`);

    const keys = await select(`
      SELECT DISTINCT OBJECTID1, OBJECTVALUE1, OBJECTID2, OBJECTVALUE2, OBJECTID3, OBJECTVALUE3, OBJECTID4, OBJECTVALUE4,
                      OBJECTID5, OBJECTVALUE5, OBJECTID6, OBJECTVALUE6, OBJECTID7, OBJECTVALUE7
      FROM SYSADM.PSPCMPROG
      WHERE OBJECTVALUE1 LIKE :prefix
      ORDER BY 1, 2, 3, 4, 5, 6, 7, 8`, { prefix: `${LAB_PREFIX}%` });

    const definitions: ControlledCompileDefinition[] = [];
    for (const row of keys) {
      const key: ControlledCompileKey = {
        objectIds: [1, 2, 3, 4, 5, 6, 7].map(i => Number(row[`OBJECTID${i}`] ?? 0)),
        objectValues: [1, 2, 3, 4, 5, 6, 7].map(i => String(row[`OBJECTVALUE${i}`] ?? ' '))
      };
      const corpusDefinition: CorpusDefinition = {
        offset: definitions.length,
        displayName: key.objectValues.map(v => v.trim()).filter(Boolean).join('.'),
        key: {
          objectId1: key.objectIds[0], objectValue1: key.objectValues[0],
          objectId2: key.objectIds[1], objectValue2: key.objectValues[1],
          objectId3: key.objectIds[2], objectValue3: key.objectValues[2],
          objectId4: key.objectIds[3], objectValue4: key.objectValues[3],
          objectId5: key.objectIds[4], objectValue5: key.objectValues[4],
          objectId6: key.objectIds[5], objectValue6: key.objectValues[5],
          objectId7: key.objectIds[6], objectValue7: key.objectValues[6]
        }
      };
      const captured = await captureDefinition(connection, corpusDefinition);
      const experiment = pack.experiments.find(e => sameKey(e.key, key));
      definitions.push({
        ...(experiment !== undefined ? { experimentId: experiment.id } : {}),
        key,
        source: captured.source,
        programHex: captured.program.toString('hex'),
        names: captured.names.map(name => ({
          namenum: Number(name.NAMENUM),
          recname: String(name.RECNAME ?? ''),
          refname: String(name.REFNAME ?? ''),
          ...(name.PACKAGEROOT !== undefined ? { packageroot: String(name.PACKAGEROOT ?? '') } : {}),
          ...(name.QUALIFYPATH !== undefined ? { qualifypath: String(name.QUALIFYPATH ?? '') } : {}),
          ...(name.APPCLASSMETHOD !== undefined ? { appclassmethod: String(name.APPCLASSMETHOD ?? '') } : {})
        }))
      });
      console.log(`${experiment?.id ?? 'support'} ${corpusDefinition.displayName}: ${captured.program.length} bytes, ${captured.names.length} names`);
    }

    const missing = pack.experiments.filter(e => !definitions.some(d => d.experimentId === e.id)).map(e => e.id);
    if (missing.length > 0) console.warn(`not saved in the lab: ${missing.join(' ')}`);

    const results: ControlledCompileResults = {
      format: CONTROLLED_COMPILE_RESULTS_FORMAT,
      lab: { database, toolsRelease, ...(Number.isFinite(patch) ? { patch } : {}), capturedAt: new Date().toISOString() },
      definitions
    };
    fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`wrote ${definitions.length} definitions to ${out}`);
  } finally {
    await connection.rollback();
    await connection.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
