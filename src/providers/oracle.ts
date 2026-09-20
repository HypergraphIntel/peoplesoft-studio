import type { Connection, Pool } from 'oracledb';
import {
  DefinitionProvider, DefinitionSummary, ProjectSummary, ProviderCapabilities,
  ProviderError, SearchQuery, UnsupportedOperationError
} from './provider.js';
import { DefinitionKey, DefinitionType, isPeopleCode, makeKey } from '../model/definitions.js';
import { FieldType, RecordDefinition, RecordField, RecordType } from '../model/record.js';
import { assembleProgram, NameTable } from '../peoplecode/progtext.js';
import { decodeProgram, DecodeOptions } from '../peoplecode/decoder.js';

export interface OracleConnectionConfig {
  name: string;
  connectString: string;
  user: string;
  password: string;
  /** Instant Client directory; absent means node-oracledb Thin mode. */
  thickModeLibDir?: string;
  decoderMode?: DecodeOptions['mode'];
}

/**
 * Reads PeopleSoft definitions straight out of the PeopleTools tables.
 *
 * All queries are read-only unless a write method is called explicitly. Writes
 * are deliberately narrow: PeopleTools keeps derived state (PSVERSION,
 * PSLOCK, cache records) consistent through App Designer, and a write that
 * updates a definition without bumping the matching version counters leaves
 * application servers serving stale cached copies. Every write here updates
 * the counters in the same transaction as the definition.
 */
export class OracleProvider implements DefinitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities = {
    write: true,
    globalSearch: true,
    build: true
  };

  private pool?: Pool;

  constructor(private readonly config: OracleConnectionConfig) {
    this.id = `oracle:${config.name}`;
    this.displayName = config.name;
  }

  get isConnected(): boolean { return this.pool !== undefined; }

  async connect(): Promise<void> {
    if (this.pool) return;
    // Required lazily: the module pulls in native bindings in Thick mode, and
    // an extension that never opens a database connection should not pay for
    // loading it.
    const oracledb = await import('oracledb');
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsBuffer = [oracledb.BLOB];

    if (this.config.thickModeLibDir) {
      try {
        oracledb.initOracleClient({ libDir: this.config.thickModeLibDir });
      } catch (err) {
        throw new ProviderError(
          `Could not initialise the Oracle Instant Client at ${this.config.thickModeLibDir}.`, err);
      }
    }

    try {
      this.pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.config.connectString,
        poolMin: 0,
        poolMax: 4,
        poolTimeout: 120
      });
    } catch (err) {
      throw new ProviderError(`Could not connect to ${this.config.connectString}.`, err);
    }
  }

  async dispose(): Promise<void> {
    await this.pool?.close(10);
    this.pool = undefined;
  }

  private async withConnection<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
    if (!this.pool) throw new ProviderError(`${this.displayName} is not connected.`);
    const conn = await this.pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      await conn.close();
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ PROJECTNAME: string; DESCR: string }>(
        `SELECT PROJECTNAME, DESCR FROM PSPROJECTDEFN ORDER BY PROJECTNAME`);
      return (r.rows ?? []).map((row) => ({ name: row.PROJECTNAME, description: row.DESCR }));
    });
  }

  async listProjectItems(project: string): Promise<DefinitionSummary[]> {
    return this.withConnection(async (c) => {
      const r = await c.execute<Record<string, string | number>>(
        `SELECT OBJECTTYPE,
                OBJECTID1, OBJECTVALUE1, OBJECTID2, OBJECTVALUE2,
                OBJECTID3, OBJECTVALUE3, OBJECTID4, OBJECTVALUE4,
                OBJECTID5, OBJECTVALUE5, OBJECTID6, OBJECTVALUE6,
                OBJECTID7, OBJECTVALUE7
           FROM PSPROJECTITEM
          WHERE PROJECTNAME = :p
          ORDER BY OBJECTTYPE, OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE4`,
        { p: project });
      return (r.rows ?? []).map((row) => ({
        key: makeKey(
          row.OBJECTTYPE as DefinitionType,
          ...[1, 2, 3, 4, 5, 6, 7].map((n) => String(row[`OBJECTVALUE${n}`] ?? '')))
      }));
    });
  }

  async search(query: SearchQuery): Promise<DefinitionSummary[]> {
    const limit = query.limit ?? 500;
    const pattern = (query.namePattern ?? '%').toUpperCase();

    switch (query.type) {
      case DefinitionType.Record:
        return this.searchSimple(
          `SELECT RECNAME AS NAME, RECDESCR AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSRECDEFN WHERE RECNAME LIKE :n`,
          DefinitionType.Record, pattern, limit);
      case DefinitionType.Field:
        return this.searchSimple(
          `SELECT FIELDNAME AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSDBFIELD WHERE FIELDNAME LIKE :n`,
          DefinitionType.Field, pattern, limit);
      case DefinitionType.Page:
        return this.searchSimple(
          `SELECT PNLNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSPNLDEFN WHERE PNLNAME LIKE :n`,
          DefinitionType.Page, pattern, limit);
      case DefinitionType.Component:
        return this.searchSimple(
          `SELECT PNLGRPNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSPNLGRPDEFN WHERE PNLGRPNAME LIKE :n`,
          DefinitionType.Component, pattern, limit);
      case DefinitionType.Menu:
        return this.searchSimple(
          `SELECT MENUNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSMENUDEFN WHERE MENUNAME LIKE :n`,
          DefinitionType.Menu, pattern, limit);
      case DefinitionType.AppEngineProgram:
        return this.searchSimple(
          `SELECT AE_APPLID AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSAEAPPLDEFN WHERE AE_APPLID LIKE :n`,
          DefinitionType.AppEngineProgram, pattern, limit);
      case DefinitionType.ApplicationPackage:
        return this.searchSimple(
          `SELECT PACKAGEROOT AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSPACKAGEDEFN WHERE PACKAGEROOT LIKE :n AND QUALIFYPATH = ' '`,
          DefinitionType.ApplicationPackage, pattern, limit);
      case DefinitionType.SqlDefinition:
        return this.searchSimple(
          `SELECT SQLID AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSSQLDEFN WHERE SQLID LIKE :n AND SQLTYPE = 0`,
          DefinitionType.SqlDefinition, pattern, limit);
      default:
        throw new UnsupportedOperationError(
          `searching definition type ${query.type}`, this.displayName);
    }
  }

  private async searchSimple(
    sql: string, type: DefinitionType, pattern: string, limit: number
  ): Promise<DefinitionSummary[]> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ NAME: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
        `${sql} ORDER BY 1 FETCH FIRST :lim ROWS ONLY`,
        { n: pattern, lim: limit });
      return (r.rows ?? []).map((row) => ({
        key: makeKey(type, row.NAME),
        description: row.DESCR?.trim() || undefined,
        lastUpdated: row.LASTUPDDTTM,
        lastUpdatedBy: row.LASTUPDOPRID?.trim()
      }));
    });
  }

  async readText(key: DefinitionKey): Promise<string> {
    if (isPeopleCode(key.type)) return this.readPeopleCode(key);
    if (key.type === DefinitionType.SqlDefinition) return this.readSqlDefinition(key);
    throw new UnsupportedOperationError(
      `reading definition type ${key.type} as text`, this.displayName);
  }

  /**
   * PeopleCode lives in PSPCMPROG as a chunked byte stream, with the names it
   * references held separately in PSPCMNAME. Both tables are keyed by the same
   * seven-part definition key.
   */
  private async readPeopleCode(key: DefinitionKey): Promise<string> {
    const binds = keyBinds(key);
    const where = keyPredicate(key);

    return this.withConnection(async (c) => {
      const prog = await c.execute<{ PROGSEQ: number; PROGTXT: Buffer }>(
        `SELECT PROGSEQ, PROGTXT FROM PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds);
      const rows = prog.rows ?? [];
      if (rows.length === 0) {
        throw new ProviderError(`No PeopleCode program found for ${key.parts.join('.')}.`);
      }

      const nameRows = await c.execute<{ NAMENUM: number; PCNAME: string }>(
        `SELECT NAMENUM, PCNAME FROM PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds);

      const names = new NameTable();
      for (const n of nameRows.rows ?? []) names.add(n.NAMENUM, n.PCNAME);

      const bytes = assembleProgram(rows.map((r) => ({ seq: r.PROGSEQ, data: r.PROGTXT })));
      return decodeProgram(bytes, names, { mode: this.config.decoderMode ?? 'auto' }).text;
    });
  }

  private async readSqlDefinition(key: DefinitionKey): Promise<string> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ SQLTEXT: string }>(
        `SELECT SQLTEXT FROM PSSQLTEXTDEFN
          WHERE SQLID = :id AND SQLTYPE = 0 ORDER BY SEQNUM`,
        { id: key.parts[0] });
      const rows = r.rows ?? [];
      if (rows.length === 0) throw new ProviderError(`No SQL definition named ${key.parts[0]}.`);
      return rows.map((x) => x.SQLTEXT).join('');
    });
  }

  async writeText(key: DefinitionKey, text: string): Promise<void> {
    if (isPeopleCode(key.type)) {
      // See decoder.ts: the stored format is not mapped well enough to write
      // back safely. Refusing is the only honest behaviour here — a partial
      // encoder would corrupt working programs.
      throw new UnsupportedOperationError(
        'saving PeopleCode to the database (use a project export, or App Designer)',
        this.displayName);
    }
    if (key.type === DefinitionType.SqlDefinition) return this.writeSqlDefinition(key, text);
    throw new UnsupportedOperationError(`saving definition type ${key.type}`, this.displayName);
  }

  /**
   * SQL definitions are plain text split across PSSQLTEXTDEFN rows. PeopleTools
   * chunks at 4000 bytes; we match that so App Designer reads back what we wrote.
   */
  private async writeSqlDefinition(key: DefinitionKey, text: string): Promise<void> {
    const CHUNK = 4000;
    const id = key.parts[0];
    await this.withConnection(async (c) => {
      await c.execute(`DELETE FROM PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id });
      for (let seq = 0, off = 0; off < text.length || seq === 0; seq++, off += CHUNK) {
        await c.execute(
          `INSERT INTO PSSQLTEXTDEFN (SQLID, SQLTYPE, SEQNUM, SQLTEXT)
           VALUES (:id, 0, :seq, :txt)`,
          { id, seq, txt: text.slice(off, off + CHUNK) });
      }
      await bumpVersion(c, 'SQL');
      await c.execute(
        `UPDATE PSSQLDEFN SET LASTUPDDTTM = SYSTIMESTAMP, VERSION =
           (SELECT VERSION FROM PSVERSION WHERE OBJECTTYPENAME = 'SQL')
         WHERE SQLID = :id AND SQLTYPE = 0`, { id });
      await c.commit();
    });
  }

  async readRecord(key: DefinitionKey): Promise<RecordDefinition> {
    const recname = key.parts[0];
    return this.withConnection(async (c) => {
      const defn = await c.execute<{
        RECNAME: string; RECDESCR: string; RECTYPE: number; VERSION: number;
        AUDITRECNAME: string; OPTRECTYPE: number
      }>(
        `SELECT RECNAME, RECDESCR, RECTYPE, VERSION, AUDITRECNAME
           FROM PSRECDEFN WHERE RECNAME = :r`, { r: recname });
      const head = defn.rows?.[0];
      if (!head) throw new ProviderError(`No record definition named ${recname}.`);

      // PSRECFIELD holds the record's own fields; PSRECFIELDALL additionally
      // expands subrecords, which is what App Designer shows. Reading ALL and
      // comparing against RECFIELD tells us which fields are inherited.
      const fields = await c.execute<{
        FIELDNAME: string; FIELDNUM: number; FIELDTYPE: number; LENGTH: number;
        DECIMALPOS: number; USEEDIT: number; EDITTABLE: string; DEFRECNAME: string;
        DEFFIELDNAME: string; SUBRECORD: string
      }>(
        `SELECT a.FIELDNAME, a.FIELDNUM, b.FIELDTYPE, b.LENGTH, b.DECIMALPOS,
                a.USEEDIT, a.EDITTABLE, a.DEFRECNAME, a.DEFFIELDNAME,
                CASE WHEN o.FIELDNAME IS NULL THEN a.DEFRECNAME ELSE ' ' END AS SUBRECORD
           FROM PSRECFIELDALL a
           JOIN PSDBFIELD b ON b.FIELDNAME = a.FIELDNAME
           LEFT JOIN PSRECFIELD o
                  ON o.RECNAME = a.RECNAME AND o.FIELDNAME = a.FIELDNAME
          WHERE a.RECNAME = :r
          ORDER BY a.FIELDNUM`, { r: recname });

      const recordFields: RecordField[] = (fields.rows ?? []).map((f) => ({
        name: f.FIELDNAME.trim(),
        fieldNum: f.FIELDNUM,
        type: f.FIELDTYPE as FieldType,
        length: f.LENGTH,
        decimalPositions: f.DECIMALPOS,
        useEdit: f.USEEDIT,
        editTable: f.EDITTABLE?.trim() || undefined,
        fromSubrecord: f.SUBRECORD?.trim() || undefined
      }));

      const record: RecordDefinition = {
        key,
        name: head.RECNAME.trim(),
        description: head.RECDESCR?.trim() ?? '',
        recordType: head.RECTYPE as RecordType,
        fields: recordFields,
        version: head.VERSION,
        auditRecord: head.AUDITRECNAME?.trim() || undefined
      };

      if (record.recordType === RecordType.View || record.recordType === RecordType.DynamicView) {
        const sql = await c.execute<{ SQLTEXT: string }>(
          `SELECT SQLTEXT FROM PSSQLTEXTDEFN
            WHERE SQLID = :r AND SQLTYPE = 2 ORDER BY SEQNUM`, { r: recname });
        record.viewSql = (sql.rows ?? []).map((x) => x.SQLTEXT).join('');
      }

      return record;
    });
  }

  async writeRecord(_record: RecordDefinition): Promise<void> {
    // Saving a record means rewriting PSRECDEFN/PSRECFIELD, bumping PSVERSION
    // and PSLOCK, and regenerating dependent DDL. Implemented in the record
    // editor milestone; see docs/ROADMAP.md.
    throw new UnsupportedOperationError('saving record definitions', this.displayName);
  }
}

/** Bind variables for the seven-part definition key. */
function keyBinds(key: DefinitionKey): Record<string, string> {
  const binds: Record<string, string> = {};
  for (let i = 0; i < 7; i++) binds[`v${i + 1}`] = key.parts[i] ?? ' ';
  return binds;
}

/** WHERE clause matching all seven OBJECTVALUE columns, unused slots blank. */
function keyPredicate(_key: DefinitionKey): string {
  return [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTVALUE${n} = :v${n}`).join(' AND ');
}

/**
 * PeopleTools invalidates application-server caches by comparing a definition's
 * VERSION against the per-type counter in PSVERSION. A definition written
 * without bumping that counter stays invisible to running app servers.
 */
async function bumpVersion(c: Connection, objectTypeName: string): Promise<void> {
  await c.execute(
    `UPDATE PSVERSION SET VERSION = VERSION + 1 WHERE OBJECTTYPENAME IN (:t, 'SYS')`,
    { t: objectTypeName });
  await c.execute(
    `UPDATE PSLOCK SET VERSION = VERSION + 1 WHERE OBJECTTYPENAME IN (:t, 'SYS')`,
    { t: objectTypeName });
}
