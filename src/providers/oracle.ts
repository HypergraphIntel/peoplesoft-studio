import type { Connection, Pool } from 'oracledb';
import {
  DefinitionProvider, DefinitionSummary, EnvironmentInfo, ProjectSummary, ProviderCapabilities,
  ProviderError, SearchQuery, UnsupportedOperationError
} from './provider.js';
import { DefinitionKey, DefinitionType, isPeopleCode, makeKey } from '../model/definitions.js';
import { PROPERTIES_SPECS, PropertiesInput, StoredRow } from '../model/properties.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';
import type { RecordLayout, TranslateValue } from '../model/recordLayout.js';
import type { DefinitionReference } from './provider.js';
import { createProject as createProjectRow, saveProject, verifyProjectSave, type ProjectSaveRequest, type ProjectSaveResult } from './projectWriter.js';
import { deleteRecord, saveRecord, verifyRecordSave, type RecordSaveRequest, type RecordSaveResult } from './recordWriter.js';
import type { DdlModel } from '../model/recordDdl.js';
import { saveTranslate as saveTranslateRows, type TranslateChange } from './translateWriter.js';
import { createField as createFieldRows, saveField as saveFieldRows, type FieldCreateRequest, type FieldSaveRequest } from './fieldWriter.js';
import { createPackage as createPackageRow } from './packageWriter.js';
import { saveStyleSheet as saveStyleSheetRows, verifyStyleSheetSave, type StyleSheetSaveRequest, type StyleSheetSaveResult } from './styleSheetWriter.js';
import { saveHtmlDefinition as saveHtmlRows, verifyHtmlSave, type HtmlSaveRequest, type HtmlSaveResult } from './htmlWriter.js';
import { saveSqlDefinition as saveSqlDefinitionRows, verifySqlSave, type SqlSaveRequest, type SqlSaveResult } from './sqlWriter.js';
import {
  FieldType, RecordDefinition, RecordField, RecordType, describeField
} from '../model/record.js';
import { assembleProgram, NameTable } from '../peoplecode/progtext.js';
import { decodeProgram, DecodeOptions } from '../peoplecode/decoder.js';
import {
  ComponentPageRow, ComponentRow, FieldLabelRow, FieldRow, MenuItemRow, MenuRow,
  PageFieldRow, PageRow, renderComponent, renderField, renderMenu, renderPage
} from './oracleRender.js';
import {
  operatorExists, readForEdit, readStoredProgram, savePeopleCode as writePeopleCode, verifyCommitted,
  type PeopleCodeSaveRequest, type PeopleCodeSaveResult
} from './peopleCodeWriter.js';

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

  /** The types {@link search} has a query for. */
  readonly searchableTypes: readonly DefinitionType[] = [
    DefinitionType.Project,
    DefinitionType.Record,
    DefinitionType.Field,
    DefinitionType.Page,
    DefinitionType.Component,
    DefinitionType.Menu,
    DefinitionType.ApplicationPackage,
    DefinitionType.AppEngineProgram,
    DefinitionType.SqlDefinition,
    DefinitionType.HtmlDefinition,
    DefinitionType.StyleSheet
  ];

  private pool?: Pool;
  private projectItemKeyWidthCache?: number;
  private environmentCache?: Promise<EnvironmentInfo>;

  constructor(private readonly config: OracleConnectionConfig) {
    this.id = `oracle:${config.name}`;
    this.displayName = config.name;
  }

  get isConnected(): boolean { return this.pool !== undefined; }

  async connect(): Promise<void> {
    if (this.pool) return;
    const oracledb = await loadOracleDb();
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

    let pool: Pool;
    try {
      pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.config.connectString,
        poolMin: 0,
        poolMax: 4,
        poolTimeout: 120
      });
    } catch (err) {
      throw new ProviderError(
        `Could not connect to ${this.config.connectString}: ${reason(err)}`, err);
    }

    // createPool with poolMin 0 opens nothing, so it succeeds against a host
    // that is unreachable or credentials that are wrong. Without this check
    // Connect would report success and the failure would surface later, on
    // whatever query happened to run first.
    try {
      const probe = await pool.getConnection();
      await probe.close();
    } catch (err) {
      await pool.close(0).catch(() => { /* the pool is already unusable */ });
      throw new ProviderError(
        `Could not connect to ${this.config.connectString} as ${this.config.user}: ${reason(err)}`,
        err);
    }

    this.pool = pool;
  }

  async dispose(): Promise<void> {
    await this.pool?.close(10);
    this.pool = undefined;
    this.environmentCache = undefined;
  }

  /** PSSTATUS is one row that changes only with a PeopleTools upgrade, so it is read once per connection. */
  readEnvironment(): Promise<EnvironmentInfo> {
    if (this.environmentCache) return this.environmentCache;
    const read = this.withConnection(async (c) => {
      const r = await c.execute<{ TOOLSREL: string; PTPATCHREL: number | null }>(
        `SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS`);
      const row = r.rows?.[0];
      if (!row) throw new ProviderError(`${this.displayName} has no PSSTATUS row.`);
      return {
        toolsRelease: String(row.TOOLSREL).trim(),
        ...(row.PTPATCHREL !== null && row.PTPATCHREL !== undefined
          ? { patchLevel: Number(row.PTPATCHREL) } : {})
      };
    });
    // A failed read is not cached: the next caller retries.
    read.catch(() => { if (this.environmentCache === read) this.environmentCache = undefined; });
    this.environmentCache = read;
    return read;
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
      const r = await c.execute<{ PROJECTNAME: string; PROJECTDESCR: string }>(
        `SELECT PROJECTNAME, PROJECTDESCR FROM SYSADM.PSPROJECTDEFN ORDER BY PROJECTNAME`);
      return (r.rows ?? []).map((row) => ({ name: row.PROJECTNAME, description: row.PROJECTDESCR }));
    });
  }

  /**
   * How many OBJECTID/OBJECTVALUE column pairs PSPROJECTITEM actually has here.
   *
   * The standard PeopleTools key is seven parts, but this differs across
   * versions and customizations, and guessing a fixed number at each ORA-00904
   * just moves the failure to the next-smaller guess. Asking the data
   * dictionary once and caching it is the only way to get this right.
   */
  private async projectItemKeyWidth(c: Connection): Promise<number> {
    if (this.projectItemKeyWidthCache !== undefined) return this.projectItemKeyWidthCache;
    const r = await c.execute<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS
        WHERE OWNER = 'SYSADM' AND TABLE_NAME = 'PSPROJECTITEM' AND COLUMN_NAME LIKE 'OBJECTVALUE%'`);
    const nums = (r.rows ?? [])
      .map((row) => Number(row.COLUMN_NAME.replace('OBJECTVALUE', '')))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (nums.length === 0) {
      throw new ProviderError(
        'Could not find any OBJECTVALUE columns on SYSADM.PSPROJECTITEM.');
    }
    this.projectItemKeyWidthCache = Math.max(...nums);
    return this.projectItemKeyWidthCache;
  }

  async listProjectItems(project: string): Promise<DefinitionSummary[]> {
    return this.withConnection(async (c) => {
      const width = await this.projectItemKeyWidth(c);
      const parts = Array.from({ length: width }, (_, i) => i + 1);
      const cols = parts.map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ');
      const orderCols = parts.slice(0, 4).map((n) => `OBJECTVALUE${n}`).join(', ');

      const r = await c.execute<Record<string, string | number>>(
        `SELECT OBJECTTYPE, ${cols}
           FROM SYSADM.PSPROJECTITEM
          WHERE PROJECTNAME = :p
          ORDER BY OBJECTTYPE, ${orderCols}`,
        { p: project });
      return (r.rows ?? []).map((row) => ({
        key: makeKey(
          row.OBJECTTYPE as DefinitionType,
          ...parts.map((n) => String(row[`OBJECTVALUE${n}`] ?? '')))
      }));
    });
  }

  async search(query: SearchQuery): Promise<DefinitionSummary[]> {
    const limit = query.limit ?? 500;
    const pattern = (query.namePattern ?? '%').toUpperCase();

    switch (query.type) {
      case DefinitionType.Project:
        return this.searchSimple(
          `SELECT PROJECTNAME AS NAME, PROJECTDESCR AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSPROJECTDEFN WHERE PROJECTNAME LIKE :n`,
          DefinitionType.Project, pattern, limit);
      case DefinitionType.Record:
        return this.searchSimple(
          `SELECT RECNAME AS NAME, RECDESCR AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSRECDEFN WHERE RECNAME LIKE :n`,
          DefinitionType.Record, pattern, limit);
      case DefinitionType.Field:
        return this.searchSimple(
          `SELECT FIELDNAME AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSDBFIELD WHERE FIELDNAME LIKE :n`,
          DefinitionType.Field, pattern, limit);
      case DefinitionType.Page:
        return this.searchSimple(
          `SELECT PNLNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSPNLDEFN WHERE PNLNAME LIKE :n`,
          DefinitionType.Page, pattern, limit);
      case DefinitionType.Component:
        return this.searchSimple(
          `SELECT PNLGRPNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSPNLGRPDEFN WHERE PNLGRPNAME LIKE :n`,
          DefinitionType.Component, pattern, limit);
      case DefinitionType.Menu:
        return this.searchSimple(
          `SELECT MENUNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSMENUDEFN WHERE MENUNAME LIKE :n`,
          DefinitionType.Menu, pattern, limit);
      case DefinitionType.AppEngineProgram:
        return this.searchSimple(
          `SELECT AE_APPLID AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSAEAPPLDEFN WHERE AE_APPLID LIKE :n`,
          DefinitionType.AppEngineProgram, pattern, limit);
      case DefinitionType.ApplicationPackage:
        return this.searchSimple(
          `SELECT PACKAGEROOT AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT LIKE :n AND PACKAGELEVEL = 0`,
          DefinitionType.ApplicationPackage, pattern, limit);
      case DefinitionType.SqlDefinition:
        return this.searchSimple(
          `SELECT SQLID AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSSQLDEFN WHERE SQLID LIKE :n AND SQLTYPE = 0`,
          DefinitionType.SqlDefinition, pattern, limit);
      case DefinitionType.StyleSheet:
        return this.searchSimple(
          `SELECT STYLESHEETNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSSTYLSHEETDEFN WHERE STYLESHEETNAME LIKE :n`,
          DefinitionType.StyleSheet, pattern, limit);
      case DefinitionType.HtmlDefinition:
        // HTML only (CONTTYPE 4); images and style sheets share PSCONTDEFN.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ NAME: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT CONTNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM SYSADM.PSCONTDEFN
              WHERE CONTNAME LIKE :n AND CONTTYPE = 4 AND ALTCONTNUM = 1 ORDER BY 1 FETCH FIRST :lim ROWS ONLY`,
            { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.HtmlDefinition, row.NAME, '4'),
            description: row.DESCR?.trim() || undefined,
            lastUpdated: row.LASTUPDDTTM,
            lastUpdatedBy: row.LASTUPDOPRID?.trim()
          }));
        });
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

  /**
   * PeopleCode as it would be edited and saved: the stored source
   * (PSPCMTXT, what App Designer shows) and the concurrency token a save
   * must present. Undefined when the program has no stored source.
   */
  async readPeopleCodeForEdit(key: DefinitionKey): Promise<{ text: string; fingerprint: string } | undefined> {
    const oracledb = await loadOracleDb();
    return this.withConnection((c) => readForEdit(c, oracledb, pcmProgKeyParts(key)));
  }

  /**
   * A definition's row for its Properties panel: every column, long text
   * (DESCRLONG) as a string. A field adds its labels; a SQL definition its
   * description row, which PSSQLDESCR keeps apart (newest effective date).
   */
  async readProperties(key: DefinitionKey): Promise<PropertiesInput | undefined> {
    const spec = PROPERTIES_SPECS[key.type];
    if (!spec) return undefined;
    const oracledb = await loadOracleDb();
    const options = {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      fetchTypeHandler: (meta: { dbType?: unknown }) =>
        meta.dbType === oracledb.DB_TYPE_CLOB || meta.dbType === oracledb.DB_TYPE_NCLOB ? { type: oracledb.STRING } : undefined
    };
    const where = spec.where(key);
    const columns = Object.keys(where);
    return this.withConnection(async (c) => {
      const r = await c.execute<StoredRow>(
        `SELECT * FROM SYSADM.${spec.table} WHERE ${columns.map((col, i) => `${col} = :b${i}`).join(' AND ')}` +
        (spec.orderBy ? ` ORDER BY ${spec.orderBy}` : ''),
        columns.map((col) => where[col]), options);
      const row = r.rows?.[0];
      if (!row) return undefined;
      const input: PropertiesInput = { key, row };
      if (key.type === DefinitionType.SqlDefinition) {
        const d = await c.execute<StoredRow>(
          `SELECT * FROM SYSADM.PSSQLDESCR WHERE SQLID = :id AND SQLTYPE = :t ORDER BY EFFDT DESC`,
          [where.SQLID, where.SQLTYPE], options);
        if (d.rows?.[0]) input.descriptionRow = d.rows[0];
      }
      if (key.type === DefinitionType.Field) {
        const l = await c.execute<StoredRow>(
          `SELECT LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :f ORDER BY DEFAULT_LABEL DESC, LABEL_ID`,
          [where.FIELDNAME], options);
        input.labels = l.rows ?? [];
      }
      return input;
    });
  }

  /**
   * Saves a set of changes to a project as App Designer's Save Project does
   * (projectWriter.ts): one transaction, then verified again on another
   * connection after COMMIT.
   */
  async saveProject(request: ProjectSaveRequest): Promise<ProjectSaveResult> {
    const result = await this.withConnection((c) => saveProject(c, request));
    await this.withConnection((c) => verifyProjectSave(c, request, result));
    return result;
  }

  /** The project's VERSION, the token a later save presents; undefined when there is no such project. */
  async readProjectVersion(project: string): Promise<number | undefined> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ VERSION: number }>(
        `SELECT VERSION FROM SYSADM.PSPROJECTDEFN WHERE PROJECTNAME = :p`, { p: project });
      const v = r.rows?.[0]?.VERSION;
      return v === undefined ? undefined : Number(v);
    });
  }

  /**
   * Saves a record definition as App Designer does (recordWriter.ts): one
   * transaction, then verified again on another connection after COMMIT.
   */
  async saveRecord(request: RecordSaveRequest): Promise<RecordSaveResult> {
    const result = await this.withConnection((c) => saveRecord(c, request));
    await this.withConnection((c) => verifyRecordSave(c, request, result));
    return result;
  }

  /**
   * Deletes a record definition as App Designer does (recordWriter.ts
   * deleteRecord, case r40), then checks on another connection that it is gone.
   */
  async deleteRecord(request: { recname: string; openedVersion: number; operatorId: string }): Promise<{ version: number }> {
    const result = await this.withConnection((c) => deleteRecord(c, request));
    await this.withConnection(async (c) => {
      const r = await c.execute<{ N: number }>(
        `SELECT (SELECT COUNT(*) FROM SYSADM.PSRECDEFN WHERE RECNAME = :r) AS N FROM DUAL`, { r: request.recname });
      if (Number(r.rows?.[0]?.N) !== 0) throw new ProviderError(`${request.recname} is still defined after the delete.`);
    });
    return result;
  }

  /** Adds, changes or deletes a field's translate value as App Designer does (translateWriter.ts). */
  async saveTranslate(field: string, change: TranslateChange, operatorId: string): Promise<void> {
    await this.withConnection((c) => saveTranslateRows(c, field, change, operatorId));
  }

  /** Whether any PeopleCode rows are stored under the key (program, source or names). */
  async hasPeopleCode(key: DefinitionKey): Promise<boolean> {
    const oracledb = await loadOracleDb();
    return this.withConnection(async (c) => (await readStoredProgram(c, oracledb, pcmProgKeyParts(key), false)) !== undefined);
  }

  /** An SQL definition's text with the version a save must present; undefined when there is none. */
  async readSqlForEdit(key: DefinitionKey): Promise<{ text: string; version: number } | undefined> {
    return this.withConnection(async (c) => {
      const d = await c.execute<{ VERSION: number }>(
        `SELECT VERSION FROM SYSADM.PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id: key.parts[0] });
      if (!d.rows?.[0]) return undefined;
      return { text: await this.readSqlDefinition(key), version: Number(d.rows[0].VERSION) };
    });
  }

  /** Creates an empty Application Package as App Designer's first save does (packageWriter.ts). */
  async createPackage(request: { name: string; operatorId: string }): Promise<{ version: number; lastupddttm: string }> {
    return this.withConnection((c) => createPackageRow(c, request));
  }

  /** Whether a package name is taken (as a root or a subpackage ID). */
  async packageExists(name: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT = :n OR PACKAGEID = :n`, { n: name })).rows?.[0]?.N ?? 0) > 0);
  }

  /** Creates an empty project as App Designer's first save does (projectWriter.ts createProject). */
  async createProject(request: { project: string; operatorId: string }): Promise<ProjectSaveResult> {
    return this.withConnection((c) => createProjectRow(c, request));
  }

  /** Whether a project name is taken. */
  async projectExists(name: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM SYSADM.PSPROJECTDEFN WHERE PROJECTNAME = :p`, { p: name })).rows?.[0]?.N ?? 0) > 0);
  }

  /** Creates a field as App Designer's first save does (fieldWriter.ts), verified in the transaction. */
  async createField(request: FieldCreateRequest): Promise<{ version: number; lastupddttm: string }> {
    return this.withConnection((c) => createFieldRows(c, request));
  }

  /** Saves a field as App Designer's field saves did (fieldWriter.ts saveField), verified in the transaction. */
  async saveField(request: FieldSaveRequest): Promise<{ version: number; lastupddttm: string; records: string[] }> {
    return this.withConnection((c) => saveFieldRows(c, request));
  }

  /** Whether a field name is taken. */
  async fieldExists(name: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :f`, { f: name })).rows?.[0]?.N ?? 0) > 0);
  }

  /**
   * The Oracle DDL model a record builds with: PSDDLMODEL's Create Table and
   * Create Index statements (platform 2, sizing set 0), PSDDLDEFPARMS'
   * defaults, and the record's and its key index's own parameters over them.
   */
  async readDdlModel(recname: string): Promise<DdlModel | undefined> {
    return this.withConnection(async (c) => {
      const models = await c.execute<{ T: number; M: string }>(
        `SELECT STATEMENT_TYPE AS T, MODEL_STATEMENT AS M FROM SYSADM.PSDDLMODEL
          WHERE PLATFORMID = 2 AND SIZING_SET = 0 AND STATEMENT_TYPE IN (1, 2)`, {},
        { fetchInfo: { M: { type: (await loadOracleDb()).STRING } } });
      const table = models.rows?.find((r) => Number(r.T) === 1)?.M;
      const index = models.rows?.find((r) => Number(r.T) === 2)?.M;
      if (!table || !index) return undefined;
      const parms = async (sql: string, binds: Record<string, string | number>) => Object.fromEntries(
        ((await c.execute<{ N: string; V: string }>(sql, binds)).rows ?? []).map((r) => [String(r.N).trim(), String(r.V ?? '')]));
      const defaults = (type: number) => parms(
        `SELECT PARMNAME AS N, PARMVALUE AS V FROM SYSADM.PSDDLDEFPARMS WHERE PLATFORMID = 2 AND SIZING_SET = 0 AND STATEMENT_TYPE = :t`, { t: type });
      return {
        table, index,
        tableParms: { ...(await defaults(1)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM SYSADM.PSRECDDLPARM WHERE RECNAME = :r AND PLATFORMID = 2 AND SIZINGSET = 0`, { r: recname })) },
        indexParms: { ...(await defaults(2)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM SYSADM.PSIDXDDLPARM WHERE RECNAME = :r AND INDEXID = '_' AND PLATFORMID = 2 AND SIZINGSET = 0`, { r: recname })) },
        indexDefaults: await defaults(2),
        altIndexParms: Object.fromEntries(await Promise.all(Array.from({ length: 10 }, (_, n) => String(n)).map(async (id) => [id, { ...(await defaults(2)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM SYSADM.PSIDXDDLPARM WHERE RECNAME = :r AND INDEXID = :i AND PLATFORMID = 2 AND SIZINGSET = 0`, { r: recname, i: id })) }])))
      };
    });
  }

  /** Whether a record name is free, taken, or was deleted before (PSRECDEL: not re-created here). */
  async recordNameStatus(recname: string): Promise<'free' | 'exists' | 'deleted'> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ D: number; X: number }>(
        `SELECT (SELECT COUNT(*) FROM SYSADM.PSRECDEFN WHERE RECNAME = :r) AS D, (SELECT COUNT(*) FROM SYSADM.PSRECDEL WHERE RECNAME = :r) AS X FROM DUAL`,
        { r: recname });
      const row = r.rows?.[0];
      return Number(row?.D) > 0 ? 'exists' : Number(row?.X) > 0 ? 'deleted' : 'free';
    });
  }

  /** Whether any SQL definition row (of any SQL type) uses the ID. */
  async sqlIdTaken(sqlId: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM SYSADM.PSSQLDEFN WHERE SQLID = :id`, { id: sqlId })).rows?.[0]?.N ?? 0) > 0);
  }

  /**
   * Saves an SQL definition's text as App Designer does (sqlWriter.ts): one
   * transaction, then verified again on another connection after COMMIT.
   */
  async saveSqlDefinition(request: SqlSaveRequest): Promise<SqlSaveResult> {
    const result = await this.withConnection((c) => saveSqlDefinitionRows(c, request));
    await this.withConnection((c) => verifySqlSave(c, request, result));
    return result;
  }

  /**
   * A style sheet as text. A freeform one is its CSS (PSCONTENT, CONTTYPE 9);
   * a classic or sub style sheet is style classes, not text, so it reads as a
   * summary of them (its class attributes are not decoded).
   */
  private async readStyleSheet(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    const head = await this.withConnection(async (c) => (await c.execute<{ T: number; P: string; D: string; N: number }>(
      `SELECT STYLESHEETTYPE AS T, PARENTSTYLENAME AS P, DESCR AS D, NUMSTYLECLASS AS N FROM SYSADM.PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :n`,
      { n: name })).rows?.[0]);
    if (!head) throw new ProviderError(`No style sheet named ${name}.`);
    if (Number(head.T) === 2) return this.readContent(name, 9, `text for style sheet ${name}`);
    // SUBSTYLESHEET 1 marks a row naming an included sub style sheet (270 of 3,490), not a class.
    const classes = await this.withConnection(async (c) => (await c.execute<{ C: string; S: number }>(
      `SELECT STYLECLASSNAME AS C, SUBSTYLESHEET AS S FROM SYSADM.PSSTYLECLASS WHERE STYLESHEETNAME = :n ORDER BY SEQNO, STYLECLASSNAME`,
      { n: name })).rows ?? []);
    const t = (v: string | null | undefined) => (v ?? '').trim();
    const subs = classes.filter((x) => Number(x.S) === 1).map((x) => t(x.C));
    const own = classes.filter((x) => Number(x.S) !== 1);
    return [
      `/* ${name}: ${Number(head.T) === 1 ? 'Sub Style Sheet' : 'Style Sheet'} (read-only).`,
      ' * Its style classes are structured definitions, not text; their attributes are not shown here yet.',
      t(head.D) ? ` * Description: ${t(head.D)}` : '',
      t(head.P) ? ` * Parent style sheet: ${t(head.P)}` : '',
      ` * Style classes (${own.length}):`,
      ...own.map((x) => ` *   ${t(x.C)}`),
      subs.length ? ` * Sub style sheets: ${subs.join(', ')}` : '',
      ' */',
      ''
    ].filter((line) => line !== '').join('\n') + '\n';
  }

  /** A freeform style sheet's text with the version a save must present; undefined when there is none or it is not freeform. */
  async readStyleSheetForEdit(key: DefinitionKey): Promise<{ text: string; version: number } | 'classic' | undefined> {
    const row = await this.withConnection(async (c) => (await c.execute<{ VERSION: number; T: number }>(
      `SELECT VERSION, STYLESHEETTYPE AS T FROM SYSADM.PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :n`, { n: key.parts[0] })).rows?.[0]);
    if (!row) return undefined;
    if (Number(row.T) !== 2) return 'classic';
    return { text: await this.readContent(key.parts[0], 9, `text for style sheet ${key.parts[0]}`), version: Number(row.VERSION) };
  }

  /**
   * Saves or creates a freeform style sheet as App Designer does
   * (styleSheetWriter.ts): one transaction, verified again after COMMIT.
   */
  async saveStyleSheet(request: StyleSheetSaveRequest): Promise<StyleSheetSaveResult> {
    const oracledb = await loadOracleDb();
    const result = await this.withConnection((c) => saveStyleSheetRows(c, oracledb.BLOB, request));
    await this.withConnection((c) => verifyStyleSheetSave(c, request, result));
    return result;
  }

  /** An HTML definition's text with the version a save must present; undefined when there is none. */
  async readHtmlForEdit(key: DefinitionKey): Promise<{ text: string; version: number } | undefined> {
    return this.withConnection(async (c) => {
      const d = await c.execute<{ VERSION: number }>(
        `SELECT VERSION FROM SYSADM.PSCONTDEFN WHERE CONTNAME = :n AND CONTTYPE = :t AND ALTCONTNUM = 1`,
        { n: key.parts[0], t: Number(key.parts[1] ?? 4) });
      if (!d.rows?.[0]) return undefined;
      return { text: await this.readHtmlDefinition(key), version: Number(d.rows[0].VERSION) };
    });
  }

  /**
   * Saves or creates an HTML definition as App Designer does (htmlWriter.ts):
   * one transaction, then verified again on another connection after COMMIT.
   */
  async saveHtmlDefinition(request: HtmlSaveRequest): Promise<HtmlSaveResult> {
    const oracledb = await loadOracleDb();
    const result = await this.withConnection((c) => saveHtmlRows(c, oracledb.BLOB, request));
    await this.withConnection((c) => verifyHtmlSave(c, request, result));
    return result;
  }

  /** Whether a PeopleSoft operator exists here (PSOPRDEFN), read-only. */
  async operatorExists(operatorId: string): Promise<boolean> {
    return this.withConnection((c) => operatorExists(c, operatorId));
  }

  /**
   * Saves PeopleCode natively (peopleCodeWriter.ts): one transaction on one
   * connection, then the committed state is verified again on another.
   */
  async savePeopleCode(key: DefinitionKey, request: PeopleCodeSaveRequest): Promise<PeopleCodeSaveResult> {
    const oracledb = await loadOracleDb();
    const parts = pcmProgKeyParts(key);
    const result = await this.withConnection((c) => writePeopleCode(c, oracledb, parts, request));
    await this.withConnection((c) => verifyCommitted(c, oracledb, parts, result));
    return result;
  }

  async readText(key: DefinitionKey): Promise<string> {
    if (isPeopleCode(key.type)) return this.readPeopleCode(key);
    switch (key.type) {
      case DefinitionType.SqlDefinition: return this.readSqlDefinition(key);
      case DefinitionType.HtmlDefinition: return this.readHtmlDefinition(key);
      case DefinitionType.StyleSheet: return this.readStyleSheet(key);
      case DefinitionType.Field: return this.readFieldSummary(key);
      case DefinitionType.Menu: return this.readMenuSummary(key);
      case DefinitionType.Page: return this.readPageSummary(key);
      case DefinitionType.Component: return this.readComponentSummary(key);
      default:
        throw new UnsupportedOperationError(
          `reading definition type ${key.type} as text`, this.displayName);
    }
  }

  canReadAsText(type: DefinitionType): boolean {
    return isPeopleCode(type) || [
      DefinitionType.SqlDefinition, DefinitionType.HtmlDefinition, DefinitionType.StyleSheet, DefinitionType.Field,
      DefinitionType.Menu, DefinitionType.Page, DefinitionType.Component
    ].includes(type);
  }

  /**
   * HTML definition content, from PSCONTENT.
   *
   * The key's second part is CONTTYPE, not a language/market flag as its
   * PeopleTools name might suggest -- confirmed against
   * OU_OJET_REN_DA_BODY_HTML.4, whose only PSCONTENT row has CONTTYPE 4.
   * CONTDATA is chunked (SEQNUM from 0, 32,000 bytes a chunk but the last)
   * and stored UTF-16LE, the same as PeopleCode source and SQL text elsewhere
   * in PeopleTools.
   */
  private async readHtmlDefinition(key: DefinitionKey): Promise<string> {
    const [name, contType] = key.parts;
    return this.readContent(name, Number(contType), `HTML definition named ${name}.${contType}`);
  }

  /** PSCONTENT text, NUL terminator dropped. */
  private async readContent(name: string, contType: number, what: string): Promise<string> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ CONTDATA: Buffer }>(
        `SELECT CONTDATA FROM SYSADM.PSCONTENT
          WHERE CONTNAME = :n AND CONTTYPE = :t ORDER BY ALTCONTNUM, SEQNUM`,
        { n: name, t: contType });
      const rows = r.rows ?? [];
      if (rows.length === 0) throw new ProviderError(`No ${what}.`);
      // 2,331 of HRDMO's 3,142 end in one NUL terminator, never shown.
      return Buffer.concat(rows.map((row) => row.CONTDATA)).toString('utf16le').replace(/\0$/, '');
    });
  }

  async readField(key: DefinitionKey): Promise<FieldDefinition | undefined> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const d = await c.execute<{
        FIELDTYPE: number; LENGTH: number; DECIMALPOS: number; FORMAT: number; FORMATFAMILY: string; DISPFMTNAME: string;
        DEFCNTRYYR: number; FLDNOTUSED: number; AUXFLAGMASK: number; VERSION: number; TS: string; OPRID: string; DL: string | null
      }>(
        `SELECT FIELDTYPE, LENGTH, DECIMALPOS, FORMAT, FORMATFAMILY, DISPFMTNAME, DEFCNTRYYR, FLDNOTUSED, AUXFLAGMASK,
                VERSION, TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD HH24:MI:SS') AS TS, LASTUPDOPRID AS OPRID, DBMS_LOB.SUBSTR(DESCRLONG, 4000, 1) AS DL
           FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :n`, { n: name });
      const row = d.rows?.[0];
      if (!row) return undefined;
      const l = await c.execute<{ LABEL_ID: string; LONGNAME: string; SHORTNAME: string; DEFAULT_LABEL: number }>(
        `SELECT LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL FROM SYSADM.PSDBFLDLABL WHERE FIELDNAME = :n ORDER BY LABEL_ID`,
        { n: name });
      const t = (v: string | null | undefined) => (v ?? '').trim();
      return {
        name,
        type: Number(row.FIELDTYPE),
        length: Number(row.LENGTH),
        decimalPositions: Number(row.DECIMALPOS),
        labels: (l.rows ?? []).map((r) => ({
          id: t(r.LABEL_ID), longName: t(r.LONGNAME), shortName: t(r.SHORTNAME), isDefault: Number(r.DEFAULT_LABEL) === 1
        })),
        format: Number(row.FORMAT),
        formatFamily: t(row.FORMATFAMILY),
        displayName: t(row.DISPFMTNAME),
        defaultCenturyYear: Number(row.DEFCNTRYYR),
        notUsed: Number(row.FLDNOTUSED) !== 0,
        auxFlagMask: Number(row.AUXFLAGMASK),
        version: Number(row.VERSION),
        lastUpdated: t(row.TS),
        lastUpdatedBy: t(row.OPRID),
        description: row.DL ?? ''
      };
    });
  }

  private async readFieldSummary(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const defn = await c.execute<FieldRow>(
        `SELECT FIELDTYPE, LENGTH, DECIMALPOS, VERSION FROM SYSADM.PSDBFIELD WHERE FIELDNAME = :n`, { n: name });
      const labels = await c.execute<FieldLabelRow>(
        `SELECT LABEL_ID, LONGNAME, SHORTNAME FROM SYSADM.PSDBFLDLABL
          WHERE FIELDNAME = :n ORDER BY LABEL_ID`, { n: name });
      return renderField(name, defn.rows?.[0], labels.rows ?? []);
    });
  }

  private async readMenuSummary(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const defn = await c.execute<MenuRow>(
        `SELECT VERSION, DESCR FROM SYSADM.PSMENUDEFN WHERE MENUNAME = :n`, { n: name });
      const items = await c.execute<MenuItemRow>(
        `SELECT BARNAME, ITEMNAME, ITEMLABEL, PNLGRPNAME, MARKET FROM SYSADM.PSMENUITEM
          WHERE MENUNAME = :n ORDER BY BARNAME, ITEMNUM`, { n: name });
      return renderMenu(name, defn.rows?.[0], items.rows ?? []);
    });
  }

  private async readPageSummary(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const defn = await c.execute<PageRow>(
        `SELECT PNLTYPE, VERSION, FIELDCOUNT, GRIDHORZ, GRIDVERT, DESCR
           FROM SYSADM.PSPNLDEFN WHERE PNLNAME = :n`, { n: name });
      const fields = await c.execute<PageFieldRow>(
        `SELECT PNLFLDID, RECNAME, FIELDNAME, PNLFIELDNAME FROM SYSADM.PSPNLFIELD
          WHERE PNLNAME = :n ORDER BY FIELDNUM`, { n: name });
      return renderPage(name, defn.rows?.[0], fields.rows ?? []);
    });
  }

  private async readComponentSummary(key: DefinitionKey): Promise<string> {
    const [name, market = 'GBL'] = key.parts;
    return this.withConnection(async (c) => {
      const defn = await c.execute<ComponentRow>(
        `SELECT DESCR, SEARCHRECNAME, ADDSRCHRECNAME, VERSION FROM SYSADM.PSPNLGRPDEFN
          WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
      const pages = await c.execute<ComponentPageRow>(
        `SELECT PNLNAME, ITEMLABEL, HIDDEN FROM SYSADM.PSPNLGROUP
          WHERE PNLGRPNAME = :n AND MARKET = :m ORDER BY SUBITEMNUM`, { n: name, m: market });
      return renderComponent(name, market, defn.rows?.[0], pages.rows ?? []);
    });
  }

  /**
   * PeopleCode lives in PSPCMPROG as a chunked byte stream, with the names it
   * references held separately in PSPCMNAME. Both tables are keyed by the same
   * seven-part definition key.
   */
  private async readPeopleCode(key: DefinitionKey): Promise<string> {
    const binds = keyBinds(pcmProgKeyParts(key));
    const where = keyPredicate(key);

    return this.withConnection(async (c) => {
      const prog = await c.execute<{ PROGSEQ: number; PROGTXT: Buffer }>(
        `SELECT PROGSEQ, PROGTXT FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds);
      const rows = prog.rows ?? [];
      if (rows.length === 0) {
        throw new ProviderError(`No PeopleCode program found for ${key.parts.join('.')}.`);
      }

      // RECNAME carries the qualifier a reference is written with in source
      // -- "HTML" for HTML.OU_OJET_REQUIRE_CONFIG, the record name for a
      // record.field, "PACKAGE" for an application package. Reading REFNAME
      // alone dropped it, so references decoded as a bare name.
      const nameRows = await c.execute<{ NAMENUM: number; RECNAME: string; REFNAME: string }>(
        `SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`,
        binds);

      const names = new NameTable();
      for (const n of nameRows.rows ?? []) {
        const qualifier = (n.RECNAME ?? '').trim();
        const ref = (n.REFNAME ?? '').trim();
        names.add(n.NAMENUM, qualifier ? `${qualifier}.${ref}` : ref);
      }

      const bytes = assembleProgram(rows.map((r) => ({ seq: r.PROGSEQ, data: r.PROGTXT })));
      return decodeProgram(bytes, names, {
        mode: this.config.decoderMode ?? 'auto',
        isApplicationClass: key.type === DefinitionType.ApplicationClassPeopleCode
      }).text;
    });
  }

  private async readSqlDefinition(key: DefinitionKey): Promise<string> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ SQLTEXT: string }>(
        `SELECT SQLTEXT FROM SYSADM.PSSQLTEXTDEFN
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
   * Saving SQL definitions is refused. The earlier implementation did not do
   * what App Designer does: App Designer's SQL save (case r28, a view's SQL)
   * writes PSSQLDEFN, PSSQLDESCR, PSSQLHASH (HASH_SIGNATURE, the PSPCMTXT
   * algorithm) and PSSQLTEXTDEFN keyed by MARKET / DBTYPE / EFFDT, and moves
   * PSVERSION SRM; it wrote no hash, omitted the NOT NULL MARKET / DBTYPE
   * columns, and moved a "SQL" counter HRDMO does not have.
   */
  private async writeSqlDefinition(_key: DefinitionKey, _text: string): Promise<void> {
    throw new UnsupportedOperationError('saving SQL definitions (not yet reproduced from App Designer)', this.displayName);
  }

  /**
   * A record's fields with subrecords expanded inline, the way App Designer
   * shows them.
   *
   * PSRECFIELDALL is meant to do this expansion for us, but on this database
   * it has been stripped down to RECNAME/FIELDNAME/USEEDIT (a local
   * customization, not a PeopleTools default) -- not enough to build a field
   * list from. PSRECFIELD has everything, so this recurses through it
   * instead: a row with SUBRECORD = 'Y' names, in FIELDNAME, the subrecord to
   * expand in its place. `seen` stops a subrecord that (incorrectly) includes
   * itself from recursing forever.
   */
  private async expandRecordFields(
    c: Connection, recname: string, fromSubrecord: string | undefined, seen: Set<string>
  ): Promise<Array<{
    FIELDNAME: string; USEEDIT: number; EDITTABLE: string; fromSubrecord?: string
  }>> {
    if (seen.has(recname)) return [];
    seen.add(recname);

    const rows = await c.execute<{
      FIELDNAME: string; SUBRECORD: string; USEEDIT: number; EDITTABLE: string
    }>(
      `SELECT FIELDNAME, SUBRECORD, USEEDIT, EDITTABLE
         FROM SYSADM.PSRECFIELD WHERE RECNAME = :r ORDER BY FIELDNUM`, { r: recname });

    const out: Array<{ FIELDNAME: string; USEEDIT: number; EDITTABLE: string; fromSubrecord?: string }> = [];
    for (const row of rows.rows ?? []) {
      if (row.SUBRECORD?.trim() === 'Y') {
        const subrecName = row.FIELDNAME.trim();
        out.push(...await this.expandRecordFields(c, subrecName, fromSubrecord ?? subrecName, seen));
      } else {
        out.push({ ...row, fromSubrecord });
      }
    }
    return out;
  }

  /** The record as App Designer's record editor shows it (model/recordLayout.ts). */
  async readRecordLayout(key: DefinitionKey): Promise<RecordLayout | undefined> {
    const recname = key.parts[0];
    return this.withConnection(async (c) => {
      const t = (v: string | null | undefined) => (v ?? '').trim();
      const head = (await c.execute<{
        RECDESCR: string; RECTYPE: number; VERSION: number; SQLTABLENAME: string; BUILDSEQNO: number; AUXFLAGMASK: number;
        DL: string | null; OBJECTOWNERID: string; TS: string; LASTUPDOPRID: string; SETCNTRLFLD: string; PARENTRECNAME: string;
        RELLANGRECNAME: string; QRYSECRECNAME: string; OPTDELRECNAME: string; AUDITRECNAME: string;
        SYSTEMIDFIELDNAME: string; TIMESTAMPFIELDNAME: string; RECUSE: number; OPTTRIGFLAG: string
      }>(
        `SELECT RECDESCR, RECTYPE, VERSION, SQLTABLENAME, BUILDSEQNO, AUXFLAGMASK, DBMS_LOB.SUBSTR(DESCRLONG, 4000, 1) AS DL,
                OBJECTOWNERID, TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD HH24:MI:SS') AS TS, LASTUPDOPRID, SETCNTRLFLD, PARENTRECNAME,
                RELLANGRECNAME, QRYSECRECNAME, OPTDELRECNAME, AUDITRECNAME, SYSTEMIDFIELDNAME, TIMESTAMPFIELDNAME,
                RECUSE, OPTTRIGFLAG
           FROM SYSADM.PSRECDEFN WHERE RECNAME = :r`, { r: recname })).rows?.[0];
      if (!head) return undefined;
      // Each own row with its field's PSDBFIELD values and its label: the
      // record field's LABEL_ID when set, else the field's default label.
      const rows = (await c.execute<{
        FIELDNUM: number; FIELDNAME: string; SUBRECORD: string; USEEDIT: number; EDITTABLE: string; SETCNTRLFLD: string;
        USEEDIT2: number; LABEL_ID: string; DEFGUICONTROL: number;
        DEFRECNAME: string; DEFFIELDNAME: string; FIELDTYPE: number | null; LENGTH: number | null;
        DECIMALPOS: number | null; FORMAT: number | null; LONGNAME: string | null; SHORTNAME: string | null; PC: number
      }>(
        `SELECT rf.FIELDNUM, rf.FIELDNAME, rf.SUBRECORD, rf.USEEDIT, rf.EDITTABLE, rf.SETCNTRLFLD, rf.DEFRECNAME, rf.DEFFIELDNAME,
                rf.USEEDIT2, rf.LABEL_ID, rf.DEFGUICONTROL,
                f.FIELDTYPE, f.LENGTH, f.DECIMALPOS, f.FORMAT, l.LONGNAME, l.SHORTNAME,
                (SELECT COUNT(*) FROM SYSADM.PSPCMPROG p WHERE p.OBJECTID1 = 1 AND p.OBJECTVALUE1 = rf.RECNAME
                    AND p.OBJECTID2 = 2 AND p.OBJECTVALUE2 = rf.FIELDNAME AND p.PROGSEQ = 0) AS PC
           FROM SYSADM.PSRECFIELD rf
           LEFT JOIN SYSADM.PSDBFIELD f ON f.FIELDNAME = rf.FIELDNAME AND rf.SUBRECORD <> 'Y'
           LEFT JOIN SYSADM.PSDBFLDLABL l ON l.FIELDNAME = rf.FIELDNAME AND rf.SUBRECORD <> 'Y'
            AND ((rf.LABEL_ID <> ' ' AND l.LABEL_ID = rf.LABEL_ID) OR (rf.LABEL_ID = ' ' AND l.DEFAULT_LABEL = 1))
          WHERE rf.RECNAME = :r ORDER BY rf.FIELDNUM`, { r: recname })).rows ?? [];
      const layout: RecordLayout = {
        name: recname,
        description: t(head.RECDESCR),
        recordType: Number(head.RECTYPE) as RecordType,
        sqlTableName: t(head.SQLTABLENAME),
        version: Number(head.VERSION),
        buildSequence: Number(head.BUILDSEQNO),
        auxFlagMask: Number(head.AUXFLAGMASK),
        properties: {
          description: t(head.RECDESCR), definition: (head.DL ?? '').replace(/\s+$/, ''), ownerId: t(head.OBJECTOWNERID),
          lastUpdated: t(head.TS), lastUpdatedBy: t(head.LASTUPDOPRID), setControlField: t(head.SETCNTRLFLD),
          parentRecord: t(head.PARENTRECNAME), relatedLanguageRecord: t(head.RELLANGRECNAME), querySecurityRecord: t(head.QRYSECRECNAME),
          analyticDeleteRecord: t(head.OPTDELRECNAME), auditRecord: t(head.AUDITRECNAME), systemIdField: t(head.SYSTEMIDFIELDNAME),
          timestampField: t(head.TIMESTAMPFIELDNAME), auxFlagMask: Number(head.AUXFLAGMASK),
          recUse: Number(head.RECUSE), optTrigFlag: t(head.OPTTRIGFLAG)
        },
        fields: rows.map((r) => {
          const sub = t(r.SUBRECORD) === 'Y';
          return {
            fieldNum: Number(r.FIELDNUM),
            name: t(r.FIELDNAME),
            isSubrecord: sub,
            ...(sub || r.FIELDTYPE === null ? {} : {
              type: Number(r.FIELDTYPE) as FieldType, length: Number(r.LENGTH),
              decimalPositions: Number(r.DECIMALPOS), format: Number(r.FORMAT)
            }),
            shortName: t(r.SHORTNAME),
            longName: t(r.LONGNAME),
            useEdit: Number(r.USEEDIT),
            hasPeopleCode: Number(r.PC) > 0,
            editTable: t(r.EDITTABLE),
            setControlField: t(r.SETCNTRLFLD),
            useEdit2: Number(r.USEEDIT2),
            labelId: t(r.LABEL_ID),
            defGuiControl: Number(r.DEFGUICONTROL),
            defaultRecord: t(r.DEFRECNAME),
            defaultField: t(r.DEFFIELDNAME)
          };
        })
      };
      if (layout.recordType === RecordType.View || layout.recordType === RecordType.DynamicView) {
        const sql = await c.execute<{ SQLTEXT: string }>(
          `SELECT SQLTEXT FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :r AND SQLTYPE = 2 ORDER BY SEQNUM`, { r: recname });
        layout.viewSql = (sql.rows ?? []).map((x) => x.SQLTEXT).join('');
      }
      // Every label of the record's fields, for the Record Field Label ID choice.
      const labelRows = (await c.execute<{ FIELDNAME: string; LABEL_ID: string; LONGNAME: string; SHORTNAME: string; DEFAULT_LABEL: number }>(
        `SELECT l.FIELDNAME, l.LABEL_ID, l.LONGNAME, l.SHORTNAME, l.DEFAULT_LABEL FROM SYSADM.PSDBFLDLABL l
          WHERE l.FIELDNAME IN (SELECT FIELDNAME FROM SYSADM.PSRECFIELD WHERE RECNAME = :r AND SUBRECORD = 'N')
          ORDER BY l.FIELDNAME, l.LABEL_ID`, { r: recname })).rows ?? [];
      for (const f of layout.fields) {
        f.labels = labelRows.filter((l) => t(l.FIELDNAME) === f.name)
          .map((l) => ({ id: t(l.LABEL_ID), longName: t(l.LONGNAME), shortName: t(l.SHORTNAME), isDefault: Number(l.DEFAULT_LABEL) === 1 }));
      }
      if (layout.recordType === RecordType.QueryView) {
        const q = await c.execute<{ QRYNAME: string }>(
          `SELECT QRYNAME FROM SYSADM.PSQRYDEFN WHERE QRYNAME = :r AND ROWNUM = 1`, { r: recname });
        if (q.rows?.[0]) layout.queryName = t(q.rows[0].QRYNAME);
      }
      const ts = await c.execute<{ DDLSPACENAME: string }>(
        `SELECT DDLSPACENAME FROM SYSADM.PSRECTBLSPC WHERE RECNAME = :r AND ROWNUM = 1`, { r: recname });
      if (ts.rows?.[0]) layout.tablespace = t(ts.rows[0].DDLSPACENAME);
      const idx = await c.execute<{ INDEXID: string }>(
        `SELECT INDEXID FROM SYSADM.PSINDEXDEFN WHERE RECNAME = :r ORDER BY INDEXID`, { r: recname });
      layout.indexIds = (idx.rows ?? []).map((x) => t(x.INDEXID));
      return layout;
    });
  }

  /**
   * Find Definition References for a field, or a record field: the records
   * that contain the field (field only), the pages that show it (PSPNLFIELD),
   * and the PeopleCode programs that reference it (PSPCMNAME: RECNAME /
   * REFNAME). Record Field and Application Class programs can be opened.
   */
  async findFieldReferences(field: string, record?: string): Promise<DefinitionReference[]> {
    return this.withConnection(async (c) => {
      const t = (v: unknown) => String(v ?? '').trim();
      const out: DefinitionReference[] = [];
      if (!record) {
        const recs = await c.execute<{ RECNAME: string }>(
          `SELECT DISTINCT RECNAME FROM SYSADM.PSRECFIELD WHERE FIELDNAME = :f AND SUBRECORD = 'N' ORDER BY RECNAME`, { f: field });
        for (const r of recs.rows ?? []) out.push({ group: 'Record', label: t(r.RECNAME), key: makeKey(DefinitionType.Record, t(r.RECNAME)) });
      }
      const pages = await c.execute<{ PNLNAME: string; RECNAME: string }>(
        `SELECT DISTINCT PNLNAME, RECNAME FROM SYSADM.PSPNLFIELD WHERE FIELDNAME = :f ${record ? 'AND RECNAME = :r' : ''} ORDER BY PNLNAME`,
        record ? { f: field, r: record } : { f: field });
      for (const p of pages.rows ?? []) {
        out.push({ group: 'Page', label: t(p.PNLNAME), description: `${t(p.RECNAME)}.${field}`, key: makeKey(DefinitionType.Page, t(p.PNLNAME)) });
      }
      const cols = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ');
      const pcs = await c.execute<Record<string, string | number>>(
        `SELECT DISTINCT RECNAME, ${cols} FROM SYSADM.PSPCMNAME WHERE REFNAME = :f AND RECNAME ${record ? '= :r' : "<> ' '"}
          ORDER BY OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3`, record ? { f: field, r: record } : { f: field });
      // One entry per program, however many records it references the field through.
      const programs = new Map<string, { recs: Set<string>; key?: DefinitionKey }>();
      for (const row of pcs.rows ?? []) {
        const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => Number(row[`OBJECTID${n}`]));
        const vals = [1, 2, 3, 4, 5, 6, 7].map((n) => t(row[`OBJECTVALUE${n}`])).filter((_, i) => ids[i] !== 0);
        const used = ids.filter((id) => id !== 0);
        const label = vals.join('.');
        let entry = programs.get(label);
        if (!entry) {
          let key: DefinitionKey | undefined;
          if (used.join() === '1,2,12') key = makeKey(DefinitionType.RecordPeopleCode, ...vals);
          else if (used[0] === 104 && used.at(-1) === 12) key = makeKey(DefinitionType.ApplicationClassPeopleCode, ...vals);
          entry = { recs: new Set(), ...(key ? { key } : {}) };
          programs.set(label, entry);
        }
        entry.recs.add(t(row.RECNAME));
      }
      for (const [label, e] of programs) {
        out.push({ group: 'PeopleCode', label, description: `references ${[...e.recs].map((r) => `${r}.${field}`).join(', ')}`, ...(e.key ? { key: e.key } : {}) });
      }
      return out;
    });
  }

  /** A field's translate values (PSXLATITEM), as App Designer's View Translates lists them. */
  async readTranslates(fieldName: string): Promise<TranslateValue[]> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ V: string; D: string; S: string; L: string; SH: string }>(
        `SELECT FIELDVALUE AS V, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS D, EFF_STATUS AS S, XLATLONGNAME AS L, XLATSHORTNAME AS SH
           FROM SYSADM.PSXLATITEM WHERE FIELDNAME = :f ORDER BY FIELDVALUE, EFFDT`, { f: fieldName });
      const t = (v: string | null | undefined) => (v ?? '').trim();
      return (r.rows ?? []).map((x) => ({ value: t(x.V), effectiveDate: t(x.D), status: t(x.S), longName: t(x.L), shortName: t(x.SH) }));
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
           FROM SYSADM.PSRECDEFN WHERE RECNAME = :r`, { r: recname });
      const head = defn.rows?.[0];
      if (!head) throw new ProviderError(`No record definition named ${recname}.`);

      const expanded = await this.expandRecordFields(c, recname, undefined, new Set());

      const fieldNames = [...new Set(expanded.map((f) => f.FIELDNAME.trim()))];
      const typeByField = new Map<string, { FIELDTYPE: number; LENGTH: number; DECIMALPOS: number }>();
      if (fieldNames.length > 0) {
        const binds: Record<string, string> = {};
        fieldNames.forEach((n, i) => { binds[`f${i}`] = n; });
        const placeholders = fieldNames.map((_, i) => `:f${i}`).join(', ');
        const types = await c.execute<{ FIELDNAME: string; FIELDTYPE: number; LENGTH: number; DECIMALPOS: number }>(
          `SELECT FIELDNAME, FIELDTYPE, LENGTH, DECIMALPOS FROM SYSADM.PSDBFIELD
            WHERE FIELDNAME IN (${placeholders})`, binds);
        for (const t of types.rows ?? []) typeByField.set(t.FIELDNAME.trim(), t);
      }

      const recordFields: RecordField[] = expanded.map((f, i) => {
        const t = typeByField.get(f.FIELDNAME.trim());
        return {
          name: f.FIELDNAME.trim(),
          fieldNum: i + 1,
          type: (t?.FIELDTYPE ?? 0) as FieldType,
          length: t?.LENGTH ?? 0,
          decimalPositions: t?.DECIMALPOS ?? 0,
          useEdit: f.USEEDIT,
          editTable: f.EDITTABLE?.trim() || undefined,
          fromSubrecord: f.fromSubrecord
        };
      });

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
          `SELECT SQLTEXT FROM SYSADM.PSSQLTEXTDEFN
            WHERE SQLID = :r AND SQLTYPE = 2 ORDER BY SEQNUM`, { r: recname });
        record.viewSql = (sql.rows ?? []).map((x) => x.SQLTEXT).join('');
      }

      return record;
    });
  }

  async listChildren(key: DefinitionKey): Promise<DefinitionSummary[]> {
    switch (key.type) {
      case DefinitionType.Record: {
        const record = await this.readRecord(key);
        // Each field carries its record, so it can expand to its PeopleCode.
        return record.fields.map((f) => ({
          key: makeKey(DefinitionType.Field, f.name, key.parts[0]),
          description: describeField(f)
        }));
      }
      case DefinitionType.Field:
        return key.parts[1] ? this.recordFieldPeopleCode(key.parts[1], key.parts[0]) : [];
      case DefinitionType.Component: return this.componentPageChildren(key);
      default: return [];
    }
  }

  /**
   * A record field's PeopleCode programs, one per event that has one
   * (PSPCMPROG keyed RECORD (1) . FIELD (2) . event (12)), by event name.
   */
  private async recordFieldPeopleCode(record: string, field: string): Promise<DefinitionSummary[]> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ EVENT: string; UPDATED: Date | null; OPRID: string }>(
        `SELECT OBJECTVALUE3 AS EVENT, MAX(LASTUPDDTTM) AS UPDATED, MAX(LASTUPDOPRID) AS OPRID
           FROM SYSADM.PSPCMPROG
          WHERE OBJECTID1 = 1 AND OBJECTVALUE1 = :r AND OBJECTID2 = 2 AND OBJECTVALUE2 = :f
            AND OBJECTID3 = 12 AND OBJECTID4 = 0
          GROUP BY OBJECTVALUE3
          ORDER BY OBJECTVALUE3`,
        { r: record, f: field });
      return (r.rows ?? []).map((row) => ({
        key: makeKey(DefinitionType.RecordPeopleCode, record, field, row.EVENT.trim()),
        label: row.EVENT.trim(),
        description: 'PeopleCode',
        ...(row.UPDATED ? { lastUpdated: row.UPDATED } : {}),
        ...(row.OPRID?.trim() ? { lastUpdatedBy: row.OPRID.trim() } : {})
      }));
    });
  }

  /** A component's pages, from PSPNLGROUP, in the component's own page order. */
  private async componentPageChildren(key: DefinitionKey): Promise<DefinitionSummary[]> {
    const [name, market] = [key.parts[0], key.parts[1] || 'GBL'];
    return this.withConnection(async (c) => {
      const r = await c.execute<{ PNLNAME: string; ITEMLABEL: string; HIDDEN: number }>(
        `SELECT g.PNLNAME, g.ITEMLABEL, g.HIDDEN
           FROM SYSADM.PSPNLGROUP g
          WHERE g.PNLGRPNAME = :n AND g.MARKET = :m
          ORDER BY g.SUBITEMNUM`,
        { n: name, m: market });
      return (r.rows ?? []).map((row) => ({
        key: makeKey(DefinitionType.Page, row.PNLNAME.trim()),
        description: row.HIDDEN ? `${row.ITEMLABEL?.trim() ?? ''} (hidden)` : row.ITEMLABEL?.trim() || undefined
      }));
    });
  }

  async writeRecord(_record: RecordDefinition): Promise<void> {
    // Saving a record means rewriting PSRECDEFN/PSRECFIELD, bumping PSVERSION
    // and PSLOCK, and regenerating dependent DDL. Implemented in the record
    // editor milestone; see docs/ROADMAP.md.
    throw new UnsupportedOperationError('saving record definitions', this.displayName);
  }
}

/** The driver's own message, which names the real problem far better than we can. */
function reason(err: unknown): string {
  const message = (err as { message?: string })?.message;
  return message ? message.trim().split('\n')[0] : String(err);
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
async function loadOracleDb(): Promise<typeof import('oracledb')> {
  const namespace = await import('oracledb');
  const resolved = (namespace as { default?: typeof import('oracledb') }).default ?? namespace;
  if (typeof resolved?.createPool !== 'function') {
    throw new ProviderError(
      'The oracledb module loaded but does not look like node-oracledb. ' +
      'Reinstall the extension, or check that node_modules/oracledb is intact.');
  }
  return resolved;
}

/** Bind variables for the seven-part definition key. */
function keyBinds(parts: readonly string[]): Record<string, string> {
  const binds: Record<string, string> = {};
  for (let i = 0; i < 7; i++) binds[`v${i + 1}`] = parts[i] ?? ' ';
  return binds;
}

/**
 * A definition key's parts, as PSPCMPROG actually stores them.
 *
 * PSPROJECTITEM identifies an application class by its package path and class
 * name alone -- there is only ever one PeopleCode program per class, so
 * nothing distinguishes it from another item. PSPCMPROG still keys that one
 * program with a trailing 'OnExecute', the same event-name slot record and
 * component PeopleCode use for a real event; confirmed by looking up
 * OU_JET_PACK.Layout.ComponentRegistry directly.
 */
function pcmProgKeyParts(key: DefinitionKey): readonly string[] {
  if (key.type === DefinitionType.ApplicationClassPeopleCode && key.parts.at(-1) !== 'OnExecute') {
    return [...key.parts, 'OnExecute'];
  }
  return key.parts;
}

/** WHERE clause matching all seven OBJECTVALUE columns, unused slots blank. */
function keyPredicate(_key: DefinitionKey): string {
  return [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTVALUE${n} = :v${n}`).join(' AND ');
}
