import type { SqlPlatform } from './sqlTranslate.js';

/*
 * The database surface the provider and its writers use: node-oracledb's
 * Connection API, narrowed to what they call. Oracle's connection is passed
 * through as it is; SQL Server's and DB2's adapters (mssql.ts, db2.ts)
 * implement the same calls, translating each statement first.
 *
 * Results are what node-oracledb returns with the provider's settings: rows
 * as objects keyed by upper-case column name; numbers as numbers; dates and
 * timestamps as Date; character LOBs as strings; binary as Buffer; NULL as
 * null.
 */

export interface DbResult<T> {
  rows?: T[];
  rowsAffected?: number;
}

/** A bind value, or a typed one: { val, type: types.BLOB | types.CLOB }. */
export type DbBinds = Record<string, unknown> | unknown[];

export interface DbConnection {
  /** The platform's data dictionary, for the PeopleTools schema. */
  readonly catalog: DbCatalog;
  execute<T = Record<string, unknown>>(sql: string, binds?: DbBinds, options?: Record<string, unknown>): Promise<DbResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The driver constants statements and binds name: node-oracledb's own on
 * Oracle; tokens the other adapters recognise elsewhere (they return text and
 * binary LOBs as strings and Buffers whatever the options ask).
 */
export interface DbTypes {
  OUT_FORMAT_OBJECT: number;
  STRING: unknown;
  CLOB: unknown;
  BLOB: unknown;
  DB_TYPE_CLOB: unknown;
  DB_TYPE_NCLOB: unknown;
}

export const ADAPTER_TYPES: DbTypes = {
  OUT_FORMAT_OBJECT: 4002,
  STRING: 'STRING',
  CLOB: 'CLOB',
  BLOB: 'BLOB',
  DB_TYPE_CLOB: 'DB_TYPE_CLOB',
  DB_TYPE_NCLOB: 'DB_TYPE_NCLOB'
};

/** A bound value that names its type, as the writers bind LOBs. */
export function typedBind(value: unknown): { val: unknown; type: unknown } | undefined {
  return value !== null && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) && 'val' in value
    ? value as { val: unknown; type: unknown }
    : undefined;
}

export interface ColumnInfo {
  name: string;
  /** The platform's type name, upper case: VARCHAR2, NVARCHAR, VARGRAPHIC, TIMESTAMP ... */
  dataType: string;
}

/** What differs between platforms beyond the SQL itself. */
export interface DbCatalog {
  /** A table's columns in column order; empty when it does not exist in the PeopleTools schema. */
  columns(c: DbConnection, table: string): Promise<ColumnInfo[]>;
  /** Whether the table exists in the PeopleTools schema. */
  tableExists(c: DbConnection, table: string): Promise<boolean>;
}

export interface DbPool {
  readonly platform: SqlPlatform;
  /** The schema the PeopleTools tables are read and written in. */
  readonly schema: string;
  readonly types: DbTypes;
  readonly catalog: DbCatalog;
  /**
   * The platform's PLATFORMID in PeopleTools' DDL tables (PSDDLMODEL,
   * PSDDLDEFPARMS, PSRECDDLPARM): 2 Oracle, 7 SQL Server, 4 DB2 LUW, 1 DB2 z/OS.
   */
  readonly ddlPlatformId: number;
  getConnection(): Promise<DbConnection>;
  close(drainSeconds?: number): Promise<void>;
}

/**
 * Runs one connection's calls one at a time, in order. node-oracledb queues
 * concurrent calls on a connection itself (the provider overlaps some reads
 * with Promise.all); mssql refuses them ("another request in progress") and
 * ibm_db does not promise to serialise them.
 */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Row keys in upper case, as Oracle returns unquoted names. */
export function upperKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.toUpperCase()] = v;
  return out;
}

/** A schema name, as it may be written into a statement (no binds there). */
export const SCHEMA_NAME = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;

/** A driver error's first line: the part that names the problem. */
export function firstLine(err: unknown): string {
  const message = (err as { message?: string })?.message;
  return message ? message.trim().split('\n')[0] : String(err);
}
