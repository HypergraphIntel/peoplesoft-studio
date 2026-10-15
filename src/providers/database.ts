import { saveOAuth, type OAuthSaveRequest } from './securityWriter.js';
import { listSecurity, readSecurity, securityChoices } from './securityReader.js';
import type { SecurityKind } from '../model/security.js';
import { readPortalDocument, savePortalDocument, type PortalSaveRequest } from './portalWriter.js';
import { portalInput, portalKey, type PortalIdentity } from '../model/portalDocument.js';
import { createHash } from 'node:crypto';
import { listAdministration, readAdministration, saveAdministration, verifyAdministration, type AdminSaveRequest } from './administrationWriter.js';
import { adminInputKey, validateAdminInput, type AdminKind } from '../model/administration.js';
import { witnessedCreation, recordCreation, type CreationReceipt, type DefinitionStamp } from './creationProvenance.js';
import type { DbConnection as Connection, DbPool, DbTypes } from '../db/connection.js';
import { openDatabase, type DatabasePlatform } from '../db/open.js';
import {
  DefinitionProvider, DefinitionSummary, EnvironmentInfo, ProjectSummary, ProviderCapabilities,
  ProviderError, SearchQuery, UnsupportedOperationError
} from './provider.js';
import { DefinitionKey, DefinitionType, displayName as keyDisplayName, isPeopleCode, makeKey } from '../model/definitions.js';
import { PROPERTIES_SPECS, PropertiesInput, StoredRow } from '../model/properties.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';
import type { RecordLayout, TranslateValue } from '../model/recordLayout.js';
import type { DefinitionReference } from './provider.js';
import { createProject as createProjectRow, saveProject, verifyProjectSave, type ProjectSaveRequest, type ProjectSaveResult } from './projectWriter.js';
import { deleteRecord, saveRecord, verifyRecordSave, type RecordSaveRequest, type RecordSaveResult } from './recordWriter.js';
import { ddlPlatformFor, tableName, type DdlModel } from '../model/recordDdl.js';
import { maskSql, prepareReadOnlyQuery } from '../sql/readOnlyQuery.js';
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
import { renderComponent, renderMenu, renderPage, type PageView, type Row as UiRow } from '../model/uiDefinitions.js';
import { buildPageLayout, type PageLayout } from '../model/pageLayout.js';
import { buildComponentStructure, referencedPages, type ComponentStructure, type StructureField } from '../model/componentStructure.js';
import { ciBuffer, ciFromBuffer, markKeys, type CiBuffer, type CiDocument, type CiRecordField, type CiSource } from '../model/ciDocument.js';
import { ciDocumentOf, ciToken, deleteCi, readStoredCi, renameCi, saveCi, verifyCiSave, type CiSaveRequest, type CiSaveResult } from './ciWriter.js';
import { ciSourceFromData, type CiSourceData } from '../model/ciSource.js';
import { componentBuffer, pageStructure, type RecordInfo } from '../model/bufferStructure.js';
import { PAGE_FIELD_TYPES as PAGE_CONTROL_TYPES } from '../model/uiDefinitions.js';
import { buildComponentDefinition, type ComponentDefinition } from '../model/componentDefinition.js';
import { bufferRecords, peopleCodeObjects, type PeopleCodeObject } from '../model/componentPeopleCode.js';
import { saveComponent, type ComponentSaveRequest, type ComponentSaveResult } from './componentWriter.js';
import { createPage, savePage, verifyPageSave, type PageCreateRequest, type PageSaveRequest, type PageSaveResult } from './pageWriter.js';
import type { PagePropertyChoices } from '../editors/pageHtml.js';
import {
  appEngineToken, deleteAppEngine, documentOf, readStoredAppEngine, renameAppEngine, saveAppEngine, verifyAppEngineSave,
  type AeSaveRequest, type AeSaveResult
} from './appEngineWriter.js';
import {
  deleteMenu, menuDocumentOf, menuToken, readStoredMenu, renameMenu, saveMenu, verifyMenuSave, type MenuSaveRequest, type MenuSaveResult
} from './menuWriter.js';
import { TRANSFER_ACTIONS, type MenuDocument } from '../model/menuDocument.js';
import {
  channelDocumentOf, channelToken, deleteChannel, readChannelContext, readStoredChannel, renameChannel, saveChannel, verifyChannelSave,
  type ChannelSaveRequest, type ChannelSaveResult
} from './channelWriter.js';
import { newChannel, type ChannelDocument, type ChannelReferenceLookup } from '../model/channelDocument.js';
import { renderChannel } from '../model/channelOperations.js';
import { classifyOwnership, type Classification, type NamingPrefix, type OwnershipEvidence } from '../model/ownership.js';
import { captureBaseline, readOwnershipEvidence, readRelease, resolveBaseline, type BaselineFile, type DatabaseRelease } from './ownershipReader.js';
import { guardWrite, type WriteAction } from './writeGuard.js';
import { discoverEventMapping } from './eventMappingReader.js';
import { discoverDropZones } from './dropZoneReader.js';
import { discoverPageFieldConfigurator } from './pfcReader.js';
import type { PfcDiscovery } from '../model/pageFieldConfigurator.js';
import { derivePfcMappings, pfcContentReferences, type PfcMapping } from './pfcMapper.js';
import { pfcCatalogFields, pfcCatalogPages, pfcMaskProfiles, type PfcCatalogField, type PfcCatalogPage, type PfcMaskProfile } from './pfcCatalog.js';
import {
  PFC_TARGETING_TABLES, compactRow, isTypeService, mappingSignature, pfcToken, rowsOf, type ListTable, readPfcColumns, readPfcConfiguration, savePfcConfiguration, storedSignature,
  type PfcSaveRequest, type PfcSaveResult
} from './pfcWriter.js';
import { dropZoneToken, readDropZoneState, saveDropZones, type DropZoneOwner, type DropZoneSaveRequest, type DropZoneSaveResult } from './dropZoneWriter.js';
import type { DropZone } from '../model/dropZones.js';
import type { DropZoneDiscovery } from '../model/dropZones.js';
import {
  configRowsOf, configurationToken, readStoredConfiguration, removeConfiguration, saveConfiguration,
  type ConfigurationSaveRequest, type ConfigurationSaveResult
} from './eventMappingWriter.js';
import {
  createAppClassService, qualifyPath, serviceClassSource, validateServiceRequest, type AppClassServicePlan, type AppClassServiceRequest
} from './rcServiceWriter.js';
import type { EventMappingConfigRow, EventMappingDiscovery } from '../model/eventMapping.js';
import type { MenuReferenceLookup } from '../model/menuSession.js';
import type { AeDocument } from '../model/aeDocument.js';
import type { AeReferenceLookup } from '../model/aeValidation.js';
import { renderComponentInterface, renderFileLayout } from '../model/integrationDefinitions.js';
import { renderMessage, renderPermissionList, renderRole } from '../model/adminDefinitions.js';
import { renderQuery, type QueryView } from '../model/queryDefinition.js';
import { prepareQueryExecution, validateQueryPromptValues } from './queryRunner.js';
import type { QuerySqlPlan } from '../model/querySql.js';
import {
  readQueryForEdit as readEditableQuery, saveQuery as writeQuery, verifyQuerySave,
  type QueryEdit, type QuerySaveRequest, type QuerySaveResult
} from './queryWriter.js';
import { saveProcess, type ProcessSaveRequest } from './processWriter.js';
import { processToken } from '../model/processEdit.js';
import type { ProcessView } from '../model/processDefinition.js';
import { PROCESS_TRANSLATE_FIELDS, renderProcessDefinition } from '../model/processDefinition.js';
import { renderTree, TREE_TRANSLATE_FIELDS } from '../model/treeDefinition.js';
import { PORTAL_TRANSLATE_FIELDS, renderPortalItem } from '../model/portalRegistry.js';
import { NODE_TRANSLATE_FIELDS, renderNode, renderUrl } from '../model/miscDefinitions.js';
import type { ImageContent } from '../editors/imageHtml.js';
import { IB_TRANSLATE_FIELDS, renderMessage as renderIbMessage, renderOperation, renderService } from '../model/ibDefinitions.js';
import { listIb, readIb, validateIb } from './ibReader.js';
import type { IbKind, IbDocument } from '../model/ibDocument.js';
import { saveIb, type IbSaveRequest } from './ibWriter.js';
import { ibDefinitionKey, IB_DEFINITION_TYPES, ibWriteInput } from '../model/ibOperations.js';
import { newIbInput, type IbNewOptions } from '../model/ibNew.js';
import { safeRows as ibSafeRows, rows as ibRows } from './ibReader.js';

/** LASTUPDDTTM as text, for the page / component / menu views. */
const UI_STAMP = `TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD HH24:MI:SS') AS LASTUPD`;
import {
  operatorExists, readForEdit, readStoredProgram, savePeopleCode as writePeopleCode, select, verifyCommitted,
  type PeopleCodeSaveRequest, type PeopleCodeSaveResult
} from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

export interface DatabaseConnectionConfig {
  name: string;
  /** The database PeopleSoft runs on. */
  platform: DatabasePlatform;
  /**
   * Oracle: an Easy Connect string or TNS alias. SQL Server:
   * host[\instance][:port]/database. DB2: host[:port]/database.
   */
  connectString: string;
  user: string;
  password: string;
  /** Oracle Instant Client directory; absent means node-oracledb Thin mode. */
  thickModeLibDir?: string;
  /** DB2: a directory with node_modules/ibm_db; absent: resolved normally. */
  db2DriverPath?: string;
  decoderMode?: DecodeOptions['mode'];
  /**
   * The schema owning the PeopleTools tables. Absent: PS.PSDBOWNER's owner
   * ID for this database, else the platform's default (Oracle SYSADM, SQL
   * Server the login's default schema, DB2 the user's).
   */
  schema?: string;
  /**
   * Two-tier sign-on: the PeopleSoft operator (PSOPRDEFN.OPRID) this
   * connection signs on as. The database login ({@link user}) is the proxy
   * that runs every query; this operator is the acting identity a save is
   * recorded as. When set, {@link connect} verifies the operator exists and
   * is not locked before the connection is usable.
   */
  signonOperator?: string;
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
export class DatabaseProvider implements DefinitionProvider {
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
    DefinitionType.MessageChannel,
    DefinitionType.IbService,
    DefinitionType.IbServiceOperation,
    DefinitionType.IbRouting,
    DefinitionType.IbDocument,
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

  private pool?: DbPool;
  private projectItemKeyWidthCache?: number;
  private environmentCache?: Promise<EnvironmentInfo>;

  constructor(private readonly config: DatabaseConnectionConfig) {
    this.id = `${config.platform}:${config.name}`;
    this.displayName = config.name;
  }

  get isConnected(): boolean { return this.pool !== undefined; }

  /** The schema the session reads and writes the PeopleTools tables in, once connected. */
  get schema(): string | undefined { return this.pool?.schema; }

  /** The database PeopleSoft runs on here. */
  get platform(): DatabasePlatform { return this.config.platform; }

  /** The driver's constants (LOB bind types, fetch options), once connected. */
  private get types(): DbTypes {
    if (!this.pool) throw new ProviderError(`${this.displayName} is not connected.`);
    return this.pool.types;
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    try {
      this.pool = await openDatabase(this.config.platform, {
        connectString: this.config.connectString,
        user: this.config.user,
        password: this.config.password,
        ...(this.config.thickModeLibDir ? { thickModeLibDir: this.config.thickModeLibDir } : {}),
        ...(this.config.db2DriverPath ? { db2DriverPath: this.config.db2DriverPath } : {}),
        ...(this.config.schema ? { schema: this.config.schema } : {})
      });
    } catch (err) {
      throw new ProviderError(reason(err), err);
    }

    // Two-tier sign-on: the operator the save identity will be must exist and
    // be usable in this database, checked through the proxy connection before
    // the connection is handed back. A bad operator fails sign-on, as it does
    // in App Designer, rather than surfacing only at the first save.
    if (this.config.signonOperator) {
      try {
        await this.verifySignonOperator(this.config.signonOperator);
      } catch (err) {
        await this.pool?.close(0).catch(() => { /* already closing down */ });
        this.pool = undefined;
        throw err;
      }
    }
  }

  /**
   * Checks a two-tier sign-on operator against PSOPRDEFN through the proxy
   * connection: it must have a row (PSOPRDEFN) and not be locked (ACCTLOCK 0).
   * The operator password is not checked here -- that is a one-way hash this
   * extension does not reproduce; the proxy database login is the credential
   * that gates the connection.
   */
  private async verifySignonOperator(operatorId: string): Promise<void> {
    const row = await this.withConnection(async (c) =>
      (await c.execute<{ ACCTLOCK: number }>(
        `SELECT ACCTLOCK FROM PSOPRDEFN WHERE OPRID = :op`, { op: operatorId })).rows?.[0]);
    if (!row) {
      throw new ProviderError(`PeopleSoft operator ${operatorId} does not exist in ${this.displayName} (PSOPRDEFN).`);
    }
    if (Number(row.ACCTLOCK) !== 0) {
      throw new ProviderError(`PeopleSoft operator ${operatorId} is locked in ${this.displayName} (PSOPRDEFN.ACCTLOCK).`);
    }
  }

  async dispose(): Promise<void> {
    await this.pool?.close(10);
    this.pool = undefined;
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
    const nums = (await c.catalog.columns(c, 'PSPROJECTITEM'))
      .filter((col) => col.name.startsWith('OBJECTVALUE'))
      .map((col) => Number(col.name.replace('OBJECTVALUE', '')))
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
      case DefinitionType.MessageChannel:
        return this.searchSimple(
          `SELECT CHNLNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSCHNLDEFN WHERE CHNLNAME LIKE :n`,
          DefinitionType.MessageChannel, pattern, limit);
      case DefinitionType.IbService:
        return this.searchSimple(
          `SELECT IB_SERVICENAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSSERVICE WHERE IB_SERVICENAME LIKE :n`,
          DefinitionType.IbService, pattern, limit);
      case DefinitionType.IbServiceOperation:
        return this.searchSimple(
          `SELECT IB_OPERATIONNAME AS NAME, DESCR, LASTUPDDTTM, LASTUPDOPRID FROM PSOPERATION WHERE IB_OPERATIONNAME LIKE :n`,
          DefinitionType.IbServiceOperation, pattern, limit);
      case DefinitionType.IbRouting:
      case DefinitionType.IbDocument:
        return this.withConnection(async c => {
          const document = query.type === DefinitionType.IbDocument;
          const sql = document ? `SELECT IB_PACKAGEID AS K1,IB_SCHEMANAME AS K2,IB_VARIANTNAME AS K3,DESCR FROM PSLSDEFN
              WHERE IB_SCHEMANAME LIKE :n OR IB_PACKAGEID LIKE :n ORDER BY IB_PACKAGEID,IB_SCHEMANAME,IB_VARIANTNAME FETCH FIRST :lim ROWS ONLY`
            : `SELECT ROUTINGDEFNNAME AS K1,TO_CHAR(EFFDT,'YYYY-MM-DD') AS K2,DESCR FROM PSIBRTNGDEFN WHERE ROUTINGDEFNNAME LIKE :n ORDER BY ROUTINGDEFNNAME,EFFDT FETCH FIRST :lim ROWS ONLY`;
          const result = await c.execute<{K1:string;K2:string;K3?:string;DESCR:string}>(sql,{n:pattern,lim:limit});
          return (result.rows??[]).map(r=>({key:makeKey(query.type!,...[r.K1,r.K2,...(document?[r.K3!]:[])].map(s=>s.trim())),description:r.DESCR?.trim()}));
        });
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
    const types = this.types;
    return this.withConnection((c) => readForEdit(c, types, pcmProgKeyParts(key)));
  }

  /**
   * A definition's row for its Properties panel: every column, long text
   * (DESCRLONG) as a string. A field adds its labels; a SQL definition its
   * description row, which PSSQLDESCR keeps apart (newest effective date).
   */
  async readProperties(key: DefinitionKey): Promise<PropertiesInput | undefined> {
    const spec = PROPERTIES_SPECS[key.type];
    if (!spec) return undefined;
    const types = this.types;
    const options = {
      outFormat: types.OUT_FORMAT_OBJECT,
      fetchTypeHandler: (meta: { dbType?: unknown }) =>
        meta.dbType === types.DB_TYPE_CLOB || meta.dbType === types.DB_TYPE_NCLOB ? { type: types.STRING } : undefined
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
    const key=makeKey(DefinitionType.Record,request.edit.recname);
    if (!request.edit.isNew) await this.guard(key, 'save');
    const previous=request.edit.isNew?undefined:await this.createdReceipt(key);
    const result = await this.withConnection((c) => saveRecord(c, request));
    await this.withConnection((c) => verifyRecordSave(c, request, result));
    if(request.edit.isNew || previous)await this.noteCreation(key,{version:result.version,operator:request.operatorId,updated:result.lastupddttm},previous);
    return result;
  }

  /**
   * Deletes a record definition as App Designer does (recordWriter.ts
   * deleteRecord, case r40), then checks on another connection that it is gone.
   */
  async deleteRecord(request: { recname: string; openedVersion: number; operatorId: string }): Promise<{ version: number }> {
    await this.guard(makeKey(DefinitionType.Record, request.recname), 'delete');
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
    await this.guard(makeKey(DefinitionType.Field, field), 'save');
    await this.withConnection((c) => saveTranslateRows(c, field, change, operatorId));
  }

  /** Whether any PeopleCode rows are stored under the key (program, source or names). */
  async hasPeopleCode(key: DefinitionKey): Promise<boolean> {
    const types = this.types;
    return this.withConnection(async (c) => (await readStoredProgram(c, types, pcmProgKeyParts(key), false)) !== undefined);
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
    const result=await this.withConnection((c) => createFieldRows(c, request));
    await this.noteCreation(makeKey(DefinitionType.Field,request.name),{version:result.version,operator:request.operatorId,updated:result.lastupddttm});
    return result;
  }

  /** Saves a field as App Designer's field saves did (fieldWriter.ts saveField), verified in the transaction. */
  async saveField(request: FieldSaveRequest): Promise<{ version: number; lastupddttm: string; records: string[] }> {
    const key=makeKey(DefinitionType.Field,request.name);
    await this.guard(key, 'save');
    const previous=await this.createdReceipt(key);
    const related:Array<{key:DefinitionKey;receipt:CreationReceipt}>=[];
    const refs=await this.withConnection(async c=>(await c.execute<{RECNAME:string}>('SELECT DISTINCT RECNAME FROM PSRECFIELDDB WHERE FIELDNAME=:f',{f:request.name})).rows??[]);
    for(const r of refs){const k=makeKey(DefinitionType.Record,String(r.RECNAME).trim());const receipt=await this.createdReceipt(k);if(receipt)related.push({key:k,receipt});}
    const result=await this.withConnection((c) => saveFieldRows(c, request));
    for(const r of related)await this.noteCreation(r.key,{...r.receipt.stamp,version:result.version},r.receipt);
    if(previous)await this.noteCreation(key,{version:result.version,operator:request.operatorId,updated:result.lastupddttm},previous);
    return result;
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
      if (!(await c.catalog.tableExists(c, table))) return { exists: false, hasRows: false };
      const rows = await c.execute(`SELECT 1 AS X FROM ${table} FETCH FIRST 1 ROWS ONLY`);
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
          // Oracle's DDL commits itself; SQL Server's and DB2's is transactional, and is committed as it runs.
          await c.commit();
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
    const pf = this.pool?.ddlPlatformId ?? 2;
    return this.withConnection(async (c) => {
      const models = await c.execute<{ T: number; M: string }>(
        `SELECT STATEMENT_TYPE AS T, MODEL_STATEMENT AS M FROM PSDDLMODEL
          WHERE PLATFORMID = :pf AND SIZING_SET = 0 AND STATEMENT_TYPE IN (1, 2)`, { pf },
        { fetchInfo: { M: { type: this.types.STRING } } });
      const table = models.rows?.find((r) => Number(r.T) === 1)?.M;
      const index = models.rows?.find((r) => Number(r.T) === 2)?.M;
      if (!table || !index) return undefined;
      const parms = async (sql: string, binds: Record<string, string | number>) => Object.fromEntries(
        ((await c.execute<{ N: string; V: string }>(sql, binds)).rows ?? []).map((r) => [String(r.N).trim(), String(r.V ?? '')]));
      const defaults = (type: number) => parms(
        `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSDDLDEFPARMS WHERE PLATFORMID = :pf AND SIZING_SET = 0 AND STATEMENT_TYPE = :t`, { pf, t: type });
      const space = (await c.execute<{ DB: string }>(
        `SELECT DBNAME AS DB FROM PSRECTBLSPC WHERE RECNAME = :r AND DBTYPE IN (:d, ' ')
          ORDER BY CASE WHEN DBTYPE = :d THEN 0 ELSE 1 END FETCH FIRST 1 ROWS ONLY`, { r: recname, d: String(pf) })).rows?.[0];
      return {
        platform: ddlPlatformFor(pf),
        ...(space?.DB?.trim() ? { dbName: space.DB.trim() } : {}),
        table, index,
        tableParms: { ...(await defaults(1)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSRECDDLPARM WHERE RECNAME = :r AND PLATFORMID = :pf AND SIZINGSET = 0`, { pf, r: recname })) },
        indexParms: { ...(await defaults(2)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSIDXDDLPARM WHERE RECNAME = :r AND INDEXID = '_' AND PLATFORMID = :pf AND SIZINGSET = 0`, { pf, r: recname })) },
        indexDefaults: await defaults(2),
        altIndexParms: Object.fromEntries(await Promise.all(Array.from({ length: 10 }, (_, n) => String(n)).map(async (id) => [id, { ...(await defaults(2)), ...(await parms(
          `SELECT PARMNAME AS N, PARMVALUE AS V FROM PSIDXDDLPARM WHERE RECNAME = :r AND INDEXID = :i AND PLATFORMID = :pf AND SIZINGSET = 0`, { pf, r: recname, i: id })) }])))
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
    if (request.openedVersion !== undefined) await this.guard(makeKey(DefinitionType.SqlDefinition, request.sqlId, '0'), 'save');
    const result = await this.withConnection((c) => saveSqlDefinitionRows(c, request));
    await this.withConnection((c) => verifySqlSave(c, request, result));
    return result;
  }

  /**
   * Saves a page's layout as App Designer does (pageWriter.ts, docs/PAGE_SAVE.md):
   * move / resize / label / use changes and deletes of existing controls, in
   * one transaction, then verified again on another connection after COMMIT.
   */
  /**
   * View PeopleCode's object list for a component: the component, each record
   * in its buffer with its fields -- all of a table or view's (PSRECFIELDDB,
   * subrecords expanded, in order), a Derived/Work record's on-page ones, as
   * App Designer's buffer holds them -- and the events with a program.
   */
  async componentPeopleCodeObjects(def: ComponentDefinition): Promise<PeopleCodeObject[]> {
    const records = bufferRecords(def.structure);
    const types = new Map<string, number>();
    const note = (s: { records: { name: string; type: number }[]; scrolls: typeof s[] }) => { for (const r of s.records) types.set(r.name, r.type); s.scrolls.forEach(note); };
    note(def.structure.level0);
    if (def.structure.searchRecord) types.set(def.structure.searchRecord.name, def.structure.searchRecord.type);
    const tables = records.filter((r) => types.get(r) !== 2);
    const fields: Record<string, string[]> = {};
    await this.withConnection(async (c) => {
      for (let i = 0; i < tables.length; i += 500) {
        const batch = tables.slice(i, i + 500);
        const binds = Object.fromEntries(batch.map((r, j) => [`r${j}`, r]));
        const rows = (await c.execute<{ R: string; F: string }>(
          `SELECT RECNAME AS R, FIELDNAME AS F FROM PSRECFIELDDB WHERE RECNAME IN (${batch.map((_, j) => `:r${j}`).join(', ')}) ORDER BY RECNAME, FIELDNUM`, binds)).rows ?? [];
        for (const row of rows) (fields[String(row.R).trim()] ??= []).push(String(row.F).trim());
      }
    });
    for (const r of records) if (types.get(r) === 2) fields[r] = def.structure.pageFields[r] ?? [];
    return peopleCodeObjects(def.name, records, def.programs, fields);
  }

  /** A page's DEFERPROC, or undefined when there is no such page (Insert > Page into Component). */
  /**
   * The Page PeopleCode editor's object list: the page (Activate) and each
   * record field placed on it, in page order, with the events that have a
   * program -- the page's PSPCMPROG 9 / 12, the fields' Record Field
   * PeopleCode 1 / 2 / 12.
   */
  async pagePeopleCodeObjects(pnlName: string): Promise<Array<{ label: string; record?: string; field?: string; withCode: string[] }>> {
    return this.withConnection(async (c) => {
      const fields = (await c.execute<{ R: string; F: string }>(
        `SELECT RECNAME AS R, FIELDNAME AS F FROM PSPNLFIELD WHERE PNLNAME = :p AND RECNAME <> ' ' AND FIELDNAME <> ' ' ORDER BY FIELDNUM`,
        { p: pnlName })).rows ?? [];
      const seen = new Set<string>();
      const list = fields.map((f) => ({ record: String(f.R).trim(), field: String(f.F).trim() }))
        .filter((f) => !seen.has(`${f.record}.${f.field}`) && seen.add(`${f.record}.${f.field}`));
      const page = (await c.execute<{ E: string }>(
        `SELECT DISTINCT OBJECTVALUE2 AS E FROM PSPCMPROG WHERE OBJECTID1 = 9 AND OBJECTVALUE1 = :p AND OBJECTID2 = 12`, { p: pnlName })).rows ?? [];
      const code = new Map<string, string[]>();
      const records = [...new Set(list.map((f) => f.record))];
      for (let i = 0; i < records.length; i += 500) {
        const batch = records.slice(i, i + 500);
        const binds = Object.fromEntries(batch.map((r, j) => [`r${j}`, r]));
        for (const row of (await c.execute<{ R: string; F: string; E: string }>(
          `SELECT DISTINCT OBJECTVALUE1 AS R, OBJECTVALUE2 AS F, OBJECTVALUE3 AS E FROM PSPCMPROG
            WHERE OBJECTID1 = 1 AND OBJECTID2 = 2 AND OBJECTID3 = 12 AND OBJECTVALUE1 IN (${batch.map((_, j) => `:r${j}`).join(', ')})`, binds)).rows ?? []) {
          const k = `${String(row.R).trim()}.${String(row.F).trim()}`;
          code.set(k, [...(code.get(k) ?? []), String(row.E).trim()]);
        }
      }
      return [{ label: `${pnlName} (page)`, withCode: page.map((r) => String(r.E).trim()) },
        ...list.map((f) => ({ label: `${f.record}.${f.field} (field)`, record: f.record, field: f.field, withCode: code.get(`${f.record}.${f.field}`) ?? [] }))];
    });
  }

  /** Whether a component of this name and market exists (New Definition > Component). */
  async componentExists(name: string, market: string): Promise<boolean> {
    return this.withConnection(async (c) => Number((await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS N FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market })).rows?.[0]?.N) > 0);
  }

  /** The Page Properties dialog's lists: owner IDs (PSXLATITEM OBJECTOWNERID), style sheets, style classes, popup menus, the base language. */
  async pagePropertyChoices(): Promise<PagePropertyChoices> {
    return this.withConnection(async (c) => {
      const rows = async <T>(sql: string) => (await c.execute<T>(sql)).rows ?? [];
      const t = (v: unknown) => String(v ?? '').trim();
      const owners = await rows<{ V: string; N: string }>(
        `SELECT X.FIELDVALUE AS V, X.XLATLONGNAME AS N FROM PSXLATITEM X WHERE X.FIELDNAME = 'OBJECTOWNERID' AND X.EFF_STATUS = 'A'
            AND X.EFFDT = (SELECT MAX(Y.EFFDT) FROM PSXLATITEM Y WHERE Y.FIELDNAME = X.FIELDNAME AND Y.FIELDVALUE = X.FIELDVALUE AND Y.EFFDT <= SYSDATE)
          ORDER BY X.XLATLONGNAME`);
      const sheets = await rows<{ N: string }>(`SELECT STYLESHEETNAME AS N FROM PSSTYLSHEETDEFN ORDER BY STYLESHEETNAME`);
      const menus = await rows<{ N: string }>(`SELECT MENUNAME AS N FROM PSMENUDEFN WHERE MENUTYPE = 1 ORDER BY MENUNAME`);
      const classes = await rows<{ N: string }>(`SELECT DISTINCT STYLECLASSNAME AS N FROM PSSTYLECLASS ORDER BY STYLECLASSNAME`);
      const [opt] = await rows<{ L: string }>(`SELECT LANGUAGE_CD AS L FROM PSOPTIONS`);
      return { language: t(opt?.L), owners: owners.map((r) => [t(r.V), t(r.N)] as [string, string]),
        styleSheets: sheets.map((r) => t(r.N)), popupMenus: menus.map((r) => t(r.N)), styleClasses: classes.map((r) => t(r.N)) };
    });
  }

  /**
   * A Long Edit Box's Rich Text lists (le01): Configuration Settings are the HTML definitions named PT_RTE_CFG*, the Image
   * Location URL the URL definitions named PT_RTE*, Plugin Files the HTML definitions named PT_RTE_PLUGIN*. (Template and
   * Style File lists are empty on HRDMO and no delivered page sets them; they are typed.)
   */
  async richTextChoices(): Promise<{ configs: string[]; imageUrls: string[]; plugins: string[] }> {
    return this.withConnection(async (c) => {
      const names = async (sql: string) => ((await c.execute<{ N: string }>(sql)).rows ?? []).map((r) => String(r.N ?? '').trim());
      return {
        configs: await names(`SELECT CONTNAME AS N FROM PSCONTDEFN WHERE CONTTYPE = 4 AND ALTCONTNUM = 1 AND CONTNAME LIKE 'PT_RTE_CFG%' ORDER BY CONTNAME`),
        imageUrls: await names(`SELECT URL_ID AS N FROM PSURLDEFN WHERE URL_ID LIKE 'PT_RTE%' ORDER BY URL_ID`),
        plugins: await names(`SELECT CONTNAME AS N FROM PSCONTDEFN WHERE CONTTYPE = 4 AND ALTCONTNUM = 1 AND CONTNAME LIKE 'PT_RTE_PLUGIN%' ORDER BY CONTNAME`)
      };
    });
  }

  /**
   * What an Edit Box's dialog greys or lists by its record field (eb77-eb80): whether the field has a prompt table (Smart
   * Prompt is offered), its format family (PSDBFIELD.FORMATFAMILY: the Family Name) and that family's Display Names (PSFMTITEM).
   */
  async editBoxField(record: string, field: string): Promise<{ promptTable: boolean; formatFamily: string; displayNames: string[] }> {
    return this.withConnection(async (c) => {
      const r = record.trim().toUpperCase(), f = field.trim().toUpperCase();
      const [prompt] = (await c.execute<{ E: string }>(`SELECT EDITTABLE AS E FROM PSRECFIELDDB WHERE RECNAME = :r AND FIELDNAME = :f`, { r, f })).rows ?? [];
      const [db] = (await c.execute<{ F: string }>(`SELECT FORMATFAMILY AS F FROM PSDBFIELD WHERE FIELDNAME = :f`, { f })).rows ?? [];
      const formatFamily = String(db?.F ?? '').trim();
      const names = formatFamily ? ((await c.execute<{ N: string }>(`SELECT DISTINCT DISPFMTNAME AS N FROM PSFMTITEM WHERE FORMATFAMILY = :m ORDER BY 1`, { m: formatFamily })).rows ?? []) : [];
      return { promptTable: !!String(prompt?.E ?? '').trim(), formatFamily, displayNames: names.map((x) => String(x.N ?? '').trim()).filter(Boolean) };
    });
  }

  /** The Popup Pages (PSPNLDEFN.PNLTYPE 3): an Edit Box's Mouse Over Popup page list (eb39). */
  async popupPages(): Promise<string[]> {
    return this.withConnection(async (c) => ((await c.execute<{ N: string }>(`SELECT PNLNAME AS N FROM PSPNLDEFN WHERE PNLTYPE = 3 ORDER BY PNLNAME`)).rows ?? [])
      .map((r) => String(r.N ?? '').trim()));
  }

  /** Records' types (PSRECDEFN.RECTYPE) and key fields (PSRECFIELDDB USEEDIT Key / Duplicate Order Key), in record order. */
  async recordInfo(names: readonly string[]): Promise<Map<string, RecordInfo>> {
    const wanted = [...new Set(names.map((n) => n.trim().toUpperCase()).filter(Boolean))];
    const out = new Map<string, RecordInfo>();
    if (!wanted.length) return out;
    return this.withConnection(async (c) => {
      for (let i = 0; i < wanted.length; i += 500) {
        const batch = wanted.slice(i, i + 500);
        const binds = Object.fromEntries(batch.map((r, j) => [`r${j}`, r]));
        const list = batch.map((_, j) => `:r${j}`).join(', ');
        for (const r of (await c.execute<{ R: string; T: number }>(`SELECT RECNAME AS R, RECTYPE AS T FROM PSRECDEFN WHERE RECNAME IN (${list})`, binds)).rows ?? []) {
          out.set(String(r.R).trim(), { type: Number(r.T), keys: [] });
        }
        const keys = (await c.execute<{ R: string; F: string }>(
          `SELECT RECNAME AS R, FIELDNAME AS F FROM PSRECFIELDDB WHERE RECNAME IN (${list}) AND (BITAND(USEEDIT, 1) = 1 OR BITAND(USEEDIT, 2) = 2) ORDER BY RECNAME, FIELDNUM`, binds)).rows ?? [];
        for (const k of keys) out.get(String(k.R).trim())?.keys.push(String(k.F).trim());
      }
      return out;
    });
  }

  /** A page's scroll structure (bufferStructure.ts pageStructure): levels, scrolls, primary records and keys, App Designer's checks. */
  async readPageStructure(page: string): Promise<ReturnType<typeof pageStructure> & { page: string }> {
    const name = page.trim().toUpperCase();
    const view = await this.readPageView({ type: DefinitionType.Page, parts: [name] });
    const rows = [...view.data.fields].sort((a, b) => Number(a.FIELDNUM) - Number(b.FIELDNUM));
    const info = await this.recordInfo(rows.map((r) => String(r.RECNAME ?? '')));
    const controls = rows.map((r) => ({ id: Number(r.PNLFLDID), fieldType: Number(r.FIELDTYPE), typeName: PAGE_CONTROL_TYPES[Number(r.FIELDTYPE)] ?? `Type ${r.FIELDTYPE}`,
      occursLevel: Number(r.OCCURSLEVEL), fieldUse: Number(r.FIELDUSE), recName: String(r.RECNAME ?? ''), fieldName: String(r.FIELDNAME ?? ''),
      label: String(r.LBLTEXT ?? ''), assocFieldNum: Number(r.ASSOCFIELDNUM ?? 0), recType: info.get(String(r.RECNAME ?? '').trim())?.type ?? -1,
      fieldLeft: Number(r.FIELDLEFT ?? -1), fieldTop: Number(r.FIELDTOP ?? -1) }));
    return { page: name, ...pageStructure(name, controls, info) };
  }

  /** A component's buffer (bufferStructure.ts componentBuffer): search record, level 0, each scroll level with keys and PeopleCode. */
  async readComponentBuffer(component: string, market = 'GBL'): Promise<ReturnType<typeof componentBuffer> & { component: string; market: string; pages: string[] }> {
    const key = { type: DefinitionType.Component, parts: [component.trim().toUpperCase(), market.trim().toUpperCase() || 'GBL'] };
    const def = await this.readComponentDefinition(key);
    const names: string[] = [];
    const visit = (s: { records: Array<{ name: string }>; scrolls: unknown[] }) => { names.push(...s.records.map((r) => r.name)); for (const k of s.scrolls) visit(k as typeof s); };
    visit(def.structure.level0);
    if (def.structure.searchRecord) names.push(def.structure.searchRecord.name);
    const info = await this.recordInfo(names);
    return { component: key.parts[0], market: key.parts[1], pages: def.items.map((i) => i.pageName), ...componentBuffer(def.structure, info) };
  }

  /** A field's labels (PSDBFLDLABL), default first: a control's Label ID list. */
  async fieldLabels(field: string): Promise<Array<{ labelId: string; longName: string; shortName: string; isDefault: boolean }>> {
    return this.withConnection(async (c) => {
      const rows = (await c.execute<{ LABEL_ID: string; LONGNAME: string; SHORTNAME: string; DEFAULT_LABEL: number }>(
        `SELECT LABEL_ID, LONGNAME, SHORTNAME, DEFAULT_LABEL FROM PSDBFLDLABL WHERE FIELDNAME = :f ORDER BY DEFAULT_LABEL DESC, LABEL_ID`,
        { f: field.trim().toUpperCase() })).rows ?? [];
      return rows.map((r) => ({ labelId: String(r.LABEL_ID ?? '').trim(), longName: String(r.LONGNAME ?? '').trim(),
        shortName: String(r.SHORTNAME ?? '').trim(), isDefault: Number(r.DEFAULT_LABEL) === 1 }));
    });
  }

  async pageInfo(name: string): Promise<{ deferred: boolean } | undefined> {
    return this.withConnection(async (c) => {
      const [row] = (await c.execute<{ D: number }>(`SELECT DEFERPROC AS D FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: name })).rows ?? [];
      return row ? { deferred: Number(row.D) !== 0 } : undefined;
    });
  }

  /** Saves a component as App Designer does (componentWriter.ts); never one without a search record. */
  async saveComponent(request: ComponentSaveRequest): Promise<ComponentSaveResult> {
    await this.guard(makeKey(DefinitionType.Component, request.name, request.market), 'save');
    return this.withConnection((c) => saveComponent(c, request));
  }

  /** Creates a page: App Designer's New Page (its first save) or New Page Fluid from a Layout Page (pageWriter.ts createPage). */
  async createPage(request: PageCreateRequest): Promise<PageSaveResult> {
    return this.withConnection((c) => createPage(c, request));
  }

  /** New Page Fluid's Choose Layout Page list: every Layout Page (PNLTYPE 7), with its description. */
  async layoutPages(): Promise<Array<{ name: string; description: string }>> {
    return this.withConnection(async (c) => ((await c.execute<{ N: string; D: string }>(
      `SELECT PNLNAME AS N, DESCR AS D FROM PSPNLDEFN WHERE PNLTYPE = 7 ORDER BY PNLNAME`)).rows ?? [])
      .map((r) => ({ name: String(r.N).trim(), description: String(r.D ?? '').trim() })));
  }

  async savePage(request: PageSaveRequest): Promise<PageSaveResult> {
    await this.guard(makeKey(DefinitionType.Page, request.pnlName), 'save');
    const result = await this.withConnection((c) => savePage(c, request));
    await this.withConnection((c) => verifyPageSave(c, request, result));
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
    await this.guard(makeKey(DefinitionType.StyleSheet, request.name), 'save');
    const types = this.types;
    const result = await this.withConnection((c) => saveStyleSheetRows(c, types.BLOB, request));
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
    await this.guard(makeKey(DefinitionType.HtmlDefinition, request.name, '4'), 'save');
    const types = this.types;
    const result = await this.withConnection((c) => saveHtmlRows(c, types.BLOB, request));
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
    await this.guard(key, 'save');
    const types = this.types;
    const parts = pcmProgKeyParts(key);
    const objectIds = PEOPLECODE_OBJECTIDS[key.type];
    const result = await this.withConnection((c) => writePeopleCode(c, types, parts, { ...request, ...(objectIds ? { objectIds } : {}) }));
    await this.withConnection((c) => verifyCommitted(c, types, parts, result));
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
      case DefinitionType.MessageChannel: {
        const r = await this.readChannelDocument(key.parts[0]);
        if (!r) throw new ProviderError(`No message channel named ${key.parts[0]}.`);
        return renderChannel(r.doc);
      }
      case DefinitionType.IbService: return this.readIbService(key);
      case DefinitionType.IbServiceOperation: return this.readIbOperation(key);
      case DefinitionType.IbRouting:
      case DefinitionType.IbDocument: {
        const doc = await this.readIntegrationBroker(key.type === DefinitionType.IbRouting ? 'routing' : 'document',[...key.parts]);
        if (!doc) throw new ProviderError('Integration Broker definition not found.');
        return JSON.stringify(doc,null,2)+'\n';
      }
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
      DefinitionType.IbMessage, DefinitionType.IbService, DefinitionType.IbServiceOperation, DefinitionType.MessageChannel
    ].includes(type);
  }

  /**
   * HTML definition content, from PSCONTENT.
   *
   * The key's second part is CONTTYPE, not a language/market flag as its
   * PeopleTools name might suggest -- confirmed against
   * ZZ_OJET_REN_DA_BODY_HTML.4, whose only PSCONTENT row has CONTTYPE 4.
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
    const types = this.types;
    return (await c.execute<UiRow>(sql, binds, {
      fetchTypeHandler: (meta: { dbType?: unknown }) =>
        meta.dbType === types.DB_TYPE_CLOB || meta.dbType === types.DB_TYPE_NCLOB ? { type: types.STRING } : undefined
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

  async listIntegrationBroker(kind: IbKind, query = '', offset = 0, serviceKind?: 'standard' | 'rest', restRole?: 'consumer' | 'provider') {
    return this.withConnection(c => listIb(c, this.types, kind, query, offset, serviceKind, restRole));
  }

  async readIntegrationBroker(kind: IbKind, key: string[]) {
    return this.withConnection(c => readIb(c, this.types, kind, key));
  }

  async validateIntegrationBroker(doc: IbDocument) {
    return this.withConnection(c => validateIb(c, this.types, doc));
  }

  async saveIntegrationBroker(request: IbSaveRequest) {
    const input = ibWriteInput.parse(request.input);
    const key = ibDefinitionKey(input.kind,input.key);
    const previous = request.expectedToken === 'absent' ? undefined : await this.createdReceipt(key);
    if (!request.dryRun && request.expectedToken !== 'absent') await this.guard(key,'save');
    if (!request.dryRun && input.kind === 'operation' && request.expectedToken === 'absent') {
      const service = String(input.properties.IB_SERVICENAME??'').trim();
      if (service) await this.guard(ibDefinitionKey('service',[service]),'save');
    }
    const saved = await this.withConnection(c => saveIb(c,this.types,{...request,input}));
    if (saved.written) {
      const after = await this.readIntegrationBroker(input.kind,input.key);
      if (!after || after.token !== saved.token) throw new ProviderError('After COMMIT the IB definition differs from the verified saved result.');
      if (request.expectedToken === 'absent' || previous) await this.noteCreation(key,{version:Number(after.properties.VERSION),operator:String(after.properties.LASTUPDOPRID).trim(),updated:String(after.properties.LASTUPDDTTM)},previous);
    }
    return saved;
  }

  async newIntegrationBroker(kind: IbKind, key: string[], options: IbNewOptions = {}) {
    return this.withConnection(async c => {
      const [config] = await ibSafeRows(c,this.types,'PSIBSVCSETUP','1=1',{});
      const [language] = await ibRows(c,this.types,'SELECT LANGUAGE_CD FROM PSOPTIONS');
      const [service] = options.service ? await ibSafeRows(c,this.types,'PSSERVICE','IB_SERVICENAME=:n',{n:options.service}) : [];
      return newIbInput(kind,key,options,config??{},String(language?.LANGUAGE_CD??'').trim(),service);
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
        service: (await this.uiRows(c, `SELECT IB_REST_SERVICE FROM PSSERVICE WHERE IB_SERVICENAME = :n`, { n: String(operation.IB_SERVICENAME).trim() }))[0],
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
        connectorProperties: await this.uiRows(c, `SELECT PROPID, PROPNAME, SEQNUM, PROPVALUE FROM PSNODECONPROP WHERE MSGNODENAME = :n ORDER BY PROPID, PROPNAME, SEQNUM`, { n: name }),
        translates: await this.translates(c, NODE_TRANSLATE_FIELDS)
      });
    });
  }

  async readPortalDocument(identity: PortalIdentity) {
    return this.withConnection(c => readPortalDocument(c, this.types, identity));
  }

  async savePortalDocument(request: PortalSaveRequest) {
    const input = portalInput.parse(request.input);
    if (request.expectedToken !== 'absent' && !request.dryRun) await this.guard(makeKey(DefinitionType.PortalRegistry, ...portalKey(input)), 'save');
    const saved = await this.withConnection(c => savePortalDocument(c, this.types, request));
    if (!request.dryRun) {
      const after = await this.readPortalDocument(saved.identity);
      if (!after || after.token !== saved.token) throw new ProviderError('After COMMIT the registry entry differs from the saved result.');
    }
    return saved;
  }

  /** All entries for one portal, in delivered sibling order; no search limit. */
  async portalStructure(portal: string): Promise<UiRow[]> {
    return this.withConnection(c => this.uiRows(c,
      `SELECT P.PORTAL_REFTYPE, P.PORTAL_OBJNAME, P.PORTAL_PRNTOBJNAME, P.PORTAL_LABEL, P.PORTAL_SEQ_NUM,
              (SELECT MAX(L.PORTAL_LABEL) FROM PSPRSMDEFN L WHERE L.PORTAL_OBJNAME = P.PORTAL_LINKOBJNAME
               AND L.PORTAL_NAME = NVL(TRIM(P.PORTAL_LINK_PORTAL), P.PORTAL_NAME)) AS LINK_LABEL
         FROM PSPRSMDEFN P WHERE P.PORTAL_NAME = :p
         ORDER BY P.PORTAL_SEQ_NUM, P.PORTAL_LABEL, P.PORTAL_OBJNAME`, { p: portal }));
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
                                                        FROM PSPRSMDEFN P WHERE PORTAL_NAME = :p AND PORTAL_PRNTOBJNAME = :n ORDER BY PORTAL_SEQ_NUM, PORTAL_LABEL, PORTAL_OBJNAME`,
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
    return renderProcessDefinition(await this.readProcessDocument(key));
  }

  async readProcessDocument(key: DefinitionKey): Promise<ProcessView> {
    return this.withConnection(c => this.readProcessRows(c, key));
  }

  private async readProcessRows(c: Connection, key: DefinitionKey): Promise<ProcessView> {
    if (key.type !== DefinitionType.ProcessDefinition) throw new ProviderError('Expected a process definition.');
    const [type, name] = key.parts, binds = { t: type ?? '', n: name ?? '' };
    const [process] = await this.uiRows(c, `SELECT P.*, ${UI_STAMP} FROM PS_PRCSDEFN P WHERE PRCSTYPE = :t AND PRCSNAME = :n`, binds);
    if (!process) throw new ProviderError(`No process definition ${type} / ${name}.`);
    return {
      process,
      components: await this.uiRows(c, `SELECT * FROM PS_PRCSDEFNPNL WHERE PRCSTYPE = :t AND PRCSNAME = :n ORDER BY PNLGRPNAME`, binds),
      groups: await this.uiRows(c, `SELECT * FROM PS_PRCSDEFNGRP WHERE PRCSTYPE = :t AND PRCSNAME = :n ORDER BY PRCSGRP`, binds),
      translates: await this.translates(c, PROCESS_TRANSLATE_FIELDS)
    };
  }

  async saveProcessDocument(request: ProcessSaveRequest): Promise<ProcessView> {
    if (this.platform !== 'oracle') throw new ProviderError('Process definition saves are currently supported on Oracle.');
    const key = makeKey(DefinitionType.ProcessDefinition, ...request.key);
    if (!request.dryRun) await this.guard(key, 'save');
    const saved = await this.withConnection(c => saveProcess(c, this.types, request, connection => this.readProcessRows(connection, key)));
    if (!request.dryRun && processToken(await this.readProcessDocument(key)) !== processToken(saved)) throw new ProviderError('Process save committed but subsequent readback differs. Reopen the definition to inspect it.');
    return saved;
  }

  /** A query, keyed by name and owner (blank or absent: public). */
  private async readQuery(key: DefinitionKey): Promise<string> {
    return renderQuery(key.parts[0], await this.readQueryDefinition(key));
  }

  /** Structured query rows for the Windows Query designer; retains every stored column. */
  async readQueryDefinition(key: DefinitionKey): Promise<QueryView> {
    if (key.type !== DefinitionType.Query) throw new ProviderError('Expected a Query definition.');
    const [name, owner] = key.parts;
    return this.withConnection(async (c) => {
      const binds = { n: name, o: owner?.trim() || ' ' };
      const q = async (sql: string) => {
        const STRING = this.types.STRING;
        return (await c.execute<UiRow>(sql, binds, { fetchInfo: { EXPRESSIONTEXT: { type: STRING }, DESCRLONG: { type: STRING } } })).rows ?? [];
      };
      const [query] = await q(`SELECT D.*, ${UI_STAMP} FROM PSQRYDEFN D WHERE QRYNAME = :n AND OPRID = :o`);
      if (!query) throw new ProviderError(`No ${binds.o.trim() ? `private query ${name} of ${binds.o}` : `public query ${name}`}.`);
      const where = `WHERE QRYNAME = :n AND OPRID = :o`;
      return {
        query,
        selects: await q(`SELECT * FROM PSQRYSELECT ${where}`),
        records: await q(`SELECT * FROM PSQRYRECORD ${where}`),
        fields: await q(`SELECT * FROM PSQRYFIELD ${where}`),
        criteria: await q(`SELECT * FROM PSQRYCRITERIA ${where}`),
        expressions: await q(`SELECT * FROM PSQRYEXPR ${where}`),
        binds: await q(`SELECT * FROM PSQRYBIND ${where}`)
      };
    });
  }

  async readQueryDocument(name: string, owner = ''): Promise<QueryEdit | undefined> {
    return this.withConnection(async c=>{
      try {
        if(this.platform==='oracle')await c.execute('SET TRANSACTION READ ONLY');
        return await readEditableQuery(c,this.types,name,owner);
      } finally { await c.rollback(); }
    });
  }

  async saveQueryDocument(request: QuerySaveRequest): Promise<QuerySaveResult> {
    if (this.platform!=='oracle') throw new ProviderError('Query saves are currently calibrated on Oracle.');
    if (!request.dryRun) await this.guard(makeKey(DefinitionType.Query,String(request.view.query.QRYNAME).trim(),String(request.view.query.OPRID).trim()),'save');
    const result=await this.withConnection(c=>writeQuery(c,this.types,request));
    if (result.written) await this.withConnection(c=>verifyQuerySave(c,this.types,result));
    return result;
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

  async saveOAuth(request: OAuthSaveRequest) {
    if (this.platform !== 'oracle') throw new ProviderError('OAuth writes are calibrated only on Oracle.');
    const refusal = writeScopeRefusal(request.key[0]);
    if (refusal) throw new ProviderError(refusal);
    const saved = await this.withConnection(c => saveOAuth(c, this.types, request));
    if (!request.dryRun) {
      const committed = await this.readSecurity('oauth', request.key);
      if (!committed || committed.token !== saved.token) throw new ProviderError('OAuth save committed but subsequent readback differs. Refresh and inspect the application.');
    }
    return saved;
  }

  async listSecurity(kind: SecurityKind, query: string, offset = 0) {
    return this.withConnection(c => listSecurity(c, this.types, kind, query, offset));
  }

  async readSecurity(kind: SecurityKind, key: string[]) {
    return this.withConnection(c => readSecurity(c, this.types, kind, key));
  }

  async securityChoices() {
    return this.withConnection(c => securityChoices(c, this.types));
  }

  async listAdministration(kind: AdminKind, query: string, offset = 0) {
    return this.withConnection(async c => {
      if (kind === 'text' && !await c.catalog.tableExists(c, 'PS_HR_SSTEXT_TEXT')) throw new ProviderError('This environment does not have the HCM Text Catalog tables.');
      return listAdministration(c, this.types, kind, query, offset);
    });
  }

  async readAdministration(kind: AdminKind, key: string[]) {
    return this.withConnection(c => readAdministration(c, this.types, kind, key));
  }

  async administrationChoices() {
    return this.withConnection(async c => ({
      languages: (await this.uiRows(c, 'SELECT LANGUAGE_CD,ISO_LOCALE FROM PSLANGUAGES ORDER BY LANGUAGE_CD', {}))
        .map(r => ({ code: String(r.LANGUAGE_CD).trim(), description: String(r.ISO_LOCALE ?? '').trim() })),
      configurations: await c.catalog.tableExists(c, 'PS_HR_SSTEXT_CFG')
        ? (await this.uiRows(c, 'SELECT OBJECTOWNERID,HR_SSTEXT_SUB_ID,DESCR FROM PS_HR_SSTEXT_CFG ORDER BY OBJECTOWNERID,HR_SSTEXT_SUB_ID', {}))
          .map(r => ({ owner: String(r.OBJECTOWNERID).trim(), subId: String(r.HR_SSTEXT_SUB_ID).trim(), description: String(r.DESCR ?? '').trim() })) : [],
      usages: (await this.uiRows(c, "SELECT DISTINCT FIELDVALUE,XLATLONGNAME FROM PSXLATITEM WHERE FIELDNAME='HR_SSTEXT_USAGE' ORDER BY FIELDVALUE", {}))
        .map(r => ({ code: String(r.FIELDVALUE).trim(), description: String(r.XLATLONGNAME ?? '').trim() }))
    }));
  }

  async saveAdministration(request: AdminSaveRequest) {
    const key = adminInputKey(request.kind, validateAdminInput(request.kind, request.input));
    const urlKey = request.kind === 'url' ? makeKey(DefinitionType.UrlDefinition, key[0]) : undefined;
    if (urlKey && request.expectedToken !== 'absent') await this.guard(urlKey, 'save');
    const previous = urlKey && request.expectedToken !== 'absent' ? await this.createdReceipt(urlKey) : undefined;
    const saved = await this.withConnection(c => saveAdministration(c, this.types, request));
    await this.withConnection(c => verifyAdministration(c, this.types, saved));
    if (urlKey && (request.expectedToken === 'absent' || previous)) await this.noteCreation(urlKey, {
      version: Number(saved.row.VERSION), operator: request.operatorId, updated: String(saved.row.LASTUPDDTTM)
    }, previous);
    return saved;
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
    return (await this.readPageView(key)).order;
  }

  /**
   * A page's visual layout (its controls positioned from PSPNLFIELD geometry)
   * and its Order view text, for the Page panel.
   */
  async readPageLayout(key: DefinitionKey): Promise<{ layout: PageLayout; order: string }> {
    const view = await this.readPageView(key);
    return { layout: buildPageLayout(key.parts[0], view.data), order: view.order };
  }

  private async readPageView(key: DefinitionKey): Promise<{ data: PageView; order: string }> {
    const name = key.parts[0];
    return this.withConnection(async (c) => {
      const [page] = await this.uiRows(c, `SELECT P.*, ${UI_STAMP} FROM PSPNLDEFN P WHERE PNLNAME = :n`, { n: name });
      if (!page) throw new ProviderError(`No page named ${name}.`);
      // Each control's PSPNLFIELDEXT Fluid settings ride along (FFSTYLELONG is a CLOB: read as text).
      const fields = await this.uiRows(c,
        `SELECT F.*, DBMS_LOB.SUBSTR(E.FFSTYLELONG, 4000, 1) AS EXT_FFSTYLELONG, E.FIELDUSETEMP2 AS EXT_FIELDUSETEMP2,
                E.GRPBOXTYPE AS EXT_GRPBOXTYPE, E.GRPBOXHTMLTYPE AS EXT_GRPBOXHTMLTYPE, E.SCROLLBARS AS EXT_SCROLLBARS,
                E.MESSAGE_SET_NBR AS EXT_MESSAGE_SET_NBR, E.MESSAGE_NBR AS EXT_MESSAGE_NBR,
                E.PTGBRELTXTINFO AS EXT_PTGBRELTXTINFO, E.PTGBRELACTINFO AS EXT_PTGBRELACTINFO, E.PTGBRELACTFLD AS EXT_PTGBRELACTFLD,
                H.HTMLAREA AS EXT_HTMLAREA, E.PLHTYPE AS EXT_PLHTYPE, E.PLACEHOLDER AS EXT_PLACEHOLDER,
                E.PLH_MSG_SET_NBR AS EXT_PLH_MSG_SET_NBR, E.PLH_MSG_NBR AS EXT_PLH_MSG_NBR,
                E.PTPOPUPPNL AS EXT_PTPOPUPPNL, E.HTML_INPUT_TYPE AS EXT_HTML_INPUT_TYPE, E.MINNUMBER AS EXT_MINNUMBER,
                E.MAXNUMBER AS EXT_MAXNUMBER, E.STEPNUMBER AS EXT_STEPNUMBER, E.PTDISABLESMARTPROM AS EXT_PTDISABLESMARTPROM,
                E.PT_NUMFLD1 AS EXT_PT_NUMFLD1,
                R.PNLFLDID AS RTE_PNLFLDID, R.PTRTECFGSETTINGSID AS RTE_CFG, R.PTRTEIMGLOCURLID AS RTE_IMG, R.PTRTEPLUGIN AS RTE_PLUGIN,
                R.PTRTETEMPLATE AS RTE_TEMPLATE, R.PTRTESTYLE AS RTE_STYLE
           FROM PSPNLFIELD F LEFT JOIN PSPNLFIELDEXT E ON E.PNLNAME = F.PNLNAME AND E.PNLFLDID = F.PNLFLDID
                LEFT JOIN PSPNLHTMLAREA H ON H.PNLNAME = F.PNLNAME AND H.PNLFLDID = F.PNLFLDID
                LEFT JOIN PSPTPNLRTEDITOR R ON R.PNLNAME = F.PNLNAME AND R.PNLFLDID = F.PNLFLDID
          WHERE F.PNLNAME = :n ORDER BY F.FIELDNUM`, { n: name });
      const components = await this.uiRows(c,
        `SELECT PNLGRPNAME, MARKET, ITEMLABEL FROM PSPNLGROUP WHERE PNLNAME = :n ORDER BY PNLGRPNAME, MARKET`, { n: name });
      const data: PageView = { page, fields, components };
      return { data, order: renderPage(name, data) };
    });
  }

  /**
   * A component as App Designer's component window shows it: the Definition
   * grid, the Structure tab (built from its pages, their subpages and
   * secondary pages) and Component Properties, for the Component panel.
   */
  async readComponentDefinition(key: DefinitionKey): Promise<ComponentDefinition> {
    const [name, market = 'GBL'] = key.parts;
    return this.withConnection(async (c) => {
      const b = { n: name, m: market };
      const [defn] = await this.uiRows(c, `SELECT G.*, ${UI_STAMP} FROM PSPNLGRPDEFN G WHERE PNLGRPNAME = :n AND MARKET = :m`, b);
      if (!defn) throw new ProviderError(`No component named ${name}.${market}.`);
      const [ext] = await this.uiRows(c, `SELECT * FROM PSPNLGRPDEFNEXT WHERE PNLGRPNAME = :n AND MARKET = :m`, b);
      const items = await this.uiRows(c,
        `SELECT G.*, P.DEFERPROC AS PAGEDEFERPROC FROM PSPNLGROUP G LEFT JOIN PSPNLDEFN P ON P.PNLNAME = G.PNLNAME
          WHERE G.PNLGRPNAME = :n AND G.MARKET = :m ORDER BY G.SUBITEMNUM`, b);
      const menus = await this.uiRows(c,
        `SELECT MENUNAME, BARNAME, ITEMNAME FROM PSMENUITEM WHERE PNLGRPNAME = :n AND MARKET = :m ORDER BY MENUNAME, BARNAME, ITEMNAME`, b);
      const programs = await this.uiRows(c,
        `SELECT DISTINCT OBJECTID3, OBJECTVALUE3, OBJECTID4, OBJECTVALUE4, OBJECTID5, OBJECTVALUE5 FROM PSPCMPROG
          WHERE OBJECTID1 = 10 AND OBJECTVALUE1 = :n AND OBJECTVALUE2 = :m
          ORDER BY OBJECTID3 DESC, OBJECTVALUE3, OBJECTVALUE4, OBJECTVALUE5`, b);

      const { structure } = await this.loadComponentStructure(c, items.map((i) => String(i.PNLNAME ?? '').trim()), String(defn.SEARCHRECNAME ?? ''));
      const scripts = await this.uiRows(c,
        `SELECT PTSCRIPTTYPE, PTSCRIPTNAME, PTSCRIPTCATG, SEQNO FROM PSPNLGRPSCRIPTS WHERE PNLGRPNAME = :n AND MARKET = :m`, b);
      return buildComponentDefinition(name, market, { defn, ...(ext ? { ext } : {}), items, menus, programs, scripts }, structure);
    });
  }

  /**
   * A component's Structure tab (componentStructure.ts) from its pages: every
   * page the walk reaches -- the pages, then their subpages and secondary
   * pages, a batch at a time -- and the records' types.
   */
  private async loadComponentStructure(c: Connection, pages: readonly string[], searchRecord: string, systemPages: ReadonlySet<string> = new Set()):
    Promise<{ structure: ComponentStructure; types: Map<string, number>; fields: Map<string, StructureField[]> }> {
    // Every page the walk reaches: the items' pages, then their subpages and secondary pages, a batch at a time.
    const fields = new Map<string, StructureField[]>();
    let pending = [...new Set(pages.filter(Boolean))];
    while (pending.length) {
      const batch = pending.splice(0, 500);
      const binds = Object.fromEntries(batch.map((p, i) => [`p${i}`, p]));
      const rows = await this.uiRows(c,
        `SELECT PNLNAME, FIELDNUM, FIELDTYPE, OCCURSLEVEL, RECNAME, FIELDNAME, SUBPNLNAME, FIELDUSE FROM PSPNLFIELD
          WHERE PNLNAME IN (${batch.map((_, i) => `:p${i}`).join(', ')})`, binds);
      for (const p of batch) fields.set(p, []);
      for (const r of rows) fields.get(String(r.PNLNAME).trim())?.push(r as unknown as StructureField);
      for (const p of referencedPages(rows)) if (!fields.has(p) && !pending.includes(p)) pending.push(p);
    }
    const records = new Set<string>([searchRecord.trim()]);
    for (const list of fields.values()) for (const f of list) if (String(f.RECNAME ?? '').trim()) records.add(String(f.RECNAME).trim());
    const types = new Map<string, number>();
    const recs = [...records].filter(Boolean);
    for (let i = 0; i < recs.length; i += 500) {
      const batch = recs.slice(i, i + 500);
      const binds = Object.fromEntries(batch.map((r, j) => [`r${j}`, r]));
      for (const r of await this.uiRows(c, `SELECT RECNAME, RECTYPE FROM PSRECDEFN WHERE RECNAME IN (${batch.map((_, j) => `:r${j}`).join(', ')})`, binds)) {
        types.set(String(r.RECNAME).trim(), Number(r.RECTYPE));
      }
    }
    const structure = buildComponentStructure(pages, searchRecord, (p) => fields.get(p), (r) => types.get(r) ?? -1, systemPages);
    return { structure, types, fields };
  }

  /** What App Designer reads from a component to default a Component Interface on it (ciDocument.ts). */
  async readCiSource(component: string, market: string): Promise<CiSource> {
    return ciSourceFromData(await this.readCiSourceData(component, market));
  }

  /** The rows readCiSource reads, as data (tests keep them as fixtures: ci-source.json). */
  async readCiSourceData(component: string, market: string): Promise<CiSourceData> {
    return this.withConnection(async (c) => {
      const b = { n: component, m: market };
      const [defn] = await this.uiRows(c,
        `SELECT SEARCHRECNAME, ADDSRCHRECNAME, ACTIONS, FLUIDMODE, INCHEADER, INCSIDE FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :n AND MARKET = :m`, b);
      if (!defn) throw new ProviderError(`No component named ${component}.${market}.`);
      const pages = (await this.uiRows(c, `SELECT PNLNAME FROM PSPNLGROUP WHERE PNLGRPNAME = :n AND MARKET = :m ORDER BY SUBITEMNUM`, b))
        .map((r) => String(r.PNLNAME).trim());
      const searchRecord = String(defn.SEARCHRECNAME ?? '').trim();
      const addSearchRecord = String(defn.ADDSRCHRECNAME ?? '').trim();
      // A Fluid component's buffer has the system side page, then header page, after its own (ci04), unless No System Side / Header Page.
      const system = Number(defn.FLUIDMODE) === 1
        ? [...(Number(defn.INCSIDE) ? [] : ['PT_SIDE2PAGE']), ...(Number(defn.INCHEADER) ? [] : ['PT_HEADERPAGE'])] : [];
      const { types, fields: pageFields } = await this.loadComponentStructure(c, [...pages, ...system], searchRecord, new Set(system));
      const recs = [...new Set([...types.keys(), addSearchRecord].filter(Boolean))];
      const fields = new Map<string, CiRecordField[]>();
      for (let i = 0; i < recs.length; i += 500) {
        const batch = recs.slice(i, i + 500);
        const binds = Object.fromEntries(batch.map((r, j) => [`r${j}`, r]));
        const rows = await this.uiRows(c,
          `SELECT R.RECNAME, R.FIELDNAME, R.USEEDIT, D.FIELDTYPE FROM PSRECFIELDDB R JOIN PSDBFIELD D ON D.FIELDNAME = R.FIELDNAME
            WHERE R.RECNAME IN (${batch.map((_, j) => `:r${j}`).join(', ')}) ORDER BY R.RECNAME, R.FIELDNUM`, binds);
        for (const r of rows) {
          const rec = String(r.RECNAME).trim();
          if (!fields.has(rec)) fields.set(rec, []);
          fields.get(rec)!.push({ name: String(r.FIELDNAME).trim(), useEdit: Number(r.USEEDIT), fieldType: Number(r.FIELDTYPE) });
        }
      }
      if (addSearchRecord && !types.has(addSearchRecord)) {
        const [t] = await this.uiRows(c, `SELECT RECTYPE FROM PSRECDEFN WHERE RECNAME = :r`, { r: addSearchRecord });
        if (t) types.set(addSearchRecord, Number(t.RECTYPE));
      }
      const recordSyncFields: Record<string, [string, string]> = {};
      const all = [...types.keys()];
      for (let i = 0; i < all.length; i += 500) {
        const batch = all.slice(i, i + 500);
        const binds = Object.fromEntries(batch.map((r, j) => [`r${j}`, r]));
        for (const r of await this.uiRows(c, `SELECT RECNAME, SYSTEMIDFIELDNAME, TIMESTAMPFIELDNAME FROM PSRECDEFN WHERE RECNAME IN (${batch.map((_, j) => `:r${j}`).join(', ')})`, binds)) {
          recordSyncFields[String(r.RECNAME).trim()] = [String(r.SYSTEMIDFIELDNAME ?? ' '), String(r.TIMESTAMPFIELDNAME ?? ' ')];
        }
      }
      const clean = (f: StructureField): StructureField => ({
        FIELDNUM: Number(f.FIELDNUM), FIELDTYPE: Number(f.FIELDTYPE), OCCURSLEVEL: Number(f.OCCURSLEVEL), RECNAME: String(f.RECNAME ?? '').trim(),
        FIELDNAME: String(f.FIELDNAME ?? '').trim(), SUBPNLNAME: String(f.SUBPNLNAME ?? '').trim(), FIELDUSE: Number(f.FIELDUSE)
      });
      return {
        component, market, searchRecord, addSearchRecord, actions: Number(defn.ACTIONS), pages, systemPages: system,
        pageFields: Object.fromEntries([...pageFields].map(([p, list]) => [p, list.map(clean)])),
        recordTypes: Object.fromEntries(types), recordFields: Object.fromEntries(fields), recordSyncFields
      };
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
      // -- "HTML" for HTML.ZZ_OJET_REQUIRE_CONFIG, the record name for a
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
      const STRING = this.types.STRING;
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
                                    WHERE EXISTS (SELECT 1 FROM PSAESTEPDEFN S
                                      WHERE S.AE_APPLID = :a AND S.MESSAGE_SET_NBR = M.MESSAGE_SET_NBR AND S.MESSAGE_NBR = M.MESSAGE_NBR AND EXISTS (SELECT 1 FROM PSAESTMTDEFN T WHERE T.AE_APPLID = S.AE_APPLID
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

  /** An App Engine program as an editable document (model/aeDocument.ts) with its concurrency token; undefined when there is none. */
  async readAppEngineDocument(name: string): Promise<{ doc: AeDocument; token: string } | undefined> {
    return this.withConnection(async (c) => {
      const stored = await readStoredAppEngine(c, this.types, name, false);
      if (!stored?.exists) return undefined;
      return { doc: documentOf(stored), token: appEngineToken(stored) };
    });
  }

  /**
   * Saves an App Engine document as App Designer does (appEngineWriter.ts,
   * docs/APP_ENGINE.md) in one transaction, then proves it on another
   * connection after COMMIT. A dry run returns the plan and writes nothing.
   */
  async saveAppEngineDocument(request: AeSaveRequest): Promise<AeSaveResult> {
    if (!request.dryRun && request.openedToken !== 'absent') await this.guard(makeKey(DefinitionType.AppEngineProgram, request.doc.name), 'save');
    const key=makeKey(DefinitionType.AppEngineProgram,request.doc.name);
    const previous=request.dryRun || request.openedToken==='absent'?undefined:await this.createdReceipt(key);
    const types = this.types;
    const result = await this.withConnection((c) => saveAppEngine(c, types, request));
    await this.withConnection((c) => verifyAppEngineSave(c, types, result));
    if(!request.dryRun && (request.openedToken==='absent' || previous)){
      const e=await this.withConnection(c=>readOwnershipEvidence(c,key,[]));
      if(e.version!==undefined && e.operator && e.updated)await this.noteCreation(key,{version:e.version,operator:e.operator,updated:e.updated},previous);
    }
    return result;
  }

  async deleteAppEngineProgram(name: string, token: string, operatorId: string): Promise<void> {
    await this.guard(makeKey(DefinitionType.AppEngineProgram, name), 'delete');
    const types = this.types;
    await this.withConnection((c) => deleteAppEngine(c, types, name, token, operatorId));
    const after = await this.withConnection((c) => readStoredAppEngine(c, types, name, false));
    if (after?.exists) throw new ProviderError(`After COMMIT ${name} still exists.`);
  }

  async renameAppEngineProgram(from: string, to: string, token: string, operatorId: string): Promise<AeSaveResult> {
    await this.guard(makeKey(DefinitionType.AppEngineProgram, from), 'rename');
    const previous=await this.createdReceipt(makeKey(DefinitionType.AppEngineProgram,from));
    const types = this.types;
    const result = await this.withConnection((c) => renameAppEngine(c, types, from, to, token, operatorId));
    await this.withConnection((c) => verifyAppEngineSave(c, types, result));
    const key=makeKey(DefinitionType.AppEngineProgram,to);
    const e=await this.withConnection(c=>readOwnershipEvidence(c,key,[]));
    if(e.version!==undefined && e.operator && e.updated)await this.noteCreation(key,{version:e.version,operator:e.operator,updated:e.updated},previous);
    return result;
  }

  /** A menu as an editable document (model/menuDocument.ts) with its concurrency token; undefined when there is none. */
  async readMenuDocument(name: string): Promise<{ doc: MenuDocument; token: string } | undefined> {
    return this.withConnection(async (c) => {
      const stored = await readStoredMenu(c, this.types, name, false);
      if (!stored.exists) return undefined;
      return { doc: menuDocumentOf(stored), token: menuToken(stored) };
    });
  }

  /** Saves a menu document as App Designer does (menuWriter.ts, docs/MENUS.md), then proves it after COMMIT. */
  async saveMenuDocument(request: MenuSaveRequest): Promise<MenuSaveResult> {
    if (!request.dryRun && request.openedToken !== 'absent') await this.guard(makeKey(DefinitionType.Menu, request.doc.name), 'save');
    const types = this.types;
    const result = await this.withConnection((c) => saveMenu(c, types, request));
    await this.withConnection((c) => verifyMenuSave(c, types, result));
    return result;
  }

  async deleteMenuDefinition(name: string, token: string, operatorId: string): Promise<void> {
    await this.guard(makeKey(DefinitionType.Menu, name), 'delete');
    const types = this.types;
    await this.withConnection((c) => deleteMenu(c, types, name, token, operatorId));
    const after = await this.withConnection((c) => readStoredMenu(c, types, name, false));
    if (after.exists) throw new ProviderError(`After COMMIT ${name} still exists.`);
  }

  async renameMenuDefinition(from: string, to: string, token: string, operatorId: string): Promise<MenuSaveResult> {
    await this.guard(makeKey(DefinitionType.Menu, from), 'rename');
    const types = this.types;
    const result = await this.withConnection((c) => renameMenu(c, types, from, to, token, operatorId));
    await this.withConnection((c) => verifyMenuSave(c, types, result));
    return result;
  }

  private release: Promise<DatabaseRelease> | undefined;

  /** The application and tools release of this database (cached): a delivered baseline applies to its own release only. */
  async databaseRelease(): Promise<DatabaseRelease> {
    this.release ??= this.withConnection((c) => readRelease(c)).catch((error) => { this.release = undefined; throw error; });
    return this.release;
  }

  /**
   * Who owns a definition, and why (model/ownership.ts, docs/CUSTOMIZATION.md):
   * its stamp, an Oracle-delivered project listing it, this release's
   * delivered baseline when one was captured, the naming prefixes. A
   * PeopleCode program not stored yet is judged by the definition it belongs to.
   */
  async classifyDefinition(key: DefinitionKey, prefixes: readonly NamingPrefix[]): Promise<{ classification: Classification; evidence: OwnershipEvidence & { judgedBy?: DefinitionKey }; release: DatabaseRelease }> {
    const release = await this.databaseRelease();
    const baseline = await resolveBaseline(release);
    const evidence = await this.withConnection((c) => readOwnershipEvidence(c, key, prefixes, baseline));
    const receipt=await this.createdReceipt(evidence.judgedBy??key,evidence);
    if(receipt)evidence.studioCreation={createdAt:receipt.createdAt};
    const classification = classifyOwnership(evidence);
    if (evidence.judgedBy) classification.evidence.unshift(`No program stored yet: judged by ${keyDisplayName(evidence.judgedBy)}, the definition it belongs to.`);
    return { classification, evidence, release };
  }

  /** A delivered baseline of this database: run it on a vanilla demo database of the release (read only). */
  /**
   * Which configuration frameworks could extend a definition, as this
   * database shows it (docs/CUSTOMIZATION.md): Event Mapping -- the
   * component's content references and the configurations on them -- and
   * Drop Zones -- the drop zones on its pages and any subpage configured into
   * them -- and Page and Field Configurator -- its configurations and where
   * their Event Mapping applies them. The other frameworks are not discovered yet.
   */
  async discoverCapabilities(key: DefinitionKey): Promise<{ eventMapping?: EventMappingDiscovery; dropZones?: DropZoneDiscovery; pageFieldConfigurator?: PfcDiscovery }> {
    return this.withConnection(async (c) => {
      const eventMapping = await discoverEventMapping(c, key);
      const dropZones = await discoverDropZones(c, key);
      const pageFieldConfigurator = await discoverPageFieldConfigurator(c, key);
      return { ...(eventMapping ? { eventMapping } : {}), ...(dropZones ? { dropZones } : {}), ...(pageFieldConfigurator ? { pageFieldConfigurator } : {}) };
    });
  }

  /** A component's drop zones as the Configure Drop Zones page lists them, each with its subpage, and the token a save checks (dropZoneWriter.ts). */
  async readDropZoneConfiguration(component: string, market = 'GBL'): Promise<{ zones: DropZone[]; owners: DropZoneOwner[]; token: string }> {
    return this.withConnection(async (c) => {
      const state = await readDropZoneState(c, component.trim().toUpperCase(), market.trim().toUpperCase());
      return { zones: state.zones, owners: state.owners, token: dropZoneToken(state) };
    });
  }

  /**
   * Sets drop zones' subpages ('' removes one) as Configure Drop Zones saves them (dropZoneWriter.ts), in one
   * transaction, verified before and after COMMIT. No delivered-object guard: no definition changes; the write
   * scope applies to the subpages configured or removed.
   */
  async saveDropZoneConfiguration(request: DropZoneSaveRequest): Promise<DropZoneSaveResult> {
    const result = await this.withConnection((c) => saveDropZones(c, request));
    if (result.written) {
      const after = await this.withConnection((c) => readDropZoneState(c, request.component.trim().toUpperCase(), (request.market ?? 'GBL').trim().toUpperCase()));
      if (dropZoneToken(after) !== result.token) throw new ProviderError(`After COMMIT ${request.component}'s drop-zone configuration is not what was written.`);
    }
    return result;
  }

  /**
   * A component's Page and Field Configurator configuration of a type (STD, MASK, TRK): its rows (compact: what a save would fill in
   * left out), the token a save checks, and per content reference whether its Event Mapping is what the configuration derives (pfcWriter.ts).
   */
  async readPageFieldConfiguration(component: string, market = 'GBL', type = 'STD'): Promise<{
    exists: boolean; token: string; configuration?: { header: Record<string, unknown>; sequences: Record<string, unknown>[]; criteria: Record<string, unknown>[];
      pages: Record<string, unknown>[]; fields: Record<string, unknown>[] } & { [K in ListTable]?: Record<string, unknown>[] };
    derived: PfcMapping[]; contentReferences: Array<{ cref: string; menu: string; mappingRows: number; inSync: boolean }>;
  }> {
    const comp = component.trim().toUpperCase(), mkt = market.trim().toUpperCase(), t = type.trim().toUpperCase();
    return this.withConnection(async (c) => {
      const columns = await readPfcColumns(c);
      const config = await readPfcConfiguration(c, columns, comp, mkt, t);
      const active = config.header && String(config.header.EFF_STATUS).trim() === 'A';
      const derived = active ? await derivePfcMappings(c, comp, mkt, t) : [];
      const want = JSON.stringify(derived.map(mappingSignature).sort());
      const contentReferences = [];
      for (const { cref, menu } of await pfcContentReferences(c, comp, mkt)) {
        const rows = (await readStoredConfiguration(c, cref, false)).configs.filter((r) => isTypeService(t, String(r.PTCS_SERVICEID).trim()));
        contentReferences.push({ cref, menu, mappingRows: rows.length, inSync: JSON.stringify(rows.map(storedSignature).sort()) === want });
      }
      const compact = (table: ListTable) => rowsOf(config, table).map((r) => compactRow(columns, table, r));
      return {
        exists: !!config.header, token: pfcToken(config), derived, contentReferences,
        ...(config.header ? { configuration: {
          header: compactRow(columns, 'header', config.header), sequences: compact('sequences'), criteria: compact('criteria'), pages: compact('pages'), fields: compact('fields'),
          // Who it applies to; a list left out when empty.
          ...Object.fromEntries(PFC_TARGETING_TABLES.map((t) => [t, compact(t)]).filter(([, rows]) => (rows as unknown[]).length))
        } } : {})
      };
    });
  }

  /** The pages a Page and Field Configurator configuration can name fields on (the component's, then secondary pages), as Select Fields offers them. */
  async readPageFieldCatalogPages(component: string, market = 'GBL'): Promise<Array<Omit<PfcCatalogPage, 'fields'>>> {
    return this.withConnection((c) => pfcCatalogPages(c, component.trim().toUpperCase(), market.trim().toUpperCase()));
  }

  /** The fields the configurator offers on a page of that list, each with the values its field row takes (pfcCatalog.ts). */
  async readPageFieldCatalogFields(page: string, type: 'P' | 'S', options: { mask?: boolean } = {}): Promise<PfcCatalogField[]> {
    return this.withConnection((c) => pfcCatalogFields(c, page.trim().toUpperCase(), type, options));
  }

  /** PeopleSoft users (PSOPRDEFN) whose ID or description contains the text, for a configuration's user lists. */
  async searchOperators(text: string, limit = 100): Promise<Array<{ oprid: string; description: string }>> {
    const p = `%${text.trim().toUpperCase()}%`;
    return this.withConnection(async (c) => (await select<{ O: string; D: string }>(c,
      `SELECT OPRID AS O, OPRDEFNDESC AS D FROM PSOPRDEFN WHERE UPPER(OPRID) LIKE :p OR UPPER(OPRDEFNDESC) LIKE :p ORDER BY OPRID FETCH FIRST ${Math.max(1, Math.min(500, limit))} ROWS ONLY`,
      { p })).map((r) => ({ oprid: String(r.O ?? '').trim(), description: String(r.D ?? '').trim() })));
  }

  /** The configurator's mask profiles and the profile each field group gives its fields. */
  async readPageFieldMaskProfiles(): Promise<{ profiles: PfcMaskProfile[]; fieldDefaults: Record<string, string> }> {
    return this.withConnection((c) => pfcMaskProfiles(c));
  }

  /**
   * Saves a Page and Field Configurator configuration and regenerates its Event Mapping on the component's content references as
   * EOCC_CONFIGURE saves it (pfcWriter.ts), in one transaction, verified before COMMIT and the token checked after.
   */
  async savePageFieldConfiguration(request: PfcSaveRequest): Promise<PfcSaveResult> {
    const result = await this.withConnection((c) => savePfcConfiguration(c, request));
    if (result.written) {
      const after = await this.readPageFieldConfiguration(request.component, request.market ?? 'GBL', request.type);
      if (after.token !== result.token) throw new ProviderError(`After COMMIT ${request.component}'s configuration is not what was written.`);
    }
    return result;
  }

  /** A content reference's Event Mapping configuration as the Configure Event Mapping page lists it, with its token (eventMappingWriter.ts). */
  async readEventMappingConfiguration(cref: string, portal = 'EMPLOYEE'): Promise<{
    rows: EventMappingConfigRow[]; token: string; exists: boolean; component?: { name: string; market: string; menu: string; label: string };
  }> {
    return this.withConnection(async (c) => {
      const name = cref.trim().toUpperCase();
      const stored = await readStoredConfiguration(c, name, false);
      const reg = ((await c.execute<{ M: string; C: string; K: string; L: string }>(
        `SELECT PORTAL_URI_SEG1 AS M, PORTAL_URI_SEG2 AS C, PORTAL_URI_SEG3 AS K, PORTAL_LABEL AS L FROM PSPRSMDEFN WHERE PORTAL_NAME = :p AND PORTAL_REFTYPE = 'C' AND PORTAL_OBJNAME = :n`,
        { p: portal.trim().toUpperCase(), n: name })).rows ?? [])[0];
      return {
        rows: configRowsOf(stored), token: configurationToken(stored), exists: stored.exists,
        ...(reg ? { component: { name: String(reg.C).trim(), market: String(reg.K).trim(), menu: String(reg.M).trim(), label: String(reg.L).trim() } } : {})
      };
    });
  }

  /**
   * Saves a content reference's Event Mapping configuration as the page's
   * Save does, then proves it after COMMIT. No delivered-object guard: no
   * definition changes -- configuring instead of customizing is the point.
   */
  async saveEventMappingConfiguration(request: ConfigurationSaveRequest): Promise<ConfigurationSaveResult> {
    const result = await this.withConnection((c) => saveConfiguration(c, request));
    if (result.written) {
      const after = await this.withConnection((c) => readStoredConfiguration(c, result.plan.cref, false));
      if (configurationToken(after) !== result.token) throw new ProviderError(`After COMMIT ${result.plan.cref}'s Event Mapping configuration is not what was written.`);
    }
    return result;
  }

  /**
   * An Event Mapping service, end to end: the root package when missing
   * (createPackage), the class when missing (as App Designer creates one,
   * subpackages on its path included; source serviceClassSource's unless
   * given), then the Application Class related content service as the Define
   * Related Content Service page saves it (rcServiceWriter.ts). Each step is
   * its own transaction; the result says which ran.
   */
  async createEventMappingService(request: AppClassServiceRequest & { source?: string; purpose?: string }): Promise<{
    packageCreated: boolean; classCreated: boolean; service: AppClassServicePlan & { written: boolean };
  }> {
    const pkg = request.packageRoot.trim().toUpperCase();
    const classId = request.classId.trim();
    const problems = validateServiceRequest(request);
    if (problems.length) throw new ProviderError(problems.join(' '));
    const scope = writeScopeRefusal(pkg);
    if (scope) throw new ProviderError(scope);
    const classKey = makeKey(DefinitionType.ApplicationClassPeopleCode, pkg, ...(request.path ?? []), classId, 'OnExecute');
    const classExists = await this.withConnection(async (c) => (await select(c,
      `SELECT 'X' AS X FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :p AND QUALIFYPATH = :q AND APPCLASSID = :c`, { p: pkg, q: qualifyPath(request.path), c: classId })).length > 0);
    const packageExists = await this.packageExists(pkg);
    if (request.dryRun) {
      const service = await this.withConnection((c) => createAppClassService(c, { ...request, dryRun: true }).catch((e) => {
        // The class does not exist yet in a dry run that would create it: plan the service regardless.
        if (!classExists && /no application class/.test(String((e as Error).message))) return { serviceId: request.serviceId.toUpperCase(), statements: [], version: 0, row: {}, written: false };
        throw e;
      }));
      return { packageCreated: !packageExists, classCreated: !classExists, service };
    }
    if (!packageExists) await this.createPackage({ name: pkg, operatorId: request.operatorId });
    if (!classExists) {
      await this.savePeopleCode(classKey, {
        source: request.source ?? serviceClassSource(classId, request.purpose), openedFingerprint: 'absent', operatorId: request.operatorId, createClass: true
      });
    }
    const service = await this.withConnection((c) => createAppClassService(c, request));
    return { packageCreated: !packageExists, classCreated: !classExists, service };
  }

  /**
   * What the Event Mapping editor offers, as the page's default prompts do
   * (PTCS_EV_CFG_WRK.PTCS_UNRESTRICT FieldChange): the component's pages, the
   * records on them, and the Application Class services with their classes.
   */
  async eventMappingChoices(component: string): Promise<{ pages: string[]; records: string[]; services: Array<{ id: string; name: string; appClass: string }> }> {
    return this.withConnection(async (c) => {
      const g = { g: component };
      const pages = (await select<{ P: string }>(c, `SELECT DISTINCT PNLNAME AS P FROM PSPNLGROUP WHERE PNLGRPNAME = :g ORDER BY 1`, g)).map((r) => String(r.P).trim());
      const records = (await select<{ R: string }>(c,
        `SELECT DISTINCT F.RECNAME AS R FROM PSPNLFIELD F JOIN PSRECDEFN D ON D.RECNAME = F.RECNAME
          WHERE F.PNLNAME IN (SELECT PNLNAME FROM PSPNLGROUP WHERE PNLGRPNAME = :g) AND D.RECTYPE <> 5 ORDER BY 1`, g)).map((r) => String(r.R).trim());
      const services = (await select<{ S: string; N: string; P: string; Q: string; C: string }>(c,
        `SELECT PTCS_SERVICEID AS S, PTCS_SERVICENAME AS N, PACKAGEROOT AS P, QUALIFYPATH AS Q, APPCLASSID AS C FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEURLTYP = 'UAPC' ORDER BY 1`))
        .map((r) => {
          const path = String(r.Q ?? '').trim();
          return { id: String(r.S).trim(), name: String(r.N ?? '').trim(), appClass: [String(r.P).trim(), ...(path && path !== ':' ? path.split(':') : []), String(r.C).trim()].join(':') };
        });
      return { pages, records, services };
    });
  }

  /** A record's fields for the editor: those on the component's pages, else (Unrestricted Prompt) all of them. */
  async eventMappingFields(record: string, component: string): Promise<{ onComponent: string[]; all: string[] }> {
    return this.withConnection(async (c) => {
      const onComponent = (await select<{ F: string }>(c,
        `SELECT DISTINCT FIELDNAME AS F FROM PSPNLFIELD WHERE RECNAME = :r AND FIELDNAME <> ' ' AND PNLNAME IN (SELECT PNLNAME FROM PSPNLGROUP WHERE PNLGRPNAME = :g) ORDER BY 1`,
        { r: record, g: component })).map((x) => String(x.F).trim());
      const all = (await select<{ F: string }>(c, `SELECT FIELDNAME AS F FROM PSRECFIELDDB WHERE RECNAME = :r ORDER BY FIELDNUM`, { r: record })).map((x) => String(x.F).trim());
      return { onComponent, all };
    });
  }

  /** The configuration list's Remove. */
  async removeEventMappingConfiguration(cref: string, token: string, operatorId: string): Promise<void> {
    await this.withConnection((c) => removeConfiguration(c, cref, token, operatorId));
    const after = await this.withConnection((c) => readStoredConfiguration(c, cref.trim().toUpperCase(), false));
    if (after.exists || after.configs.length) throw new ProviderError(`After COMMIT ${cref} still has an Event Mapping configuration.`);
  }

  async captureDeliveredBaseline(onProgress?: (what: string) => void): Promise<BaselineFile> {
    return this.withConnection((c) => captureBaseline(c, onProgress));
  }

  private async creationScope():Promise<string> {
    const release=await this.databaseRelease();
    return createHash('sha256').update(JSON.stringify([this.config.platform,this.config.connectString,this.config.schema??'',this.config.user,release])).digest('hex');
  }
  private async createdReceipt(key:DefinitionKey,evidence?:OwnershipEvidence):Promise<CreationReceipt|undefined> {
    if(![DefinitionType.Field,DefinitionType.Record,DefinitionType.AppEngineProgram,DefinitionType.UrlDefinition,...Object.values(IB_DEFINITION_TYPES)].includes(key.type))return;
    const e=evidence??await this.withConnection(c=>readOwnershipEvidence(c,key,[]));
    if(!e.exists || e.version===undefined || !e.operator || !e.updated)return;
    return witnessedCreation(await this.creationScope(),key,{version:e.version,operator:e.operator,updated:e.updated});
  }
  private async noteCreation(key:DefinitionKey,stamp:DefinitionStamp,previous?:CreationReceipt):Promise<void> {
    try { await recordCreation(await this.creationScope(),key,stamp,previous); }
    catch(e){console.error('PeopleSoft Studio: creation receipt could not be stored:',e instanceof Error?e.message:String(e));}
  }

  /** The delivered-object guard (writeGuard.ts) before a write to an existing definition. */
  private async guard(key: DefinitionKey, action: WriteAction): Promise<void> {
    await guardWrite({ provider: this, key, action });
  }

  /** A message channel as its window opens it (channelWriter.ts, docs/MESSAGE_CHANNELS.md), with its token; undefined when there is none. */
  async readChannelDocument(name: string): Promise<{ doc: ChannelDocument; token: string } | undefined> {
    return this.withConnection(async (c) => {
      const stored = await readStoredChannel(c, this.types, name, false);
      if (!stored.exists) return undefined;
      return { doc: channelDocumentOf(stored), token: channelToken(stored) };
    });
  }

  /** File > New > Message Channel: App Designer's defaults, with the messages already naming the name and their fields. */
  async newChannelDocument(name: string): Promise<ChannelDocument> {
    const { messages, candidates } = await this.withConnection((c) => readChannelContext(c, name));
    return newChannel(name, messages, candidates);
  }

  /** Saves a message channel as App Designer does, then proves it after COMMIT. */
  async saveChannelDocument(request: ChannelSaveRequest): Promise<ChannelSaveResult> {
    if (!request.dryRun && request.openedToken !== 'absent') await this.guard(makeKey(DefinitionType.MessageChannel, request.doc.name), 'save');
    const types = this.types;
    const result = await this.withConnection((c) => saveChannel(c, types, request));
    await this.withConnection((c) => verifyChannelSave(c, types, result));
    return result;
  }

  async deleteChannelDefinition(name: string, token: string, operatorId: string): Promise<void> {
    await this.guard(makeKey(DefinitionType.MessageChannel, name), 'delete');
    const types = this.types;
    await this.withConnection((c) => deleteChannel(c, types, name, token, operatorId));
    const after = await this.withConnection((c) => readStoredChannel(c, types, name, false));
    if (after.exists) throw new ProviderError(`After COMMIT ${name} still exists.`);
  }

  async renameChannelDefinition(from: string, to: string, token: string, operatorId: string): Promise<ChannelSaveResult> {
    await this.guard(makeKey(DefinitionType.MessageChannel, from), 'rename');
    const types = this.types;
    const result = await this.withConnection((c) => renameChannel(c, types, from, to, token, operatorId));
    await this.withConnection((c) => verifyChannelSave(c, types, result));
    return result;
  }

  /** Add Partition Field's check (78,1) and the Owner ID list. */
  channelReferenceLookup(): ChannelReferenceLookup {
    const count = (sql: string, binds: Record<string, unknown>) =>
      this.withConnection(async (c) => Number(((await c.execute<{ N: number }>(sql, binds)).rows ?? [])[0]?.N ?? 0));
    return {
      fieldExists: async (field) => (await count(`SELECT COUNT(*) AS N FROM PSDBFIELD WHERE FIELDNAME = :f`, { f: field.trim().toUpperCase() })) > 0,
      ownerExists: async (owner) => (await count(`SELECT COUNT(*) AS N FROM PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND FIELDVALUE = :o`, { o: owner })) > 0
    };
  }

  /** The Message Channel window's lists: Owner ID, and fields by name for Add Partition Field. */
  async channelChoices(what: 'owners' | 'fields', arg = '', limit = 300): Promise<{ value: string; label?: string }[]> {
    const q = (sql: string, binds: Record<string, unknown>) => this.withConnection(async (c) => (await c.execute<Record<string, unknown>>(sql, binds)).rows ?? []);
    const rows = what === 'owners'
      ? await q(`SELECT FIELDVALUE AS V, XLATLONGNAME AS L FROM PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND EFF_STATUS = 'A' ORDER BY XLATLONGNAME`, {})
      : await q(`SELECT FIELDNAME AS V FROM PSDBFIELD WHERE FIELDNAME LIKE :p ORDER BY FIELDNAME FETCH FIRST :n ROWS ONLY`, { p: `${arg.toUpperCase()}%`, n: limit });
    return rows.map((r) => ({ value: String(r.V).trim(), ...(r.L !== undefined && r.L !== null ? { label: String(r.L).trim() } : {}) }));
  }

  /**
   * A Component Interface as its window holds it (ciWriter.ts,
   * docs/COMPONENT_INTERFACES.md), with its component's buffer -- the
   * window's left tree, numbered -- and the items' key flags; the buffer is
   * missing when the component is.
   */
  async readCiDocument(name: string): Promise<{ doc: CiDocument; token: string; buffer?: CiBuffer } | undefined> {
    const stored = await this.withConnection((c) => readStoredCi(c, this.types, name, false));
    if (!stored.exists) return undefined;
    const doc = ciDocumentOf(stored);
    let buffer: CiBuffer | undefined;
    try {
      const src = await this.readCiSource(doc.component, doc.market);
      buffer = ciBuffer(src);
      markKeys(doc, (r, f) => !!(((src.recordFields(r) ?? []).find((x) => x.name === f)?.useEdit ?? 0) & 1));
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
    }
    return { doc, token: ciToken(stored), ...(buffer ? { buffer } : {}) };
  }

  /** File > New > Component Interface on a component: (123,12) Yes defaults its properties, No makes its keys only (ci01-ci04, ci28). */
  async newCiDocument(name: string, component: string, market: string, defaults: boolean): Promise<{ doc: CiDocument; buffer: CiBuffer }> {
    const src = await this.readCiSource(component, market);
    const buffer = ciBuffer(src);
    const doc = ciFromBuffer(name, buffer, defaults);
    markKeys(doc, (r, f) => !!(((src.recordFields(r) ?? []).find((x) => x.name === f)?.useEdit ?? 0) & 1));
    return { doc, buffer };
  }

  /** Saves a Component Interface as App Designer does, then proves it after COMMIT. */
  async saveCiDocument(request: CiSaveRequest): Promise<CiSaveResult> {
    if (!request.dryRun && request.openedToken !== 'absent') await this.guard(makeKey(DefinitionType.ComponentInterface, request.doc.name), 'save');
    const types = this.types;
    const result = await this.withConnection((c) => saveCi(c, types, request));
    await this.withConnection((c) => verifyCiSave(c, types, result));
    return result;
  }

  async deleteCiDefinition(name: string, token: string, operatorId: string): Promise<void> {
    await this.guard(makeKey(DefinitionType.ComponentInterface, name), 'delete');
    const types = this.types;
    await this.withConnection((c) => deleteCi(c, types, name, token, operatorId));
    const after = await this.withConnection((c) => readStoredCi(c, types, name, false));
    if (after.exists) throw new ProviderError(`After COMMIT ${name} still exists.`);
  }

  async renameCiDefinition(from: string, to: string, token: string, operatorId: string): Promise<CiSaveResult> {
    await this.guard(makeKey(DefinitionType.ComponentInterface, from), 'rename');
    const types = this.types;
    const result = await this.withConnection((c) => renameCi(c, types, from, to, token, operatorId));
    await this.withConnection((c) => verifyCiSave(c, types, result));
    return result;
  }

  /** The lists the CI window's dialogs offer: owners, components (Select source Component), the menus with an item for the component (Menu Name: ci05), projects. */
  async ciChoices(what: 'owners' | 'components' | 'menus' | 'projects', arg = '', limit = 300): Promise<{ value: string; label?: string }[]> {
    const like = `${arg.toUpperCase()}%`;
    const q = (sql: string, binds: Record<string, unknown>) => this.withConnection(async (c) => (await c.execute<Record<string, unknown>>(sql, binds)).rows ?? []);
    const out = (rows: Record<string, unknown>[]) => rows.map((r) => ({ value: String(r.V).trim(), ...(r.L !== undefined && r.L !== null ? { label: String(r.L).trim() } : {}) }));
    switch (what) {
      case 'owners': return out(await q(`SELECT FIELDVALUE AS V, XLATLONGNAME AS L FROM PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND EFF_STATUS = 'A' ORDER BY XLATLONGNAME`, {}));
      case 'components': return out(await q(`SELECT PNLGRPNAME AS V, MARKET AS L FROM PSPNLGRPDEFN WHERE PNLGRPNAME LIKE :p ORDER BY PNLGRPNAME, MARKET FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }));
      case 'menus': {
        const [component, market] = arg.split('.');
        return out(await q(`SELECT DISTINCT MENUNAME AS V FROM PSMENUITEM WHERE PNLGRPNAME = :c AND MARKET = :m ORDER BY MENUNAME`, { c: component, m: market || 'GBL' }));
      }
      case 'projects': return out(await q(`SELECT PROJECTNAME AS V, PROJECTDESCR AS L FROM PSPROJECTDEFN WHERE PROJECTNAME LIKE :p ORDER BY PROJECTNAME FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }));
    }
  }

  /** What menu reference validation asks the database (model/menuSession.ts). */
  menuReferenceLookup(): MenuReferenceLookup {
    const count = (sql: string, binds: Record<string, unknown>) =>
      this.withConnection(async (c) => Number(((await c.execute<{ N: number }>(sql, binds)).rows ?? [])[0]?.N ?? 0));
    return {
      componentExists: async (component, market) => (await count(`SELECT COUNT(*) AS N FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :c AND MARKET = :m`, { c: component, m: market })) > 0,
      recordExists: async (record) => (await count(`SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = :r`, { r: record })) > 0,
      menuExists: async (menu) => (await count(`SELECT COUNT(*) AS N FROM PSMENUDEFN WHERE MENUNAME = :m`, { m: menu })) > 0
    };
  }

  /**
   * The lists the Menu Designer's dialogs offer: owners, menu groups (with
   * their order and separator), components and markets (Select...), search
   * records, and Transfer Properties' portals, nodes, menus, a menu's
   * components, a component's pages and allowed actions.
   */
  async menuChoices(what: 'owners' | 'groups' | 'components' | 'records' | 'portals' | 'nodes' | 'menus' | 'menuComponents' | 'pages' | 'actions',
    arg = '', limit = 300): Promise<{ value: string; label?: string; order?: number; separator?: boolean }[]> {
    const like = `${arg.toUpperCase()}%`;
    const q = (sql: string, binds: Record<string, unknown>) => this.withConnection(async (c) => (await c.execute<Record<string, unknown>>(sql, binds)).rows ?? []);
    const out = (rows: Record<string, unknown>[]) => rows.map((r) => ({ value: String(r.V).trim(), ...(r.L !== undefined && r.L !== null ? { label: String(r.L).trim() } : {}) }));
    switch (what) {
      case 'owners': return out(await q(`SELECT FIELDVALUE AS V, XLATLONGNAME AS L FROM PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND EFF_STATUS = 'A' ORDER BY XLATLONGNAME`, {}));
      case 'groups': {
        const rows = await q(`SELECT MENUGROUP AS V, MAX(GROUPORDER) AS O, MAX(GROUPSEP) AS S FROM PSMENUDEFN WHERE MENUTYPE = 0 AND MENUGROUP <> ' ' GROUP BY MENUGROUP ORDER BY MAX(GROUPORDER), MENUGROUP`, {});
        return rows.map((r) => ({ value: String(r.V).trim(), order: Number(r.O), separator: Number(r.S) === 1 }));
      }
      case 'components': return out(await q(`SELECT PNLGRPNAME AS V, MARKET AS L FROM PSPNLGRPDEFN WHERE PNLGRPNAME LIKE :p ORDER BY PNLGRPNAME, MARKET FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }));
      case 'records': return out(await q(`SELECT RECNAME AS V, RECDESCR AS L FROM PSRECDEFN WHERE RECNAME LIKE :p AND RECTYPE IN (0, 1, 6) ORDER BY RECNAME FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }));
      case 'portals': return out(await q(`SELECT PORTAL_NAME AS V FROM PSPRDMDEFN ORDER BY PORTAL_NAME`, {}));
      case 'nodes': return out(await q(`SELECT MSGNODENAME AS V, DESCR AS L FROM PSMSGNODEDEFN ORDER BY MSGNODENAME`, {}));
      case 'menus': return out(await q(`SELECT MENUNAME AS V, DESCR AS L FROM PSMENUDEFN WHERE MENUNAME LIKE :p AND MENUTYPE = 0 ORDER BY MENUNAME FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }));
      case 'menuComponents': return out(await q(`SELECT DISTINCT PNLGRPNAME AS V, MARKET AS L FROM PSMENUITEM WHERE MENUNAME = :m AND ITEMTYPE = 5 ORDER BY PNLGRPNAME`, { m: arg }));
      case 'pages': {
        const [component, market] = arg.split('.');
        return out(await q(`SELECT ITEMNAME AS V, ITEMLABEL AS L FROM PSPNLGROUP WHERE PNLGRPNAME = :c AND MARKET = :m AND HIDDEN = 0 ORDER BY SUBITEMNUM`, { c: component, m: market || 'GBL' }));
      }
      case 'actions': {
        const [component, market] = arg.split('.');
        const [r] = await q(`SELECT ACTIONS AS A FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :c AND MARKET = :m`, { c: component, m: market || 'GBL' });
        const bits = Number(r?.A ?? 0);
        // XFERACTION is the bit's position in PSPNLGRPDEFN.ACTIONS [mp02-mp04].
        return Object.entries(TRANSFER_ACTIONS).filter(([code]) => bits & (1 << Number(code))).map(([code, label]) => ({ value: code, label }));
      }
    }
  }

  /** What App Engine reference validation asks the database (model/aeValidation.ts). */
  appEngineReferenceLookup(): AeReferenceLookup {
    const one = <T>(sql: string, binds: Record<string, unknown>) =>
      this.withConnection(async (c) => (await c.execute<T>(sql, binds)).rows ?? []);
    return {
      recordType: async (record) => {
        const [r] = await one<{ T: number }>(`SELECT RECTYPE AS T FROM PSRECDEFN WHERE RECNAME = :r`, { r: record });
        return r ? Number(r.T) : undefined;
      },
      recordFields: async (record) => {
        const rows = await one<{ F: string }>(`SELECT FIELDNAME AS F FROM PSRECFIELDDB WHERE RECNAME = :r ORDER BY FIELDNUM`, { r: record });
        if (rows.length) return rows.map((x) => String(x.F).trim());
        const [exists] = await one<{ N: number }>(`SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = :r`, { r: record });
        return Number(exists?.N) ? [] : undefined;
      },
      programSections: async (program) => {
        const [p] = await one<{ N: number }>(`SELECT COUNT(*) AS N FROM PSAEAPPLDEFN WHERE AE_APPLID = :p`, { p: program });
        if (!Number(p?.N)) return undefined;
        const rows = await one<{ S: string; P: string }>(`SELECT AE_SECTION AS S, AE_PUBLIC_SW AS P FROM PSAESECTDEFN WHERE AE_APPLID = :p`, { p: program });
        return rows.map((r) => ({ name: String(r.S).trim(), isPublic: String(r.P).trim() === 'Y' }));
      },
      messageExists: async (set, number) => {
        const [r] = await one<{ N: number }>(`SELECT COUNT(*) AS N FROM PSMSGCATDEFN WHERE MESSAGE_SET_NBR = :s AND MESSAGE_NBR = :n`, { s: set, n: number });
        return Number(r?.N) > 0;
      }
    };
  }

  /**
   * The lists App Designer's App Engine dialogs offer: owners (PSXLATITEM
   * OBJECTOWNERID), markets (PSXLATITEM MARKET), state records (*AET),
   * temporary tables (RECTYPE 7) and programs matching a prefix.
   */
  async appEngineChoices(what: 'owners' | 'markets' | 'stateRecords' | 'tempTables' | 'programs' | 'sections', prefix = '', limit = 200):
    Promise<{ value: string; label?: string }[]> {
    const like = `${prefix.toUpperCase()}%`;
    const q = (sql: string, binds: Record<string, unknown>) => this.withConnection(async (c) => (await c.execute<{ V: string; L?: string }>(sql, binds)).rows ?? []);
    let rows: { V: string; L?: string }[];
    switch (what) {
      case 'owners': rows = await q(`SELECT FIELDVALUE AS V, XLATLONGNAME AS L FROM PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND EFF_STATUS = 'A' ORDER BY XLATLONGNAME`, {}); break;
      case 'markets': rows = await q(`SELECT DISTINCT FIELDVALUE AS V, XLATLONGNAME AS L FROM PSXLATITEM WHERE FIELDNAME = 'MARKET' ORDER BY FIELDVALUE`, {}); break;
      case 'stateRecords': rows = await q(`SELECT RECNAME AS V, RECDESCR AS L FROM PSRECDEFN WHERE RECNAME LIKE :p AND RECNAME LIKE '%AET' AND RECTYPE IN (0, 2) ORDER BY RECNAME FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }); break;
      case 'tempTables': rows = await q(`SELECT RECNAME AS V, RECDESCR AS L FROM PSRECDEFN WHERE RECNAME LIKE :p AND RECTYPE = 7 ORDER BY RECNAME FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }); break;
      case 'programs': rows = await q(`SELECT AE_APPLID AS V, DESCR AS L FROM PSAEAPPLDEFN WHERE AE_APPLID LIKE :p ORDER BY AE_APPLID FETCH FIRST :n ROWS ONLY`, { p: like, n: limit }); break;
      case 'sections': rows = await q(`SELECT AE_SECTION AS V, AE_PUBLIC_SW AS L FROM PSAESECTDEFN WHERE AE_APPLID = :p ORDER BY AE_SECTION`, { p: prefix }); break;
    }
    return rows.map((r) => ({ value: String(r.V).trim(), ...(r.L !== undefined && r.L !== null ? { label: String(r.L).trim() } : {}) }));
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
        { id: key.parts[0], t: key.parts[1] ?? '0' }, { fetchInfo: { SQLTEXT: { type: this.types.STRING } } });
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
          { fetchInfo: { SQLTEXT: { type: this.types.STRING } } });
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
          `SELECT QRYNAME FROM PSQRYDEFN WHERE QRYNAME = :r FETCH FIRST 1 ROWS ONLY`, { r: recname });
        if (q.rows?.[0]) layout.queryName = t(q.rows[0].QRYNAME);
      }
      const ts = await c.execute<{ DDLSPACENAME: string }>(
        // This platform's row (DBTYPE as PSDDLMODEL's PLATFORMID: 2 Oracle, 4 DB2 LUW, 1 DB2 z/OS), else the default (' ').
        `SELECT DDLSPACENAME FROM PSRECTBLSPC WHERE RECNAME = :r AND DBTYPE IN (:d, ' ')
          ORDER BY CASE WHEN DBTYPE = :d THEN 0 ELSE 1 END FETCH FIRST 1 ROWS ONLY`,
        { r: recname, d: String(this.pool?.ddlPlatformId ?? 2) });
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
          ORDER BY OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE4, OBJECTVALUE5, OBJECTVALUE6, OBJECTVALUE7, RECNAME`,
        record ? { f: field, r: record } : { f: field });
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

  /**
   * Run SQL (psft.sql.run): one query, read only. prepareReadOnlyQuery checks it (a single SELECT, no INTO
   * or FOR UPDATE) and expands %Table(REC) to the record's table (PSRECDEFN.SQLTABLENAME, else PS_REC).
   * It runs in a transaction that is always rolled back -- on Oracle also SET TRANSACTION READ ONLY, so a
   * function that writes fails -- and at most `maxRows` rows come back (Oracle: the driver's maxRows, the
   * query untouched; elsewhere the query wrapped in FETCH FIRST).
   */
  /** Public definitions plus the configured operator's private definitions. */
  async searchQueries(pattern: string, operator: string): Promise<DefinitionSummary[]> {
    return this.withConnection(async c=>{
      const rows=(await c.execute<{QRYNAME:string;OPRID:string;DESCR:string}>(`SELECT QRYNAME,OPRID,DESCR FROM PSQRYDEFN
        WHERE (OPRID=' ' OR OPRID=:o) AND QRYNAME LIKE :n ORDER BY QRYNAME,OPRID FETCH FIRST 500 ROWS ONLY`,{o:operator || ' ',n:pattern.toUpperCase()})).rows ?? [];
      return rows.map(r=>({key:makeKey(DefinitionType.Query,String(r.QRYNAME).trim(),String(r.OPRID).trim()),description:`${String(r.OPRID).trim()?'Private':'Public'} · ${String(r.DESCR).trim()}`}));
    });
  }

  async prepareQuery(view: QueryView, operatorId: string): Promise<QuerySqlPlan> {
    if (this.platform !== 'oracle') throw new ProviderError('PS Query execution is currently calibrated on Oracle.');
    return this.withConnection(c => prepareQueryExecution(c,view,operatorId));
  }

  /** Generates SQL on the host, checks Query access, validates prompts, and always rolls back. */
  async runQuery(view: QueryView, operatorId: string, values: Record<string,string>, maxRows = 500): Promise<{
    sql: string; rows: Array<Record<string,unknown>>; truncated: boolean; maxRows: number; ms: number;
  }> {
    if (this.platform !== 'oracle') throw new ProviderError('PS Query execution is currently calibrated on Oracle.');
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000) throw new ProviderError('Query row limit must be between 1 and 10000.');
    return this.withConnection(async c => {
      const started = Date.now();
      try {
        await c.execute('SET TRANSACTION READ ONLY');
        const plan = await prepareQueryExecution(c,view,operatorId);
        const binds = await validateQueryPromptValues(c,plan,operatorId,values);
        const rows = (await c.execute<Record<string,unknown>>(plan.sql,binds,{outFormat:this.types.OUT_FORMAT_OBJECT,maxRows:maxRows+1})).rows ?? [];
        return {sql:plan.sql,rows:rows.slice(0,maxRows),truncated:rows.length>maxRows,maxRows,ms:Date.now()-started};
      } finally { await c.rollback(); }
    });
  }

  async runReadOnlyQuery(text: string, maxRows = 500): Promise<{ sql: string; rows: Array<Record<string, unknown>>; truncated: boolean; ms: number }> {
    const types = this.types;
    return this.withConnection(async (c) => {
      const tables = new Map<string, string>();
      for (const m of maskSql(text).matchAll(/%table\s*\(\s*([A-Za-z0-9_#$@]+)\s*\)/gi)) {
        const rec = m[1].toUpperCase();
        if (tables.has(rec)) continue;
        const r = await c.execute<{ T: string }>('SELECT SQLTABLENAME AS T FROM PSRECDEFN WHERE RECNAME = :r', { r: rec });
        if (!r.rows?.length) throw new ProviderError(`%Table(${rec}): there is no record ${rec}.`);
        tables.set(rec, tableName({ name: rec, sqlTableName: String(r.rows[0].T ?? ' ') }));
      }
      const prepared = prepareReadOnlyQuery(text, (rec) => tables.get(rec) ?? `PS_${rec}`);
      if (!prepared.ok) throw new ProviderError(prepared.reason);
      const started = Date.now();
      try {
        let rows: Array<Record<string, unknown>>;
        if (this.platform === 'oracle') {
          await c.execute('SET TRANSACTION READ ONLY');
          rows = (await c.execute<Record<string, unknown>>(prepared.sql, {}, {
            outFormat: types.OUT_FORMAT_OBJECT, maxRows: maxRows + 1,
            fetchTypeHandler: (meta: { dbType?: unknown }) =>
              meta.dbType === types.DB_TYPE_CLOB || meta.dbType === types.DB_TYPE_NCLOB ? { type: types.STRING } : undefined
          })).rows ?? [];
        } else {
          rows = (await c.execute<Record<string, unknown>>(`SELECT * FROM (${prepared.sql}) Q FETCH FIRST ${maxRows + 1} ROWS ONLY`)).rows ?? [];
        }
        return { sql: prepared.sql, rows: rows.slice(0, maxRows), truncated: rows.length > maxRows, ms: Date.now() - started };
      } finally {
        await c.rollback().catch(() => { /* the connection closes either way */ });
      }
    });
  }

  /**
   * The PeopleCode programs whose stored source (PSPCMTXT) contains a text, case-insensitively: one
   * query over every program's source, not a scan of decoded programs. PSPCMTXT splits a program only
   * after a line feed, so a symbol never spans two rows. Keys the editor can open, in key order, at
   * most `limit`; programs whose key is not a PeopleCode type Studio opens are left out.
   */
  async findPeopleCodeContaining(text: string, limit = 200): Promise<{ keys: DefinitionKey[]; truncated: boolean }> {
    const needle = text.trim();
    if (!needle) return { keys: [], truncated: false };
    const pattern = `%${needle.toUpperCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.withConnection(async (c) => {
      const cols = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ');
      const r = await c.execute<Record<string, string | number>>(
        `SELECT DISTINCT ${cols} FROM PSPCMTXT WHERE UPPER(PCTEXT) LIKE :p ESCAPE '\\'
          ORDER BY OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE4, OBJECTVALUE5, OBJECTVALUE6, OBJECTVALUE7
          FETCH FIRST :lim ROWS ONLY`, { p: pattern, lim: limit + 1 });
      const t = (v: string | number | null | undefined) => String(v ?? '').trim();
      const keys: DefinitionKey[] = [];
      const rows = r.rows ?? [];
      for (const row of rows.slice(0, limit)) {
        const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => Number(row[`OBJECTID${n}`]));
        const vals = [1, 2, 3, 4, 5, 6, 7].map((n) => t(row[`OBJECTVALUE${n}`])).filter((_, i) => ids[i] !== 0);
        const type = peopleCodeTypeOf(ids.filter((id) => id !== 0));
        if (type !== undefined) keys.push(makeKey(type, ...peopleCodeKeyFromValues(type, vals)));
      }
      return { keys, truncated: rows.length > limit };
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
          { fetchInfo: { SQLTEXT: { type: this.types.STRING } } });
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
