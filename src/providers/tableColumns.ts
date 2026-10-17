import type { DbConnection } from '../db/connection.js';

/*
 * The columns a PeopleTools table has on this database. Later PeopleTools releases add
 * columns: PSPNLFIELDEXT.PTDISABLESMARTPROM (Smart Prompt) is in 8.62 and not 8.61.12,
 * where naming it failed a new page's save with ORA-00904. Readers select a missing
 * column as NULL and writers leave it out, as that release's App Designer does.
 */

const cache = new WeakMap<DbConnection, Map<string, Promise<ReadonlySet<string>>>>();

/** The table's column names, read once per connection. */
export function tableColumns(c: DbConnection, table: string): Promise<ReadonlySet<string>> {
  let tables = cache.get(c);
  if (!tables) cache.set(c, (tables = new Map()));
  let names = tables.get(table);
  if (!names) {
    names = c.catalog.columns(c, table).then((cols) => new Set(cols.map((col) => col.name.toUpperCase())));
    tables.set(table, names);
  }
  return names;
}

/**
 * A select-list entry: `alias.NAME AS as` when the table has the column, `NULL AS as`
 * when this release does not. `expr` wraps a present column (a CLOB read as text).
 */
export function columnOrNull(have: ReadonlySet<string>, alias: string, name: string, as = name, expr?: (column: string) => string): string {
  if (!have.has(name)) return `NULL AS ${as}`;
  const column = `${alias}.${name}`;
  const value = expr ? expr(column) : column;
  return value === column && as === name ? column : `${value} AS ${as}`;
}

/** A row without the columns this release's table lacks. */
export function presentOnly<T extends Record<string, unknown>>(row: T, have: ReadonlySet<string>): { row: Partial<T>; dropped: string[] } {
  const out: Partial<T> = {};
  const dropped: string[] = [];
  for (const [col, value] of Object.entries(row)) {
    if (have.has(col.toUpperCase())) (out as Record<string, unknown>)[col] = value;
    else dropped.push(col);
  }
  return { row: out, dropped };
}
