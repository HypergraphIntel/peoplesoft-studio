/*
 * SQL checked against the record and field catalogue: do the fields a statement
 * names exist, and do their types match the columns they are written to or
 * compared with.
 *
 * Every rule here was broken by agent-written code on HRDMO and cost a
 * build/run cycle in the lab, because none of it is caught at save time by
 * App Designer either -- the failures are at run time, inside App Engine:
 *
 *   sql-bind-unknown     %Bind(F) / %Select(F) naming a field that is on no
 *                        state record of the program
 *   sql-insert-arity     INSERT column list and SELECT list of different length
 *                        (Oracle: ORA-00947 / ORA-00913)
 *   sql-type-mismatch    a column written from a value of another type family
 *                        (Oracle: ORA-00932, or silent truncation)
 *   sql-select-arity     %Select(...) naming a different number of fields than
 *                        the SELECT returns
 *   sql-call-arity       CreateSQL / SQLExec passing a different number of
 *                        binds than the SQL definition has markers
 *
 * The catalogue is supplied by the caller so this module stays pure: the
 * database provider implements it, and the tests use a literal.
 */

/** PeopleTools field types, by FIELDTYPE on PSDBFIELD. */
export const FIELD_TYPE_NAME = ['char', 'long', 'number', 'signed', 'date', 'time', 'datetime'] as const;

export interface FieldType { type: number; length: number; decimals: number }

export interface SqlCatalog {
  /** The field's definition, or undefined when the catalogue does not know it. */
  field(name: string): FieldType | undefined;
  /** Whether the record exists at all (undefined when the catalogue cannot say). */
  record(name: string): Set<string> | undefined;
}

export interface SqlTypeProblem { code: string; severity: 'error' | 'warning'; message: string }

/*
 * Comparable families. long is char, signed is number: PeopleSoft stores both
 * sides the same way and delivered code mixes them freely, so flagging those
 * would be noise. date / time / datetime stay distinct -- mixing them is the
 * mistake worth catching.
 */
const family = (t: number): number => (t === 1 ? 0 : t === 3 ? 2 : t);

const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/** The select list of a SELECT, split on top-level commas. Undefined when it cannot be read. */
export function selectList(sql: string): string[] | undefined {
  const m = /\bSELECT\b(\s+DISTINCT\b)?/i.exec(sql);
  if (!m) return undefined;
  const rest = sql.slice(m.index + m[0].length);
  const items: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /^\s FROM\s/i.test(` ${rest.slice(i, i + 6)}`) && /^\s/.test(ch)) break;
    if (depth === 0 && /^\sFROM\b/i.test(rest.slice(i))) break;
    if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items.length ? items : undefined;
}

/** The fields named by the leading %Select(...), if there is one. */
export function selectTargets(sql: string): string[] | undefined {
  const m = /^\s*%Select(Init)?\s*\(([^)]*)\)/i.exec(stripComments(sql));
  if (!m) return undefined;
  return m[2].split(',').map((f) => f.trim().replace(/^\w+\./, '').toUpperCase()).filter(Boolean);
}

/** The highest :n marker in a SQL definition's text, i.e. how many binds it takes. */
export function bindMarkerCount(sql: string): number {
  let max = 0;
  for (const m of stripComments(sql).matchAll(/(?<![0-9A-Za-z_]):(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Check one statement. `stateFields` is the union of the fields on the
 * program's state records (empty when the caller has none to offer, which
 * turns the %Bind check off rather than reporting every field as unknown).
 */
export function checkSqlTypes(sql: string, opts: { stateFields?: Set<string>; catalog: SqlCatalog }): SqlTypeProblem[] {
  const problems: SqlTypeProblem[] = [];
  const body = stripComments(sql);
  const add = (code: string, severity: 'error' | 'warning', message: string) => problems.push({ code, severity, message });

  // %Bind / %Select must name a field the program carries.
  if (opts.stateFields?.size) {
    for (const m of body.matchAll(/%(Bind|Select)(?:Init)?\s*\(([^)]*)\)/gi)) {
      for (const raw of m[2].split(',')) {
        const f = raw.trim().replace(/^\w+\./, '').toUpperCase();
        if (!f || f.startsWith('%') || /^:\d+$/.test(f)) continue;
        if (!opts.stateFields.has(f)) {
          add('sql-bind-unknown', 'error', `%${m[1]}(${f}) names a field that is on none of the program's state records.`);
        }
      }
    }
  }

  // INSERT INTO PS_REC (cols) SELECT ...
  const ins = /INSERT\s+INTO\s+PS_(\w+)\s*\(([^)]*)\)\s*(?=SELECT|\(\s*SELECT)/i.exec(body);
  if (ins) {
    const rec = ins[1].toUpperCase();
    const cols = ins[2].split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    const recordFields = opts.catalog.record(rec);
    if (recordFields) {
      for (const col of cols) {
        if (!recordFields.has(col)) add('sql-bind-unknown', 'error', `${rec}.${col} is not a field of record ${rec}.`);
      }
    }
    const items = selectList(body.slice(ins.index + ins[0].length - 1));
    if (items) {
      if (cols.length !== items.length) {
        add('sql-insert-arity', 'error', `INSERT INTO PS_${rec} lists ${cols.length} columns but the SELECT returns ${items.length}.`);
      }
      const n = Math.min(cols.length, items.length);
      for (let k = 0; k < n; k++) {
        const target = recordFields?.has(cols[k]!) ? opts.catalog.field(cols[k]!) : undefined;
        if (!target) continue;
        const source = sourceType(items[k]!, opts.catalog);
        if (source && family(source.type.type) !== family(target.type)) {
          add('sql-type-mismatch', 'error',
            `${rec}.${cols[k]} is ${FIELD_TYPE_NAME[target.type]} but it is written from ${source.name}, which is ${FIELD_TYPE_NAME[source.type.type]}.`);
        }
      }
    }
  }

  // %Select(...) must name as many fields as the SELECT returns.
  const targets = selectTargets(sql);
  if (targets && !ins) {
    const items = selectList(body);
    if (items && items.length !== targets.length) {
      add('sql-select-arity', 'error', `%Select names ${targets.length} field(s) but the SELECT returns ${items.length}.`);
    }
    if (items) {
      const n = Math.min(items.length, targets.length);
      for (let k = 0; k < n; k++) {
        const target = opts.catalog.field(targets[k]!);
        const source = sourceType(items[k]!, opts.catalog);
        if (target && source && family(source.type.type) !== family(target.type)) {
          add('sql-type-mismatch', 'error',
            `%Select puts ${source.name} (${FIELD_TYPE_NAME[source.type.type]}) into ${targets[k]}, which is ${FIELD_TYPE_NAME[target.type]}.`);
        }
      }
    }
  }
  return problems;
}

/** The type behind one select-list item, when it is a plain field reference or a %Bind. */
function sourceType(item: string, catalog: SqlCatalog): { name: string; type: FieldType } | undefined {
  const bind = /^%Bind\s*\(\s*(?:\w+\.)?(\w+)\s*\)$/i.exec(item.trim());
  const name = bind ? bind[1]! : /^[A-Za-z]\w*\.(\w+)$/.exec(item.trim())?.[1];
  if (!name) return undefined;
  const type = catalog.field(name.toUpperCase());
  return type ? { name: name.toUpperCase(), type } : undefined;
}

/**
 * CreateSQL(SQL.NAME, ...) / SQLExec(SQL.NAME, ...) in PeopleCode against the
 * definition's own bind count. SQLExec also takes its outputs in the same
 * argument list, so it is only checked when it cannot be satisfied at all.
 */
export function checkSqlCallSites(
  peopleCode: string,
  lookup: (sqlId: string) => { binds: number; columns: number } | undefined
): SqlTypeProblem[] {
  const problems: SqlTypeProblem[] = [];
  const src = peopleCode.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of src.matchAll(/\b(CreateSQL|SQLExec)\s*\(\s*SQL\.(\w+)\s*([^;]*)/gi)) {
    const fn = m[1]!, id = m[2]!.toUpperCase();
    const defn = lookup(id);
    if (!defn) continue;
    const args = topLevelArgs(m[3]!);
    if (args === undefined) continue;
    if (fn.toLowerCase() === 'createsql') {
      if (args !== defn.binds) {
        problems.push({ code: 'sql-call-arity', severity: 'error',
          message: `CreateSQL(SQL.${id}, ...) passes ${args} bind value(s) but ${id} has ${defn.binds} marker(s). CreateSQL takes binds only; the selected columns come from Fetch.` });
      }
    } else if (args < defn.binds || args > defn.binds + defn.columns) {
      problems.push({ code: 'sql-call-arity', severity: 'error',
        message: `SQLExec(SQL.${id}, ...) passes ${args} argument(s); ${id} has ${defn.binds} bind marker(s) and returns ${defn.columns} column(s), so it takes ${defn.binds} to ${defn.binds + defn.columns}.` });
    }
  }
  return problems;
}

/** The count of top-level comma-separated arguments after the SQL name, or undefined if unreadable. */
function topLevelArgs(rest: string): number | undefined {
  let depth = 0, count = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === '(') { depth++; continue; }
    // The first comma separates SQL.NAME from argument one, so the comma count is
    // the argument count: ", &a, &b)" is two arguments, ")" is none.
    if (ch === ')') { if (depth === 0) return count; depth--; continue; }
    if (ch === ',' && depth === 0) { count++; continue; }
  }
  return undefined;
}
