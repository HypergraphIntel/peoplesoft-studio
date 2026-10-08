import type * as Mssql from 'mssql';
import {
  ADAPTER_TYPES, ColumnInfo, DbBinds, DbCatalog, DbConnection, DbPool, DbResult, firstLine, SCHEMA_NAME, Serial, typedBind, upperKeys
} from './connection.js';
import { namedBinds, translateSql, type TranslateOptions } from './sqlTranslate.js';

/*
 * Microsoft SQL Server through `mssql` (tedious, pure JavaScript). Each
 * provider connection is one transaction on one pooled connection, begun at
 * its first statement and ended by commit / rollback (close rolls back what
 * was not committed) -- the same unit node-oracledb gives with autoCommit off.
 */

export interface MssqlTarget {
  server: string;
  instanceName?: string;
  port?: number;
  database: string;
}

/**
 * "host[\instance][:port]/database", as a connection's Connect string holds
 * it for SQL Server.
 */
export function parseMssqlConnectString(connectString: string): MssqlTarget {
  const m = /^\s*([^\\/:\s]+)(?:\\([^/:\s]+))?(?::(\d+))?\/([^/\s]+)\s*$/.exec(connectString);
  if (!m) throw new Error(`"${connectString}" is not host[\\instance][:port]/database.`);
  return {
    server: m[1],
    ...(m[2] ? { instanceName: m[2] } : {}),
    ...(m[3] ? { port: Number(m[3]) } : {}),
    database: m[4]
  };
}

async function loadMssql(): Promise<typeof Mssql> {
  const namespace = await import('mssql');
  return ((namespace as { default?: typeof Mssql }).default ?? namespace) as typeof Mssql;
}

export interface MssqlOpenOptions {
  connectString: string;
  user: string;
  password: string;
  /** Configured PeopleTools schema; absent: PSDBOWNER's owner, else the login's default schema. */
  schema?: string;
}

export async function openMssql(options: MssqlOpenOptions): Promise<DbPool> {
  const sql = await loadMssql();
  const target = parseMssqlConnectString(options.connectString);
  const pool = new sql.ConnectionPool({
    server: target.server,
    ...(target.port ? { port: target.port } : {}),
    database: target.database,
    user: options.user,
    password: options.password,
    pool: { max: 4, min: 0, idleTimeoutMillis: 120_000 },
    options: {
      ...(target.instanceName ? { instanceName: target.instanceName } : {}),
      // A PeopleSoft SQL Server is usually on the internal network with its
      // own certificate; encrypt when the server offers it, trust what it sends.
      encrypt: false,
      trustServerCertificate: true,
      // Local time, as node-oracledb returns DATE and TIMESTAMP.
      useUTC: false
    }
  });
  await pool.connect();
  try {
    const defaultSchema = String((await pool.request().query('SELECT SCHEMA_NAME() AS S')).recordset[0]?.S ?? 'dbo');
    const configured = options.schema?.trim();
    if (configured && !SCHEMA_NAME.test(configured)) throw new Error(`${configured} is not a valid schema name.`);
    const schema = configured || await detectOwner(pool) || defaultSchema;
    const qualify = schema.toLowerCase() === defaultSchema.toLowerCase() ? undefined : schema;
    // DATETIME or DATETIME2: how this database stores PeopleSoft's datetimes.
    const typeRow = (await pool.request().input('s', sql.NVarChar(128), schema).query(
      `SELECT UPPER(DATA_TYPE) AS T FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @s AND TABLE_NAME = 'PSPCMPROG' AND COLUMN_NAME = 'LASTUPDDTTM'`)).recordset[0];
    const dateTimeType = String(typeRow?.T ?? '') === 'DATETIME' ? 'DATETIME' as const : 'DATETIME2' as const;
    const adapter = new MssqlPool(sql, pool, schema, { ...(qualify ? { schema: qualify } : {}), dateTimeType });
    // A session as every later one will be: the PeopleTools tables in reach.
    const c = await adapter.getConnection();
    try {
      await c.execute('SELECT TOOLSREL FROM PSSTATUS');
    } catch (err) {
      throw new Error(`Connected to ${options.connectString}, but schema ${schema} has no PeopleTools tables readable as ${options.user} ` +
        `(set the connection's Schema to the PeopleSoft owner ID): ${firstLine(err)}`, { cause: err });
    } finally {
      await c.close();
    }
    return adapter;
  } catch (err) {
    await pool.close().catch(() => { /* already unusable */ });
    throw err;
  }
}

/** PSDBOWNER's owner ID for this database, when PeopleSoft recorded one. */
async function detectOwner(pool: Mssql.ConnectionPool): Promise<string | undefined> {
  for (const table of ['PS.PSDBOWNER', 'PSDBOWNER']) {
    try {
      const r = await pool.request().query(`SELECT DBNAME, OWNERID, DB_NAME() AS DB FROM ${table}`);
      const rows = r.recordset as { DBNAME: string; OWNERID: string; DB: string }[];
      const db = String(rows[0]?.DB ?? '').trim().toUpperCase();
      const row = rows.find((x) => String(x.DBNAME).trim().toUpperCase() === db) ?? (rows.length === 1 ? rows[0] : undefined);
      const owner = String(row?.OWNERID ?? '').trim();
      if (SCHEMA_NAME.test(owner)) return owner;
    } catch {
      // Not there: try the next place, then fall back.
    }
  }
  return undefined;
}

class MssqlPool implements DbPool {
  readonly platform = 'mssql' as const;
  readonly types = ADAPTER_TYPES;
  readonly ddlPlatformId = 7;
  readonly catalog: DbCatalog;

  constructor(
    private readonly sql: typeof Mssql,
    private readonly pool: Mssql.ConnectionPool,
    readonly schema: string,
    /** Translation settings: the schema to qualify tables with (when not the login's default), the datetime type. */
    private readonly options: TranslateOptions
  ) {
    const schemaName = schema;
    this.catalog = {
      async columns(c, table) {
        const r = await c.execute<{ N: string; T: string }>(
          `SELECT COLUMN_NAME AS N, UPPER(DATA_TYPE) AS T FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t ORDER BY ORDINAL_POSITION`, { s: schemaName, t: table });
        return (r.rows ?? []).map((row): ColumnInfo => ({ name: row.N.toUpperCase(), dataType: row.T }));
      },
      async tableExists(c, table) {
        const r = await c.execute<{ N: number }>(
          `SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t`, { s: schemaName, t: table });
        return Number(r.rows?.[0]?.N ?? 0) > 0;
      }
    };
  }

  async getConnection(): Promise<DbConnection> {
    return new MssqlConnection(this.sql, this.pool, this.options, this.catalog);
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}

/** INFORMATION_SCHEMA and other system views are never qualified with the PeopleTools schema. */
const SYSTEM_VIEW = /\bINFORMATION_SCHEMA\b|\bsys\./i;

class MssqlConnection implements DbConnection {
  private tx?: Mssql.Transaction;
  private readonly serial = new Serial();

  constructor(
    private readonly sql: typeof Mssql,
    private readonly pool: Mssql.ConnectionPool,
    private readonly options: TranslateOptions,
    readonly catalog: DbCatalog
  ) {}

  execute<T>(statement: string, given: DbBinds = {}): Promise<DbResult<T>> {
    return this.serial.run(() => this.run<T>(statement, given));
  }

  private async run<T>(statement: string, given: DbBinds): Promise<DbResult<T>> {
    const binds = Array.isArray(given) ? namedBinds(statement, given) : given;
    const { schema, ...rest } = this.options;
    const t = translateSql(statement, 'mssql', binds, schema && !SYSTEM_VIEW.test(statement) ? this.options : rest);
    if (!this.tx) {
      this.tx = new this.sql.Transaction(this.pool);
      await this.tx.begin(this.sql.ISOLATION_LEVEL.READ_COMMITTED);
    }
    const request = new this.sql.Request(this.tx);
    for (const name of t.binds) {
      if (!(name in binds)) throw new Error(`No value bound for :${name}.`);
      this.input(request, name, binds[name]);
    }
    const result = await request.query(t.sql);
    // BIGINT arrives as a digit string: the column's declared type says which these are.
    const columns = (result.recordset as unknown as { columns?: Record<string, { type?: unknown }> } | undefined)?.columns ?? {};
    const bigints = Object.entries(columns).filter(([, col]) => col.type === this.sql.BigInt).map(([n]) => n.toUpperCase());
    return {
      rows: (result.recordset ?? []).map((row) => normalise(upperKeys(row), bigints) as T),
      rowsAffected: (result.rowsAffected ?? []).reduce((a, b) => a + b, 0)
    };
  }

  private input(request: Mssql.Request, name: string, value: unknown): void {
    const sql = this.sql;
    const typed = typedBind(value);
    const v = typed ? typed.val : value;
    if (typed?.type === ADAPTER_TYPES.BLOB || Buffer.isBuffer(v)) request.input(name, sql.VarBinary(sql.MAX), v ?? null);
    else if (v === null || v === undefined) request.input(name, sql.NVarChar(sql.MAX), null);
    else if (typeof v === 'number') request.input(name, Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? sql.Int : sql.Float, v);
    else if (v instanceof Date) request.input(name, sql.DateTime2(6), v);
    else {
      const s = String(v);
      request.input(name, s.length > 4000 || typed?.type === ADAPTER_TYPES.CLOB ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), s);
    }
  }

  commit(): Promise<void> {
    return this.serial.run(async () => {
      const tx = this.tx;
      this.tx = undefined;
      await tx?.commit();
    });
  }

  rollback(): Promise<void> {
    return this.serial.run(async () => {
      const tx = this.tx;
      this.tx = undefined;
      await tx?.rollback();
    });
  }

  async close(): Promise<void> {
    await this.rollback().catch(() => { /* the connection is released either way */ });
  }
}

/** BIGINT columns as numbers; binary as Buffer. */
function normalise(row: Record<string, unknown>, bigints: readonly string[]): Record<string, unknown> {
  for (const k of bigints) if (typeof row[k] === 'string') row[k] = Number(row[k]);
  for (const [k, v] of Object.entries(row)) if (v instanceof Uint8Array && !Buffer.isBuffer(v)) row[k] = Buffer.from(v);
  return row;
}
