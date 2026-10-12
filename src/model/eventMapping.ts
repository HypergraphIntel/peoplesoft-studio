/*
 * Event Mapping, as PeopleTools stores it (docs/CUSTOMIZATION.md "Event
 * Mapping"): read-only discovery for the Customization Strategy view and the
 * MCP. Established on HRDMO (PeopleTools 8.62), not from documentation alone:
 *
 * - A configuration is a PSPTCSSRVCONF row under the pseudo-portal
 *   _PTCS_PTEVMAP, keyed by the content reference (PORTAL_OBJNAME) it maps --
 *   Oracle's own view PTCS_EVMAP_CFGS reads it so. Event Mapping therefore
 *   needs the component registered as a content reference in the portal
 *   registry; HRDMO's Configure Event Mapping page lists exactly the 8
 *   content references those rows name.
 * - Its service is a PSPTCSSRVDEFN row of URL type UAPC (Application Class;
 *   Oracle's view PTCS_EV_SRVC_VW), naming the class by PACKAGEROOT,
 *   QUALIFYPATH and APPCLASSID.
 * - The event level is PTCS_ISCOMPSERVICE. Its translate labels mislead: the
 *   Configure Event Mapping page shows C as Component, P as Record and R as
 *   Page (P rows carry a record and RowInit / RowInsert, R rows a page and
 *   Activate), F as Record Field.
 * - Events (PTCS_CMPEVENT for the component level, PTCS_CMPRECEVENT for the
 *   others) and the processing sequence (PTCS_PROCSEQ) take their labels from
 *   PSXLATITEM, which the page shows unchanged.
 *
 * - The page's Event Map Parameter is the configuration's EV_PARAM row in
 *   PSPTCS_MAPFLDS (its PTCS_PNLFLDNAME); Unrestricted Prompt is a work
 *   field that only widens the page's prompts and is not stored [em03-em05].
 */

export const EVENT_MAPPING_PORTAL = '_PTCS_PTEVMAP';

export type EventLevel = 'C' | 'P' | 'R' | 'F';

/** As the Configure Event Mapping page shows them (not PSXLATITEM's labels: see above). */
export const EVENT_LEVEL_LABELS: Readonly<Record<EventLevel, string>> = { C: 'Component', P: 'Record', R: 'Page', F: 'Record Field' };

export const COMPONENT_EVENT_LABELS: Readonly<Record<string, string>> = {
  PRE: 'PreBuild', POST: 'PostBuild', SPRE: 'SavePreChange', SPOS: 'SavePostChange', WFLO: 'Workflow'
};

export const RECORD_EVENT_LABELS: Readonly<Record<string, string>> = {
  PACT: 'Activate', RDEL: 'RowDelete', RFCH: 'FieldChange', RFDT: 'FieldDefault', RFED: 'FieldEdit', RINI: 'RowInit', RINS: 'RowInsert',
  RSEL: 'RowSelect', SEDT: 'SaveEdit', SINT: 'SearchInit', SPOS: 'SavePostChange', SPRE: 'SavePreChange', SSVE: 'SearchSave'
};

export const PROCESSING_LABELS: Readonly<Record<string, string>> = { PRE: 'Pre Process', POST: 'Post Process', OVER: 'Override/Replace' };

/** The events the Configure Event Mapping page offers at each level (PTCS_EV_CFG_WRK.PTCS_EV_EVENTNAME FieldFormula). */
export const EVENTS_BY_LEVEL: Readonly<Record<EventLevel, readonly string[]>> = {
  C: ['PRE', 'POST', 'SPRE', 'SPOS', 'WFLO'],
  R: ['PACT'],
  P: ['RINI', 'RINS', 'RSEL', 'RDEL', 'SEDT', 'SPRE', 'SPOS', 'SINT', 'SSVE'],
  F: ['RFCH', 'RFDT', 'RFED', 'SINT', 'SSVE']
};

/** The Event Map Parameter's field (PTCS_EV_MAP_PARM): uppercase, 254 long. */
export const EVENT_MAP_PARAMETER_LENGTH = 254;

/**
 * One row of the Configure Event Mapping page, as a writer takes it:
 * instanceId names a stored configuration (missing: a new row).
 */
export interface EventMappingConfigRow {
  instanceId?: number;
  level: EventLevel;
  /** R: the page. */
  page?: string;
  /** P and F: the record. */
  record?: string;
  /** F: the field. */
  field?: string;
  /** The event's code (EVENTS_BY_LEVEL). */
  event: string;
  serviceId: string;
  processing: 'PRE' | 'POST' | 'OVER';
  sequence: number;
  enabled: boolean;
  /** The Event Map Parameter; the page uppercases it. */
  parameter?: string;
}

export interface EventMappingProblem {
  row: number;
  message: string;
}

const upper = (v: string | undefined) => (v ?? '').trim().toUpperCase();

/** The row as the page would store it: names and the parameter uppercased, targets the level does not use cleared. */
export function normalizeConfigRow(r: EventMappingConfigRow): EventMappingConfigRow {
  const level = upper(r.level) as EventLevel;
  return {
    ...(r.instanceId ? { instanceId: r.instanceId } : {}),
    level,
    ...(level === 'R' ? { page: upper(r.page) } : {}),
    ...(level === 'P' || level === 'F' ? { record: upper(r.record) } : {}),
    ...(level === 'F' ? { field: upper(r.field) } : {}),
    event: upper(r.event), serviceId: upper(r.serviceId), processing: upper(r.processing) as EventMappingConfigRow['processing'],
    sequence: r.sequence, enabled: r.enabled,
    ...(upper(r.parameter) ? { parameter: upper(r.parameter) } : {})
  };
}

/**
 * What the page refuses on Save (PTCS_EV_CFG_WRK.BTN_SAVE FieldEdit: a level,
 * its page, record or field, a service), plus what the classic page refuses
 * (the same event, service and processing twice on one target) and what the
 * fields cannot hold. Rows are numbered from 1.
 */
export function validateConfigRows(rows: readonly EventMappingConfigRow[]): EventMappingProblem[] {
  const problems: EventMappingProblem[] = [];
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    const row = i + 1;
    const r = normalizeConfigRow(raw);
    const say = (message: string) => problems.push({ row, message });
    if (!(r.level in EVENTS_BY_LEVEL)) { say(`Event level ${raw.level || '(none)'} is not one of C (Component), R (Page), P (Record), F (Record Field).`); return; }
    if (r.level === 'R' && !r.page) say('A page-level configuration needs a page.');
    if ((r.level === 'P' || r.level === 'F') && !r.record) say(`A ${EVENT_LEVEL_LABELS[r.level].toLowerCase()}-level configuration needs a record.`);
    if (r.level === 'F' && !r.field) say('A record field-level configuration needs a field.');
    if (!EVENTS_BY_LEVEL[r.level].includes(r.event)) {
      say(`${eventLabel(r)} is not a ${EVENT_LEVEL_LABELS[r.level]} event (${EVENTS_BY_LEVEL[r.level].map((e) => eventLabel({ level: r.level, event: e })).join(', ')}).`);
    }
    if (!r.serviceId) say('A configuration needs a service.');
    if (!(r.processing in PROCESSING_LABELS)) say(`Processing ${raw.processing || '(none)'} is not PRE, POST or OVER.`);
    if (!Number.isInteger(r.sequence) || r.sequence < 0 || r.sequence > 999) say(`Sequence ${r.sequence} is not a whole number from 0 to 999.`);
    if ((r.parameter ?? '').length > EVENT_MAP_PARAMETER_LENGTH) say(`The Event Map Parameter is longer than ${EVENT_MAP_PARAMETER_LENGTH} characters.`);
    const key = [r.level, r.page ?? '', r.record ?? '', r.field ?? '', r.event, r.serviceId, r.processing].join('|');
    const first = seen.get(key);
    if (first) say(`Duplicates row ${first}: the same event, service and processing on the same target.`);
    else seen.set(key, row);
  });
  const ids = rows.map((r) => r.instanceId).filter((x): x is number => !!x);
  if (new Set(ids).size !== ids.length) problems.push({ row: 0, message: 'A stored configuration is listed twice.' });
  return problems;
}

/** A component's registration in the portal registry: what Event Mapping configures. */
export interface ContentReference {
  portal: string;
  name: string;
  label: string;
  menu: string;
}

export interface EventMappingRow {
  contentReference: string;
  serviceId: string;
  /** The service's application class, PACKAGE:PATH:CLASS (missing when the service is not an Application Class one). */
  applicationClass?: string;
  level: EventLevel | string;
  page?: string;
  record?: string;
  field?: string;
  /** The event's code (POST, RINI ...). */
  event: string;
  processing: string;
  sequence: number;
  enabled: boolean;
  /** Who last saved the configuration: PPLSOFT for Oracle's. */
  operator?: string;
  updated?: string;
}

export interface EventMappingDiscovery {
  state: 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'INDETERMINATE';
  /** Why, in the order it was weighed. */
  evidence: string[];
  contentReferences: ContentReference[];
  /** The configurations on those content references (for a page or record: those naming it). */
  mappings: EventMappingRow[];
  /** Application Class services defined (any could be mapped). */
  services: number;
}

export function eventLabel(row: Pick<EventMappingRow, 'level' | 'event'>): string {
  const table = row.level === 'C' ? COMPONENT_EVENT_LABELS : RECORD_EVENT_LABELS;
  return table[row.event] ?? row.event;
}

/** A configuration in a line, as the Configure Event Mapping page shows its row. */
export function describeMapping(m: EventMappingRow): string {
  const level = EVENT_LEVEL_LABELS[m.level as EventLevel] ?? m.level;
  const target = m.level === 'R' ? m.page : m.level === 'F' ? `${m.record}.${m.field}` : m.level === 'P' ? m.record : undefined;
  return `${level}${target ? ` ${target}` : ''} ${eventLabel(m)} -> ${m.serviceId}${m.applicationClass ? ` (${m.applicationClass})` : ''}, ` +
    `${PROCESSING_LABELS[m.processing] ?? m.processing}, sequence ${m.sequence}${m.enabled ? '' : ', disabled'}`;
}

/**
 * The discovery's verdict for a component: Event Mapping configures content
 * references, so it is available when the component is registered as one,
 * and unavailable -- with the evidence -- when it is not.
 */
export function discoveryFor(component: string, crefs: ContentReference[], mappings: EventMappingRow[], services: number): EventMappingDiscovery {
  if (!crefs.length) {
    return {
      state: 'VERIFIED_UNAVAILABLE', contentReferences: [], mappings: [], services,
      evidence: [`${component} is not registered as a content reference in the portal registry: Event Mapping configures content references.`,
        'Register the component (portal registry) to make Event Mapping available for it.']
    };
  }
  const oracle = mappings.filter((m) => m.operator === 'PPLSOFT').length;
  return {
    state: 'VERIFIED_AVAILABLE', contentReferences: crefs, mappings, services,
    evidence: [
      `Registered as ${crefs.length === 1 ? 'the content reference' : `${crefs.length} content references:`} ${crefs.map((c) => `${c.name} (${c.portal}, "${c.label}")`).join(', ')}.`,
      mappings.length
        ? `${mappings.length} Event Mapping configuration${mappings.length === 1 ? '' : 's'} already on ${crefs.length === 1 ? 'it' : 'them'}${oracle ? ` (${oracle} delivered by Oracle)` : ''}.`
        : 'No Event Mapping configuration on it yet.',
      `${services} Application Class services are defined for Event Mapping on this database.`
    ]
  };
}
