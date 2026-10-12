import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Statement } from '../providers/appEngineWriter.js';

/*
 * The Configure Event Mapping page's saves, as captured on HRDMO with
 * snapshot.ts sweeps (tools/corpus/save-protocol/results/em01-em08,
 * docs/CUSTOMIZATION.md "Writing Event Mapping"). A sweep keeps the rows that
 * changed: inserted and deleted rows whole, updated ones as changed columns
 * keyed by ROWID -- Oracle reuses a deleted row's slot for an insert in the
 * same save, which the sweep reports as an update. Chaining the deltas from
 * an empty content reference gives each case's rows before and after.
 */

export const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

interface DeltaTable {
  inserted?: Row[];
  deleted?: Row[];
  updated?: { key: Row; changes: Record<string, { before: unknown; after: unknown }> }[];
}

const json = new Map<string, any>();
function load(caseName: string, file: string): any {
  const p = path.join(RESULTS, caseName, file);
  if (!json.has(p)) json.set(p, JSON.parse(readFileSync(p, 'utf8')));
  return json.get(p);
}

export const captureExists = (caseName: string) => existsSync(path.join(RESULTS, caseName, 'delta.json'));

/** A sweep's counter moves (PSVERSION), by counter. */
export function counterDeltas(caseName: string): Record<string, number> {
  const v = load(caseName, 'delta.json').summary.psversion as Record<string, { delta: number }>;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.delta]));
}

export function counterValues(caseName: string, side: 'before' | 'after'): Record<string, number> {
  const v = load(caseName, 'delta.json').summary.psversion as Record<string, { before: number; after: number }>;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x[side]]));
}

export const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const STAMP = new Set(['LASTUPDDTTM']);

/** A row as text, its timestamp left out: what two sides are compared on. */
export function rowText(r: Row): string {
  return JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, norm(r[k])]));
}

export const tableText = (rows: Row[]) => rows.map(rowText).sort();

/** The tables after a case, from the tables before it and its delta. */
export function applyDelta(caseName: string, before: Tables, tables: readonly string[]): Tables {
  const delta = load(caseName, 'delta.json').otherTables as Record<string, DeltaTable>;
  const out: Tables = {};
  for (const t of tables) {
    let rows = (before[t] ?? []).map((r) => ({ ...r }));
    const d = delta[t] ?? {};
    for (const del of d.deleted ?? []) {
      const i = rows.findIndex((r) => rowText(r) === rowText(del));
      if (i < 0) throw new Error(`${caseName}: a deleted ${t} row is not in the rows before`);
      rows.splice(i, 1);
    }
    for (const u of d.updated ?? []) {
      const i = rows.findIndex((r) => Object.entries(u.changes).every(([k, ch]) => k === 'LASTUPDDTTM' || norm(r[k]) === norm(ch.before)));
      if (i < 0) throw new Error(`${caseName}: an updated ${t} row is not in the rows before`);
      for (const [k, ch] of Object.entries(u.changes)) rows[i][k] = ch.after;
    }
    rows = [...rows, ...(d.inserted ?? []).map((r) => ({ ...r }))];
    out[t] = rows;
  }
  return out;
}

/** The rows a case inserted into a table (whole). */
export function insertedRows(caseName: string, table: string): Row[] {
  return ((load(caseName, 'delta.json').otherTables as Record<string, DeltaTable>)[table]?.inserted ?? []).map((r) => ({ ...r }));
}

/**
 * Runs a writer's statements on in-memory tables: INSERT ... VALUES, DELETE
 * ... WHERE col = :b AND ..., and PSVERSION / PSLOCK moves. PSADSTRACKING
 * and the service's VERSION are recorded, not modelled.
 */
export function execute(statements: readonly Statement[], tables: Tables, counters: Record<string, number>): { tables: Tables; counters: Record<string, number>; other: string[] } {
  const t: Tables = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const c = { ...counters };
  const other: string[] = [];
  for (const st of statements) {
    const sql = st.sql.replace(/\s+/g, ' ').trim();
    let m: RegExpMatchArray | null;
    if ((m = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES \((.*)\)$/))) {
      const cols = m[2].split(',').map((x) => x.trim());
      const vals = m[3].split(/,(?![^(]*\))/).map((x) => x.trim());
      const row: Row = {};
      cols.forEach((col, i) => {
        const v = vals[i];
        const bind = v.match(/:(\w+)/)![1];
        row[col] = st.binds[bind];
      });
      (t[m[1]] ??= []).push(row);
    } else if ((m = sql.match(/^DELETE FROM (\w+) WHERE (.*)$/))) {
      const conds = m[2].split(' AND ').map((x) => x.match(/(\w+) = :(\w+)/)!).map((x) => [x[1], st.binds[x[2]]] as const);
      const before = (t[m[1]] ?? []).length;
      t[m[1]] = (t[m[1]] ?? []).filter((r) => !conds.every(([k, v]) => norm(r[k]) === norm(v)));
      if (st.expect !== undefined && before - t[m[1]].length !== st.expect) throw new Error(`${st.what}: ${before - t[m[1]].length} rows, ${st.expect} expected`);
    } else if ((m = sql.match(/^UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '(\w+)'$/))) {
      c[m[1]] = Number(st.binds.v);
    } else if ((m = sql.match(/^UPDATE PSLOCK SET VERSION = VERSION \+ :d WHERE OBJECTTYPENAME = '(\w+)'$/))) {
      c[`PSLOCK.${m[1]}`] = (c[`PSLOCK.${m[1]}`] ?? 0) + Number(st.binds.d);
    } else other.push(st.what);
  }
  return { tables: t, counters: c, other };
}
