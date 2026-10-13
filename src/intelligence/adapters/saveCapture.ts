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

/**
 * The capture formats this adapter reads: the full sweep, and the definition
 * captures (watch tables only, no release). A page capture
 * (tools/lab/page-capture.mts) watches one page's rows and only the PDM, RDM
 * and SYS counters: another counter's move cannot show in it.
 */
export const CAPTURE_FORMATS = ['save-protocol-delta/1', 'def-capture/1', 'ae-capture/1', 'page-capture/1'] as const;

interface WatchTable { inserted?: unknown[]; deleted?: unknown[]; updated?: Array<{ key: Record<string, string>; changes: Record<string, { before: unknown; after: unknown }> }> }

/** The sanitized delta of a capture: tables (background ones left out unless asked) and counter moves. */
export function sanitizedDeltaOf(delta: unknown, options: { keepBackground?: boolean } = {}): SanitizedDelta {
  const d = delta as DeltaFile & { watch?: Record<string, WatchTable> };
  if (!CAPTURE_FORMATS.includes(d?.format as never)) throw new Error(`Not a capture this adapter reads (format ${String(d?.format)}).`);
  let changed: Record<string, { inserted?: number; deleted?: number; updated?: number }>;
  let counters: Record<string, number>;
  if (d.format === 'save-protocol-delta/1') {
    const s = d.summary ?? {};
    changed = { ...(s.otherTablesChanged ?? {}), ...(s.watchTablesChanged ?? {}) };
    counters = Object.fromEntries(Object.entries(s.psversion ?? {}).map(([k, v]) => [k, Number(v.delta ?? 0)]));
  } else {
    // A definition capture: its watch tables, by key; counters from PSVERSION's rows.
    changed = Object.fromEntries(Object.entries(d.watch ?? {}).map(([t, o]) => [t, { inserted: o.inserted?.length ?? 0, deleted: o.deleted?.length ?? 0, updated: o.updated?.length ?? 0 }])
      .filter(([, c]) => (c as { inserted: number }).inserted + (c as { deleted: number }).deleted + (c as { updated: number }).updated > 0));
    counters = Object.fromEntries((d.watch?.PSVERSION?.updated ?? []).map((u) => [u.key.OBJECTTYPENAME, Number(u.changes.VERSION?.after) - Number(u.changes.VERSION?.before)]));
  }
  const tables = Object.entries(changed)
    .filter(([t]) => options.keepBackground || !BACKGROUND_TABLES.includes(t))
    .filter(([t]) => t !== 'PSVERSION' && t !== 'PSLOCK')
    .map(([table, c]) => ({ table, inserted: c.inserted ?? 0, deleted: c.deleted ?? 0, updated: c.updated ?? 0 }))
    .sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0)); // code-point order: deterministic whatever the locale
  const moved = Object.fromEntries(Object.entries(counters).filter(([, v]) => Number.isFinite(v) && v !== 0));
  return { tables, ...(Object.keys(moved).length ? { counters: moved } : {}) };
}

/** A capture as an observation; the caller adds what was observed, in words. */
export function observationFromCapture(delta: unknown, words: {
  observation: string; expected?: string; actual?: string; tool?: string; runId?: string; reproduction?: string[];
  /** Required for definition captures, which do not record it; must agree with a sweep's own. */
  peopleToolsRelease?: string;
  /** The capture's directory under results/: its ID, over the file's own `case` (a renamed case keeps its old one). */
  caseName?: string;
}): Observation {
  const d = delta as DeltaFile;
  const caseId = words.caseName ?? d.case;
  const recorded = String(d.peopleToolsRelease ?? '').trim();
  if (recorded && words.peopleToolsRelease && words.peopleToolsRelease !== recorded) throw new Error(`The capture says PeopleTools ${recorded}, not ${words.peopleToolsRelease}.`);
  const release = recorded || String(words.peopleToolsRelease ?? '').trim();
  if (!/^\d\.\d{2}(\.\d{2})?$/.test(release)) throw new Error(`The capture does not say its PeopleTools release (${release || 'missing'}): give it.`);
  const at = d.markers?.after?.timestamp;
  const observedAt = at && !Number.isNaN(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : new Date().toISOString();
  return {
    observedAt, method: 'save-capture', ...(caseId ? { experimentId: caseId } : {}), ...(words.runId ? { runId: words.runId } : {}),
    environment: { peopleToolsRelease: release, platform: 'oracle', ...(words.tool ? { tool: words.tool } : {}) },
    observation: words.observation,
    ...(words.expected ? { expected: words.expected } : {}), ...(words.actual ? { actual: words.actual } : {}),
    ...(words.reproduction ? { reproduction: words.reproduction } : {}),
    delta: sanitizedDeltaOf(delta),
    ...(caseId ? { evidence: [{ kind: 'capture-case' as const, ref: caseId }] } : {})
  };
}
