import type { Connection, Pool } from 'oracledb';
import {
  DefinitionProvider, DefinitionSummary, ProjectSummary, ProviderCapabilities,
  ProviderError, SearchQuery, UnsupportedOperationError
} from './provider.js';
import { DefinitionKey, DefinitionType, isPeopleCode, makeKey } from '../model/definitions.js';
import {
  FieldType, RecordDefinition, RecordField, RecordType, describeField
} from '../model/record.js';
import { assembleProgram, NameTable } from '../peoplecode/progtext.js';
import { decodeProgram, DecodeOptions } from '../peoplecode/decoder.js';
import {
  ComponentPageRow, ComponentRow, FieldLabelRow, FieldRow, MenuItemRow, MenuRow,
  PageFieldRow, PageRow, renderComponent, renderField, renderMenu, renderPage
} from './oracleRender.js';

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
    DefinitionType.SqlDefinition
  ];

  private pool?: Pool;
  private projectItemKeyWidthCache?: number;

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
             FROM SYSADM.PSPACKAGEDEFN WHERE PACKAGEROOT LIKE :n AND QUALIFYPATH = ' '`,
          DefinitionType.ApplicationPackage, pattern, limit);
      case DefinitionType.SqlDefinition:
        return this.searchSimple(
          `SELECT SQLID AS NAME, '' AS DESCR, LASTUPDDTTM, LASTUPDOPRID
             FROM SYSADM.PSSQLDEFN WHERE SQLID LIKE :n AND SQLTYPE = 0`,
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
    switch (key.type) {
      case DefinitionType.SqlDefinition: return this.readSqlDefinition(key);
      case DefinitionType.HtmlDefinition: return this.readHtmlDefinition(key);
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
      DefinitionType.SqlDefinition, DefinitionType.HtmlDefinition, DefinitionType.Field,
      DefinitionType.Menu, DefinitionType.Page, DefinitionType.Component
    ].includes(type);
  }

  /**
   * HTML definition content, from PSCONTENT.
   *
   * The key's second part is CONTTYPE, not a language/market flag as its
   * PeopleTools name might suggest -- confirmed against
   * OU_OJET_REN_DA_BODY_HTML.4, whose only PSCONTENT row has CONTTYPE 4.
   * CONTDATA is chunked (SEQNUM) and stored UTF-16LE, the same as PeopleCode
   * source and SQL text elsewhere in PeopleTools.
   */
  private async readHtmlDefinition(key: DefinitionKey): Promise<string> {
    const [name, contType] = key.parts;
    return this.withConnection(async (c) => {
      const r = await c.execute<{ CONTDATA: Buffer }>(
        `SELECT CONTDATA FROM SYSADM.PSCONTENT
          WHERE CONTNAME = :n AND CONTTYPE = :t ORDER BY ALTCONTNUM, SEQNUM`,
        { n: name, t: Number(contType) });
      const rows = r.rows ?? [];
      if (rows.length === 0) throw new ProviderError(`No HTML definition named ${name}.${contType}.`);
      return Buffer.concat(rows.map((row) => row.CONTDATA)).toString('utf16le');
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
   * SQL definitions are plain text split across PSSQLTEXTDEFN rows. PeopleTools
   * chunks at 4000 bytes; we match that so App Designer reads back what we wrote.
   */
  private async writeSqlDefinition(key: DefinitionKey, text: string): Promise<void> {
    const CHUNK = 4000;
    const id = key.parts[0];
    await this.withConnection(async (c) => {
      await c.execute(`DELETE FROM SYSADM.PSSQLTEXTDEFN WHERE SQLID = :id AND SQLTYPE = 0`, { id });
      for (let seq = 0, off = 0; off < text.length || seq === 0; seq++, off += CHUNK) {
        await c.execute(
          `INSERT INTO SYSADM.PSSQLTEXTDEFN (SQLID, SQLTYPE, SEQNUM, SQLTEXT)
           VALUES (:id, 0, :seq, :txt)`,
          { id, seq, txt: text.slice(off, off + CHUNK) });
      }
      await bumpVersion(c, 'SQL');
      await c.execute(
          `UPDATE SYSADM.PSSQLDEFN SET LASTUPDDTTM = SYSTIMESTAMP, VERSION =
            (SELECT VERSION FROM SYSADM.PSVERSION WHERE OBJECTTYPENAME = 'SQL')
         WHERE SQLID = :id AND SQLTYPE = 0`, { id });
      await c.commit();
    });
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
        return record.fields.map((f) => ({
          key: makeKey(DefinitionType.Field, f.name),
          description: describeField(f)
        }));
      }
      case DefinitionType.Component: return this.componentPageChildren(key);
      default: return [];
    }
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

/**
 * PeopleTools invalidates application-server caches by comparing a definition's
 * VERSION against the per-type counter in PSVERSION. A definition written
 * without bumping that counter stays invisible to running app servers.
 */
async function bumpVersion(c: Connection, objectTypeName: string): Promise<void> {
  await c.execute(
    `UPDATE SYSADM.PSVERSION SET VERSION = VERSION + 1 WHERE OBJECTTYPENAME IN (:t, 'SYS')`,
    { t: objectTypeName });
  await c.execute(
    `UPDATE SYSADM.PSLOCK SET VERSION = VERSION + 1 WHERE OBJECTTYPENAME IN (:t, 'SYS')`,
    { t: objectTypeName });
}
