import { FieldType, RecordType } from './record.js';
import {
  columnType, createColumnOrder, createViewLines, ddlIndexes, metadataIndexLines, metadataTableLines, modelIndexLines, modelTableLines, notNull, tableName,
  resolveViewMetaSql, VIEW_SCRIPT_HEADER, wrapLine, type DdlField, type DdlIndex, type DdlModel, type DdlRecord, type ViewMetaContext
} from './recordDdl.js';
import { scriptStatements, type BuildPlan } from './recordBuild.js';

/*
 * App Designer's Build > Create Indexes, Create Views and Alter Tables on
 * Oracle, from its own scripts for ZZ_PCODE_LAB_R1, BA_CD_TBL and
 * ZZ_DSTNCT_DEPT on HRDMO 8.62.09 (2026-10-19, docs/RECORD_SAVE.md "Build:
 * indexes, views and Alter"). An existing table's and index's physical
 * clauses come from the database (DBMS_METADATA.GET_DDL), as App Designer
 * takes them; a new index comes from the DDL model, as Create Tables writes it.
 *
 * What was not captured is refused with the reason, never guessed: other
 * platforms, column type changes, a narrowed number holding data, a new
 * required Date/Time/DateTime/Long/Image column, a column made NOT NULL other
 * than a DateTime, LOB storage of a column that stays and partition clauses on
 * the existing table, a custom SQL table name, Alter even if no changes, and
 * views whose meta-SQL resolution was not captured (all but %CurrentDateIn,
 * %Substring and %EffdtCheck).
 */

export interface DbColumn {
  name: string;
  /** ALL_TAB_COLUMNS.DATA_TYPE: VARCHAR2, NUMBER, DATE, TIMESTAMP(6), CLOB, BLOB ... */
  dataType: string;
  charLength: number;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
}

export interface DbIndex {
  name: string;
  unique: boolean;
  columns: string[];
  /** DBMS_METADATA.GET_DDL('INDEX', name). */
  ddl: string;
}

/** What the database holds for a record's table. */
export interface DbTableFacts {
  exists: boolean;
  hasRows: boolean;
  columns: DbColumn[];
  /** DBMS_METADATA.GET_DDL('TABLE', name). */
  ddl?: string;
  indexes: DbIndex[];
}

export type IndexOption = 'recreate' | 'ifModified';
export type ViewOption = 'recreate' | 'skip';

export interface AlterSettings {
  tableOption: 'inPlace' | 'rename';
  dropColumn: 'drop' | 'skip';
  changeLength: 'truncate' | 'skip';
  adds: boolean;
  changes: boolean;
  renames: boolean;
  deletes: boolean;
  evenIfNoChanges: boolean;
}

const none = (notes: string[]): BuildPlan => ({ script: '', statements: [], notes });
const finish = (lines: string[], notes: string[], extra: Partial<BuildPlan> = {}): BuildPlan => {
  const script = lines.length ? lines.join('\n') + '\n' : '';
  return { script, statements: script ? scriptStatements(script) : [], notes, ...extra };
};
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x.toUpperCase() === b[i].toUpperCase());

function oracleOnly(model: DdlModel, what: string): string | undefined {
  return (model.platform ?? 'oracle') === 'oracle' ? undefined : `${what} is built from App Designer's Oracle scripts only; ${model.platform} has not been captured.`;
}

/**
 * The index work Create Indexes does on an existing table: every index
 * re-created first dropped, in order; then each re-created one from its
 * database DDL and each missing one from the DDL model. An unchanged index
 * is left alone under "Recreate index only if modified".
 */
function indexWork(r: DdlRecord, model: DdlModel, facts: DbTableFacts, recreateAll: boolean): string[] {
  const table = tableName(r);
  const drops: string[] = [];
  const creates: string[] = [];
  for (const x of ddlIndexes(r, model)) {
    const db = facts.indexes.find((i) => i.name.toUpperCase() === x.name.toUpperCase());
    if (db && (recreateAll || db.unique !== x.unique || !same(db.columns, x.columns))) {
      drops.push(`DROP INDEX ${x.name}`, '/');
      creates.push(...metadataIndexLines(table, x, model, db.ddl));
    } else if (!db) {
      creates.push(...modelIndexLines(table, x, model));
    }
  }
  return [...drops, ...creates];
}

function triggerNote(r: DdlRecord): string[] {
  return r.optimizationTrigger ? [`${r.name}: its optimization trigger (PSOPTSYNC, OPTTRIGFLAG Y) is not generated here; App Designer adds it after the indexes.`] : [];
}

/** Build > Create Indexes (Oracle). */
export function planCreateIndexes(r: DdlRecord, model: DdlModel, facts: DbTableFacts, option: IndexOption): BuildPlan {
  const refused = oracleOnly(model, 'Create Indexes');
  if (refused) return none([refused]);
  if (!facts.exists) return none([`${tableName(r)} does not exist: Create Tables builds it with its indexes.`]);
  const lines = indexWork(r, model, facts, option === 'recreate');
  return finish(lines, lines.length ? [] : [`${r.name}: every index is unchanged (Build Settings: Recreate index only if modified).`]);
}

/**
 * Build > Create Views (Oracle): the view, dropped first when it exists, under
 * App Designer's view-script header. Meta-SQL is resolved where App Designer's
 * resolution was captured (resolveViewMetaSql); `context` holds the records
 * and SQL definitions it names (DatabaseProvider.readViewMetaContext). The
 * column list is the record's fields with subrecords expanded (capture V10).
 */
export function planCreateViews(r: DdlRecord, sql: string, viewExists: boolean, option: ViewOption, model: DdlModel,
  context: ViewMetaContext = { records: new Map() }, columns: readonly string[] = r.fields.map((f) => f.name)): BuildPlan {
  const refused = oracleOnly(model, 'Create Views');
  if (refused) return none([refused]);
  if (r.recordType !== RecordType.View) return none([`${r.name} is not an SQL View.`]);
  if (!sql.trim()) return none([`${r.name} has no view SQL.`]);
  const resolved = resolveViewMetaSql(sql, context);
  if ('unsupported' in resolved) {
    return none([`${r.name}: its SQL uses meta-SQL (${resolved.unsupported.join(', ')}) whose resolution by App Designer has not been captured, or names a definition that was not found.`]);
  }
  const view = tableName(r);
  if (viewExists && option === 'skip') return none([`${view} exists: skipped (Build Settings: Skip view if it already exists).`]);
  return finish([...VIEW_SCRIPT_HEADER, ...(viewExists ? [`DROP VIEW ${view}`, '/'] : []), ...createViewLines(view, columns, resolved.sql)], []);
}

type Family = 'char' | 'number' | 'date' | 'timestamp' | 'clob' | 'blob';

function expectedFamily(f: DdlField): Family {
  const t = columnType(f);
  if (/^v?[vV]ARCHAR2/.test(t)) return 'char';
  if (t === 'DATE') return 'date';
  if (/^t?[tT]IMESTAMP/.test(t)) return 'timestamp';
  if (t === 'CLOB' || t === 'BLOB') return t.toLowerCase() as Family;
  return 'number';
}

function dbFamily(c: DbColumn): Family | undefined {
  const t = c.dataType.toUpperCase();
  if (t === 'VARCHAR2' || t === 'CHAR' || t === 'NVARCHAR2') return 'char';
  if (t === 'NUMBER' || t === 'FLOAT' || t === 'INTEGER') return 'number';
  if (t === 'DATE') return 'date';
  if (t.startsWith('TIMESTAMP')) return 'timestamp';
  if (t === 'CLOB' || t === 'NCLOB') return 'clob';
  if (t === 'BLOB') return 'blob';
  return undefined;
}

/** NUMBER's precision and scale for a field's column: undefined for SMALLINT/INTEGER (stored as NUMBER with scale 0 and no precision). */
function numberShape(f: DdlField): { precision: number; scale: number } | undefined {
  const m = /^DECIMAL\((\d+)(?:, (\d+))?\)$/.exec(columnType(f));
  return m ? { precision: Number(m[1]), scale: Number(m[2] ?? 0) } : undefined;
}

/** The literal Alter fills a new NOT NULL column with: ' ' for character and image reference, 0 for numbers (captures A1-A3). */
function newColumnDefault(f: DdlField): string | undefined {
  if (f.type === FieldType.Character || f.type === FieldType.ImageReference) return "' '";
  if (f.type === FieldType.Number || f.type === FieldType.SignedNumber) return '0';
  return undefined;
}

/** Build > Alter Tables (Oracle). */
export function planAlterTable(r: DdlRecord, model: DdlModel, facts: DbTableFacts, settings: AlterSettings): BuildPlan {
  const refused = oracleOnly(model, 'Alter Tables');
  if (refused) return none([refused]);
  if (r.recordType !== RecordType.Table) return none([`${r.name} is not an SQL Table.`]);
  const table = tableName(r);
  if (!facts.exists) return none([`${table} does not exist: Create Tables builds it.`]);
  if (r.sqlTableName.trim()) return none([`${r.name} has its own SQL table name; App Designer's temporary table for it has not been captured.`]);
  const skip = (why: string) => none([`${r.name} not altered: ${why}`]);
  const refuse = (why: string) => none([`${r.name}: ${why} This has not been captured from App Designer, so it is not built here.`]);

  const db = new Map(facts.columns.map((c) => [c.name.toUpperCase(), c]));
  const adds = r.fields.filter((f) => !db.has(f.name.toUpperCase()));
  const defined = new Set(r.fields.map((f) => f.name.toUpperCase()));
  const deletes = facts.columns.filter((c) => !defined.has(c.name.toUpperCase()));
  const notNullNow: DdlField[] = [];
  let changed = false;
  for (const f of r.fields) {
    const c = db.get(f.name.toUpperCase());
    if (!c) continue;
    const family = expectedFamily(f);
    if (dbFamily(c) !== family) return refuse(`${f.name} changes type (${c.dataType} to ${columnType(f)}).`);
    if (family === 'clob' || family === 'blob') {
      if (c.nullable === notNull(f)) return refuse(`${f.name}, a LOB column, changes nullability.`);
      continue;
    }
    if (family === 'char' && c.charLength !== f.length) {
      changed = true;
      if (f.length < c.charLength && facts.hasRows && settings.changeLength === 'skip') {
        return skip(`${f.name} is shortened from ${c.charLength} to ${f.length} and ${table} holds data that may not fit (Build Settings: Skip record if field too short).`);
      }
    }
    if (family === 'number') {
      const want = numberShape(f);
      const have = c.precision === null ? undefined : { precision: c.precision, scale: c.scale ?? 0 };
      if (JSON.stringify(want) !== JSON.stringify(have)) {
        changed = true;
        if (facts.hasRows && (!want || !have || want.precision - want.scale < have.precision - have.scale || want.scale < have.scale)) {
          return refuse(`${f.name}'s number column narrows while ${table} holds data.`);
        }
      }
    }
    if (notNull(f) !== !c.nullable) {
      changed = true;
      if (notNull(f)) {
        if (f.type !== FieldType.DateTime) return refuse(`${f.name} becomes NOT NULL (only a DateTime's SYSDATE fill was captured).`);
        notNullNow.push(f);
      }
    }
  }
  for (const f of adds) if (notNull(f) && newColumnDefault(f) === undefined) return refuse(`${f.name}, a new required ${columnType(f)} column, needs a fill value.`);
  if (adds.length && !settings.adds) return skip('it has new columns and Build Settings, Alter Any, leaves Adds out.');
  if (changed && !settings.changes) return skip('columns change and Build Settings, Alter Any, leaves Changes out.');
  if (deletes.length) {
    if (!settings.deletes) return skip('columns are deleted and Build Settings, Alter Any, leaves Deletes out.');
    if (facts.hasRows && settings.dropColumn === 'skip') {
      return skip(`${deletes.map((c) => c.name).join(', ')} would be dropped and ${table} holds data (Build Settings: Skip record if data present).`);
    }
  }
  const columnsChange = adds.length > 0 || deletes.length > 0 || changed;
  if (!columnsChange) {
    if (settings.evenIfNoChanges) return refuse('"Alter even if no changes" rebuilds an unchanged table.');
    const lines = indexWork(r, model, facts, false);
    return finish(lines, [...(lines.length ? [] : [`${r.name}: the table and its indexes match the definition.`]), ...triggerNote(r)]);
  }

  // Alter in place: App Designer's choice only when every change is an add (A3); otherwise table rename (A4).
  if (settings.tableOption === 'inPlace' && deletes.length === 0 && !changed) {
    const lines: string[] = [];
    for (const f of adds) lines.push(...wrapLine(`ALTER TABLE ${table} ADD ${f.name} ${columnType(f).replace(/^tIMESTAMP$/, 'TIMESTAMP')}`), '/');
    const required = adds.filter((f) => notNull(f));
    if (required.length) {
      lines.push(...wrapLine(`UPDATE ${table} SET ${required.map((f) => `${f.name} = ${newColumnDefault(f)}`).join(', ')}`), '/');
      for (const f of required) lines.push(`ALTER TABLE ${table} MODIFY ${f.name} NOT NULL`, '/');
    }
    lines.push(...indexWork(r, model, facts, false));
    return finish(lines, triggerNote(r));
  }

  const ddl = facts.ddl ?? '';
  if (!ddl) return refuse(`the database gave no DDL for ${table}.`);
  if (/\bPARTITION\b/i.test(ddl)) return refuse(`${table}'s DDL has partition clauses.`);
  // LOB storage: App Designer falls back to the DDL model when a deleted column had it (A5); a kept LOB's storage was not captured.
  const lobs = [...ddl.matchAll(/\bLOB\s*\("([^"]+)"\)/gi)].map((m) => m[1].toUpperCase());
  if (lobs.some((n) => defined.has(n))) return refuse(`${table} has LOB storage for a column the record keeps.`);
  const notes = triggerNote(r);
  if (lobs.length) notes.unshift(`${r.name}: one or more deleted fields had LOB storage parameters; Alter by Table Rename resets the table's storage to the DDL model defaults (as App Designer warns).`);
  const temporary = `PSY${r.name}`;
  const lines: string[] = [];
  for (const f of notNullNow) lines.push(`UPDATE ${table} SET ${f.name} = SYSDATE`, `   WHERE ${f.name} IS NULL`, '/');
  lines.push(...(lobs.length ? modelTableLines(r, model, temporary) : metadataTableLines(r, temporary, ddl)));
  const copied = createColumnOrder(r).filter((f) => db.has(f.name.toUpperCase()) || notNull(f));
  // A shortened character column is copied cut to its new length (A5).
  const value = (f: DdlField) => {
    const c = db.get(f.name.toUpperCase());
    if (!c) return newColumnDefault(f)!;
    return expectedFamily(f) === 'char' && f.length < c.charLength ? `SUBSTR(${f.name}, 1, ${f.length})` : f.name;
  };
  const values = copied.map(value);
  const list = (items: string[], last: string) => items.map((x, i) => `${i === 0 ? '        ' : '    '}${x}${i === items.length - 1 ? last : ','}`);
  lines.push(`INSERT INTO ${temporary} (`, ...list(copied.map((f) => f.name), ')'), '  SELECT', ...list(values, ''), `  FROM ${table}`, '/');
  lines.push(`DROP TABLE ${table}`, '/', `RENAME ${temporary} TO ${table}`, '/');
  for (const x of ddlIndexes(r, model)) {
    const old = facts.indexes.find((i) => i.name.toUpperCase() === x.name.toUpperCase());
    lines.push(...(old ? metadataIndexLines(table, x, model, old.ddl) : modelIndexLines(table, x, model)));
  }
  const lost = facts.hasRows && deletes.length ? `${deletes.map((c) => c.name).join(', ')} and the data in ${deletes.length === 1 ? 'it' : 'them'}` : undefined;
  return finish(lines, notes, { drops: lost ? `${table}'s column${deletes.length === 1 ? '' : 's'} ${lost}` : undefined });
}

/** Several records' plans as one script (Build Project): App Designer's view header once, at the top. */
export function combineBuildPlans(plans: readonly BuildPlan[]): BuildPlan {
  const header = VIEW_SCRIPT_HEADER.join('\n') + '\n';
  const scripts = plans.map((p) => p.script).filter(Boolean);
  const viewed = scripts.some((x) => x.startsWith(header));
  const script = scripts.length ? (viewed ? header : '') + scripts.map((x) => (x.startsWith(header) ? x.slice(header.length) : x)).join('') : '';
  const drops = plans.map((p) => p.drops).filter(Boolean);
  return { script, statements: script ? scriptStatements(script) : [], notes: plans.flatMap((p) => p.notes), ...(drops.length ? { drops: drops.join('; ') } : {}) };
}

/** Whether an index the record defines differs from the database's (for display). */
export function indexDiffers(x: DdlIndex, db: DbIndex | undefined): boolean {
  return !db || db.unique !== x.unique || !same(db.columns, x.columns);
}
