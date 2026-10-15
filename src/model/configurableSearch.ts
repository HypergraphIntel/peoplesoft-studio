/*
 * Configurable Search discovery (PeopleTools > Portal > Manage Search
 * Configuration, PTS_MENU.PTS_SRCH_CONFIG): a component's search page
 * configured without changing its search record or search definition. Per
 * content reference, an effective-dated configuration (PS_PTS_SRCH_DEFN) of
 * type Standard Search (S, on a search record, PTS_SRCH_RECNM) or Keyword
 * Search (E, on a search definition, PTS_SRCH_ESDEF), assigned and active or
 * inactive (PS_PTS_SRCH_ASGN.PTS_CONFIG_STATUS), with a row per field
 * (PS_PTS_SRCH_DTL_S / _E): relabelled, required, hidden, display only, a
 * default, a criterion (Basic, Advanced or both), a result, shown on small
 * screens. Only the active configuration in effect changes the search page.
 */

import type { DiscoveryState } from './customizationStrategy.js';

export type CsSearchType = 'S' | 'E';
export const CS_SEARCH_TYPE_LABELS: Readonly<Record<string, string>> = { S: 'Standard Search', E: 'Keyword Search' };

export interface CsFieldCounts {
  total: number;
  criteria: number;
  results: number;
  smallFormFactor: number;
  keys: number;
  relabelled: number;
  required: number;
  hidden: number;
  displayOnly: number;
  defaulted: number;
}

export interface CsConfiguration {
  cref: string;
  component: string;
  market: string;
  searchId: string;
  /** The effective date of the row in effect (YYYY-MM-DD). */
  effdt: string;
  type: string;
  /** The search record (Standard) or search definition (Keyword). */
  source: string;
  /** Assigned and active (PS_PTS_SRCH_ASGN.PTS_CONFIG_STATUS A). */
  active: boolean;
  /** The search page's label, when the configuration sets one. */
  pageLabel?: string;
  fields: CsFieldCounts;
}

export interface CsDiscovery {
  state: Extract<DiscoveryState, 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'INDETERMINATE'>;
  evidence: string[];
  installed: boolean;
  contentReferences: string[];
  configurations: CsConfiguration[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Standard Search on PAY_PAGE_WUSAX, inactive: 11 fields, 9 criteria, 6 results". */
export function describeCsConfiguration(c: CsConfiguration): string {
  const f = c.fields;
  const changes = [f.relabelled ? `${f.relabelled} relabelled` : '', f.required ? `${f.required} required` : '', f.hidden ? `${f.hidden} hidden` : '',
    f.displayOnly ? `${f.displayOnly} display only` : '', f.defaulted ? `${plural(f.defaulted, 'default')}` : ''].filter(Boolean);
  return `${CS_SEARCH_TYPE_LABELS[c.type] ?? c.type} on ${c.source || '(none)'}, ${c.active ? 'active' : 'inactive'}: ${plural(f.total, 'field')}, ` +
    `${f.criteria} criteria, ${plural(f.results, 'result')}${changes.length ? `; ${changes.join(', ')}` : ''}`;
}

/** The verdict and evidence for a component (or a page's components). */
export function csDiscoveryFor(subject: string, installed: boolean, crefs: string[], configs: CsConfiguration[]): CsDiscovery {
  const base = { installed, contentReferences: crefs, configurations: configs };
  if (!installed) {
    return { ...base, state: 'VERIFIED_UNAVAILABLE', evidence: ['Configurable Search (PS_PTS_SRCH_DEFN) is not on this database.'] };
  }
  if (!crefs.length) {
    return { ...base, state: 'VERIFIED_UNAVAILABLE', evidence: [`${subject} is not registered as a content reference: Configurable Search configures a content reference's search page.`] };
  }
  const active = configs.filter((c) => c.active);
  const evidence = [
    configs.length
      ? `${plural(configs.length, 'search configuration')} on ${plural(new Set(configs.map((c) => c.cref)).size, 'content reference')}; ${active.length ? `${active.length} active` : 'none active (configured but not in effect)'}.`
      : `No search configuration on its ${plural(crefs.length, 'content reference')}; one can be created in Manage Search Configuration.`
  ];
  return { ...base, state: 'VERIFIED_AVAILABLE', evidence };
}
