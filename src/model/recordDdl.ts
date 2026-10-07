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
 *   NOT NULL: always for Character, Image Reference and numbers; for Long,
 *   Date, Time and DateTime exactly when the field is Required.
 */

export interface DdlField {
  name: string;
  type: FieldType;
  length: number;
  decimalPositions: number;
  format?: number;
  useEdit: number;
}

/** The DDL model statements and parameters a build fills in. */
export interface DdlModel {
  /** PSDDLMODEL STATEMENT_TYPE 1: Create Table. */
  table: string;
  /** PSDDLMODEL STATEMENT_TYPE 2: Create Index. */
  index: string;
  /** **PARM** values for the table: the record's own over the defaults. */
  tableParms: Readonly<Record<string, string>>;
  /** **PARM** values for the key index: the index's own over the defaults. */
  indexParms: Readonly<Record<string, string>>;
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

export function columnType(f: DdlField): string {
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

export function notNull(f: DdlField): boolean {
  switch (f.type) {
    case FieldType.LongCharacter:
    case FieldType.Date:
    case FieldType.Time:
    case FieldType.DateTime:
    case FieldType.Image:
      return hasFlag(f.useEdit, UseEdit.Required);
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

const statement = (text: string) => [...text.split('\n').flatMap((l) => wrapLine(l)), '/'];

/** The Create Table script, or the reason there is none. */
export function createTableScript(r: DdlRecord, model: DdlModel): string {
  if (r.recordType !== RecordType.Table) {
    throw new Error(`${r.name} is not an SQL Table: only SQL Tables have a Create Table script here.`);
  }
  if (r.fields.length === 0) throw new Error(`${r.name} has no fields.`);
  const table = tableName(r);
  const lob = (f: DdlField) => ['CLOB', 'BLOB'].includes(columnType(f));
  const columns = [...r.fields.filter((f) => !lob(f)), ...r.fields.filter(lob)]
    .map((f) => `${f.name} ${columnType(f)}${notNull(f) ? ' NOT NULL' : ''}`).join(',\n   ');
  const out = statement(fill(model.table, { TBNAME: table, TBCOLLIST: columns, TBSPCNAME: r.tablespace ?? '' }, model.tableParms));

  const keys = r.fields.filter((f) => hasFlag(f.useEdit, UseEdit.Key) || hasFlag(f.useEdit, UseEdit.DuplicateOrderKey));
  if (keys.length > 0) {
    const unique = !keys.some((k) => hasFlag(k.useEdit, UseEdit.DuplicateOrderKey));
    const index = fill(model.index,
      { UNIQUE: unique ? 'UNIQUE' : '', IDXNAME: table, TBNAME: table, IDXCOLLIST: keys.map((k) => k.name).join(',\n   ') },
      model.indexParms).replace(/ INDEX /, ' iNDEX ');
    out.push(...statement(index));
    if (/\bPARALLEL NOLOGGING\b/.test(index)) out.push(...statement(`ALTER INDEX ${table} NOPARALLEL LOGGING`));
  }
  return out.join('\n') + '\n';
}
