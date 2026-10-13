/*
 * Run SQL's gate (psft.sql.run): what may be run against a PeopleSoft
 * database from the editor. One query, read only: a single SELECT (or
 * WITH ... SELECT) with no INTO and no FOR UPDATE; comments and string
 * literals are ignored when checking. The query is run in a transaction
 * that is rolled back (on Oracle also SET TRANSACTION READ ONLY), with a
 * row cap -- that is DatabaseProvider.runReadOnlyQuery's part.
 *
 * Meta-SQL: %Table(REC) becomes the record's table; any other meta-SQL or
 * bind variable is refused by name, since running it needs PeopleTools.
 */

export type Prepared = { ok: true; sql: string; tables: string[] } | { ok: false; reason: string };

/** The text with comments removed and string literals blanked (same length outside comments), for checking only. */
export function maskSql(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) { const e = sql.indexOf('\n', i); i = e === -1 ? sql.length : e; continue; }
    if (sql.startsWith('/*', i)) { const e = sql.indexOf('*/', i + 2); out += ' '; i = e === -1 ? sql.length : e + 2; continue; }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += "'" + ' '.repeat(Math.max(0, j - i - 1)) + "'";
      i = j + 1;
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/** The meta-SQL names (without %) and bind variables in a statement, outside comments and literals. */
export function metaSqlIn(sql: string): { meta: string[]; binds: string[] } {
  const masked = maskSql(sql);
  const meta = [...new Set([...masked.matchAll(/%([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
  const binds = [...new Set([...masked.matchAll(/(?<![A-Za-z0-9_:]):([A-Za-z0-9_]+)/g)].map((m) => `:${m[1]}`))];
  return { meta, binds };
}

/**
 * Checks a query and expands %Table(REC) with `tableOf` (the record's SQL table name); returns the
 * statement to run, without a trailing ';' or '/' line, or why it is refused.
 */
export function prepareReadOnlyQuery(text: string, tableOf?: (record: string) => string): Prepared {
  let sql = text.replace(/\r\n/g, '\n').trim();
  sql = sql.replace(/\n\s*\/\s*$/, '').replace(/;\s*$/, '').trim();
  if (!sql) return { ok: false, reason: 'There is no SQL to run.' };
  const masked = maskSql(sql);
  if (masked.includes(';')) return { ok: false, reason: 'Run SQL runs one statement at a time: select just one.' };
  if (!/^\s*(select|with)\b/i.test(masked)) return { ok: false, reason: 'Run SQL runs queries only: the statement must be a SELECT (or WITH ... SELECT).' };
  if (/\binto\b/i.test(masked)) return { ok: false, reason: 'Run SQL does not run SELECT ... INTO: it would write.' };
  if (/\bfor\s+update\b/i.test(masked)) return { ok: false, reason: 'Run SQL does not run SELECT ... FOR UPDATE: it would lock rows.' };
  // A WITH can end in a write on SQL Server (WITH x AS (...) DELETE FROM x): after WITH, no write keyword at all.
  if (/^\s*with\b/i.test(masked) && /\b(insert|update|delete|merge)\b/i.test(masked)) {
    return { ok: false, reason: 'Run SQL runs queries only: this WITH statement writes.' };
  }
  const tables: string[] = [];
  const found = metaSqlIn(sql);
  const others = found.meta.filter((m) => m.toUpperCase() !== 'TABLE');
  if (others.length) return { ok: false, reason: `Meta-SQL that needs PeopleTools to expand: ${others.map((m) => `%${m}`).join(', ')}. Only %Table(record) is expanded here.` };
  if (found.binds.length) return { ok: false, reason: `Bind variables have no values here: ${found.binds.join(', ')}.` };
  if (/%table\s*\(/i.test(masked)) {
    if (!tableOf) return { ok: false, reason: '%Table needs a database to name the table.' };
    let bad: string | undefined;
    sql = sql.replace(/%table\s*\(\s*([A-Za-z0-9_#$@]*)\s*\)/gi, (_m, rec: string) => {
      if (!rec) { bad = '%Table() names no record.'; return _m; }
      const t = tableOf(rec.toUpperCase());
      tables.push(t);
      return t;
    });
    if (bad) return { ok: false, reason: bad };
  }
  return { ok: true, sql, tables };
}
