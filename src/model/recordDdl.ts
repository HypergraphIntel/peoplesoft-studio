import { FieldType, hasFlag, RecordType, UseEdit } from './record.js';

/*
 * App Designer's Build > Create Tables script for Oracle: generated, never
 * run. The statements are the DDL model's (PSDDLMODEL, platform 2) with the
 * record's parameters (PSRECDDLPARM / PSIDXDDLPARM) over the model defaults
 * (PSDDLDEFPARMS), laid out as App Designer writes them -- checked against
 * its script for ZZ_PCODE_LAB_R1 (docs/RECORD_SAVE.md, Build Script):
 *
 *   - the first column follows "CREATE TABLE <name> (", the others start a
 *     line indented three spaces;
 *   - a line is at most 70 characters: a word that would pass that starts
 *     the next line, after one space;
 *   - each statement ends with a line "/";
 *   - App Designer writes "iNDEX" in CREATE INDEX, and marks two column
 *     types by a lowercase first letter: "tIMESTAMP" for DateTime (Time is
 *     "TIMESTAMP") and "vARCHAR2" for Long Character (R1, R6);
 *   - CLOB and BLOB columns come last, in field order (R6);
 *   - an index built PARALLEL NOLOGGING is followed by ALTER INDEX ...
 *     NOPARALLEL LOGGING;
 *   - no DESC: none of HRDMO's 172,848 index columns is descending, though
 *     6,272 key fields are.
 *
 * Column types (Oracle, a CHAR-semantics database: VARCHAR2(n) is n
 * characters), from HRDMO's built tables and App Designer's scripts for R1
 * and R6:
 *
 *   Character, Image Reference   VARCHAR2(LENGTH) NOT NULL
 *   Long Character               vARCHAR2(LENGTH) up to 1,333, else CLOB;
 *                                BLOB when its format is Raw Binary (7)
 *   Number, no decimals          SMALLINT up to 4 digits, INTEGER up to 9,
 *                                else DECIMAL(LENGTH)
 *   Signed Number, no decimals   SMALLINT up to 5 positions, INTEGER up to 11,
 *                                else DECIMAL(LENGTH-1)
 *   Number / Signed, decimals    DECIMAL(LENGTH-1, DEC) / DECIMAL(LENGTH-2, DEC)
 *                                (the point, and the sign, count in LENGTH)
 *   Date                         DATE
 *   Time                         TIMESTAMP
 *   DateTime                     tIMESTAMP
 *   Image                        BLOB
 *
 *   NOT NULL: always for Character, Image Reference and numbers -- but not a
 *   number with Auto-Update (a System ID field: R6's N4 in App Designer's
 *   script); for Long, Date, Time and DateTime exactly when the field is
 *   Required.
 *
 * Each alternate search key adds an index PS<n><RECORD> (n = its INDEXID,
 * 0, 1, ...): the alternate field then the record's keys, not unique, written
 * "INDEX" (not "iNDEX"), with its own ALTER INDEX (App Designer's R6 script).
 */

export interface DdlField {
  name: string;
  type: FieldType;
  length: number;
  decimalPositions: number;
  format?: number;
  useEdit: number;
}

/**
 * The platform a script is written for, as PSDDLMODEL's PLATFORMID names it:
 * 2 Oracle, 7 Microsoft SQL Server, 4 DB2 LUW, 1 DB2 z/OS.
 *
 * Oracle's scripts are App Designer's own, checked byte for byte. The others
 * follow PeopleTools' platform type mapping (PeopleBooks, Application
 * Designer: field definitions -- SQL Server Character NVARCHAR(n), Long
 * Character NVARCHAR(MAX), Image VARBINARY(MAX); DB2 Unicode VARGRAPHIC /
 * DBCLOB) and HRDMO's PSDDLMODEL statements for the platform; no App Designer
 * script for them has been captured, so their layout (terminators, where
 * lines break) is this module's, not App Designer's.
 */
export type DdlPlatform = 'oracle' | 'mssql' | 'db2' | 'db2zos';

export const DDL_PLATFORM_IDS: Readonly<Record<DdlPlatform, number>> = { oracle: 2, mssql: 7, db2: 4, db2zos: 1 };

export function ddlPlatformFor(id: number): DdlPlatform {
  return id === 7 ? 'mssql' : id === 4 ? 'db2' : id === 1 ? 'db2zos' : 'oracle';
}

/** The DDL model statements and parameters a build fills in. */
export interface DdlModel {
  /** The platform the model is for; absent: Oracle. */
  platform?: DdlPlatform;
  /** PSRECTBLSPC.DBNAME: the database a DB2 z/OS table space is in. */
  dbName?: string;
  /** PSDDLMODEL STATEMENT_TYPE 1: Create Table. */
  table: string;
  /** PSDDLMODEL STATEMENT_TYPE 2: Create Index. */
  index: string;
  /** **PARM** values for the table: the record's own over the defaults. */
  tableParms: Readonly<Record<string, string>>;
  /** **PARM** values for the key index: the index's own over the defaults. */
  indexParms: Readonly<Record<string, string>>;
  /** **PARM** values for alternate search key indexes, by INDEXID, where they have their own (else indexParms' defaults). */
  altIndexParms?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The index defaults alone, for alternate indexes without parameters of their own. */
  indexDefaults?: Readonly<Record<string, string>>;
}

export interface DdlRecord {
  name: string;
  recordType: RecordType;
  /** PSRECDEFN.SQLTABLENAME; blank for the default PS_<RECORD>. */
  sqlTableName: string;
  /** PSRECTBLSPC.DDLSPACENAME. */
  tablespace?: string;
  fields: DdlField[];
}

/** App Designer's widest script line. */
export const SCRIPT_WIDTH = 70;

export function tableName(r: { name: string; sqlTableName: string }): string {
  return r.sqlTableName.trim() || `PS_${r.name}`;
}

/** 'CLOB' or 'BLOB' for a field whose column is one, else undefined (and for a field of unknown type). */
export function lobColumn(f: { type?: FieldType; length?: number; format?: number }): 'CLOB' | 'BLOB' | undefined {
  if (f.type === undefined) return undefined;
  if (f.type !== FieldType.LongCharacter && f.type !== FieldType.Image) return undefined;
  const t = columnType({ name: '', type: f.type, length: f.length ?? 0, decimalPositions: 0, format: f.format, useEdit: 0 });
  return t === 'CLOB' || t === 'BLOB' ? t : undefined;
}

export function columnType(f: DdlField, platform: DdlPlatform = 'oracle'): string {
  if (platform !== 'oracle') return otherColumnType(f, platform);
  switch (f.type) {
    case FieldType.Character:
    case FieldType.ImageReference:
      return `VARCHAR2(${f.length})`;
    case FieldType.LongCharacter:
      if (f.format === 7) return 'BLOB';
      return f.length > 0 && f.length <= 1333 ? `vARCHAR2(${f.length})` : 'CLOB';
    case FieldType.Number:
      if (f.decimalPositions > 0) return `DECIMAL(${f.length - 1}, ${f.decimalPositions})`;
      return f.length <= 4 ? 'SMALLINT' : f.length <= 9 ? 'INTEGER' : `DECIMAL(${f.length})`;
    case FieldType.SignedNumber:
      if (f.decimalPositions > 0) return `DECIMAL(${f.length - 2}, ${f.decimalPositions})`;
      return f.length <= 5 ? 'SMALLINT' : f.length <= 11 ? 'INTEGER' : `DECIMAL(${f.length - 1})`;
    case FieldType.Date:
      return 'DATE';
    case FieldType.Time:
      return 'TIMESTAMP';
    case FieldType.DateTime:
      return 'tIMESTAMP';
    case FieldType.Image:
      return 'BLOB';
    default:
      throw new Error(`Field type ${f.type} has no column rule.`);
  }
}

/** Integer and decimal columns are the same on every platform. */
function numberType(f: DdlField): string {
  if (f.type === FieldType.Number) {
    if (f.decimalPositions > 0) return `DECIMAL(${f.length - 1}, ${f.decimalPositions})`;
    return f.length <= 4 ? 'SMALLINT' : f.length <= 9 ? 'INTEGER' : `DECIMAL(${f.length})`;
  }
  if (f.decimalPositions > 0) return `DECIMAL(${f.length - 2}, ${f.decimalPositions})`;
  return f.length <= 5 ? 'SMALLINT' : f.length <= 11 ? 'INTEGER' : `DECIMAL(${f.length - 1})`;
}

function otherColumnType(f: DdlField, platform: Exclude<DdlPlatform, 'oracle'>): string {
  const ms = platform === 'mssql';
  const zos = platform === 'db2zos';
  switch (f.type) {
    case FieldType.Character:
    case FieldType.ImageReference:
      return ms ? `NVARCHAR(${f.length})` : zos ? `VARCHAR(${f.length})` : `VARGRAPHIC(${f.length})`;
    case FieldType.LongCharacter:
      if (f.format === 7) return ms ? 'VARBINARY(MAX)' : 'BLOB(100M)';
      return ms ? 'NVARCHAR(MAX)' : zos ? 'CLOB(100M)' : 'DBCLOB(100M)';
    case FieldType.Number:
    case FieldType.SignedNumber:
      return numberType(f);
    case FieldType.Date:
      return 'DATE';
    case FieldType.Time:
      return ms ? 'DATETIME' : 'TIME';
    case FieldType.DateTime:
      return ms ? 'DATETIME' : 'TIMESTAMP';
    case FieldType.Image:
      return ms ? 'VARBINARY(MAX)' : 'BLOB(100M)';
    default:
      throw new Error(`Field type ${f.type} has no column rule.`);
  }
}

/** Whether a column is a LOB on its platform (listed last in a Create Table, as App Designer does on Oracle). */
function isLob(type: string): boolean {
  return /^(CLOB|BLOB|DBCLOB|NVARCHAR\(MAX\)|VARBINARY\(MAX\))/.test(type);
}

export function notNull(f: DdlField): boolean {
  switch (f.type) {
    case FieldType.LongCharacter:
    case FieldType.Date:
    case FieldType.Time:
    case FieldType.DateTime:
    case FieldType.Image:
      return hasFlag(f.useEdit, UseEdit.Required);
    case FieldType.Number:
    case FieldType.SignedNumber:
      return !hasFlag(f.useEdit, UseEdit.AutoUpdate);
    default:
      return true;
  }
}

/** One logical line cut as App Designer cuts it: at most SCRIPT_WIDTH, a moved word keeping its leading space. */
export function wrapLine(line: string, width = SCRIPT_WIDTH): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > width) {
    const cut = rest.lastIndexOf(' ', width);
    if (cut <= 0) break;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

/** A model statement with [TOKEN]s and **PARM**s filled in; its ";" becomes the script's "/" line. */
function fill(model: string, tokens: Readonly<Record<string, string>>, parms: Readonly<Record<string, string>>): string {
  return model.trim().replace(/;$/, '')
    .replace(/\[([A-Z]+)\]/g, (m, t: string) => tokens[t] ?? m)
    .replace(/\*\*([A-Z]+)\*\*/g, (m, p: string) => (p in parms ? parms[p].trim() : m));
}

/**
 * A statement's lines and its end: Oracle's "/" line (App Designer's); "go"
 * for SQL Server (sqlcmd and SSMS); ";" ending the last line for DB2's CLP.
 */
function statementFor(platform: DdlPlatform) {
  return (text: string): string[] => {
    if (platform === 'oracle') return [...text.split('\n').flatMap((l) => wrapLine(l)), '/'];
    // Empty [TOKEN]s leave runs of blanks: one is enough.
    const lines = text.split('\n').map((l) => l.replace(/(\S) {2,}/g, '$1 ').trimEnd()).flatMap((l) => wrapLine(l));
    if (platform === 'mssql') return [...lines, 'go'];
    lines[lines.length - 1] += ';';
    return lines;
  };
}

/** The Create Table script, or the reason there is none. */
export function createTableScript(r: DdlRecord, model: DdlModel): string {
  if (r.recordType !== RecordType.Table) {
    throw new Error(`${r.name} is not an SQL Table: only SQL Tables have a Create Table script here.`);
  }
  if (r.fields.length === 0) throw new Error(`${r.name} has no fields.`);
  const platform = model.platform ?? 'oracle';
  const statement = statementFor(platform);
  const table = tableName(r);
  const lob = (f: DdlField) => isLob(columnType(f, platform));
  const columns = [...r.fields.filter((f) => !lob(f)), ...r.fields.filter(lob)]
    .map((f) => `${f.name} ${columnType(f, platform)}${notNull(f) ? ' NOT NULL' : ''}`).join(',\n   ');
  const tokens: Record<string, string> = {
    TBNAME: table, TBCOLLIST: columns, TBSPCNAME: r.tablespace ?? '',
    // DB2: no VOLATILE marking and no separate LOB table space unless a record names them.
    VOLATILE: '', DBXLOBTBSPCNAME: '', DBNAME: model.dbName ?? ''
  };
  let tableStatement = fill(model.table, tokens, model.tableParms);
  // DB2 LUW without a table space of its own: the database's default, and indexes with the table.
  if (platform === 'db2' && !r.tablespace) tableStatement = tableStatement.replace(/\s+IN\s+INDEX IN\s+IDX\s*/, ' ');
  const out = statement(tableStatement);

  const keys = r.fields.filter((f) => hasFlag(f.useEdit, UseEdit.Key) || hasFlag(f.useEdit, UseEdit.DuplicateOrderKey));
  if (keys.length > 0) {
    const unique = !keys.some((k) => hasFlag(k.useEdit, UseEdit.DuplicateOrderKey));
    const index = fill(model.index,
      { UNIQUE: unique ? 'UNIQUE' : '', CLUSTER: platform === 'mssql' ? 'CLUSTERED' : '', IDXNAME: table, TBNAME: table, IDXCOLLIST: keys.map((k) => k.name).join(',\n   ') },
      model.indexParms).replace(/ INDEX /, platform === 'oracle' ? ' iNDEX ' : ' INDEX ');
    out.push(...statement(index));
    if (/\bPARALLEL NOLOGGING\b/.test(index)) out.push(...statement(`ALTER INDEX ${table} NOPARALLEL LOGGING`));
  }
  const keyFields = r.fields.filter((f) => hasFlag(f.useEdit, UseEdit.Key));
  for (const [i, alt] of r.fields.filter((f) => hasFlag(f.useEdit, UseEdit.AltSearchKey)).entries()) {
    const name = `PS${i}${r.name}`;
    const parms = model.altIndexParms?.[String(i)] ?? model.indexDefaults ?? model.indexParms;
    const index = fill(model.index,
      { UNIQUE: '', CLUSTER: '', IDXNAME: name, TBNAME: table, IDXCOLLIST: [alt, ...keyFields].map((k) => k.name).join(',\n   ') }, parms);
    out.push(...statement(index));
    if (/\bPARALLEL NOLOGGING\b/.test(index)) out.push(...statement(`ALTER INDEX ${name} NOPARALLEL LOGGING`));
  }
  return out.join('\n') + '\n';
}
