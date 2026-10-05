/*
 * Cycle 175: read-only access to the controlled-compile LAB database,
 * shared by capture-lab.ts and orchestrate.ts.
 *
 * Every session:
 * - is SELECT-only, inside a READ ONLY transaction (so open a new one for
 *   each capture: a read-only transaction keeps its snapshot);
 * - reads only keys whose OBJECTVALUE1 starts with ZZ_PCODE_LAB;
 * - refuses institutional databases, and any database whose DB_NAME
 *   differs from the expected lab.
 *
 * Connection: PS_CONNECT_STRING / PS_USER / PS_PASSWORD
 * (tools/corpus/discovery.ts), set only for the lab's SELECT-only
 * capture account.
 */
import oracledb from 'oracledb';

import { captureDefinition, getConnectionConfig, openCorpusConnection } from '../discovery';
import type { CorpusDefinition } from '../classifications';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import { SCRATCH_LIKE } from '../../../src/peoplecode/corpus/labSafety';
import type {
  ControlledCompileDefinition,
  ControlledCompileKey,
  ExperimentPack
} from '../../../src/peoplecode/corpus/controlledCompile';

export const LAB_PREFIX = 'ZZ_PCODE_LAB';

export interface LabSession {
  database: string;
  toolsRelease: string;
  patch: number;
  select(sql: string, binds?: oracledb.BindParameters): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
  connection: oracledb.Connection;
}

export const sameKey = (a: ControlledCompileKey, b: ControlledCompileKey): boolean =>
  a.objectIds.every((id, i) => Number(id) === Number(b.objectIds[i]) &&
    String(a.objectValues[i] ?? '').trim().toUpperCase() === String(b.objectValues[i] ?? '').trim().toUpperCase());

export async function openLab(expectedDatabase: string): Promise<LabSession> {
  if (PROTECTED_DATABASE_PATTERN.test(expectedDatabase)) throw new Error(`${expectedDatabase} is an institutional database, not a lab.`);
  const connection = await openCorpusConnection(getConnectionConfig());
  const close = async () => {
    await connection.rollback();
    await connection.close();
  };
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    const select = async (sql: string, binds: oracledb.BindParameters = {}) =>
      ((await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? []) as Record<string, unknown>[];
    const [identity] = await select(`SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB_NAME FROM DUAL`);
    const database = String(identity?.DB_NAME ?? '').trim();
    if (PROTECTED_DATABASE_PATTERN.test(database)) throw new Error(`Connected to ${database}, an institutional database: refusing.`);
    if (database.toUpperCase() !== expectedDatabase.toUpperCase()) {
      throw new Error(`Connected to ${database}, not the lab ${expectedDatabase}: refusing.`);
    }
    const [status] = await select('SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS');
    return {
      database,
      toolsRelease: String(status?.TOOLSREL ?? '').trim(),
      patch: Number(status?.PTPATCHREL),
      select,
      close,
      connection
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** The database clock, in the format checkLabCompile compares. */
export async function databaseTimestamp(lab: LabSession): Promise<string> {
  const [row] = await lab.select(`SELECT TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS NOW FROM DUAL`);
  return String(row?.NOW);
}

/** Capture every ZZ_PCODE_LAB program, or only `onlyKey`. */
export async function captureLabDefinitions(
  lab: LabSession,
  pack: ExperimentPack,
  onlyKey?: ControlledCompileKey
): Promise<ControlledCompileDefinition[]> {
  const keys = await lab.select(`
    SELECT DISTINCT OBJECTID1, OBJECTVALUE1, OBJECTID2, OBJECTVALUE2, OBJECTID3, OBJECTVALUE3, OBJECTID4, OBJECTVALUE4,
                    OBJECTID5, OBJECTVALUE5, OBJECTID6, OBJECTVALUE6, OBJECTID7, OBJECTVALUE7
    FROM SYSADM.PSPCMPROG
    WHERE OBJECTVALUE1 ${SCRATCH_LIKE}
    ORDER BY 1, 2, 3, 4, 5, 6, 7, 8`);

  const definitions: ControlledCompileDefinition[] = [];
  for (const row of keys) {
    const key: ControlledCompileKey = {
      objectIds: [1, 2, 3, 4, 5, 6, 7].map(i => Number(row[`OBJECTID${i}`] ?? 0)),
      objectValues: [1, 2, 3, 4, 5, 6, 7].map(i => String(row[`OBJECTVALUE${i}`] ?? ' '))
    };
    if (onlyKey !== undefined && !sameKey(onlyKey, key)) continue;
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
    const captured = await captureDefinition(lab.connection, corpusDefinition);
    const keyBinds: oracledb.BindParameters = {};
    const keyPredicate = [1, 2, 3, 4, 5, 6, 7].map(i => {
      keyBinds[`id${i}`] = key.objectIds[i - 1];
      keyBinds[`v${i}`] = key.objectValues[i - 1];
      return `OBJECTID${i} = :id${i} AND OBJECTVALUE${i} = :v${i}`;
    }).join(' AND ');
    const [stamp] = await lab.select(`SELECT TO_CHAR(MAX(LASTUPDDTTM), 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS COMPILED_AT FROM SYSADM.PSPCMPROG WHERE ${keyPredicate}`, keyBinds);
    const compiledAt = stamp?.COMPILED_AT ? String(stamp.COMPILED_AT) : undefined;
    const experiment = pack.experiments.find(e => sameKey(e.key, key));
    const smoke = pack.smoke !== undefined && sameKey(pack.smoke.key, key) ? pack.smoke : undefined;
    const experimentId = experiment?.id ?? smoke?.id;
    definitions.push({
      ...(experimentId !== undefined ? { experimentId } : {}),
      key,
      ...(compiledAt !== undefined ? { compiledAt } : {}),
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
  }
  return definitions;
}
