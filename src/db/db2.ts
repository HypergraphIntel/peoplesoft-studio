import type * as IbmDb from 'ibm_db';
import {
  ADAPTER_TYPES, ColumnInfo, DbBinds, DbCatalog, DbConnection, DbPool, DbResult, firstLine, SCHEMA_NAME, Serial, typedBind, upperKeys
} from './connection.js';
import { namedBinds, translateSql } from './sqlTranslate.js';

/*
 * DB2 (LUW, and z/OS through DB2 Connect) through `ibm_db` and IBM's CLI
 * driver. The PeopleTools schema is the session's CURRENT SCHEMA, so tables
 * stay unqualified as on Oracle. Each provider connection is one unit of work,
 * begun at its first statement and ended by commit / rollback.
 */

export interface Db2Target {
  host: string;
  port: number;
  database: string;
}

/** "host[:port]/database" -- the database being the location name on z/OS. */
export function parseDb2ConnectString(connectString: string): Db2Target {
  const m = /^\s*([^/:\s]+)(?::(\d+))?\/([^/\s]+)\s*$/.exec(connectString);
  if (!m) throw new Error(`"${connectString}" is not host[:port]/database.`);
  return { host: m[1], port: m[2] ? Number(m[2]) : 50000, database: m[3] };
}

/** A CLI connection-string value, braced when it holds a separator. */
const cliValue = (v: string) => (/[;{}]/.test(v) ? `{${v.replace(/}/g, '}}')}}` : v);

export function db2ConnectionString(target: Db2Target, user: string, password: string, schema?: string): string {
  return [
    `DATABASE=${cliValue(target.database)}`, `HOSTNAME=${cliValue(target.host)}`, `PORT=${target.port}`, 'PROTOCOL=TCPIP',
    `UID=${cliValue(user)}`, `PWD=${cliValue(password)}`, ...(schema ? [`CURRENTSCHEMA=${schema}`] : [])
  ].join(';') + ';';
}

/**
 * ibm_db finishes its asynchronous calls on worker threads without waking
 * Node's event loop: the result is delivered at the loop's next turn. With
 * another socket keeping the loop asleep (an open Oracle connection), every
 * call took 8-20 s here; with a timer turning the loop, milliseconds. So while any
 * DB2 call is outstanding, a short timer keeps the loop turning (unref'd: it
 * never keeps the extension host alive on its own).
 */
let outstanding = 0;
let heartbeat: ReturnType<typeof setInterval> | undefined;

export async function db2Call<T>(call: () => Promise<T>): Promise<T> {
  if (outstanding++ === 0) {
    heartbeat = setInterval(() => { /* turn the loop */ }, 1);
    heartbeat.unref?.();
  }
  try {
    return await call();
  } finally {
    if (--outstanding === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  }
}

/** Thrown when no ibm_db can be loaded: the message says how to get one. */
export class Db2DriverMissingError extends Error {
  constructor(where: string, cause: unknown) {
    const why = String((cause as { message?: string })?.message ?? '');
    // IBM's CLI driver links against libxml2.so.2, which newer Linux distributions replace (libxml2.so.16).
    const libxml = /libxml2\.so\.2/.test(why)
      ? ' IBM\'s CLI driver needs libxml2.so.2: install your distribution\'s libxml2 compatibility package (e.g. libxml2-legacy), or put a libxml2.so.2 on LD_LIBRARY_PATH.'
      : '';
    super(libxml ? `The DB2 driver could not load${where}.${libxml}`
      : `The DB2 driver (ibm_db) is not installed${where}. Run "PeopleSoft: Install DB2 Driver", ` +
        'or set peoplesoft.db2.driverPath to a directory holding node_modules/ibm_db.', { cause });
    this.name = 'Db2DriverMissingError';
  }
}

/**
 * ibm_db is not shipped in the extension: it carries IBM's CLI driver for one
 * operating system (some 85 MB). It is loaded from `driverPath` (a directory
 * with node_modules/ibm_db: the setting, or where Install DB2 Driver put it),
 * else resolved as any module is (development, the lab tools).
 */
async function loadIbmDb(driverPath?: string): Promise<typeof IbmDb> {
  if (driverPath) {
    try {
      const { createRequire } = await import('node:module');
      const { join } = await import('node:path');
      return createRequire(join(driverPath, 'package.json'))('ibm_db') as typeof IbmDb;
    } catch (err) {
      throw new Db2DriverMissingError(` in ${driverPath}`, err);
    }
  }
  try {
    const namespace = await import('ibm_db');
    return ((namespace as unknown as { default?: typeof IbmDb }).default ?? namespace) as typeof IbmDb;
  } catch (err) {
    throw new Db2DriverMissingError('', err);
  }
}

export interface Db2OpenOptions {
  connectString: string;
  user: string;
  password: string;
  /** Configured PeopleTools schema; absent: PS.PSDBOWNER's owner, else the user's default schema. */
  schema?: string;
  /** A directory with node_modules/ibm_db. */
  db2DriverPath?: string;
}

export async function openDb2(options: Db2OpenOptions): Promise<DbPool> {
  const ibmdb = await loadIbmDb(options.db2DriverPath);
  const target = parseDb2ConnectString(options.connectString);
  const configured = options.schema?.trim().toUpperCase();
  if (configured && !SCHEMA_NAME.test(configured)) throw new Error(`${configured} is not a valid schema name.`);

  // A standalone session first: it proves the host and credentials and finds the schema.
  const probe = await db2Call(() => ibmdb.open(db2ConnectionString(target, options.user, options.password)));
  let schema: string;
  let zos: boolean;
  try {
    // SQL_DBMS_NAME (17): "DB2/LINUXX8664", "DB2/NT64" ... on LUW; "DB2" (DSN) on z/OS.
    zos = !/^DB2\//i.test(String(probe.getInfoSync(17, 64) ?? ''));
    schema = configured || await detectOwner(probe)
      || String(((await db2Call(() => probe.query('SELECT CURRENT SCHEMA AS S FROM SYSIBM.SYSDUMMY1'))) as Record<string, unknown>[])[0]?.S ?? '').trim();
  } finally {
    await db2Call(() => probe.close());
  }

  const connStr = db2ConnectionString(target, options.user, options.password, schema);
  const pool = new ibmdb.Pool({ maxPoolSize: 4 });
  const adapter = new Db2Pool(pool, connStr, schema, zos ? 1 : 4);
  try {
    const c = await adapter.getConnection();
    try {
      await c.execute('SELECT TOOLSREL FROM PSSTATUS');
    } finally {
      await c.close();
    }
  } catch (err) {
    await adapter.close().catch(() => { /* already unusable */ });
    throw new Error(`Connected to ${options.connectString}, but schema ${schema} has no PeopleTools tables readable as ${options.user} ` +
      `(set the connection's Schema to the PeopleSoft owner ID): ${firstLine(err)}`, { cause: err });
  }
  return adapter;
}

async function detectOwner(db: IbmDb.Database): Promise<string | undefined> {
  try {
    const rows = await db2Call(() => db.query('SELECT DBNAME, OWNERID, CURRENT SERVER AS DB FROM PS.PSDBOWNER')) as unknown as { DBNAME: string; OWNERID: string; DB: string }[];
    const name = String(rows[0]?.DB ?? '').trim().toUpperCase();
    const row = rows.find((x) => String(x.DBNAME).trim().toUpperCase() === name) ?? (rows.length === 1 ? rows[0] : undefined);
    const owner = String(row?.OWNERID ?? '').trim().toUpperCase();
    return SCHEMA_NAME.test(owner) ? owner : undefined;
  } catch {
    return undefined;
  }
}

class Db2Pool implements DbPool {
  readonly platform = 'db2' as const;
  readonly types = ADAPTER_TYPES;
  readonly catalog: DbCatalog;

  constructor(
    private readonly pool: IbmDb.Pool, private readonly connStr: string, readonly schema: string,
    /** 4 for DB2 LUW, 1 for DB2 z/OS (PSDDLMODEL's PLATFORMID). */
    readonly ddlPlatformId: number
  ) {
    const schemaName = schema;
    this.catalog = {
      async columns(c, table) {
        const r = await c.execute<{ N: string; T: string }>(
          `SELECT COLNAME AS N, TYPENAME AS T FROM SYSCAT.COLUMNS WHERE TABSCHEMA = :s AND TABNAME = :t ORDER BY COLNO`, { s: schemaName, t: table });
        return (r.rows ?? []).map((row): ColumnInfo => ({ name: row.N.trim(), dataType: row.T.trim().toUpperCase() }));
      },
      async tableExists(c, table) {
        const r = await c.execute<{ N: number }>(
          `SELECT COUNT(*) AS N FROM SYSCAT.TABLES WHERE TABSCHEMA = :s AND TABNAME = :t`, { s: schemaName, t: table });
        return Number(r.rows?.[0]?.N ?? 0) > 0;
      }
    };
  }

  async getConnection(): Promise<DbConnection> {
    return new Db2Connection(await db2Call(() => this.pool.open(this.connStr)), this.catalog);
  }

  async close(): Promise<void> {
    await db2Call(() => this.pool.close());
  }
}

class Db2Connection implements DbConnection {
  private inTransaction = false;
  private readonly serial = new Serial();

  constructor(private readonly db: IbmDb.Database, readonly catalog: DbCatalog) {}

  execute<T>(statement: string, given: DbBinds = {}): Promise<DbResult<T>> {
    return this.serial.run(() => this.run<T>(statement, given));
  }

  private async run<T>(statement: string, given: DbBinds): Promise<DbResult<T>> {
    const binds = Array.isArray(given) ? namedBinds(statement, given) : given;
    const t = translateSql(statement, 'db2', binds);
    const params = t.binds.map((name) => {
      if (!(name in binds)) throw new Error(`No value bound for :${name}.`);
      return param(binds[name]);
    });
    if (!this.inTransaction) {
      await db2Call(() => this.db.beginTransaction());
      this.inTransaction = true;
    }
    if (/^\s*(SELECT|WITH|VALUES)\b/i.test(t.sql)) {
      const [result] = await db2Call(() => this.db.queryResult(t.sql, params as IbmDb.SQLParam[]));
      if (!result) return { rows: [] };
      try {
        const columns = result.getColumnMetadataSync();
        const rows = (await db2Call(() => result.fetchAll())) as Record<string, unknown>[];
        return { rows: rows.map((row) => convert(upperKeys(row), columns) as T) };
      } finally {
        result.closeSync();
      }
    }
    const stmt = await db2Call(() => this.db.prepare(t.sql));
    try {
      const n = await db2Call(() => stmt.executeNonQuery(params as IbmDb.SQLParam[]));
      return { rows: [], rowsAffected: Math.max(0, Number(n)) };
    } finally {
      stmt.closeSync(1); // SQL_DROP: free the statement
    }
  }

  commit(): Promise<void> {
    return this.serial.run(async () => {
      if (!this.inTransaction) return;
      this.inTransaction = false;
      await db2Call(() => this.db.commitTransaction());
    });
  }

  rollback(): Promise<void> {
    return this.serial.run(() => this.end());
  }

  private async end(): Promise<void> {
    if (!this.inTransaction) return;
    this.inTransaction = false;
    await db2Call(() => this.db.rollbackTransaction());
  }

  close(): Promise<void> {
    return this.serial.run(async () => {
      try {
        await this.end();
      } finally {
        // Back to the pool.
        await db2Call(() => this.db.close());
      }
    });
  }
}

/** A bind as ibm_db takes it: LOBs typed, long text as a CLOB. */
function param(value: unknown): unknown {
  const typed = typedBind(value);
  const v = typed ? typed.val : value;
  if (typed?.type === ADAPTER_TYPES.BLOB || Buffer.isBuffer(v)) return { ParamType: 'INPUT', DataType: 'BLOB', Data: v ?? null };
  if (typeof v === 'string' && (typed?.type === ADAPTER_TYPES.CLOB || v.length > 16_000)) return { ParamType: 'INPUT', DataType: 'CLOB', Data: v };
  if (v === undefined) return null;
  return v;
}


/** DATE / TIME / TIMESTAMP text as Date (local time, as node-oracledb returns them); BIGINT as a number. */
function convert(row: Record<string, unknown>, columns: { SQL_DESC_NAME: string; SQL_DESC_TYPE_NAME: string }[]): Record<string, unknown> {
  for (const col of columns) {
    const k = col.SQL_DESC_NAME.toUpperCase();
    const v = row[k];
    if (v === null || v === undefined) continue;
    const type = col.SQL_DESC_TYPE_NAME.toUpperCase();
    if (typeof v === 'string') {
      if (type === 'DATE') {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
        if (m) row[k] = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else if (type === 'TIMESTAMP') {
        const m = /^(\d{4})-(\d{2})-(\d{2})[- T](\d{2})[.:](\d{2})[.:](\d{2})(?:\.(\d+))?/.exec(v);
        if (m) {
          row[k] = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]),
            Math.floor(Number(`0.${m[7] ?? '0'}`) * 1000));
        }
      } else if (type === 'TIME') {
        const m = /^(\d{2})[.:](\d{2})[.:](\d{2})/.exec(v);
        if (m) row[k] = new Date(1900, 0, 1, Number(m[1]), Number(m[2]), Number(m[3]));
      } else if (type === 'BIGINT' || type === 'DECIMAL' || type === 'DECFLOAT') {
        row[k] = Number(v);
      }
    } else if (v instanceof Uint8Array && !Buffer.isBuffer(v)) {
      row[k] = Buffer.from(v);
    }
  }
  return row;
}
