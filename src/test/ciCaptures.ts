import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ciBuffer, documentFromRows, markKeys, type CiBuffer, type CiDocument, type CiRows, type Row } from '../model/ciDocument.js';
import { ciSourceFromData, type CiSourceData } from '../model/ciSource.js';
import type { StoredCi, SystemIds } from '../providers/ciWriter.js';

/*
 * App Designer's Component Interface saves, as captured on the lab VM
 * (tools/corpus/save-protocol/results, docs/COMPONENT_INTERFACES.md): one
 * interface's rows before and after a save (def-capture.mts keeps each
 * watched table as { columns, rows }; a full sweep -- snapshot.ts, ci01 --
 * keeps the rows it changed in delta.json), and the component's source
 * beside a create (ci-source.json).
 */

export const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

interface Watched { columns: { name: string }[]; rows: (string | null)[][] }

export const ciCaptureExists = (caseName: string) => existsSync(path.join(RESULTS, caseName, 'after.json'));

const cache = new Map<string, unknown>();
function json<T>(file: string): T {
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(file, 'utf8')));
  return cache.get(file) as T;
}

/** A table's rows on one side of a capture, filtered to one interface (CI tables by BCNAME, PeopleCode by 74 / BCNAME). */
export function rowsOf(caseName: string, phase: 'before' | 'after', table: string, ci?: string): Row[] {
  const dir = path.join(RESULTS, caseName);
  const w = json<{ watch: Record<string, Watched> }>(path.join(dir, `${phase}.json`)).watch;
  let rows: Row[];
  if (w[table]) {
    rows = w[table].rows.map((r) => Object.fromEntries(w[table].columns.map((c, i) => [c.name, r[i]])) as Row);
  } else {
    // A full sweep: only the rows the save changed, in delta.json (a create: its inserted rows are all there is after).
    const d = json<{ otherTables?: Record<string, { inserted: Row[]; deleted: Row[] }> }>(path.join(dir, 'delta.json')).otherTables?.[table];
    rows = d ? (phase === 'after' ? d.inserted : d.deleted) : [];
  }
  if (ci === undefined) return rows;
  return rows.filter((r) => ('BCNAME' in r ? r.BCNAME === ci : 'OBJECTVALUE1' in r ? r.OBJECTID1 === '74' && r.OBJECTVALUE1 === ci : true));
}

export function counters(caseName: string, phase: 'before' | 'after'): Record<string, number> {
  const rows = rowsOf(caseName, phase, 'PSVERSION');
  if (rows.length) return Object.fromEntries(rows.map((r) => [String(r.OBJECTTYPENAME).trim(), Number(r.VERSION)]));
  // A full sweep keeps PSVERSION's changes: before / after of each.
  const d = json<{ watch: { PSVERSION: { updated: { key: { OBJECTTYPENAME: string }; changes: { VERSION: { before: string; after: string } } }[] } } }>(
    path.join(RESULTS, caseName, 'delta.json')).watch.PSVERSION;
  return Object.fromEntries(d.updated.map((u) => [u.key.OBJECTTYPENAME, Number(u.changes.VERSION[phase])]));
}

/** PSSYSTEMID's PSBCITEM and PSCISYNCDEFN on one side (a full sweep: its change). */
export function systemIds(caseName: string, phase: 'before' | 'after'): SystemIds {
  const rows = rowsOf(caseName, phase, 'PSSYSTEMID');
  const v = (n: string) => Number(rows.find((r) => String(r.RECNAME).trim() === n)?.PTNEXTSYSTEMID ?? 0);
  if (rows.length) return { PSBCITEM: v('PSBCITEM'), PSCISYNCDEFN: v('PSCISYNCDEFN') };
  const d = json<{ otherTables?: Record<string, { updated: { changes: Record<string, { before: string; after: string }> }[] }> }>(
    path.join(RESULTS, caseName, 'delta.json')).otherTables?.PSSYSTEMID?.updated[0];
  return { PSBCITEM: Number(d?.changes.PTNEXTSYSTEMID?.[phase] ?? 0), PSCISYNCDEFN: 0 };
}

export function ciRows(caseName: string, phase: 'before' | 'after', ci: string): CiRows | undefined {
  const t = (table: string) => rowsOf(caseName, phase, table, ci);
  const [defn] = t('PSBCDEFN');
  if (!defn) return undefined;
  return { defn, items: t('PSBCITEM'), sync: t('PSCISYNCDEFN') };
}

export function storedCi(caseName: string, phase: 'before' | 'after', ci: string): StoredCi {
  const rows = ciRows(caseName, phase, ci);
  const tombstones = { ci: rowsOf(caseName, phase, 'PSBCDEL', ci), peopleCode: rowsOf(caseName, phase, 'PSPCMPROGDEL', ci) };
  return rows ? { exists: true, rows, tombstones } : { exists: false, rows: { defn: {}, items: [], sync: [] }, tombstones };
}

/** The component's source kept beside a capture. */
export function sourceData(caseName: string): CiSourceData {
  return json<CiSourceData>(path.join(RESULTS, caseName, 'ci-source.json'));
}

export const bufferOf = (caseName: string): CiBuffer => ciBuffer(ciSourceFromData(sourceData(caseName)));

/** A stored interface's document, its items' key flags from the component's records. */
export function storedDocument(caseName: string, phase: 'before' | 'after', ci: string, sourceCase: string): CiDocument {
  const doc = documentFromRows(ciRows(caseName, phase, ci)!);
  const src = sourceData(sourceCase);
  markKeys(doc, (r, f) => !!(((src.recordFields[r] ?? []).find((x) => x.name === f)?.useEdit ?? 0) & 1));
  return doc;
}
