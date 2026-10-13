import type { Observation, SanitizedDelta } from '../schema.js';

/*
 * The discovery adapter for save captures (tools/corpus/save-protocol
 * snapshot.ts): a capture's delta.json as an observation -- which tables a
 * native save changed and how many rows, which PSVERSION counters moved, on
 * which PeopleTools release. Counts only: no row, value, key or ROWID leaves
 * the capture. The claim is the researcher's (the assertion they record):
 * one delta proves what one save wrote, not a rule (DISCOVERY_PROTOCOL.md).
 */

/** Tables every sweep shows changing, whatever was saved: the Integration Broker's and sign-on bookkeeping. */
export const BACKGROUND_TABLES: readonly string[] = ['PSAPMSGDSPSTAT', 'PSIBNWSTATUS', 'PSIBOAUTH', 'PSACCESSLOG'];

interface DeltaFile {
  format?: string;
  case?: string;
  peopleToolsRelease?: string;
  markers?: { after?: { timestamp?: string } };
  summary?: {
    psversion?: Record<string, { delta?: number }>;
    watchTablesChanged?: Record<string, { inserted?: number; deleted?: number; updated?: number }>;
    otherTablesChanged?: Record<string, { inserted?: number; deleted?: number; updated?: number }>;
  };
}

/** The sanitized delta of a capture: tables (background ones left out unless asked) and counter moves. */
export function sanitizedDeltaOf(delta: unknown, options: { keepBackground?: boolean } = {}): SanitizedDelta {
  const d = delta as DeltaFile;
  if (d?.format !== 'save-protocol-delta/1') throw new Error(`Not a save-protocol delta (format ${String(d?.format)}).`);
  const s = d.summary ?? {};
  const tables = Object.entries({ ...(s.otherTablesChanged ?? {}), ...(s.watchTablesChanged ?? {}) })
    .filter(([t]) => options.keepBackground || !BACKGROUND_TABLES.includes(t))
    .filter(([t]) => t !== 'PSVERSION' && t !== 'PSLOCK')
    .map(([table, c]) => ({ table, inserted: c.inserted ?? 0, deleted: c.deleted ?? 0, updated: c.updated ?? 0 }))
    .sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0)); // code-point order: deterministic whatever the locale
  const counters = Object.fromEntries(Object.entries(s.psversion ?? {}).map(([k, v]) => [k, Number(v.delta ?? 0)]).filter(([, v]) => v !== 0));
  return { tables, ...(Object.keys(counters).length ? { counters } : {}) };
}

/** A capture as an observation; the caller adds what was observed, in words. */
export function observationFromCapture(delta: unknown, words: { observation: string; expected?: string; actual?: string; tool?: string; runId?: string; reproduction?: string[] }): Observation {
  const d = delta as DeltaFile;
  const release = String(d.peopleToolsRelease ?? '').trim();
  if (!/^\d\.\d{2}(\.\d{2})?$/.test(release)) throw new Error(`The capture does not say its PeopleTools release (${release || 'missing'}).`);
  const at = d.markers?.after?.timestamp;
  const observedAt = at && !Number.isNaN(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : new Date().toISOString();
  return {
    observedAt, method: 'save-capture', ...(d.case ? { experimentId: d.case } : {}), ...(words.runId ? { runId: words.runId } : {}),
    environment: { peopleToolsRelease: release, platform: 'oracle', ...(words.tool ? { tool: words.tool } : {}) },
    observation: words.observation,
    ...(words.expected ? { expected: words.expected } : {}), ...(words.actual ? { actual: words.actual } : {}),
    ...(words.reproduction ? { reproduction: words.reproduction } : {}),
    delta: sanitizedDeltaOf(delta),
    ...(d.case ? { evidence: [{ kind: 'capture-case' as const, ref: d.case }] } : {})
  };
}
