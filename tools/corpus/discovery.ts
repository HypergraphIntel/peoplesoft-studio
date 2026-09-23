import oracledb from 'oracledb';

import {
  CorpusDefinition,
  CorpusDefinitionKey
} from './classifications';

const KEY_COUNT = 7;

export interface DiscoveryOptions {
  limit?: number;
  offset?: number;
  definitionIds?: number[];
}

export interface ConnectionConfig {
  user: string;
  password: string;
  connectString: string;
}

export interface CapturedDefinition {
  definition: CorpusDefinition;

  sourceRows: number;
  source: string;

  programRows: number;
  program: Buffer;

  names: Record<string, unknown>[];
}

type OracleKey = Record<string, unknown>;

function keyColumnNames(): string[] {
  const columns: string[] = [];

  for (let i = 1; i <= KEY_COUNT; i++) {
    columns.push(`OBJECTID${i}`);
    columns.push(`OBJECTVALUE${i}`);
  }

  return columns;
}

function oracleKey(row: OracleKey): OracleKey {
  const key: OracleKey = {};

  for (let i = 1; i <= KEY_COUNT; i++) {
    key[`OBJECTID${i}`] = row[`OBJECTID${i}`];
    key[`OBJECTVALUE${i}`] = row[`OBJECTVALUE${i}`];
  }

  return key;
}

function corpusKey(row: OracleKey): CorpusDefinitionKey {
  return {
    objectId1: Number(row.OBJECTID1 ?? 0),
    objectValue1: String(row.OBJECTVALUE1 ?? ''),

    objectId2: Number(row.OBJECTID2 ?? 0),
    objectValue2: String(row.OBJECTVALUE2 ?? ''),

    objectId3: Number(row.OBJECTID3 ?? 0),
    objectValue3: String(row.OBJECTVALUE3 ?? ''),

    objectId4: Number(row.OBJECTID4 ?? 0),
    objectValue4: String(row.OBJECTVALUE4 ?? ''),

    objectId5: Number(row.OBJECTID5 ?? 0),
    objectValue5: String(row.OBJECTVALUE5 ?? ''),

    objectId6: Number(row.OBJECTID6 ?? 0),
    objectValue6: String(row.OBJECTVALUE6 ?? ''),

    objectId7: Number(row.OBJECTID7 ?? 0),
    objectValue7: String(row.OBJECTVALUE7 ?? '')
  };
}

function keyDescription(key: OracleKey): string {
  const parts: string[] = [];

  for (let i = 1; i <= KEY_COUNT; i++) {
    const objectId = key[`OBJECTID${i}`];
    const objectValue = key[`OBJECTVALUE${i}`];

    if (
      objectId !== null &&
      objectId !== undefined &&
      objectValue !== null &&
      objectValue !== undefined &&
      String(objectValue).length > 0
    ) {
      parts.push(`${objectId}=${String(objectValue)}`);
    }
  }

  return parts.join(', ');
}

function buildKeyPredicate(
  key: OracleKey,
  binds: Record<string, unknown>
): string {
  const predicates: string[] = [];

  for (let i = 1; i <= KEY_COUNT; i++) {
    const objectIdColumn = `OBJECTID${i}`;
    const objectValueColumn = `OBJECTVALUE${i}`;

    const objectId = key[objectIdColumn];
    const objectValue = key[objectValueColumn];

    const idBind = `id${i}`;
    const valueBind = `value${i}`;

    if (objectId === null || objectId === undefined) {
      predicates.push(`${objectIdColumn} IS NULL`);
    } else {
      predicates.push(`${objectIdColumn} = :${idBind}`);
      binds[idBind] = objectId;
    }

    if (objectValue === null || objectValue === undefined) {
      predicates.push(`${objectValueColumn} IS NULL`);
    } else {
      predicates.push(`${objectValueColumn} = :${valueBind}`);
      binds[valueBind] = objectValue;
    }
  }

  return predicates.join('\n      AND ');
}

async function lobToBuffer(value: unknown): Promise<Buffer> {
  if (value === null || value === undefined) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return Buffer.from(value, 'binary');
  }

  const chunks: Buffer[] = [];

  for await (const chunk of value as AsyncIterable<Buffer | string>) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

async function lobToString(value: unknown): Promise<string> {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  const chunks: string[] = [];

  for await (const chunk of value as AsyncIterable<Buffer | string>) {
    chunks.push(
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString('utf8')
    );
  }

  return chunks.join('');
}

export function getConnectionConfig(): ConnectionConfig {
  const connectString = process.env.PS_CONNECT_STRING;
  const user = process.env.PS_USER;
  const password = process.env.PS_PASSWORD;

  const missing: string[] = [];

  if (!connectString) {
    missing.push('PS_CONNECT_STRING');
  }

  if (!user) {
    missing.push('PS_USER');
  }

  if (!password) {
    missing.push('PS_PASSWORD');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`
    );
  }

  return {
    user: user!,
    password: password!,
    connectString: connectString!
  };
}

export async function openCorpusConnection(
  config: ConnectionConfig
): Promise<oracledb.Connection> {
  return oracledb.getConnection(config);
}

export async function discoverDefinitions(
  connection: oracledb.Connection,
  options: DiscoveryOptions = {}
): Promise<CorpusDefinition[]> {
  const offset = options.offset ?? 0;

  const columns = keyColumnNames().join(',\n          ');

  const binds: Record<string, number> = {
    offset
  };

  if (options.limit !== undefined) {
    binds.endRow = offset + options.limit;
  }

  const rowLimitClause =
    options.limit !== undefined
      ? 'AND rn <= :endRow'
      : '';

  const sql = `
    SELECT *
    FROM (
      SELECT
        ${columns},
        ROW_NUMBER() OVER (
          ORDER BY ${keyColumnNames().join(', ')}
        ) AS RN
      FROM (
        SELECT DISTINCT
          ${columns}
        FROM SYSADM.PSPCMTXT
      )
    )
    WHERE RN > :offset
      ${rowLimitClause}
    ORDER BY RN
  `;

  const result = await connection.execute(
    sql,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  const rows =
    (result.rows ?? []) as OracleKey[];

  return rows.map(row => {
    const key = oracleKey(row);

    return {
      offset: Number(row.RN ?? 0) - 1,
      key: corpusKey(row),
      displayName: keyDescription(key)
    };
  });
}

function definitionToOracleKey(
  definition: CorpusDefinition
): OracleKey {
  const key = definition.key;

  return {
    OBJECTID1: key.objectId1,
    OBJECTVALUE1: key.objectValue1,

    OBJECTID2: key.objectId2,
    OBJECTVALUE2: key.objectValue2,

    OBJECTID3: key.objectId3,
    OBJECTVALUE3: key.objectValue3,

    OBJECTID4: key.objectId4,
    OBJECTVALUE4: key.objectValue4,

    OBJECTID5: key.objectId5,
    OBJECTVALUE5: key.objectValue5,

    OBJECTID6: key.objectId6,
    OBJECTVALUE6: key.objectValue6,

    OBJECTID7: key.objectId7,
    OBJECTVALUE7: key.objectValue7
  };
}

async function captureSource(
  connection: oracledb.Connection,
  key: OracleKey
): Promise<{
  rows: number;
  source: string;
}> {
  const binds: Record<string, unknown> = {};
  const predicate = buildKeyPredicate(key, binds);

  const result = await connection.execute(
    `
      SELECT
        PROGSEQ,
        PCTEXT
      FROM SYSADM.PSPCMTXT
      WHERE ${predicate}
      ORDER BY PROGSEQ
    `,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  const rows =
    (result.rows ?? []) as Array<Record<string, unknown>>;

  const parts: string[] = [];

  for (const row of rows) {
    parts.push(await lobToString(row.PCTEXT));
  }

  return {
    rows: rows.length,
    source: parts.join('')
  };
}

async function captureProgram(
  connection: oracledb.Connection,
  key: OracleKey
): Promise<{
  rows: number;
  program: Buffer;
}> {
  const binds: Record<string, unknown> = {};
  const predicate = buildKeyPredicate(key, binds);

  const result = await connection.execute(
    `
      SELECT
        PROGSEQ,
        PROGTXT
      FROM SYSADM.PSPCMPROG
      WHERE ${predicate}
      ORDER BY PROGSEQ
    `,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  const rows =
    (result.rows ?? []) as Array<Record<string, unknown>>;

  const chunks: Buffer[] = [];

  for (const row of rows) {
    chunks.push(await lobToBuffer(row.PROGTXT));
  }

  return {
    rows: rows.length,
    program: Buffer.concat(chunks)
  };
}

async function captureNames(
  connection: oracledb.Connection,
  key: OracleKey
): Promise<Record<string, unknown>[]> {
  const binds: Record<string, unknown> = {};
  const predicate = buildKeyPredicate(key, binds);

  const result = await connection.execute(
    `
      SELECT *
      FROM SYSADM.PSPCMNAME
      WHERE ${predicate}
      ORDER BY NAMENUM
    `,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  return (
    result.rows ?? []
  ) as Record<string, unknown>[];
}

export async function captureDefinition(
  connection: oracledb.Connection,
  definition: CorpusDefinition
): Promise<CapturedDefinition> {
  const key =
    definitionToOracleKey(definition);

  const source =
    await captureSource(connection, key);

  const program =
    await captureProgram(connection, key);

  const names =
    await captureNames(connection, key);

  return {
    definition,

    sourceRows: source.rows,
    source: source.source,

    programRows: program.rows,
    program: program.program,

    names
  };
}
