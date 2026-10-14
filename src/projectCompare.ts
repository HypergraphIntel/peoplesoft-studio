import { DefinitionType, displayName, keyEquals, makeKey, type DefinitionKey } from './model/definitions.js';
import type { DefinitionProvider, DefinitionSummary } from './providers/provider.js';
import { projectItemFor } from './model/projectItems.js';

/*
 * Compare Project: text and modeled record/field metadata read from this
 * connection and from another, classified. Text is compared with line
 * endings and trailing whitespace at the end ignored, as an export and a
 * database store them differently; anything else that differs is a
 * difference. Other definitions without a comparable form are listed.
 */

export type ProjectItemOutcome = 'different' | 'missing' | 'same' | 'notCompared' | 'error';

export interface ProjectItemComparison {
  key: DefinitionKey;
  label: string;
  outcome: ProjectItemOutcome;
  /** Why it was not compared, or what failed. */
  detail?: string;
  /** The other side's text, for a difference (to show it). */
  otherText?: string;
  /** Source snapshot for modeled metadata comparisons. */
  sourceText?: string;
}

export const normalizeForCompare = (text: string): string => text.replace(/\r\n/g, '\n').replace(/\s+$/, '');

export function projectKeyIdentity(key: DefinitionKey): string {
  try {
    const item = projectItemFor(key);
    return JSON.stringify([item.objectType, item.objectIds, item.objectValues.map(v => v.toUpperCase())]);
  } catch {
    return JSON.stringify([key.type, makeKey(key.type, ...key.parts).parts.map(p => p.toUpperCase())]);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  }, 2);
}

/** A model comparison is a review aid, not App Designer's native compare. */
async function comparable(provider: DefinitionProvider, key: DefinitionKey): Promise<string | undefined> {
  if (key.type === DefinitionType.Record) {
    const { version: _version, key: _key, ...record } = await provider.readRecord(key);
    return canonical(record);
  }
  if (key.type === DefinitionType.Field && provider.readField) {
    const field = await provider.readField(key);
    if (!field) return undefined;
    const { version: _version, lastUpdated: _updated, lastUpdatedBy: _by, ...definition } = field;
    return canonical({ ...definition, labels: [...definition.labels].sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return provider.readText(key);
}

function canCompare(provider: DefinitionProvider, key: DefinitionKey): boolean {
  return key.type === DefinitionType.Record || (key.type === DefinitionType.Field && !!provider.readField) || provider.canReadAsText(key.type);
}

/** Only a successful, untruncated search can establish absence after a failed read. */
async function confirmedMissing(provider: DefinitionProvider, key: DefinitionKey): Promise<boolean> {
  const limit = 1000;
  const matches = await provider.search({ type: key.type, namePattern: key.parts[0], limit });
  return matches.length < limit && !matches.some(item => keyEquals(makeKey(item.key.type, ...item.key.parts), makeKey(key.type, ...key.parts))
    || projectKeyIdentity(item.key) === projectKeyIdentity(key));
}

export async function compareProjectItems(items: readonly DefinitionSummary[], here: DefinitionProvider, other: DefinitionProvider,
  onItem?: (done: number, total: number) => void): Promise<ProjectItemComparison[]> {
  const out: ProjectItemComparison[] = [];
  for (const [i, item] of items.entries()) {
    const key = item.key;
    const label = displayName(key);
    onItem?.(i + 1, items.length);
    if (!canCompare(here, key)) { out.push({ key, label, outcome: 'notCompared', detail: 'no comparable representation' }); continue; }
    let mine: string;
    try {
      const source = await comparable(here, key);
      if (source === undefined) throw new Error('definition not found');
      mine = source;
    } catch (error) {
      out.push({ key, label, outcome: 'error', detail: `here: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!canCompare(other, key)) { out.push({ key, label, outcome: 'notCompared', detail: 'the other side has no comparable representation' }); continue; }
    let theirs: string | undefined;
    try {
      theirs = await comparable(other, key);
      if (theirs === undefined) throw new Error('definition payload not available');
    } catch (error) {
      let missing = false;
      try { missing = await confirmedMissing(other, key); } catch { /* search failed too: absence is unproven */ }
      if (!missing) {
        out.push({ key, label, outcome: 'error', detail: `target: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
    }
    const detail = key.type === DefinitionType.Record || key.type === DefinitionType.Field
      ? 'Compared modeled metadata only; version and audit stamps excluded.' : undefined;
    if (theirs === undefined) out.push({ key, label, outcome: 'missing' });
    else if (normalizeForCompare(mine) === normalizeForCompare(theirs)) out.push({ key, label, outcome: 'same', detail });
    else out.push({ key, label, outcome: 'different', otherText: theirs, sourceText: mine, detail });
  }
  return out;
}
