import { displayName, type DefinitionKey } from './model/definitions.js';
import type { DefinitionProvider, DefinitionSummary } from './providers/provider.js';

/*
 * Compare Project: each definition of a project read as text from this
 * connection and from another, classified. Text is compared with line
 * endings and trailing whitespace at the end ignored, as an export and a
 * database store them differently; anything else that differs is a
 * difference. Definitions with no text form are listed, not compared.
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
}

export const normalizeForCompare = (text: string): string => text.replace(/\r\n/g, '\n').replace(/\s+$/, '');

export async function compareProjectItems(items: readonly DefinitionSummary[], here: DefinitionProvider, other: DefinitionProvider,
  onItem?: (done: number, total: number) => void): Promise<ProjectItemComparison[]> {
  const out: ProjectItemComparison[] = [];
  for (const [i, item] of items.entries()) {
    const key = item.key;
    const label = displayName(key);
    onItem?.(i + 1, items.length);
    if (!here.canReadAsText(key.type)) { out.push({ key, label, outcome: 'notCompared', detail: 'no text form' }); continue; }
    let mine: string;
    try { mine = await here.readText(key); } catch (error) {
      out.push({ key, label, outcome: 'error', detail: `here: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!other.canReadAsText(key.type)) { out.push({ key, label, outcome: 'notCompared', detail: 'the other side has no text form for it' }); continue; }
    let theirs: string | undefined;
    try {
      theirs = await other.readText(key);
    } catch {
      theirs = undefined; // not there (or not readable there): reported as missing
    }
    if (theirs === undefined) out.push({ key, label, outcome: 'missing' });
    else if (normalizeForCompare(mine) === normalizeForCompare(theirs)) out.push({ key, label, outcome: 'same' });
    else out.push({ key, label, outcome: 'different', otherText: theirs });
  }
  return out;
}
