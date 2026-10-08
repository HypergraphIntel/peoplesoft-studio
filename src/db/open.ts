import type { DbPool } from './connection.js';
import type { SqlPlatform } from './sqlTranslate.js';

/** The databases PeopleSoft Studio connects to: PeopleTools' Oracle, Microsoft SQL Server and DB2 (LUW, z/OS). */
export type DatabasePlatform = SqlPlatform;

export const DATABASE_PLATFORMS: readonly DatabasePlatform[] = ['oracle', 'mssql', 'db2'];

export const PLATFORM_LABELS: Readonly<Record<DatabasePlatform, string>> = {
  oracle: 'Oracle',
  mssql: 'Microsoft SQL Server',
  db2: 'DB2'
};

export interface OpenOptions {
  connectString: string;
  user: string;
  password: string;
  /** Oracle only: an Instant Client directory (Thick mode). */
  thickModeLibDir?: string;
  /** DB2 only: a directory with node_modules/ibm_db (absent: resolved normally). */
  db2DriverPath?: string;
  schema?: string;
}

/** A pool on the PeopleTools schema, its sessions proven able to read PSSTATUS. Drivers load only when used. */
export async function openDatabase(platform: DatabasePlatform, options: OpenOptions): Promise<DbPool> {
  switch (platform) {
    case 'oracle': return (await import('./oracle.js')).openOracle(options);
    case 'mssql': return (await import('./mssql.js')).openMssql(options);
    case 'db2': return (await import('./db2.js')).openDb2(options);
  }
}

/** Whether a connection kind is a database (as opposed to a project export). */
export function isDatabaseKind(kind: string): kind is DatabasePlatform {
  return (DATABASE_PLATFORMS as readonly string[]).includes(kind);
}
