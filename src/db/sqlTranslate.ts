/*
 * The provider's SQL is written once, in Oracle's dialect -- it was proven
 * against Oracle first, and Oracle stays the reference platform. This module
 * rewrites a statement for Microsoft SQL Server or DB2 (LUW and z/OS), and
 * turns its named binds (:name) into the driver's: @name for SQL Server,
 * positional markers for DB2.
 *
 * It is a token rewriter, not a SQL parser: it knows the constructs the
 * provider uses and refuses ones it does not (UntranslatableSqlError), so a
 * new Oracle-only construct fails loudly in the cross-platform tests instead
 * of reaching a customer database. Oracle statements pass through untouched.
 *
 *   a || b || c              SQL Server CONCAT(a, b, c); DB2 unchanged
 *   FETCH FIRST n ROWS ONLY  SQL Server OFFSET 0 ROWS FETCH NEXT n ROWS ONLY
 *                            (ORDER BY (SELECT NULL) when there is none);
 *                            a bound n is written as a literal on both
 *   FOR UPDATE [OF ...]      SQL Server WITH (UPDLOCK, ROWLOCK) on each table;
 *                            DB2 WITH RS USE AND KEEP UPDATE LOCKS
 *   FROM DUAL                SQL Server dropped; DB2 FROM SYSIBM.SYSDUMMY1
 *   SYSTIMESTAMP             SQL Server GETDATE() (DATETIME precision, which
 *                            any PeopleSoft datetime column holds exactly);
 *                            DB2 CURRENT TIMESTAMP
 *   TO_CHAR / TO_DATE / TO_TIMESTAMP with the provider's formats
 *   CAST(x AS TIMESTAMP(n) | VARCHAR2(n))
 *   NVL -> COALESCE; TRIM(x) -> NULLIF(TRIM(x), '') (Oracle's TRIM of
 *   blanks is NULL, which NVL(TRIM(x), y) relies on); SUBSTR; RPAD(a, n);
 *   LENGTH; DBMS_LOB.SUBSTR / DBMS_LOB.GETLENGTH
 */

export type SqlPlatform = 'oracle' | 'mssql' | 'db2';

export class UntranslatableSqlError extends Error {
  constructor(message: string, readonly sql: string) {
    super(`${message} in: ${sql.replace(/\s+/g, ' ').trim().slice(0, 300)}`);
    this.name = 'UntranslatableSqlError';
  }
}

export interface TranslatedSql {
  sql: string;
  /** SQL Server: the bind names used (each once). DB2: one name per marker, in order. */
  binds: string[];
}

export interface TranslateOptions {
  /**
   * SQL Server only: qualify unqualified table names with this schema. SQL
   * Server has no session schema, so a PeopleTools owner other than the
   * login's default schema has to be named in each statement.
   */
  schema?: string;
  /**
   * SQL Server only: the type PeopleSoft's datetime columns are here
   * (PSPCMPROG.LASTUPDDTTM). DATETIME keeps 1/300 s: a timestamp bound as text
   * is converted to DATETIME before it is stored or compared, so the round
   * trip through TO_CHAR / TO_TIMESTAMP is exact; "now" is GETDATE(), already
   * in DATETIME's ticks. DATETIME2 (the default) keeps microseconds.
   */
  dateTimeType?: 'DATETIME' | 'DATETIME2';
}

// ---------------------------------------------------------------------------
// Tokens

type TokenKind = 'ws' | 'str' | 'qid' | 'num' | 'id' | 'bind' | 'op' | 'raw';
interface Token { kind: TokenKind; text: string }

const OPERATORS = ['||', '<=', '>=', '<>', '!=', '(', ')', ',', '.', ';', '=', '<', '>', '+', '-', '*', '/', '%'];

export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /\s/.test(sql[j])) j++;
      out.push({ kind: 'ws', text: sql.slice(i, j) });
      i = j;
    } else if (ch === '\'') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new UntranslatableSqlError('Unterminated string', sql);
        if (sql[j] === '\'') {
          if (sql[j + 1] === '\'') { j += 2; continue; }
          break;
        }
        j++;
      }
      out.push({ kind: 'str', text: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (ch === '"') {
      const j = sql.indexOf('"', i + 1);
      if (j < 0) throw new UntranslatableSqlError('Unterminated quoted identifier', sql);
      out.push({ kind: 'qid', text: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (ch === ':' && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      out.push({ kind: 'bind', text: sql.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[0-9.]/.test(sql[j])) j++;
      out.push({ kind: 'num', text: sql.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_$#@]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$#@]/.test(sql[j])) j++;
      out.push({ kind: 'id', text: sql.slice(i, j) });
      i = j;
    } else {
      const op = OPERATORS.find((o) => sql.startsWith(o, i));
      if (!op) throw new UntranslatableSqlError(`Unexpected character ${JSON.stringify(ch)}`, sql);
      out.push({ kind: 'op', text: op });
      i += op.length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Units: a token list with each parenthesised group folded into one unit.

interface Group { kind: 'group'; units: Unit[] }
type Unit = Token | Group;

function fold(tokens: Token[], sql: string): Unit[] {
  const stack: Unit[][] = [[]];
  for (const t of tokens) {
    if (t.kind === 'op' && t.text === '(') {
      stack.push([]);
    } else if (t.kind === 'op' && t.text === ')') {
      const inner = stack.pop();
      if (!inner || stack.length === 0) throw new UntranslatableSqlError('Unbalanced parentheses', sql);
      stack[stack.length - 1].push({ kind: 'group', units: inner });
    } else {
      stack[stack.length - 1].push(t);
    }
  }
  if (stack.length !== 1) throw new UntranslatableSqlError('Unbalanced parentheses', sql);
  return stack[0];
}

const isGroup = (u: Unit | undefined): u is Group => u?.kind === 'group';
const isWs = (u: Unit | undefined) => u?.kind === 'ws';
const word = (u: Unit | undefined) => (u && u.kind === 'id' ? u.text.toUpperCase() : undefined);
const isOp = (u: Unit | undefined, text: string) => !!u && u.kind === 'op' && u.text === text;
const raw = (text: string): Token => ({ kind: 'raw', text });

/** The index of the next unit that is not whitespace, at or after `i`. */
function next(units: Unit[], i: number): number {
  while (i < units.length && isWs(units[i])) i++;
  return i;
}

/** The index of the previous unit that is not whitespace, at or before `i`. */
function prev(units: Unit[], i: number): number {
  while (i >= 0 && isWs(units[i])) i--;
  return i;
}

/** A group's arguments: its units split at top-level commas, trimmed. */
function args(g: Group): Unit[][] {
  const out: Unit[][] = [[]];
  for (const u of g.units) {
    if (isOp(u, ',')) out.push([]);
    else out[out.length - 1].push(u);
  }
  return out.map((a) => {
    let s = 0;
    let e = a.length;
    while (s < e && isWs(a[s])) s++;
    while (e > s && isWs(a[e - 1])) e--;
    return a.slice(s, e);
  });
}

// ---------------------------------------------------------------------------
// Rendering

interface Context {
  platform: 'mssql' | 'db2';
  sql: string;
  binds: Record<string, unknown>;
  schema?: string;
  dateTimeType?: 'DATETIME' | 'DATETIME2';
}

function render(units: Unit[], cx: Context): string {
  return units.map((u) => renderUnit(u, cx)).join('');
}

function renderUnit(u: Unit, cx: Context): string {
  if (isGroup(u)) return `(${render(u.units, cx)})`;
  // Placeholders, numbered in text order once the statement is complete:
  // function arguments are rendered before the units around them.
  if (u.kind === 'bind') return `\u0001${u.text.slice(1)}\u0002`;
  return u.text;
}

// ---------------------------------------------------------------------------
// Rewrites

const FUNCTIONS = new Set(['TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'NVL', 'TRIM', 'SUBSTR', 'RPAD', 'LENGTH', 'CAST', 'REGEXP_LIKE', 'DECODE', 'INSTR', 'LISTAGG']);

/** Rewrite one level of units (and, recursively, every group in it). */
function rewrite(input: Unit[], cx: Context): Unit[] {
  // Groups first: subqueries and function arguments are rewritten in place.
  let units: Unit[] = input.map((u) => (isGroup(u) ? { kind: 'group', units: rewrite(u.units, cx) } : u));

  refuseRowValues(units, cx);
  units = rewriteCalls(units, cx);
  units = rewriteKeywords(units, cx);
  if (cx.platform === 'mssql') units = rewriteConcat(units, cx);
  units = rewriteFetchFirst(units, cx);
  units = rewriteForUpdate(units, cx);
  if (cx.platform === 'mssql' && cx.schema) units = qualifyTables(units, cx);
  return units;
}

/** (a, b) IN (...) / (a, b) = (...): row-value comparisons SQL Server does not have. */
function refuseRowValues(units: Unit[], cx: Context): void {
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!isGroup(u) || !u.units.some((x) => isOp(x, ','))) continue;
    const before = units[prev(units, i - 1)];
    if (before && (before.kind === 'id' || before.kind === 'raw') && !['WHERE', 'AND', 'OR', 'NOT', 'ON', 'WHEN'].includes(word(before) ?? '')) continue;
    const after = units[next(units, i + 1)];
    if (word(after) === 'IN' || isOp(after, '=')) throw new UntranslatableSqlError('A row-value comparison ((a, b) IN ...)', cx.sql);
  }
}

/** Function calls: NAME ( args ), and DBMS_LOB.NAME ( args ). */
function rewriteCalls(units: Unit[], cx: Context): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const name = word(u);
    // DBMS_LOB.SUBSTR / DBMS_LOB.GETLENGTH
    if (name === 'DBMS_LOB' && isOp(units[i + 1], '.') && word(units[i + 2]) && isGroup(units[i + 3])) {
      out.push(raw(dbmsLob(word(units[i + 2])!, args(units[i + 3] as Group), cx)));
      i += 3;
      continue;
    }
    const g = units[next(units, i + 1)];
    // A function, not a column of that name: NAME directly before "(", not after ".".
    if (name && FUNCTIONS.has(name) && isGroup(g) && !isOp(units[prev(units, i - 1)], '.')) {
      out.push(raw(call(name, args(g), cx)));
      i = next(units, i + 1);
      continue;
    }
    out.push(u);
  }
  return out;
}

const text = (a: Unit[] | undefined, cx: Context) => (a ? render(a, cx) : '');
const literal = (a: Unit[] | undefined) => (a && a.length === 1 && a[0].kind === 'str' ? a[0].text.slice(1, -1) : undefined);
/** DB2 cannot type a bare parameter marker inside a function: give it a type. */
const typed = (a: Unit[], cx: Context, type: string) =>
  cx.platform === 'db2' && a.length === 1 && a[0].kind === 'bind' ? `CAST(${text(a, cx)} AS ${type})` : text(a, cx);

const ISO_STAMP = 'YYYY-MM-DD"T"HH24:MI:SS.FF6';

function call(name: string, a: Unit[][], cx: Context): string {
  const ms = cx.platform === 'mssql';
  switch (name) {
    case 'TO_CHAR': {
      const fmt = literal(a[1]);
      const x = text(a[0], cx);
      if (a.length === 1) return ms ? `CAST(${x} AS NVARCHAR(40))` : `VARCHAR(${x})`;
      if (fmt === 'YYYY-MM-DD') return ms ? `CONVERT(VARCHAR(10), ${x}, 23)` : `VARCHAR_FORMAT(${x}, 'YYYY-MM-DD')`;
      if (fmt === 'YYYY-MM-DD HH24:MI:SS') return ms ? `CONVERT(VARCHAR(19), ${x}, 120)` : `VARCHAR_FORMAT(${x}, 'YYYY-MM-DD HH24:MI:SS')`;
      if (fmt === ISO_STAMP) {
        return ms
          ? `FORMAT(CAST(${x} AS DATETIME2(6)), 'yyyy-MM-ddTHH:mm:ss.ffffff')`
          : `REPLACE(VARCHAR_FORMAT(${x}, 'YYYY-MM-DD HH24:MI:SS.FF6'), ' ', 'T')`;
      }
      throw new UntranslatableSqlError(`TO_CHAR format ${fmt ?? '(not a literal)'}`, cx.sql);
    }
    case 'TO_DATE': {
      const fmt = literal(a[1]);
      if (fmt !== 'YYYY-MM-DD') throw new UntranslatableSqlError(`TO_DATE format ${fmt ?? '(not a literal)'}`, cx.sql);
      return ms ? `CONVERT(DATE, ${text(a[0], cx)}, 23)` : `DATE(${typed(a[0], cx, 'VARCHAR(10)')})`;
    }
    case 'TO_TIMESTAMP': {
      const fmt = literal(a[1]);
      if (fmt !== ISO_STAMP) throw new UntranslatableSqlError(`TO_TIMESTAMP format ${fmt ?? '(not a literal)'}`, cx.sql);
      if (!ms) return `TIMESTAMP(REPLACE(${typed(a[0], cx, 'VARCHAR(32)')}, 'T', ' '))`;
      return cx.dateTimeType === 'DATETIME'
        ? `CONVERT(DATETIME, CONVERT(DATETIME2(6), ${text(a[0], cx)}, 126))`
        : `CONVERT(DATETIME2(6), ${text(a[0], cx)}, 126)`;
    }
    case 'NVL':
      return `COALESCE(${text(a[0], cx)}, ${text(a[1], cx)})`;
    case 'TRIM':
      return ms ? `NULLIF(LTRIM(RTRIM(${text(a[0], cx)})), '')` : `NULLIF(TRIM(${text(a[0], cx)}), '')`;
    case 'SUBSTR':
      return ms
        ? `SUBSTRING(${text(a[0], cx)}, ${text(a[1], cx)}, ${a[2] ? text(a[2], cx) : '1000000'})`
        : `SUBSTR(${a.map((x) => text(x, cx)).join(', ')})`;
    case 'RPAD':
      if (a.length !== 2) throw new UntranslatableSqlError('RPAD with a pad character', cx.sql);
      return ms ? `CAST(${text(a[0], cx)} AS NCHAR(${text(a[1], cx)}))` : `CAST(${typed(a[0], cx, 'VARCHAR(254)')} AS CHAR(${text(a[1], cx)}))`;
    case 'LENGTH':
      // LEN ignores trailing blanks: measure the text with one more character.
      return ms ? `(LEN(${text(a[0], cx)} + N'x') - 1)` : `LENGTH(${text(a[0], cx)})`;
    case 'CAST':
      return `CAST(${castType(a[0], cx)})`;
    default:
      throw new UntranslatableSqlError(`${name}()`, cx.sql);
  }
}

/** CAST's argument, "x AS type", with Oracle's type names replaced. */
function castType(a: Unit[], cx: Context): string {
  const asAt = a.findIndex((u) => word(u) === 'AS');
  if (asAt < 0) throw new UntranslatableSqlError('CAST without AS', cx.sql);
  const expr = render(a.slice(0, asAt), cx).trim();
  const typeUnits = a.slice(next(a, asAt + 1));
  const typeName = word(typeUnits[0]);
  const size = isGroup(typeUnits[next(typeUnits, 1)]) ? render((typeUnits[next(typeUnits, 1)] as Group).units, cx) : undefined;
  const ms = cx.platform === 'mssql';
  switch (typeName) {
    case 'TIMESTAMP':
      return `${expr} AS ${ms ? 'DATETIME2' : 'TIMESTAMP'}(${size ?? '6'})`;
    case 'VARCHAR2':
    case 'VARCHAR':
      return `${expr} AS ${ms ? 'NVARCHAR' : 'VARCHAR'}(${size ?? '254'})`;
    case 'NUMBER':
      return `${expr} AS DECIMAL(${size ?? '31'})`;
    case 'DATE':
    case 'INTEGER':
    case 'SMALLINT':
    case 'CHAR':
      return `${expr} AS ${typeName}${size ? `(${size})` : ''}`;
    default:
      throw new UntranslatableSqlError(`CAST AS ${typeName ?? '?'}`, cx.sql);
  }
}

function dbmsLob(name: string, a: Unit[][], cx: Context): string {
  const ms = cx.platform === 'mssql';
  if (name === 'SUBSTR') {
    // DBMS_LOB.SUBSTR(lob, amount, offset)
    const [lob, amount, offset] = [text(a[0], cx), text(a[1], cx), a[2] ? text(a[2], cx) : '1'];
    // DB2's SUBSTRING pads a short value with blanks to the length asked for: ask for no more than there is.
    return ms
      ? `SUBSTRING(${lob}, ${offset}, ${amount})`
      : `SUBSTRING(${lob}, ${offset}, LEAST(${amount}, LENGTH(${lob}, CODEUNITS16) - ${offset} + 1), CODEUNITS16)`;
  }
  if (name === 'GETLENGTH') {
    return ms ? `(LEN(${text(a[0], cx)} + N'x') - 1)` : `LENGTH(${text(a[0], cx)}, CODEUNITS16)`;
  }
  throw new UntranslatableSqlError(`DBMS_LOB.${name}`, cx.sql);
}

/** SYSTIMESTAMP, SYSDATE, FROM DUAL, ROWNUM. */
function rewriteKeywords(units: Unit[], cx: Context): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    const w = word(units[i]);
    if (w === 'SYSTIMESTAMP' || w === 'SYSDATE') {
      out.push(raw(cx.platform === 'db2' ? 'CURRENT TIMESTAMP' : cx.dateTimeType === 'DATETIME' ? 'GETDATE()' : 'SYSDATETIME()'));
      continue;
    }
    if (w === 'FROM' && word(units[next(units, i + 1)]) === 'DUAL') {
      const end = next(units, i + 1);
      if (cx.platform === 'db2') out.push(raw('FROM SYSIBM.SYSDUMMY1'));
      else while (out.length && isWs(out[out.length - 1])) out.pop();
      i = end;
      continue;
    }
    if (w === 'ROWNUM' || w === 'ROWID' || w === 'CONNECT' || w === 'MINUS' || w === 'MERGE') {
      throw new UntranslatableSqlError(w, cx.sql);
    }
    out.push(units[i]);
  }
  return out;
}

/** a || b || c  ->  CONCAT(a, b, c), whatever the operands' types (SQL Server's + would add numbers). */
function rewriteConcat(units: Unit[], cx: Context): Unit[] {
  if (!units.some((u) => isOp(u, '||'))) return units;
  // Terms: an operand as one entry (A.COL, FN(...), 'x', :b, (expr)); anything else alone.
  const terms: { operand: boolean; units: Unit[] }[] = [];
  const isAtom = (u: Unit | undefined) => !!u && (isGroup(u) || ['id', 'qid', 'str', 'num', 'bind', 'raw'].includes(u.kind));
  for (let i = 0; i < units.length;) {
    if (!isAtom(units[i])) { terms.push({ operand: false, units: [units[i]] }); i++; continue; }
    let j = i;
    for (;;) {
      if (isOp(units[j + 1], '.') && isAtom(units[j + 2]) && !isGroup(units[j + 2])) j += 2;
      else if (!isGroup(units[j]) && units[j].kind !== 'str' && isGroup(units[j + 1])) j += 1;
      else break;
    }
    terms.push({ operand: true, units: units.slice(i, j + 1) });
    i = j + 1;
  }
  const skipWs = (k: number) => { while (k < terms.length && isWs(terms[k].units[0])) k++; return k; };
  const isConcat = (k: number) => k < terms.length && isOp(terms[k].units[0], '||');
  const out: Unit[] = [];
  for (let k = 0; k < terms.length; k++) {
    if (!terms[k].operand || !isConcat(skipWs(k + 1))) { out.push(...terms[k].units); continue; }
    const operands = [terms[k].units];
    let m = k;
    while (isConcat(skipWs(m + 1))) {
      const o = skipWs(skipWs(m + 1) + 1);
      if (!terms[o]?.operand) throw new UntranslatableSqlError('|| without a right operand', cx.sql);
      operands.push(terms[o].units);
      m = o;
    }
    out.push(raw(`CONCAT(${operands.map((o) => render(o, cx)).join(', ')})`));
    k = m;
  }
  return out;
}

/** FETCH FIRST n ROWS ONLY (n a literal or a bind). */
function rewriteFetchFirst(units: Unit[], cx: Context): Unit[] {
  const at = units.findIndex((u, i) => word(u) === 'FETCH' && ['FIRST', 'NEXT'].includes(word(units[next(units, i + 1)]) ?? ''));
  if (at < 0) return units;
  const nAt = next(units, next(units, at + 1) + 1);
  const rowsAt = next(units, nAt + 1);
  const onlyAt = next(units, rowsAt + 1);
  if (!['ROWS', 'ROW'].includes(word(units[rowsAt]) ?? '') || word(units[onlyAt]) !== 'ONLY') {
    throw new UntranslatableSqlError('FETCH FIRST', cx.sql);
  }
  const nUnit = units[nAt];
  let n: string;
  if (nUnit.kind === 'num') n = nUnit.text;
  else if (nUnit.kind === 'bind') {
    const value = Number(cx.binds[nUnit.text.slice(1)]);
    if (!Number.isInteger(value) || value < 0) throw new UntranslatableSqlError(`FETCH FIRST ${nUnit.text} is not a row count`, cx.sql);
    n = String(value);
  } else throw new UntranslatableSqlError('FETCH FIRST', cx.sql);
  const before = units.slice(0, at);
  const after = units.slice(onlyAt + 1);
  if (cx.platform === 'db2') return [...before, raw(`FETCH FIRST ${n} ROWS ONLY`), ...after];
  const ordered = before.some((u, i) => word(u) === 'ORDER' && word(before[next(before, i + 1)]) === 'BY');
  return [...before, raw(`${ordered ? '' : 'ORDER BY (SELECT NULL) '}OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY`), ...after];
}

const CLAUSE_END = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'FOR', 'UNION', 'FETCH', 'OFFSET', 'ON', 'SET', 'VALUES']);
const JOIN_WORDS = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS']);

/** FOR UPDATE [OF a, b] [NOWAIT]. */
function rewriteForUpdate(units: Unit[], cx: Context): Unit[] {
  const at = units.findIndex((u, i) => word(u) === 'FOR' && word(units[next(units, i + 1)]) === 'UPDATE');
  if (at < 0) return units;
  const before = units.slice(0, at);
  while (before.length && isWs(before[before.length - 1])) before.pop();
  if (cx.platform === 'db2') return [...before, raw(' WITH RS USE AND KEEP UPDATE LOCKS')];
  // SQL Server: a table hint after each table (and alias) of the FROM clause.
  const out: Unit[] = [];
  let inFrom = false;
  for (let i = 0; i < before.length; i++) {
    const w = word(before[i]);
    out.push(before[i]);
    if (w === 'FROM' || (inFrom && w === 'JOIN')) {
      inFrom = true;
      i = tableRef(before, i, out);
      continue;
    }
    if (inFrom && isOp(before[i], ',')) {
      i = tableRef(before, i, out);
      continue;
    }
    if (w && CLAUSE_END.has(w) && w !== 'ON') inFrom = false;
  }
  return out;
}

/** After FROM / JOIN / a comma in FROM: copy the table and its alias, then the hint. */
function tableRef(units: Unit[], i: number, out: Unit[]): number {
  let j = next(units, i + 1);
  if (isGroup(units[j])) return i; // a derived table: not locked
  for (let k = i + 1; k <= j; k++) out.push(units[k]);
  while (isOp(units[j + 1], '.') && units[j + 2]) { out.push(units[j + 1], units[j + 2]); j += 2; }
  const aliasAt = next(units, j + 1);
  const alias = word(units[aliasAt]);
  if (alias && alias !== 'AS' && !CLAUSE_END.has(alias) && !JOIN_WORDS.has(alias)) {
    for (let k = j + 1; k <= aliasAt; k++) out.push(units[k]);
    j = aliasAt;
  }
  out.push(raw(' WITH (UPDLOCK, ROWLOCK)'));
  return j;
}

/** SQL Server: SCHEMA.TABLE after FROM / JOIN / INTO / UPDATE / DELETE FROM and in FROM lists. */
function qualifyTables(units: Unit[], cx: Context): Unit[] {
  const out: Unit[] = [];
  let inFrom = false;
  for (let i = 0; i < units.length; i++) {
    const w = word(units[i]);
    out.push(units[i]);
    const tableNext = w === 'FROM' || w === 'JOIN' || w === 'INTO' || w === 'UPDATE' || (inFrom && isOp(units[i], ','));
    if (w === 'FROM') inFrom = true;
    else if (w && CLAUSE_END.has(w)) inFrom = false;
    if (!tableNext) continue;
    const j = next(units, i + 1);
    const t = units[j];
    if (t && t.kind === 'id' && !isOp(units[j + 1], '.') && !CLAUSE_END.has(word(t)!) && !JOIN_WORDS.has(word(t)!)) {
      for (let k = i + 1; k < j; k++) out.push(units[k]);
      out.push(raw(`${cx.schema}.${t.text}`));
      i = j;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * `sql` (Oracle) for `platform`. Oracle statements are returned unchanged with
 * their bind names; for the others, `binds` lists the names the translated
 * statement's markers take, in order.
 */
export function translateSql(
  sql: string, platform: SqlPlatform, binds: Record<string, unknown> = {}, options: TranslateOptions = {}
): TranslatedSql {
  if (platform === 'oracle') return { sql, binds: Object.keys(binds) };
  const cx: Context = {
    platform, sql, binds, ...(options.schema ? { schema: options.schema } : {}), ...(options.dateTimeType ? { dateTimeType: options.dateTimeType } : {})
  };
  const order: string[] = [];
  const out = render(rewrite(fold(tokenize(sql), sql), cx), cx).replace(/\u0001([A-Za-z0-9_]+)\u0002/g, (_m, name: string) => {
    if (platform === 'db2') { order.push(name); return '?'; }
    if (!order.includes(name)) order.push(name);
    return `@${name}`;
  });
  return { sql: out, binds: order };
}

/**
 * Positional binds (an array, as node-oracledb takes them) named by the
 * statement's bind variables in order of first appearance.
 */
export function namedBinds(sql: string, values: readonly unknown[]): Record<string, unknown> {
  const names: string[] = [];
  for (const t of tokenize(sql)) {
    if (t.kind === 'bind' && !names.includes(t.text.slice(1))) names.push(t.text.slice(1));
  }
  if (names.length !== values.length) throw new UntranslatableSqlError(`${values.length} positional binds for ${names.length} bind variables`, sql);
  return Object.fromEntries(names.map((n, i) => [n, values[i]]));
}
