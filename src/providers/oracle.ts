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
import {
  buildAppEngine, peopleCodeKeyParts, renderAppEngine, type AeSection, type AeStep, type AeVariant, type AppEngineProgram, type AppEngineRows,
  type Row as AeRow
} from '../model/appEngine.js';
import { APPLICATION_CLASS_OBJECTID, PEOPLECODE_OBJECTIDS, pcmProgKeyParts, peopleCodeKeyFromValues, peopleCodeTypeOf } from '../model/peopleCodeKeys.js';
import { assembleProgram, NameTable } from '../peoplecode/progtext.js';
import { decodeProgram, DecodeOptions } from '../peoplecode/decoder.js';
import { FieldLabelRow, FieldRow, renderField } from './oracleRender.js';
import { renderComponent, renderMenu, renderPage, type Row as UiRow } from '../model/uiDefinitions.js';
import { renderComponentInterface, renderFileLayout } from '../model/integrationDefinitions.js';
import { renderMessage, renderPermissionList, renderRole } from '../model/adminDefinitions.js';
import { renderQuery } from '../model/queryDefinition.js';
import { PROCESS_TRANSLATE_FIELDS, renderProcessDefinition } from '../model/processDefinition.js';
import { renderTree, TREE_TRANSLATE_FIELDS } from '../model/treeDefinition.js';
import { PORTAL_TRANSLATE_FIELDS, renderPortalItem } from '../model/portalRegistry.js';
import { NODE_TRANSLATE_FIELDS, renderNode, renderUrl } from '../model/miscDefinitions.js';
import type { ImageContent } from '../editors/imageHtml.js';
import { IB_TRANSLATE_FIELDS, renderMessage as renderIbMessage, renderOperation, renderService } from '../model/ibDefinitions.js';

/** LASTUPDDTTM as text, for the page / component / menu views. */
const UI_STAMP = `TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD HH24:MI:SS') AS LASTUPD`;
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
  /**
   * The schema owning the PeopleTools tables. Absent: PS.PSDBOWNER's owner
   * ID for this database, else SYSADM.
   */
  schema?: string;
}

/** An Oracle schema name, as it may be put into ALTER SESSION (which takes no binds). */
export const SCHEMA_NAME = /^[A-Z][A-Z0-9_$#]{0,127}$/;

export const DEFAULT_SCHEMA = 'SYSADM';

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
    DefinitionType.AppEngineSection,
    DefinitionType.Query,
    DefinitionType.ProcessDefinition,
    DefinitionType.Tree,
    DefinitionType.IbMessage,
    DefinitionType.IbService,
    DefinitionType.IbServiceOperation,
    DefinitionType.Image,
    DefinitionType.PortalRegistry,
    DefinitionType.UrlDefinition,
    DefinitionType.MessageNode,
    DefinitionType.Xslt,
    DefinitionType.FileLayout,
    DefinitionType.ComponentInterface,
    DefinitionType.Role,
    DefinitionType.PermissionList,
    DefinitionType.MessageCatalog,
    DefinitionType.SqlDefinition,
    DefinitionType.HtmlDefinition,
    DefinitionType.StyleSheet
  ];

  private pool?: Pool;
  private resolvedSchema?: string;
  private projectItemKeyWidthCache?: number;
  private environmentCache?: Promise<EnvironmentInfo>;

  constructor(private readonly config: OracleConnectionConfig) {
    this.id = `oracle:${config.name}`;
    this.displayName = config.name;
  }

  get isConnected(): boolean { return this.pool !== undefined; }

  /** The schema the session reads and writes the PeopleTools tables in, once connected. */
  get schema(): string | undefined { return this.resolvedSchema; }

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

    const configured = this.config.schema?.trim().toUpperCase();
    if (configured && !SCHEMA_NAME.test(configured)) throw new ProviderError(`${this.config.schema} is not a valid schema name.`);

    // A standalone session first: it proves the host and credentials (createPool
    // with poolMin 0 opens nothing, so it succeeds against an unreachable host
    // or a wrong password) and finds the schema before the pool exists.
    let schema: string;
    try {
      const probe = await oracledb.getConnection({
        user: this.config.user, password: this.config.password, connectString: this.config.connectString
      });
      try {
        schema = configured || await detectSchema(probe) || DEFAULT_SCHEMA;
      } finally {
        await probe.close();
      }
    } catch (err) {
      throw new ProviderError(
        `Could not connect to ${this.config.connectString} as ${this.config.user}: ${reason(err)}`,
        err);
    }

    // Queries name the PeopleTools tables unqualified: every session the pool
    // creates resolves them in the PeopleSoft schema (CURRENT_SCHEMA), so one
    // setting serves SYSADM and every other owner ID.
    let pool: Pool;
    try {
      pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.config.connectString,
        poolMin: 0,
        poolMax: 4,
        poolTimeout: 120,
        sessionCallback: (conn: Connection, _tag: string, done: (error?: Error) => void) => {
          conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schema}`).then(() => done(), (error: Error) => done(error));
        }
      });
    } catch (err) {
      throw new ProviderError(
        `Could not connect to ${this.config.connectString}: ${reason(err)}`, err);
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
      throw new ProviderError(
        `Connected to ${this.config.connectString}, but schema ${schema} has no PeopleTools tables readable as ${this.config.user}: ${reason(err)}`,
        err);
    }

    this.resolvedSchema = schema;
    this.pool = pool;
  }

  async dispose(): Promise<void> {
    await this.pool?.close(10);
    this.pool = undefined;
    this.resolvedSchema = undefined;
    this.projectItemKeyWidthCache = undefined;
    this.environmentCache = undefined;
  }

  /** PSSTATUS is one row that changes only with a PeopleTools upgrade, so it is read once per connection. */
  readEnvironment(): Promise<EnvironmentInfo> {
    if (this.environmentCache) return this.environmentCache;
    const read = this.withConnection(async (c) => {
      const r = await c.execute<{ TOOLSREL: string; PTPATCHREL: number | null }>(
        `SELECT TOOLSREL, PTPATCHREL FROM PSSTATUS`);
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
        `SELECT PROJECTNAME, PROJECTDESCR FROM PSPROJECTDEFN ORDER BY PROJECTNAME`);
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
        WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND TABLE_NAME = 'PSPROJECTITEM' AND COLUMN_NAME LIKE 'OBJECTVALUE%'`);
    const nums = (r.rows ?? [])
      .map((row) => Number(row.COLUMN_NAME.replace('OBJECTVALUE', '')))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (nums.length === 0) {
      throw new ProviderError(
        'Could not find any OBJECTVALUE columns on PSPROJECTITEM.');
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
           FROM PSPROJECTITEM
          WHERE PROJECTNAME = :p
          ORDER BY OBJECTTYPE, ${orderCols}`,
        { p: project });
      return (r.rows ?? []).map((row) => {
        const values = parts.map((n) => String(row[`OBJECTVALUE${n}`] ?? ''));
        // An SQL definition (SQLTYPE 0) is keyed by its SQLID alone, as search keys it.
        if (Number(row.OBJECTTYPE) === DefinitionType.SqlDefinition && values[1]?.trim() === '0') values[1] = ' ';
        return { key: makeKey(row.OBJECTTYPE as DefinitionType, ...values) };
      });
    });
  }

  async search(query: SearchQuery): Promise<DefinitionSummary[]> {
    const limit = query.limit ?? 500;
    const pattern = (query.namePattern ?? '%').toUpperCase();

    if (query.type === undefined) return this.searchEveryType(query.namePattern, limit);
    if (isPeopleCode(query.type)) return this.searchPeopleCode(query.type, pattern, limit);

    switch (query.type) {
      case DefinitionType.Project:
        return this.searchSimple(
          `SELECT PROJECTNAME AS NAME, PROJECTDESCR AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSPROJECTDEFN WHERE PROJECTNAME LIKE :n`,
          DefinitionType.Project, pattern, limit);
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
        // Keyed by name and market: 1,141 of HRDMO's components are not GBL, and a name may be in several markets.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ N: string; M: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT PNLGRPNAME AS N, MARKET AS M, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSPNLGRPDEFN
              WHERE PNLGRPNAME LIKE :n ORDER BY PNLGRPNAME, MARKET FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.Component, row.N, row.M),
            description: row.DESCR?.trim() || undefined, lastUpdated: row.LASTUPDDTTM, lastUpdatedBy: row.LASTUPDOPRID?.trim()
          }));
        });
      case DefinitionType.Menu:
        return this.searchSimple(
          `SELECT MENUNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSMENUDEFN WHERE MENUNAME LIKE :n`,
          DefinitionType.Menu, pattern, limit);
      case DefinitionType.Tree:
        // Every effective-dated version: keyed SetID, set control value, name, effective date.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ S: string; C: string; N: string; E: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT SETID AS S, SETCNTRLVALUE AS C, TREE_NAME AS N, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS E, DESCR, LASTUPDDTTM, LASTUPDOPRID
               FROM PSTREEDEFN WHERE TREE_NAME LIKE :n ORDER BY TREE_NAME, SETID, EFFDT DESC FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.Tree, row.S ?? ' ', row.C ?? ' ', row.N, row.E),
            description: row.DESCR?.trim() || undefined, lastUpdated: row.LASTUPDDTTM, lastUpdatedBy: row.LASTUPDOPRID?.trim()
          }));
        });
      case DefinitionType.ProcessDefinition:
        // Keyed by process type and name; the name is what is searched.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ T: string; N: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT PRCSTYPE AS T, PRCSNAME AS N, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PS_PRCSDEFN
              WHERE PRCSNAME LIKE :n ORDER BY PRCSNAME, PRCSTYPE FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.ProcessDefinition, row.T, row.N),
            description: row.DESCR?.trim() || undefined, lastUpdated: row.LASTUPDDTTM, lastUpdatedBy: row.LASTUPDOPRID?.trim()
          }));
        });
      case DefinitionType.Query:
        // Public queries (OPRID blank) only: a private query is its owner's.
        return this.searchSimple(
          `SELECT QRYNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSQRYDEFN WHERE OPRID = ' ' AND QRYNAME LIKE :n`,
          DefinitionType.Query, pattern, limit);
      case DefinitionType.PortalRegistry:
        // Keyed portal, type, name; the name is what is searched.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ P: string; T: string; N: string; L: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT PORTAL_NAME AS P, PORTAL_REFTYPE AS T, PORTAL_OBJNAME AS N, PORTAL_LABEL AS L, LASTUPDDTTM, LASTUPDOPRID FROM PSPRSMDEFN
              WHERE PORTAL_OBJNAME LIKE :n ORDER BY PORTAL_OBJNAME, PORTAL_NAME FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.PortalRegistry, row.P, row.T, row.N),
            description: row.L?.trim() || undefined, lastUpdated: row.LASTUPDDTTM, lastUpdatedBy: row.LASTUPDOPRID?.trim()
          }));
        });
      case DefinitionType.UrlDefinition:
        return this.searchSimple(
          `SELECT URL_ID AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSURLDEFN WHERE URL_ID LIKE :n`,
          DefinitionType.UrlDefinition, pattern, limit);
      case DefinitionType.MessageNode:
        return this.searchSimple(
          `SELECT MSGNODENAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSMSGNODEDEFN WHERE MSGNODENAME LIKE :n`,
          DefinitionType.MessageNode, pattern, limit);
      case DefinitionType.Xslt:
        return this.withConnection(async (c) => {
          const r = await c.execute<{ N: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT SQLID AS N, LASTUPDDTTM, LASTUPDOPRID FROM PSSQLDEFN WHERE SQLTYPE = '6' AND SQLID LIKE :n ORDER BY SQLID FETCH FIRST :lim ROWS ONLY`,
            { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({ key: makeKey(DefinitionType.Xslt, row.N, '6'), lastUpdated: row.LASTUPDDTTM, lastUpdatedBy: row.LASTUPDOPRID?.trim() }));
        });
      case DefinitionType.Image:
        return this.searchSimple(
          `SELECT CONTNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSCONTDEFN WHERE CONTTYPE = 1 AND ALTCONTNUM = 1 AND CONTNAME LIKE :n`,
          DefinitionType.Image, pattern, limit);
      case DefinitionType.IbMessage:
        return this.searchSimple(
          `SELECT MSGNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSMSGDEFN WHERE MSGNAME LIKE :n`,
          DefinitionType.IbMessage, pattern, limit);
      case DefinitionType.IbService:
        return this.searchSimple(
          `SELECT IB_SERVICENAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSSERVICE WHERE IB_SERVICENAME LIKE :n`,
          DefinitionType.IbService, pattern, limit);
      case DefinitionType.IbServiceOperation:
        return this.searchSimple(
          `SELECT IB_OPERATIONNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSOPERATION WHERE IB_OPERATIONNAME LIKE :n`,
          DefinitionType.IbServiceOperation, pattern, limit);
      case DefinitionType.FileLayout:
        return this.searchSimple(
          `SELECT FLDDEFNNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSFLDDEFN WHERE FLDDEFNNAME LIKE :n`,
          DefinitionType.FileLayout, pattern, limit);
      case DefinitionType.ComponentInterface:
        return this.searchSimple(
          `SELECT BCNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSBCDEFN WHERE BCNAME LIKE :n`,
          DefinitionType.ComponentInterface, pattern, limit);
      case DefinitionType.Role:
        return this.searchSimple(
          `SELECT ROLENAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSROLEDEFN WHERE UPPER(ROLENAME) LIKE :n`,
          DefinitionType.Role, pattern, limit);
      case DefinitionType.PermissionList:
        return this.searchSimple(
          `SELECT CLASSID AS NAME, CLASSDEFNDESC AS DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSCLASSDEFN WHERE CLASSID LIKE :n`,
          DefinitionType.PermissionList, pattern, limit);
      case DefinitionType.AppEngineProgram:
        return this.searchSimple(
          `SELECT AE_APPLID AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSAEAPPLDEFN WHERE AE_APPLID LIKE :n`,
          DefinitionType.AppEngineProgram, pattern, limit);
      case DefinitionType.AppEngineSection:
        // Keyed program, section; "BEN110" finds every section of BEN110, "BEN110.M%" its sections from M.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ P: string; S: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT S.AE_APPLID AS P, S.AE_SECTION AS S, S.LASTUPDDTTM, S.LASTUPDOPRID,
                    (SELECT MAX(D.DESCR) FROM PSAESECTDTLDEFN D WHERE D.AE_APPLID = S.AE_APPLID AND D.AE_SECTION = S.AE_SECTION) AS DESCR
               FROM PSAESECTDEFN S WHERE S.AE_APPLID LIKE :n OR S.AE_APPLID || '.' || S.AE_SECTION LIKE :n
              ORDER BY S.AE_APPLID, S.AE_SECTION FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.AppEngineSection, row.P.trim(), row.S.trim()),
            description: row.DESCR?.trim() || undefined, lastUpdated: row.LASTUPDDTTM, lastUpdatedBy: row.LASTUPDOPRID?.trim()
          }));
        });
      case DefinitionType.MessageCatalog:
        // Keyed set, number. The pattern matches a set ("1000"), a message ("1000.25") or the text ("%NOT FOUND%").
        return this.withConnection(async (c) => {
          const r = await c.execute<{ S: number; N: number; T: string; LAST_UPDATE_DTTM: Date }>(
            `SELECT MESSAGE_SET_NBR AS S, MESSAGE_NBR AS N, MESSAGE_TEXT AS T, LAST_UPDATE_DTTM FROM PSMSGCATDEFN
              WHERE TO_CHAR(MESSAGE_SET_NBR) LIKE :n OR MESSAGE_SET_NBR || '.' || MESSAGE_NBR LIKE :n OR UPPER(MESSAGE_TEXT) LIKE :n
              ORDER BY MESSAGE_SET_NBR, MESSAGE_NBR FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
          return (r.rows ?? []).map((row) => ({
            key: makeKey(DefinitionType.MessageCatalog, String(row.S), String(row.N)),
            description: row.T?.trim() || undefined, lastUpdated: row.LAST_UPDATE_DTTM
          }));
        });
      case DefinitionType.ApplicationPackage:
        return this.searchSimple(
          `SELECT PACKAGEROOT AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSPACKAGEDEFN WHERE PACKAGEROOT LIKE :n AND PACKAGELEVEL = 0`,
          DefinitionType.ApplicationPackage, pattern, limit);
      case DefinitionType.SqlDefinition:
        return this.searchSimple(
          `SELECT SQLID AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSSQLDEFN WHERE SQLID LIKE :n AND SQLTYPE = 0`,
          DefinitionType.SqlDefinition, pattern, limit);
      case DefinitionType.StyleSheet:
        return this.searchSimple(
          `SELECT STYLESHEETNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME LIKE :n`,
          DefinitionType.StyleSheet, pattern, limit);
      case DefinitionType.HtmlDefinition:
        // HTML only (CONTTYPE 4); images and style sheets share PSCONTDEFN.
        return this.withConnection(async (c) => {
          const r = await c.execute<{ NAME: string; DESCR: string; LASTUPDDTTM: Date; LASTUPDOPRID: string }>(
            `SELECT CONTNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSCONTDEFN
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

  /**
   * Every searchable type at once, for a search that names no type: each
   * type's matches, taken in turn (one of each, then the next of each) so a
   * type with many matches does not crowd the others out of the limit.
   */
  private async searchEveryType(namePattern: string | undefined, limit: number): Promise<DefinitionSummary[]> {
    const perType: DefinitionSummary[][] = [];
    for (const type of this.searchableTypes) perType.push(await this.search({ type, namePattern, limit }));
    const out: DefinitionSummary[] = [];
    for (let i = 0; out.length < limit && perType.some((list) => i < list.length); i++) {
      for (const list of perType) if (i < list.length && out.length < limit) out.push(list[i]);
    }
    return out;
  }

  /**
   * PeopleCode programs of one kind whose first key value (record, component,
   * page, program, root package, menu) matches the pattern, from PSPCMPROG's
   * first row of each program. The OBJECTIDs tell the kinds apart
   * (PEOPLECODE_OBJECTIDS); PS_PSPCMPROG's (OBJECTID1, OBJECTVALUE1) prefix
   * serves the search.
   */
  private async searchPeopleCode(type: DefinitionType, pattern: string, limit: number): Promise<DefinitionSummary[]> {
    const ids = PEOPLECODE_OBJECTIDS[type];
    let where: string;
    if (type === DefinitionType.ApplicationClassPeopleCode) {
      where = `OBJECTID1 = ${APPLICATION_CLASS_OBJECTID}`;
    } else if (ids) {
      where = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n} = ${ids[n - 1] ?? 0}`).join(' AND ');
    } else {
      throw new UnsupportedOperationError(`searching ${type} PeopleCode`, this.displayName);
    }
    const cols = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ');
    return this.withConnection(async (c) => {
      const r = await c.execute<Record<string, string | number | Date>>(
        `SELECT ${cols}, LASTUPDDTTM, LASTUPDOPRID FROM PSPCMPROG
          WHERE PROGSEQ = 0 AND ${where} AND OBJECTVALUE1 LIKE :n
          ORDER BY OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE4, OBJECTVALUE5, OBJECTVALUE6, OBJECTVALUE7
          FETCH FIRST :lim ROWS ONLY`, { n: pattern, lim: limit });
      return (r.rows ?? []).flatMap((row) => {
        const used = [1, 2, 3, 4, 5, 6, 7].filter((n) => Number(row[`OBJECTID${n}`]) !== 0);
        if (peopleCodeTypeOf(used.map((n) => Number(row[`OBJECTID${n}`]))) !== type) return [];
        const values = used.map((n) => String(row[`OBJECTVALUE${n}`] ?? '').trim());
        return [{
          key: makeKey(type, ...peopleCodeKeyFromValues(type, values)),
          lastUpdated: row.LASTUPDDTTM as Date, lastUpdatedBy: String(row.LASTUPDOPRID ?? '').trim() || undefined
        }];
      });
    });
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
        `SELECT * FROM ${spec.table} WHERE ${columns.map((col, i) => `${col} = :b${i}`).join(' AND ')}` +
        (spec.orderBy ? ` ORDER BY ${spec.orderBy}` : ''),
        columns.map((col) => where[col]), options);
      const row = r.rows?.[0];
      if (!row) return undefined;
      const input: PropertiesInput = { key, row };
      if (key.type === DefinitionType.SqlDefinition) {
        const d = await c.execute<StoredRow>(
          `SELECT * FROM PSSQLDESCR WHERE SQLID = :id AND SQLTYPE = :t ORDER BY EFFDT DESC`,
          [where.SQLID, where.SQLTYPE], options);
        if (d.rows?.[0]) input.descriptionRow = d.rows[0];
      }
      if (key.type === DefinitionType.Field) {
        const l = await c.execute<StoredRow>(
          `SELECT LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL FROM PSDBFLDLABL WHERE FIELDNAME = :f ORDER BY DEFAULT_LABEL DESC, LABEL_ID`,
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
        `SELECT VERSION FROM PSPROJECTDEFN WHERE PROJECTNAME = :p`, { p: project });
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
        `SELECT (SELECT COUNT(*) FROM PSRECDEFN WHERE RECNAME = :r) AS N FROM DUAL`, { r: request.recname });
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
        `SELECT VERSION FROM PSSQLDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id: key.parts[0] });
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
      `SELECT COUNT(*) AS N FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :n OR PACKAGEID = :n`, { n: name })).rows?.[0]?.N ?? 0) > 0);
  }

  /** Creates an empty project as App Designer's first save does (projectWriter.ts createProject). */
  async createProject(request: { project: string; operatorId: string }): Promise<ProjectSaveResult> {
    return this.withConnection((c) => createProjectRow(c, request));
  }

  /** Whether a project name is taken. */
  async projectExists(name: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM PSPROJECTDEFN WHERE PROJECTNAME = :p`, { p: name })).rows?.[0]?.N ?? 0) > 0);
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
      `SELECT COUNT(*) AS N FROM PSDBFIELD WHERE FIELDNAME = :f`, { f: name })).rows?.[0]?.N ?? 0) > 0);
  }

  /** Whether a table exists in the PeopleSoft schema, and whether it holds any row. */
  async tableState(table: string): Promise<{ exists: boolean; hasRows: boolean }> {
    if (!/^[A-Z][A-Z0-9_#$]{0,127}$/.test(table)) throw new ProviderError(`${table} is not a table name.`);
    return this.withConnection(async (c) => {
      const r = await c.execute<{ N: number }>(
        `SELECT COUNT(*) AS N FROM ALL_TABLES WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND TABLE_NAME = :t`, { t: table });
      if (Number(r.rows?.[0]?.N ?? 0) === 0) return { exists: false, hasRows: false };
      const rows = await c.execute(`SELECT 1 FROM ${table} WHERE ROWNUM = 1`);
      return { exists: true, hasRows: (rows.rows?.length ?? 0) > 0 };
    });
  }

  /**
   * Build and Execute: runs a build's statements in order on one session,
   * stopping at the first that fails. DDL commits as it runs, so the ones
   * before a failure stay done; the result says which ran.
   */
  async executeBuild(statements: readonly string[]): Promise<{ ran: number; error?: { statement: string; message: string } }> {
    return this.withConnection(async (c) => {
      for (const [i, statement] of statements.entries()) {
        try {
          await c.execute(statement);
        } catch (err) {
          return { ran: i, error: { statement, message: reason(err) } };
        }
      }
      return { ran: statements.length };
    });
  }

  /**
   * The Oracle DDL model a record builds with: PSDDLMODEL's Create Table and
   * Create Index statements (platform 2, sizing set 0), PSDDLDEFPARMS'
   * defaults, and the record's and its key index's own parameters over them.
   */
  async readDdlModel(recname: string): Promise<DdlModel | undefined> {
    return this.withConnection(async (c) => {
      const models = await c.execute<{ T: number; M: string }>(
        `SELECT STATEMENT_TYPE AS T, MODEL_STATEMENT AS M FROM PSDDLMODEL
          WHERE PLATFORMID = 2 AND SIZING_SET = 0 AND STATEMENT_TYPE IN (1, 2)`, {},
        { fetchInfo: { M: { type: (await loadOracleDb()).STRING } } });
      const table = models.rows?.find((r) => Number(r.T) === 1)?.M;
      const index = models.rows?.find((r) => Number(r.T) === 2)?.M;
      if (!table || !index) return undefined;
      const parms = async (sql: string, binds: Record<string, string | number>) => Object.fromEntries(
        ((await c.execute<{ N: string; V: string }>(sql, binds)).rows ?? []).map((r) => [String(r.N).trim(), String(r.V ?? '')]));
      const defaults = (type: number) => parms(
        `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSDDLDEFPARMS WHERE PLATFORMID = 2 AND SIZING_SET = 0 AND STATEMENT_TYPE = :t`, { t: type });
      return {
        table, index,
        tableParms: { ...(await defaults(1)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSRECDDLPARM WHERE RECNAME = :r AND PLATFORMID = 2 AND SIZINGSET = 0`, { r: recname })) },
        indexParms: { ...(await defaults(2)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSIDXDDLPARM WHERE RECNAME = :r AND INDEXID = '_' AND PLATFORMID = 2 AND SIZINGSET = 0`, { r: recname })) },
        indexDefaults: await defaults(2),
        altIndexParms: Object.fromEntries(await Promise.all(Array.from({ length: 10 }, (_, n) => String(n)).map(async (id) => [id, { ...(await defaults(2)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSIDXDDLPARM WHERE RECNAME = :r AND INDEXID = :i AND PLATFORMID = 2 AND SIZINGSET = 0`, { r: recname, i: id })) }])))
      };
    });
  }

  /** Whether a record name is free, taken, or was deleted before (PSRECDEL: not re-created here). */
  async recordNameStatus(recname: string): Promise<'free' | 'exists' | 'deleted'> {
    return this.withConnection(async (c) => {
      const r = await c.execute<{ D: number; X: number }>(
        `SELECT (SELECT COUNT(*) FROM PSRECDEFN WHERE RECNAME = :r) AS D, (SELECT COUNT(*) FROM PSRECDEL WHERE RECNAME = :r) AS X FROM DUAL`,
        { r: recname });
      const row = r.rows?.[0];
      return Number(row?.D) > 0 ? 'exists' : Number(row?.X) > 0 ? 'deleted' : 'free';
    });
  }

  /** Whether any SQL definition row (of any SQL type) uses the ID. */
  async sqlIdTaken(sqlId: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM PSSQLDEFN WHERE SQLID = :id`, { id: sqlId })).rows?.[0]?.N ?? 0) > 0);
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
      `SELECT STYLESHEETTYPE AS T, PARENTSTYLENAME AS P, DESCR AS D, NUMSTYLECLASS AS N FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :n`,
      { n: name })).rows?.[0]);
    if (!head) throw new ProviderError(`No style sheet named ${name}.`);
    if (Number(head.T) === 2) return this.readContent(name, 9, `text for style sheet ${name}`);
    // SUBSTYLESHEET 1 marks a row naming an included sub style sheet (270 of 3,490), not a class.
    const classes = await this.withConnection(async (c) => (await c.execute<{ C: string; S: number }>(
      `SELECT STYLECLASSNAME AS C, SUBSTYLESHEET AS S FROM PSSTYLECLASS WHERE STYLESHEETNAME = :n ORDER BY SEQNO, STYLECLASSNAME`,
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
      `SELECT VERSION, STYLESHEETTYPE AS T FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :n`, { n: key.parts[0] })).rows?.[0]);
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
        `SELECT VERSION FROM PSCONTDEFN WHERE CONTNAME = :n AND CONTTYPE = :t AND ALTCONTNUM = 1`,
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
      case DefinitionType.AppEngineProgram:
      case DefinitionType.AppEngineSection: return this.readAppEngine(key);
      case DefinitionType.FileLayout: return this.readFileLayout(key);
      case DefinitionType.PermissionList: return this.readPermissionList(key);
      case DefinitionType.ProcessDefinition: return this.readProcessDefinition(key);
      case DefinitionType.Tree: return this.readTree(key);
      case DefinitionType.PortalRegistry: return this.readPortalItem(key);
      case DefinitionType.Xslt: return this.readSqlDefinition(makeKey(DefinitionType.SqlDefinition, key.parts[0], key.parts[1] || '6'));
      case DefinitionType.UrlDefinition: return this.readUrl(key);
      case DefinitionType.MessageNode: return this.readNode(key);
      case DefinitionType.IbMessage: return this.readIbMessage(key);
      case DefinitionType.IbService: return this.readIbService(key);
      case DefinitionType.IbServiceOperation: return this.readIbOperation(key);
      case DefinitionType.Query: return this.readQuery(key);
      case DefinitionType.Role: return this.readRole(key);
      case DefinitionType.MessageCatalog: return this.readMessage(key);
      case DefinitionType.ComponentInterface: return this.readComponentInterface(key);
      default:
        throw new UnsupportedOperationError(
          `reading definition type ${key.type} as text`, this.displayName);
    }
  }

  canReadAsText(type: DefinitionType): boolean {
    return isPeopleCode(type) || [
      DefinitionType.SqlDefinition, DefinitionType.HtmlDefinition, DefinitionType.StyleSheet, DefinitionType.Field,
      DefinitionType.Menu, DefinitionType.Page, DefinitionType.Component, DefinitionType.AppEngineProgram,
      DefinitionType.AppEngineSection, DefinitionType.FileLayout, DefinitionType.ComponentInterface,
      DefinitionType.PermissionList, DefinitionType.Role, DefinitionType.MessageCatalog, DefinitionType.Query,
      DefinitionType.ProcessDefinition, DefinitionType.Tree, DefinitionType.PortalRegistry,
      DefinitionType.Xslt, DefinitionType.UrlDefinition, DefinitionType.MessageNode,
      DefinitionType.IbMessage, DefinitionType.IbService, DefinitionType.IbServiceOperation
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
        `SELECT CONTDATA FROM PSCONTENT
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
           FROM PSDBFIELD WHERE FIELDNAME = :n`, { n: name });
      const row = d.rows?.[0];
      if (!row) return undefined;
      const l = await c.execute<{ LABEL_ID: string; LONGNAME: string; SHORTNAME: string; DEFAULT_LABEL: number }>(
        `SELECT LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL FROM PSDBFLDLABL WHERE FIELDNAME = :n ORDER BY LABEL_ID`,
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
        `SELECT FIELDTYPE, LENGTH, DECIMALPOS, VERSION FROM PSDBFIELD WHERE FIELDNAME = :n`, { n: name });
      const labels = await c.execute<FieldLabelRow>(
        `SELECT LABEL_ID, LONGNAME, SHORTNAME FROM PSDBFLDLABL
          WHERE FIELDNAME = :n ORDER BY LABEL_ID`, { n: name });
      return renderField(name, defn.rows?.[0], labels.rows ?? []);
    });
  }

  /** Rows of one query, every CLOB column as text (DESCRLONG, PORTAL_URLTEXT ...), never a LOB handle. */
  private async uiRows(c: Connection, sql: string, binds: Record<string, string>): Promise<UiRow[]> {
    const oracledb = await loadOracleDb();
    return (await c.execute<UiRow>(sql, binds, {
      fetchTypeHandler: (meta: { dbType?: unknown }) =>
        meta.dbType === oracledb.DB_TYPE_CLOB || meta.dbType === oracledb.DB_TYPE_NCLOB ? { type: oracledb.STRING } : undefined
    })).rows ?? [];
  }

  /** PSXLATITEM's current long names for fields: field -> value -> name. */
  private async translates(c: Connection, fields: readonly string[]): Promise<Map<string, Map<string, string>>> {
    const out = new Map<string, Map<string, string>>();
    if (fields.length === 0) return out;
    const r = await c.execute<{ F: string; V: string; L: string }>(
      `SELECT FIELDNAME AS F, FIELDVALUE AS V, XLATLONGNAME AS L FROM PSXLATITEM X
        WHERE FIELDNAME IN (${fields.map((_, i) => `:f${i}`).join(', ')})
          AND EFFDT = (SELECT MAX(EFFDT) FROM PSXLATITEM Y WHERE Y.FIELDNAME = X.FIELDNAME AND Y.FIELDVALUE = X.FIELDVALUE)`,
      Object.fromEntries(fields.map((f, i) => [`f${i}`, f])));
    for (const row of r.rows ?? []) {
      const f = String(row.F).trim();
      if (!out.has(f)) out.set(f, new Map());
      out.get(f)!.set(String(row.V).trim(), String(row.L ?? '').trim());
    }
    return out;
  }

  private async readIbMessage(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const q = (sql: string) => this.uiRows(c, sql, { n: name });
      const [message] = await q(`SELECT M.*, ${UI_STAMP} FROM PSMSGDEFN M WHERE MSGNAME = :n`);
      if (!message) throw new ProviderError(`No message named ${name}.`);
      return renderIbMessage(name, {
        message,
        versions: await q(`SELECT * FROM PSMSGVER WHERE MSGNAME = :n`),
        records: await q(`SELECT * FROM PSMSGREC WHERE MSGNAME = :n`),
        operations: await q(`SELECT DISTINCT IB_OPERATIONNAME, VERSIONNAME FROM PSOPRVERDFNPARM WHERE MSGNAME = :n ORDER BY 1, 2`),
        translates: await this.translates(c, IB_TRANSLATE_FIELDS)
      });
    });
  }

  private async readIbService(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const q = (sql: string) => this.uiRows(c, sql, { n: name });
      const [service] = await q(`SELECT S.*, ${UI_STAMP} FROM PSSERVICE S WHERE IB_SERVICENAME = :n`);
      if (!service) throw new ProviderError(`No service named ${name}.`);
      return renderService(name, {
        service,
        operations: await q(`SELECT O.IB_OPERATIONNAME, O.RTNGTYPE, O.DESCR FROM PSSERVICEOPR S
                               LEFT JOIN PSOPERATION O ON O.IB_OPERATIONNAME = S.IB_OPERATIONNAME WHERE S.IB_SERVICENAME = :n`),
        translates: await this.translates(c, IB_TRANSLATE_FIELDS)
      });
    });
  }

  private async readIbOperation(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const q = (sql: string) => this.uiRows(c, sql, { n: name });
      const [operation] = await q(`SELECT O.*, ${UI_STAMP} FROM PSOPERATION O WHERE IB_OPERATIONNAME = :n`);
      if (!operation) throw new ProviderError(`No service operation named ${name}.`);
      return renderOperation(name, {
        operation,
        versions: await q(`SELECT * FROM PSOPRVERDFN WHERE IB_OPERATIONNAME = :n`),
        parameters: await q(`SELECT * FROM PSOPRVERDFNPARM WHERE IB_OPERATIONNAME = :n ORDER BY VERSIONNAME, PARAMETERNAME`),
        handlers: await q(`SELECT * FROM PSOPRHDLR WHERE IB_OPERATIONNAME = :n`),
        routings: await q(`SELECT ROUTINGDEFNNAME, SENDERNODENAME, RECEIVERNODENAME, EFF_STATUS FROM PSIBRTNGDEFN R WHERE IB_OPERATIONNAME = :n
                            AND EFFDT = (SELECT MAX(EFFDT) FROM PSIBRTNGDEFN Y WHERE Y.ROUTINGDEFNNAME = R.ROUTINGDEFNNAME)`),
        translates: await this.translates(c, IB_TRANSLATE_FIELDS)
      });
    });
  }

  /** An image (PSCONTDEFN CONTTYPE 1) and every alternate's bytes (PSCONTENT, in SEQNUM order). */
  async readImage(key: DefinitionKey): Promise<ImageContent | undefined> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const defs = (await c.execute<{ ALTCONTNUM: number; CONTFMT: string; DESCR: string }>(
        `SELECT ALTCONTNUM, CONTFMT, DESCR FROM PSCONTDEFN WHERE CONTNAME = :n AND CONTTYPE = 1 ORDER BY ALTCONTNUM`, { n: name })).rows ?? [];
      if (defs.length === 0) return undefined;
      const chunks = (await c.execute<{ ALTCONTNUM: number; CONTDATA: Buffer }>(
        `SELECT ALTCONTNUM, CONTDATA FROM PSCONTENT WHERE CONTNAME = :n AND CONTTYPE = 1 ORDER BY ALTCONTNUM, SEQNUM`, { n: name })).rows ?? [];
      return {
        name, format: String(defs[0].CONTFMT ?? '').trim(), description: String(defs[0].DESCR ?? '').trim(),
        alternates: defs.map((d) => ({
          altContNum: Number(d.ALTCONTNUM), format: String(d.CONTFMT ?? '').trim(),
          bytes: Buffer.concat(chunks.filter((x) => Number(x.ALTCONTNUM) === Number(d.ALTCONTNUM)).map((x) => Buffer.from(x.CONTDATA ?? [])))
        }))
      };
    });
  }

  private async readUrl(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [url] = await this.uiRows(c, `SELECT U.*, ${UI_STAMP} FROM PSURLDEFN U WHERE URL_ID = :n`, { n: name });
      if (!url) throw new ProviderError(`No URL definition named ${name}.`);
      return renderUrl(name, url);
    });
  }

  /** An Integration Broker node. Its password columns are not read; secret connector properties are not shown. */
  private async readNode(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [node] = await this.uiRows(c, `SELECT MSGNODENAME, VERSION, DESCR, ACTIVE_NODE, LOCALNODE, LOCALDEFAULTFLG, NODE_TYPE, ROUTINGTYPE,
            AUTHOPTN, USERID, PORTAL_NAME, IB_TGTLOCATION, CONNGATEWAYID, CONNID, CONTACTMNGR, CONTACTEMAIL, CONTACTPHONENBR, CONTACTURL,
            TOOLSREL, LASTUPDOPRID, ${UI_STAMP} FROM PSMSGNODEDEFN WHERE MSGNODENAME = :n`, { n: name });
      if (!node) throw new ProviderError(`No node named ${name}.`);
      return renderNode(name, {
        node,
        connectorProperties: await this.uiRows(c, `SELECT PROPID, PROPNAME, SEQNUM, PROPVALUE FROM PSNODECONPROP WHERE MSGNODENAME = :n`, { n: name }),
        translates: await this.translates(c, NODE_TRANSLATE_FIELDS)
      });
    });
  }

  /** A portal registry folder or content reference, keyed portal, type (C / F), name. */
  private async readPortalItem(key: DefinitionKey): Promise<string> {
    const [portal, type, name] = key.parts;
    return this.withConnection(async (c) => {
      // A link's target label comes with it (LINK_LABEL): links have none of their own.
      const one = async (t: string, n: string) => (await this.uiRows(c,
        `SELECT P.*, ${UI_STAMP}, (SELECT MAX(L.PORTAL_LABEL) FROM PSPRSMDEFN L WHERE L.PORTAL_OBJNAME = P.PORTAL_LINKOBJNAME
                                     AND L.PORTAL_NAME = NVL(TRIM(P.PORTAL_LINK_PORTAL), P.PORTAL_NAME)) AS LINK_LABEL
           FROM PSPRSMDEFN P WHERE PORTAL_NAME = :p AND PORTAL_REFTYPE = :t AND PORTAL_OBJNAME = :n`, { p: portal, t, n }))[0];
      const item = await one(type ?? 'C', name ?? '');
      if (!item) throw new ProviderError(`No portal registry entry ${name} in ${portal}.`);
      // The folders above it, nearest first, as far as the root (at most 30 levels).
      const path: typeof item[] = [];
      let parent = String(item.PORTAL_PRNTOBJNAME ?? '').trim();
      while (parent && path.length < 30) {
        const folder = await one('F', parent);
        if (!folder) break;
        path.push(folder);
        parent = String(folder.PORTAL_PRNTOBJNAME ?? '').trim();
      }
      const binds = { p: portal, t: type ?? 'C', n: name ?? '' };
      const where = `WHERE PORTAL_NAME = :p AND PORTAL_REFTYPE = :t AND PORTAL_OBJNAME = :n`;
      return renderPortalItem({
        item, path,
        children: type === 'F' ? await this.uiRows(c, `SELECT P.PORTAL_REFTYPE, P.PORTAL_OBJNAME, P.PORTAL_LABEL,
                                                          (SELECT MAX(L.PORTAL_LABEL) FROM PSPRSMDEFN L WHERE L.PORTAL_OBJNAME = P.PORTAL_LINKOBJNAME
                                                             AND L.PORTAL_NAME = NVL(TRIM(P.PORTAL_LINK_PORTAL), P.PORTAL_NAME)) AS LINK_LABEL
                                                        FROM PSPRSMDEFN P WHERE PORTAL_NAME = :p AND PORTAL_PRNTOBJNAME = :n ORDER BY PORTAL_SEQ_NUM, PORTAL_LABEL`,
          { p: portal, n: name ?? '' }) : [],
        permissions: await this.uiRows(c, `SELECT PORTAL_PERMTYPE, PORTAL_PERMNAME FROM PSPRSMPERM ${where} ORDER BY PORTAL_PERMTYPE, PORTAL_PERMNAME`, binds),
        attributes: await this.uiRows(c, `SELECT PORTAL_ATTR_NAM, PORTAL_ATTR_VAL FROM PSPRSMATTRVAL ${where} ORDER BY PORTAL_ATTR_NAM, PORTAL_SEQ_NUM`, binds),
        translates: await this.translates(c, PORTAL_TRANSLATE_FIELDS)
      });
    });
  }

  /** A tree, keyed by SetID, set control value, name and effective date (YYYY-MM-DD). */
  private async readTree(key: DefinitionKey): Promise<string> {
    const [setid, setcntrl, name, effdt] = key.parts;
    return this.withConnection(async (c) => {
      const binds = { s: setid?.trim() || ' ', c: setcntrl?.trim() || ' ', n: name ?? '', e: effdt ?? '' };
      const where = `WHERE SETID = :s AND SETCNTRLVALUE = :c AND TREE_NAME = :n AND EFFDT = TO_DATE(:e, 'YYYY-MM-DD')`;
      const [tree] = await this.uiRows(c, `SELECT T.*, TO_CHAR(EFFDT, 'YYYY-MM-DD') AS EFFDT_TEXT, ${UI_STAMP} FROM PSTREEDEFN T ${where}`, binds);
      if (!tree) throw new ProviderError(`No tree ${name} effective ${effdt}${setid?.trim() ? ` in SetID ${setid}` : ''}.`);
      const [structure] = await this.uiRows(c, `SELECT * FROM PSTREESTRCT WHERE TREE_STRCT_ID = :i`, { i: String(tree.TREE_STRCT_ID ?? ' ') });
      return renderTree({
        tree, structure,
        levels: await this.uiRows(c, `SELECT TREE_LEVEL, TREE_LEVEL_NUM FROM PSTREELEVEL ${where}`, binds),
        nodes: await this.uiRows(c, `SELECT TREE_NODE_NUM, TREE_NODE, TREE_LEVEL_NUM, PARENT_NODE_NUM FROM PSTREENODE ${where}`, binds),
        leaves: await this.uiRows(c, `SELECT TREE_NODE_NUM, RANGE_FROM, RANGE_TO, DYNAMIC_RANGE FROM PSTREELEAF ${where}`, binds),
        translates: await this.translates(c, TREE_TRANSLATE_FIELDS)
      });
    });
  }

  /** A process definition, keyed by process type and name. */
  private async readProcessDefinition(key: DefinitionKey): Promise<string> {
    const [type, name] = key.parts;
    return this.withConnection(async (c) => {
      const binds = { t: type ?? '', n: name ?? '' };
      const [process] = await this.uiRows(c, `SELECT P.*, ${UI_STAMP} FROM PS_PRCSDEFN P WHERE PRCSTYPE = :t AND PRCSNAME = :n`, binds);
      if (!process) throw new ProviderError(`No process definition ${type} / ${name}.`);
      return renderProcessDefinition({
        process,
        components: await this.uiRows(c, `SELECT PNLGRPNAME FROM PS_PRCSDEFNPNL WHERE PRCSTYPE = :t AND PRCSNAME = :n`, binds),
        groups: await this.uiRows(c, `SELECT PRCSGRP FROM PS_PRCSDEFNGRP WHERE PRCSTYPE = :t AND PRCSNAME = :n`, binds),
        translates: await this.translates(c, PROCESS_TRANSLATE_FIELDS)
      });
    });
  }

  /** A query, keyed by name and owner (blank or absent: public). */
  private async readQuery(key: DefinitionKey): Promise<string> {
    const [name, owner] = key.parts;
    return this.withConnection(async (c) => {
      const binds = { n: name, o: owner?.trim() || ' ' };
      const q = async (sql: string) => {
        const STRING = (await loadOracleDb()).STRING;
        return (await c.execute<UiRow>(sql, binds, { fetchInfo: { EXPRESSIONTEXT: { type: STRING }, DESCRLONG: { type: STRING } } })).rows ?? [];
      };
      const [query] = await q(`SELECT D.*, ${UI_STAMP} FROM PSQRYDEFN D WHERE QRYNAME = :n AND OPRID = :o`);
      if (!query) throw new ProviderError(`No ${binds.o.trim() ? `private query ${name} of ${binds.o}` : `public query ${name}`}.`);
      const where = `WHERE QRYNAME = :n AND OPRID = :o`;
      return renderQuery(name, {
        query,
        selects: await q(`SELECT * FROM PSQRYSELECT ${where}`),
        records: await q(`SELECT * FROM PSQRYRECORD ${where}`),
        fields: await q(`SELECT * FROM PSQRYFIELD ${where}`),
        criteria: await q(`SELECT * FROM PSQRYCRITERIA ${where}`),
        expressions: await q(`SELECT * FROM PSQRYEXPR ${where}`),
        binds: await q(`SELECT * FROM PSQRYBIND ${where}`)
      });
    });
  }

  private async readPermissionList(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [list] = await this.uiRows(c, `SELECT P.*, ${UI_STAMP} FROM PSCLASSDEFN P WHERE CLASSID = :n`, { n: name });
      if (!list) throw new ProviderError(`No permission list named ${name}.`);
      const q = (sql: string) => this.uiRows(c, sql, { n: name });
      const items = await q(`SELECT * FROM PSAUTHITEM WHERE CLASSID = :n ORDER BY MENUNAME, BARNAME, BARITEMNAME, PNLITEMNAME`);
      const realMenus = new Set((await q(`SELECT DISTINCT M.MENUNAME FROM PSAUTHITEM A JOIN PSMENUDEFN M ON M.MENUNAME = A.MENUNAME
                                          WHERE A.CLASSID = :n`)).map((r) => String(r.MENUNAME).trim()));
      return renderPermissionList(name, {
        list, items, realMenus,
        roles: await q(`SELECT ROLENAME FROM PSROLECLASS WHERE CLASSID = :n ORDER BY ROLENAME`),
        signon: await q(`SELECT * FROM PSAUTHSIGNON WHERE CLASSID = :n`),
        componentInterfaces: await q(`SELECT BCNAME, BCMETHOD FROM PSAUTHBUSCOMP WHERE CLASSID = :n ORDER BY BCNAME, BCMETHOD`),
        webServices: await q(`SELECT IB_OPERATIONNAME FROM PSAUTHWS WHERE CLASSID = :n`),
        processGroups: await q(`SELECT PRCSGRP FROM PSAUTHPRCS WHERE CLASSID = :n`),
        queryAccess: await q(`SELECT TREE_NAME, ACCESS_GROUP, ACCESSIBLE FROM PS_SCRTY_ACC_GRP WHERE CLASSID = :n ORDER BY TREE_NAME, ACCESS_GROUP`)
      });
    });
  }

  private async readRole(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const q = (sql: string) => this.uiRows(c, sql, { n: name });
      const [role] = await q(`SELECT R.*, ${UI_STAMP} FROM PSROLEDEFN R WHERE ROLENAME = :n`);
      if (!role) throw new ProviderError(`No role named ${name}.`);
      const [{ N: users }] = await q(`SELECT COUNT(*) AS N FROM PSROLEUSER WHERE ROLENAME = :n`);
      return renderRole(name, {
        role, userCount: Number(users),
        permissionLists: await q(`SELECT R.CLASSID, C.CLASSDEFNDESC FROM PSROLECLASS R LEFT JOIN PSCLASSDEFN C ON C.CLASSID = R.CLASSID
                                    WHERE R.ROLENAME = :n ORDER BY R.CLASSID`),
        canGrant: await q(`SELECT GRANTROLENAME FROM PSROLECANGRANT WHERE ROLENAME = :n ORDER BY GRANTROLENAME`)
      });
    });
  }

  /** A Message Catalog entry, keyed set and number (a project item adds the set's description). */
  private async readMessage(key: DefinitionKey): Promise<string> {
    const [set, nbr] = key.parts;
    return this.withConnection(async (c) => {
      const binds = { s: set ?? '', m: nbr ?? '' };
      const [message] = await this.uiRows(c, `SELECT M.*, TO_CHAR(LAST_UPDATE_DTTM, 'YYYY-MM-DD HH24:MI:SS') AS LASTUPD FROM PSMSGCATDEFN M
                                              WHERE MESSAGE_SET_NBR = :s AND MESSAGE_NBR = :m`, binds);
      if (!message) throw new ProviderError(`No message ${set}, ${nbr}.`);
      const [setRow] = await this.uiRows(c, `SELECT * FROM PSMSGSETDEFN WHERE MESSAGE_SET_NBR = :s`, { s: binds.s });
      return renderMessage({ set: setRow, message });
    });
  }

  private async readFileLayout(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [layout] = await this.uiRows(c, `SELECT L.*, ${UI_STAMP} FROM PSFLDDEFN L WHERE FLDDEFNNAME = :n`, { n: name });
      if (!layout) throw new ProviderError(`No file layout named ${name}.`);
      const segments = await this.uiRows(c, `SELECT * FROM PSFLDSEGDEFN WHERE FLDDEFNNAME = :n ORDER BY FLDSEQNO`, { n: name });
      const fields = await this.uiRows(c, `SELECT * FROM PSFLDFIELDDEFN WHERE FLDDEFNNAME = :n ORDER BY FLDSEGNAME, FLDSEQNO`, { n: name });
      return renderFileLayout(name, { layout, segments, fields });
    });
  }

  private async readComponentInterface(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [ci] = await this.uiRows(c, `SELECT B.*, ${UI_STAMP} FROM PSBCDEFN B WHERE BCNAME = :n`, { n: name });
      if (!ci) throw new ProviderError(`No component interface named ${name}.`);
      const items = await this.uiRows(c, `SELECT * FROM PSBCITEM WHERE BCNAME = :n ORDER BY SEQUENCE_NBR_6`, { n: name });
      return renderComponentInterface(name, { ci, items });
    });
  }

  private async readMenuSummary(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [menu] = await this.uiRows(c, `SELECT M.*, ${UI_STAMP} FROM PSMENUDEFN M WHERE MENUNAME = :n`, { n: name });
      if (!menu) throw new ProviderError(`No menu named ${name}.`);
      const items = await this.uiRows(c, `SELECT * FROM PSMENUITEM WHERE MENUNAME = :n ORDER BY BARNAME, ITEMNUM`, { n: name });
      return renderMenu(name, { menu, items });
    });
  }

  private async readPageSummary(key: DefinitionKey): Promise<string> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [page] = await this.uiRows(c, `SELECT P.*, ${UI_STAMP} FROM PSPNLDEFN P WHERE PNLNAME = :n`, { n: name });
      if (!page) throw new ProviderError(`No page named ${name}.`);
      const fields = await this.uiRows(c, `SELECT * FROM PSPNLFIELD WHERE PNLNAME = :n ORDER BY FIELDNUM`, { n: name });
      const components = await this.uiRows(c,
        `SELECT PNLGRPNAME, MARKET, ITEMLABEL FROM PSPNLGROUP WHERE PNLNAME = :n ORDER BY PNLGRPNAME, MARKET`, { n: name });
      return renderPage(name, { page, fields, components });
    });
  }

  private async readComponentSummary(key: DefinitionKey): Promise<string> {
    const [name, market = 'GBL'] = key.parts;
    return this.withConnection(async (c) => {
      const [component] = await this.uiRows(c,
        `SELECT G.*, ${UI_STAMP} FROM PSPNLGRPDEFN G WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
      if (!component) throw new ProviderError(`No component named ${name}.${market}.`);
      const pages = await this.uiRows(c,
        `SELECT * FROM PSPNLGROUP WHERE PNLGRPNAME = :n AND MARKET = :m ORDER BY SUBITEMNUM`, { n: name, m: market });
      const menus = await this.uiRows(c,
        `SELECT MENUNAME, BARNAME, ITEMNAME, ITEMLABEL FROM PSMENUITEM WHERE PNLGRPNAME = :n AND MARKET = :m ORDER BY MENUNAME, BARNAME, ITEMNAME`,
        { n: name, m: market });
      return renderComponent(name, market, { component, pages, menus });
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
        `SELECT PROGSEQ, PROGTXT FROM PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds);
      const rows = prog.rows ?? [];
      if (rows.length === 0) {
        throw new ProviderError(`No PeopleCode program found for ${key.parts.join('.')}.`);
      }

      // RECNAME carries the qualifier a reference is written with in source
      // -- "HTML" for HTML.OU_OJET_REQUIRE_CONFIG, the record name for a
      // record.field, "PACKAGE" for an application package. Reading REFNAME
      // alone dropped it, so references decoded as a bare name.
      const nameRows = await c.execute<{ NAMENUM: number; RECNAME: string; REFNAME: string }>(
        `SELECT NAMENUM, RECNAME, REFNAME FROM PSPCMNAME WHERE ${where} ORDER BY NAMENUM`,
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

  /** An App Engine program's rows (model/appEngine.ts), or undefined when there is none. */
  async readAppEngineRows(name: string): Promise<AppEngineRows | undefined> {
    return this.withConnection(async (c) => {
      const STRING = (await loadOracleDb()).STRING;
      // SQLTEXT and DESCRLONG are CLOBs: fetched as text, not LOB handles.
      const all = async (sql: string) => (await c.execute<AeRow>(sql, { a: name },
        { fetchInfo: { SQLTEXT: { type: STRING }, DESCRLONG: { type: STRING } } })).rows ?? [];
      const effdt = `TO_CHAR(EFFDT, 'YYYY-MM-DD') AS EFFDT`;
      const [program] = await all(`SELECT * FROM PSAEAPPLDEFN WHERE AE_APPLID = :a`);
      if (!program) return undefined;
      return {
        program,
        states: await all(`SELECT * FROM PSAEAPPLSTATE WHERE AE_APPLID = :a`),
        tempTables: await all(`SELECT * FROM PSAEAPPLTEMPTBL WHERE AE_APPLID = :a`),
        sections: await all(`SELECT * FROM PSAESECTDEFN WHERE AE_APPLID = :a`),
        variants: await all(`SELECT AE_SECTION, MARKET, DBTYPE, ${effdt}, EFF_STATUS, DESCR, AE_AUTO_COMMIT FROM PSAESECTDTLDEFN WHERE AE_APPLID = :a`),
        steps: await all(`SELECT AE_SECTION, MARKET, DBTYPE, ${effdt}, AE_STEP, AE_SEQ_NUM, AE_ACTIVE_STATUS, AE_ABEND_ACTION, AE_COMMIT_AFTER,
                                 AE_DO_SECTION, AE_DO_APPL_ID, AE_DYNAMIC_DO, AE_PC_ON_FALSE, AE_ON_NOROWS, DESCR, MESSAGE_SET_NBR, MESSAGE_NBR,
                                 AE_COMMIT_FREQ FROM PSAESTEPDEFN WHERE AE_APPLID = :a`),
        actions: await all(`SELECT AE_SECTION, MARKET, DBTYPE, ${effdt}, AE_STEP, AE_STMT_TYPE, AE_REUSE_STMT, AE_DO_SELECT_TYPE, SQLID, DESCR
                              FROM PSAESTMTDEFN WHERE AE_APPLID = :a`),
        messages: await all(`SELECT AE_SECTION, MARKET, DBTYPE, ${effdt}, AE_STEP, AE_MESSAGE_PARMS FROM PSAESTEPMSGDEFN WHERE AE_APPLID = :a`),
        sqlText: await all(`SELECT SQLID, MARKET, DBTYPE, ${effdt}, SEQNUM, SQLTEXT FROM PSSQLTEXTDEFN
                             WHERE SQLTYPE IN ('1', '6') AND SUBSTR(SQLID, 1, 12) = RPAD(:a, 12)`),
        // The Message Catalog text of the program's Log Message actions.
        messageCatalog: await all(`SELECT M.MESSAGE_SET_NBR, M.MESSAGE_NBR, M.MESSAGE_TEXT FROM PSMSGCATDEFN M
                                    WHERE (M.MESSAGE_SET_NBR, M.MESSAGE_NBR) IN (SELECT S.MESSAGE_SET_NBR, S.MESSAGE_NBR FROM PSAESTEPDEFN S
                                      WHERE S.AE_APPLID = :a AND EXISTS (SELECT 1 FROM PSAESTMTDEFN T WHERE T.AE_APPLID = S.AE_APPLID
                                        AND T.AE_SECTION = S.AE_SECTION AND T.MARKET = S.MARKET AND T.DBTYPE = S.DBTYPE AND T.EFFDT = S.EFFDT
                                        AND T.AE_STEP = S.AE_STEP AND T.AE_STMT_TYPE = 'M'))`)
      };
    });
  }

  /** An App Engine program as text, with each PeopleCode action's source decoded (renderAppEngine). */
  /**
   * An App Engine program built from its rows (a section key: that section
   * alone), with each PeopleCode action's source decoded, for the text view
   * and the Definition / Program Flow panel.
   */
  async readAppEngineView(key: DefinitionKey): Promise<{
    program: AppEngineProgram; peopleCode: (s: AeSection, v: AeVariant, st: AeStep) => string | undefined;
  }> {
    const rows = await this.readAppEngineRows(key.parts[0]);
    if (!rows) throw new ProviderError(`No App Engine program named ${key.parts[0]}.`);
    let program = buildAppEngine(rows);
    if (key.type === DefinitionType.AppEngineSection) {
      const section = program.sections.find((s) => s.name === key.parts[1]);
      if (!section) throw new ProviderError(`${program.name} has no section ${key.parts[1]}.`);
      program = { ...program, sections: [section] };
    }
    const sources = new Map<string, string | undefined>();
    for (const section of program.sections) {
      for (const variant of section.variants) {
        for (const step of variant.steps.filter((s) => s.actions.some((a) => a.type === 'P'))) {
          const parts = peopleCodeKeyParts(program.name, section.name, variant, step.name);
          if (parts) sources.set(parts.join('|'), await this.readPeopleCode(makeKey(DefinitionType.AppEnginePeopleCode, ...parts)).catch(() => undefined));
        }
      }
    }
    return {
      program,
      peopleCode: (section, variant, step) => sources.get(peopleCodeKeyParts(program.name, section.name, variant, step.name)?.join('|') ?? '')
    };
  }

  private async readAppEngine(key: DefinitionKey): Promise<string> {
    const { program, peopleCode } = await this.readAppEngineView(key);
    return renderAppEngine(program, peopleCode);
  }

  private async readSqlDefinition(key: DefinitionKey): Promise<string> {
    return this.withConnection(async (c) => {
      // SQLTEXT is a CLOB: fetched as text, or node-oracledb hands back a LOB object.
      // One text: GBL, the default platform, the latest effective date where there is
      // such a row, else the first variant -- its 14,000-character rows in SEQNUM order.
      const r = await c.execute<{ V: string; SQLTEXT: string }>(
        `SELECT MARKET || '|' || DBTYPE || '|' || TO_CHAR(EFFDT, 'YYYY-MM-DD') AS V, SQLTEXT FROM PSSQLTEXTDEFN
          WHERE SQLID = :id AND SQLTYPE = :t
          ORDER BY CASE WHEN MARKET = 'GBL' AND DBTYPE = ' ' THEN 0 ELSE 1 END, MARKET, DBTYPE, EFFDT DESC, SEQNUM`,
        { id: key.parts[0], t: key.parts[1] ?? '0' }, { fetchInfo: { SQLTEXT: { type: (await loadOracleDb()).STRING } } });
      const rows = r.rows ?? [];
      if (rows.length === 0) throw new ProviderError(`No SQL definition named ${key.parts[0]}.`);
      return rows.filter((x) => x.V === rows[0].V).map((x) => x.SQLTEXT).join('');
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
         FROM PSRECFIELD WHERE RECNAME = :r ORDER BY FIELDNUM`, { r: recname });

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
           FROM PSRECDEFN WHERE RECNAME = :r`, { r: recname })).rows?.[0];
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
                (SELECT COUNT(*) FROM PSPCMPROG p WHERE p.OBJECTID1 = 1 AND p.OBJECTVALUE1 = rf.RECNAME
                    AND p.OBJECTID2 = 2 AND p.OBJECTVALUE2 = rf.FIELDNAME AND p.PROGSEQ = 0) AS PC
           FROM PSRECFIELD rf
           LEFT JOIN PSDBFIELD f ON f.FIELDNAME = rf.FIELDNAME AND rf.SUBRECORD <> 'Y'
           LEFT JOIN PSDBFLDLABL l ON l.FIELDNAME = rf.FIELDNAME AND rf.SUBRECORD <> 'Y'
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
          `SELECT SQLTEXT FROM PSSQLTEXTDEFN WHERE SQLID = :r AND SQLTYPE = 2 ORDER BY SEQNUM`, { r: recname },
          { fetchInfo: { SQLTEXT: { type: (await loadOracleDb()).STRING } } });
        layout.viewSql = (sql.rows ?? []).map((x) => x.SQLTEXT).join('');
      }
      // Every label of the record's fields, for the Record Field Label ID choice.
      const labelRows = (await c.execute<{ FIELDNAME: string; LABEL_ID: string; LONGNAME: string; SHORTNAME: string; DEFAULT_LABEL: number }>(
        `SELECT l.FIELDNAME, l.LABEL_ID, l.LONGNAME, l.SHORTNAME, l.DEFAULT_LABEL FROM PSDBFLDLABL l
          WHERE l.FIELDNAME IN (SELECT FIELDNAME FROM PSRECFIELD WHERE RECNAME = :r AND SUBRECORD = 'N')
          ORDER BY l.FIELDNAME, l.LABEL_ID`, { r: recname })).rows ?? [];
      for (const f of layout.fields) {
        f.labels = labelRows.filter((l) => t(l.FIELDNAME) === f.name)
          .map((l) => ({ id: t(l.LABEL_ID), longName: t(l.LONGNAME), shortName: t(l.SHORTNAME), isDefault: Number(l.DEFAULT_LABEL) === 1 }));
      }
      if (layout.recordType === RecordType.QueryView) {
        const q = await c.execute<{ QRYNAME: string }>(
          `SELECT QRYNAME FROM PSQRYDEFN WHERE QRYNAME = :r AND ROWNUM = 1`, { r: recname });
        if (q.rows?.[0]) layout.queryName = t(q.rows[0].QRYNAME);
      }
      const ts = await c.execute<{ DDLSPACENAME: string }>(
        `SELECT DDLSPACENAME FROM PSRECTBLSPC WHERE RECNAME = :r AND ROWNUM = 1`, { r: recname });
      if (ts.rows?.[0]) layout.tablespace = t(ts.rows[0].DDLSPACENAME);
      const idx = await c.execute<{ INDEXID: string }>(
        `SELECT INDEXID FROM PSINDEXDEFN WHERE RECNAME = :r ORDER BY INDEXID`, { r: recname });
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
          `SELECT DISTINCT RECNAME FROM PSRECFIELD WHERE FIELDNAME = :f AND SUBRECORD = 'N' ORDER BY RECNAME`, { f: field });
        for (const r of recs.rows ?? []) out.push({ group: 'Record', label: t(r.RECNAME), key: makeKey(DefinitionType.Record, t(r.RECNAME)) });
      }
      const pages = await c.execute<{ PNLNAME: string; RECNAME: string }>(
        `SELECT DISTINCT PNLNAME, RECNAME FROM PSPNLFIELD WHERE FIELDNAME = :f ${record ? 'AND RECNAME = :r' : ''} ORDER BY PNLNAME`,
        record ? { f: field, r: record } : { f: field });
      for (const p of pages.rows ?? []) {
        out.push({ group: 'Page', label: t(p.PNLNAME), description: `${t(p.RECNAME)}.${field}`, key: makeKey(DefinitionType.Page, t(p.PNLNAME)) });
      }
      const cols = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ');
      const pcs = await c.execute<Record<string, string | number>>(
        `SELECT DISTINCT RECNAME, ${cols} FROM PSPCMNAME WHERE REFNAME = :f AND RECNAME ${record ? '= :r' : "<> ' '"}
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
          const type = peopleCodeTypeOf(used);
          if (type !== undefined) key = makeKey(type, ...peopleCodeKeyFromValues(type, vals));
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
           FROM PSXLATITEM WHERE FIELDNAME = :f ORDER BY FIELDVALUE, EFFDT`, { f: fieldName });
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
           FROM PSRECDEFN WHERE RECNAME = :r`, { r: recname });
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
          `SELECT FIELDNAME, FIELDTYPE, LENGTH, DECIMALPOS FROM PSDBFIELD
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
          `SELECT SQLTEXT FROM PSSQLTEXTDEFN
            WHERE SQLID = :r AND SQLTYPE = 2 ORDER BY SEQNUM`, { r: recname },
          { fetchInfo: { SQLTEXT: { type: (await loadOracleDb()).STRING } } });
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
           FROM PSPCMPROG
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
           FROM PSPNLGROUP g
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

/** WHERE clause matching all seven OBJECTVALUE columns, unused slots blank. */
function keyPredicate(_key: DefinitionKey): string {
  return [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTVALUE${n} = :v${n}`).join(' AND ');
}
