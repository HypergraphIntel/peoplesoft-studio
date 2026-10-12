import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { ChannelRows, Row } from '../model/channelDocument.js';
import type { StoredChannel } from '../providers/channelWriter.js';

/*
 * App Designer's message channel saves, as captured on the lab VM
 * (tools/corpus/save-protocol/results, docs/MESSAGE_CHANNELS.md). The
 * def-capture.mts cases keep the channel's tables whole, before and after;
 * the snapshot.ts sweeps (create, rename, delete) keep only the rows that
 * changed, in delta.json -- enough, for those cases, to know the channel on
 * both sides.
 */

export const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

interface Watched { columns: { name: string }[]; rows: (string | null)[][] }
interface DeltaTable { inserted?: Row[]; deleted?: Row[]; updated?: { key: Row; changes: Record<string, { before: unknown; after: unknown }> }[] }

const json = new Map<string, any>();
function load(caseName: string, file: string): any {
  const p = path.join(RESULTS, caseName, file);
  if (!json.has(p)) json.set(p, JSON.parse(readFileSync(p, 'utf8')));
  return json.get(p);
}

export function channelCaptureExists(caseName: string): boolean {
  return existsSync(path.join(RESULTS, caseName, 'after.json'));
}

export const isSweep = (caseName: string) => load(caseName, 'after.json').format === 'save-protocol-snapshot/1';

function watched(caseName: string, phase: 'before' | 'after', table: string): Row[] {
  const t = load(caseName, `${phase}.json`).watch[table] as Watched | undefined;
  if (!t) return [];
  return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])) as Row);
}

/** A table's changed rows in a sweep's delta, on one side: deleted (before) or inserted (after) rows whole, updated ones as changed columns. */
export function deltaRows(caseName: string, table: string): DeltaTable {
  const d = load(caseName, 'delta.json');
  return (d.otherTables?.[table] ?? d.watch?.[table] ?? {}) as DeltaTable;
}

/** A table's rows for one channel on one side of a capture (a sweep: the rows that side changed). */
export function rowsOf(caseName: string, phase: 'before' | 'after', table: string, channel?: string): Row[] {
  let rows: Row[];
  if (isSweep(caseName) && !['PSVERSION', 'PSLOCK'].includes(table)) {
    const d = deltaRows(caseName, table);
    rows = phase === 'before' ? (d.deleted ?? []) : (d.inserted ?? []);
  } else rows = watched(caseName, phase, table);
  return channel === undefined ? rows : rows.filter((r) => !('CHNLNAME' in r) || r.CHNLNAME === channel);
}

export function counters(caseName: string, phase: 'before' | 'after'): Record<string, number> {
  return Object.fromEntries(watched(caseName, phase, 'PSVERSION').map((r) => [String(r.OBJECTTYPENAME).trim(), Number(r.VERSION)]));
}

export function channelRows(caseName: string, phase: 'before' | 'after', channel: string): ChannelRows | undefined {
  const t = (table: string) => rowsOf(caseName, phase, table, channel);
  const [c] = t('PSCHNLDEFN');
  if (!c) return undefined;
  return { channel: c, partitions: t('PSSUBCHNL'), languages: t('PSCHNLDEFNLANG'), nodes: t('PSCHNLNODE') };
}

/** The channel as stored on one side (messages and candidates: the window's list is the checked fields there). */
export function storedChannel(caseName: string, phase: 'before' | 'after', channel: string): StoredChannel {
  const rows = channelRows(caseName, phase, channel);
  const tombstones = rowsOf(caseName, phase, 'PSCHNLDEL', channel);
  if (!rows) return { exists: false, rows: { channel: {}, partitions: [], languages: [], nodes: [] }, messages: [], candidates: [], tombstones };
  return { exists: true, rows, messages: [], candidates: rows.partitions.map((r) => String(r.FIELDNAME)), tombstones };
}
