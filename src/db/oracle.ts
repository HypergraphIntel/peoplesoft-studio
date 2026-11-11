import type { BindParameters, Connection, ExecuteOptions, Pool } from 'oracledb';
import { ColumnInfo, DbBinds, DbCatalog, DbConnection, DbPool, DbResult, DbTypes, SCHEMA_NAME } from './connection.js';

/*
 * Oracle through node-oracledb (Thin mode, or Thick with an Instant Client).
 * The reference platform: the provider's SQL is Oracle's, so statements and
 * binds pass straight through.
 */

export const DEFAULT_SCHEMA = 'SYSADM';

/**
 * How node-oracledb reaches Oracle. Thin is pure JavaScript. Thick loads Oracle Client libraries (Instant Client), which
 * some databases require: Native Network Encryption or checksumming (sqlnet.ora), older password verifiers, databases
 * before 12.1, or Oracle Net features Thin lacks. The mode is per process -- per VS Code window -- and once a connection
 * has been opened in one mode the other cannot start until the window reloads (node-oracledb NJS-118 / NJS-090).
 */
export interface OracleClientOptions {
  mode: 'thin' | 'thick';
  /** Thick: the Instant Client directory; absent: the system library search path (Linux ldconfig / LD_LIBRARY_PATH, Windows PATH). */
  libDir?: string;
  /** Oracle Net configuration (tnsnames.ora, sqlnet.ora, wallets): Thick's configDir, Thin's per-connection configDir. */
  configDir?: string;
}

export interface OracleOpenOptions {
  connectString: string;
  user: string;
  password: string;
  /** Absent: Thin mode, no configuration directory. */
  oracleClient?: OracleClientOptions;
  /** Configured PeopleTools schema; absent: PS.PSDBOWNER's owner ID for this database, else SYSADM. */
  schema?: string;
}

type OracleDb = typeof import('oracledb');

/** A message the developer can act on, for a client start that failed. */
export function thickModeFailure(err: unknown, client: OracleClientOptions, platform: NodeJS.Platform = process.platform): string {
  const code = String((err as { code?: string })?.code ?? (reason(err).match(/^(NJS|DPI)-\d+/)?.[0] ?? ''));
  const where = client.libDir ? `in ${client.libDir}` : 'on the system library search path';
  if (code === 'NJS-118') {
    return 'Thick mode cannot start: this window already opened an Oracle connection in Thin mode, and node-oracledb cannot switch ' +
      'a running window. Reload the window (Developer: Reload Window), then connect again.';
  }
  if (code === 'NJS-090') {
    return 'Thick mode already started in this window with a different Instant Client or configuration directory. ' +
      'Reload the window (Developer: Reload Window) to use the new one.';
  }
  if ((code === 'DPI-1047' || code === 'NJS-045') && platform === 'linux' && client.libDir && /cannot open shared object file/.test(reason(err))) {
    // node-oracledb found libclntsh in the directory, but Linux resolves its own libraries (libnnz ...) only from the
    // search path the process started with (seen with Instant Client 23.26, 2026-11-11).
    return `Thick mode cannot start: the Oracle Client in ${client.libDir} needs its directory on the library search path when VS Code starts. ` +
      `Add it once with \`echo ${client.libDir} | sudo tee /etc/ld.so.conf.d/oracle-instantclient.conf && sudo ldconfig\`, ` +
      `or start VS Code with LD_LIBRARY_PATH=${client.libDir}; then reload the window. (${reason(err)})`;
  }
  if (code === 'DPI-1047' || code === 'NJS-045') {
    const hint = platform === 'linux'
      ? ' On Linux, install the 64-bit Instant Client Basic or Basic Light package and libaio (libaio1 / libaio1t64), and give its directory here or add it to ldconfig before VS Code starts.'
      : platform === 'win32'
        ? ' On Windows, use the 64-bit Instant Client and the Visual Studio redistributable it names, and give its directory here.'
        : platform === 'darwin' ? ' On macOS, give the Instant Client directory here.' : '';
    return `Thick mode cannot start: no 64-bit Oracle Client libraries were found ${where}.${hint} (${reason(err)})`;
  }
  return `Could not start Oracle Thick mode ${where}: ${reason(err)}`;
}

/**
 * Starts the client mode the options ask for, once per window. Thick calls initOracleClient, which node-oracledb allows
 * again with the same arguments; Thin needs nothing. When Thin is asked for in a window already in Thick mode, Thick
 * serves it (Thick reaches every database Thin does). Returns the mode in use.
 */
export function startOracleClient(oracledb: Pick<OracleDb, 'initOracleClient' | 'thin'>, client: OracleClientOptions | undefined): 'thin' | 'thick' {
  if (client?.mode !== 'thick') return oracledb.thin ? 'thin' : 'thick';
  const args = { ...(client.libDir ? { libDir: client.libDir } : {}), ...(client.configDir ? { configDir: client.configDir } : {}) };
  try {
    oracledb.initOracleClient(args);
  } catch (err) {
    throw new OpenError(thickModeFailure(err, client), err);
  }
  return 'thick';
}

/** The client in use, for connection details: node-oracledb's version and, in Thick mode, the Oracle Client's. */
export function describeOracleClient(oracledb: Pick<OracleDb, 'versionString'> & { oracleClientVersionString?: string }, mode: 'thin' | 'thick'): string {
  if (mode === 'thin') return `node-oracledb ${oracledb.versionString} Thin`;
  let client = '';
  try { client = oracledb.oracleClientVersionString ?? ''; } catch { /* not readable before Thick starts */ }
  return `node-oracledb ${oracledb.versionString} Thick${client ? `, Oracle Client ${client}` : ''}`;
}

/**
 * The PeopleTools owner ID PS.PSDBOWNER records: the row for this database,
 * else its only row; undefined when it has neither or cannot be read.
 */
export async function detectSchema(c: Connection): Promise<string | undefined> {
  try {
    const r = await c.execute<{ DBNAME: string; OWNERID: string; DB: string }>(
      `SELECT DBNAME, OWNERID, SYS_CONTEXT('USERENV', 'DB_NAME') AS DB FROM PS.PSDBOWNER`);
    const rows = r.rows ?? [];
    const db = String(rows[0]?.DB ?? '').trim().toUpperCase();
    const row = rows.find((x) => String(x.DBNAME).trim().toUpperCase() === db) ?? (rows.length === 1 ? rows[0] : undefined);
    const owner = String(row?.OWNERID ?? '').trim().toUpperCase();
    return SCHEMA_NAME.test(owner) ? owner : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads node-oracledb, lazily and in a form whose settings can be written.
 *
 * The module is required lazily because it resolves a driver at load time, and
 * an extension that only ever opens project exports should not pay for that.
 *
 * Unwrapping `default` is not optional. node-oracledb is CommonJS, and a
 * dynamic `import()` of a CommonJS module yields an ES module namespace object,
 * which is sealed: assigning `outFormat` on it throws
 * "Cannot assign to property 'outFormat' of [object Module]". The mutable
 * exports object -- the one whose settings actually take effect -- is the
 * namespace's default export. The fallback covers a host that hands back the
 * exports object directly.
 */
export async function loadOracleDb(): Promise<typeof import('oracledb')> {
  const namespace = await import('oracledb');
  const resolved = (namespace as { default?: typeof import('oracledb') }).default ?? namespace;
  if (typeof resolved?.createPool !== 'function') {
    throw new Error(
      'The oracledb module loaded but does not look like node-oracledb. ' +
      'Reinstall the extension, or check that node_modules/oracledb is intact.');
  }
  return resolved;
}

/** Why a step of opening failed, attached to the driver's own error. */
export class OpenError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'OpenError';
  }
}

const reason = (err: unknown) => {
  const message = (err as { message?: string })?.message;
  return message ? message.trim().split('\n')[0] : String(err);
};

export async function openOracle(options: OracleOpenOptions): Promise<DbPool> {
  const oracledb = await loadOracleDb();
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.fetchAsBuffer = [oracledb.BLOB];

  const mode = startOracleClient(oracledb, options.oracleClient);
  // Thin reads tnsnames.ora from a per-connection configDir; Thick took it in initOracleClient.
  const net = mode === 'thin' && options.oracleClient?.configDir ? { configDir: options.oracleClient.configDir } : {};

  const configured = options.schema?.trim().toUpperCase();
  if (configured && !SCHEMA_NAME.test(configured)) throw new OpenError(`${options.schema} is not a valid schema name.`, undefined);

  // A standalone session first: it proves the host and credentials (createPool
  // with poolMin 0 opens nothing, so it succeeds against an unreachable host
  // or a wrong password) and finds the schema before the pool exists.
  let schema: string;
  try {
    const probe = await oracledb.getConnection({
      user: options.user, password: options.password, connectString: options.connectString, ...net
    });
    try {
      schema = configured || await detectSchema(probe) || DEFAULT_SCHEMA;
    } finally {
      await probe.close();
    }
  } catch (err) {
    throw new OpenError(`Could not connect to ${options.connectString} as ${options.user}: ${reason(err)}`, err);
  }

  // Queries name the PeopleTools tables unqualified: every session the pool
  // creates resolves them in the PeopleSoft schema (CURRENT_SCHEMA), so one
  // setting serves SYSADM and every other owner ID.
  let pool: Pool;
  try {
    pool = await oracledb.createPool({
      user: options.user,
      password: options.password,
      connectString: options.connectString,
      ...net,
      poolMin: 0,
      poolMax: 4,
      poolTimeout: 120,
      sessionCallback: (conn: Connection, _tag: string, done: (error?: Error) => void) => {
        conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schema}`).then(() => done(), (error: Error) => done(error));
      }
    });
  } catch (err) {
    throw new OpenError(`Could not connect to ${options.connectString}: ${reason(err)}`, err);
  }

  // A session as every later one will be: the schema set, the PeopleTools tables there.
  try {
    const check = await pool.getConnection();
    try {
      await check.execute(`SELECT TOOLSREL FROM PSSTATUS`);
    } finally {
      await check.close();
    }
  } catch (err) {
    await pool.close(0).catch(() => { /* the pool is already unusable */ });
    throw new OpenError(
      `Connected to ${options.connectString}, but schema ${schema} has no PeopleTools tables readable as ${options.user}: ${reason(err)}`,
      err);
  }

  return new OraclePool(pool, schema, oracledb as unknown as DbTypes, describeOracleClient(oracledb, mode));
}

const ORACLE_CATALOG: DbCatalog = {
  async columns(c, table) {
    const r = await c.execute<{ N: string; T: string }>(
      `SELECT COLUMN_NAME AS N, DATA_TYPE AS T FROM ALL_TAB_COLUMNS
        WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND TABLE_NAME = :t ORDER BY COLUMN_ID`, { t: table });
    return (r.rows ?? []).map((row): ColumnInfo => ({ name: row.N, dataType: row.T }));
  },
  async tableExists(c, table) {
    const r = await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM ALL_TABLES WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND TABLE_NAME = :t`, { t: table });
    return Number(r.rows?.[0]?.N ?? 0) > 0;
  }
};

class OraclePool implements DbPool {
  readonly platform = 'oracle' as const;
  readonly catalog = ORACLE_CATALOG;
  readonly ddlPlatformId = 2;

  constructor(private readonly pool: Pool, readonly schema: string, readonly types: DbTypes, readonly driver: string) {}

  async getConnection(): Promise<DbConnection> {
    return new OracleConnection(await this.pool.getConnection());
  }

  async close(drainSeconds = 10): Promise<void> {
    await this.pool.close(drainSeconds);
  }
}

/** node-oracledb's connection, as it is: statements and binds go straight through. */
class OracleConnection implements DbConnection {
  readonly catalog = ORACLE_CATALOG;

  constructor(private readonly c: Connection) {}

  async execute<T>(sql: string, binds: DbBinds = {}, options: Record<string, unknown> = {}): Promise<DbResult<T>> {
    return this.c.execute<T>(sql, binds as BindParameters, options as ExecuteOptions);
  }

  commit(): Promise<void> { return this.c.commit(); }
  rollback(): Promise<void> { return this.c.rollback(); }
  close(): Promise<void> { return this.c.close(); }
}
