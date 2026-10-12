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
 * Not mapped yet: the page's Event Map Parameter and Unrestricted Prompt.
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
