/*
 * Page and Field Configurator (docs/CUSTOMIZATION.md): the PeopleSoft
 * Enterprise Components feature (EOCC_CONFIGURE, "Page and Field
 * Configurator") that hides, relabels, requires, disables, defaults, blanks
 * or masks a delivered component's fields and hides pages or makes them
 * display only -- by role, user, form factor and field-value criteria --
 * without changing the component.
 *
 * Stored in PS_EOCC_CONFIG_HDR (one configuration per component, market and
 * type: STD, MASK, TRK), _SEQ (its numbered sequences), _PNL (page rows),
 * _FLD (field rows, keyed level.record.field.pnlfldid like drop zones) and
 * _CRT (criteria). It runs through Event Mapping: the EOCC_* services
 * (EOCC_COMP_CONFIG:Services) mapped on the component's content references;
 * on PeopleTools 8.62 saving a configuration maps them on every one, earlier
 * releases needed Map to Portal Registry / Apply Configuration. So a
 * configuration only takes effect on the content references that carry that
 * mapping, and a component must be registered for it to apply at all.
 */

export const PFC_CONFIG_TYPE_LABELS: Readonly<Record<string, string>> = { STD: 'Standard', MASK: 'Masking', TRK: 'Change Tracking' };
export const PFC_APPLY_TO_LABELS: Readonly<Record<string, string>> = {
  A: 'All with excluded roles/users', R: 'Single role with exceptions', S: 'Specific roles with exceptions', U: 'Selected users'
};

/** What a sequence does to the component's fields (PS_EOCC_CONFIG_FLD), counted. */
export interface PfcFieldCounts {
  total: number;
  hidden: number;
  required: number;
  relabelled: number;
  disabled: number;
  defaulted: number;
  blanked: number;
  masked: number;
}

export interface PfcSequence {
  number: number;
  description: string;
  active: boolean;
  /** EOCC_APPLY_TO: A, R, S, U. */
  applyTo: string;
  role?: string;
  /** The form factors it applies on: Small, Medium, Large, Extra Large. */
  formFactors: string[];
  criteria: number;
  pagesHidden: number;
  pagesDisplayOnly: number;
  fields: PfcFieldCounts;
}

export interface PfcConfiguration {
  component: string;
  market: string;
  /** STD, MASK, TRK. */
  type: string;
  description: string;
  active: boolean;
  sequences: PfcSequence[];
}

export interface PfcDiscovery {
  state: 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'INDETERMINATE';
  evidence: string[];
  /** Whether Enterprise Components' configurator is on this database (EOCC_CONFIG_HDR). */
  installed: boolean;
  contentReferences: string[];
  /** The content references carrying EOCC Event Mapping: where configurations take effect. */
  appliedOn: string[];
  configurations: PfcConfiguration[];
  /** The registered components this covers (one, or a page's): where a new configuration can be created. */
  components?: Array<{ component: string; market: string }>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A sequence in a line: what it changes and to whom. */
export function describeSequence(s: PfcSequence): string {
  const f = s.fields;
  const changes = [
    f.hidden && `hides ${plural(f.hidden, 'field')}`, s.pagesHidden && `hides ${plural(s.pagesHidden, 'page')}`,
    s.pagesDisplayOnly && `${plural(s.pagesDisplayOnly, 'page')} display only`, f.required && `${f.required} required`,
    f.relabelled && `${f.relabelled} relabelled`, f.disabled && `${f.disabled} display only`, f.defaulted && `${f.defaulted} defaulted`,
    f.blanked && `${f.blanked} blanked`, f.masked && `${f.masked} masked`
  ].filter(Boolean);
  const who = s.applyTo === 'R' || s.applyTo === 'S' ? (s.role ? `role ${s.role}` : 'roles') : s.applyTo === 'U' ? 'selected users' : 'everyone';
  return `Sequence ${s.number}${s.description ? ` "${s.description}"` : ''}: ${changes.length ? changes.join(', ') : `${plural(f.total, 'field')} listed, none changed`}` +
    ` · ${who}${s.criteria ? ` · ${plural(s.criteria, 'criterion', 'criteria')}` : ''}${s.active ? '' : ' · inactive'}`;
}

/** The discovery's verdict for a component, with its evidence. */
export function pfcDiscoveryFor(subject: string, installed: boolean, crefs: string[], appliedOn: string[], configs: PfcConfiguration[]): PfcDiscovery {
  const base = { installed, contentReferences: crefs, appliedOn, configurations: configs };
  if (!installed) {
    return { ...base, state: 'VERIFIED_UNAVAILABLE', evidence: ['Page and Field Configurator (PeopleSoft Enterprise Components, EOCC_CONFIG_HDR) is not on this database.'] };
  }
  if (!crefs.length) {
    return {
      ...base, state: 'VERIFIED_UNAVAILABLE',
      evidence: [`${subject} is not registered as a content reference: Page and Field Configurator applies through Event Mapping, which needs a registered component.`]
    };
  }
  const sequences = configs.reduce((n, c) => n + c.sequences.length, 0);
  const evidence = [
    `Registered as ${plural(crefs.length, 'content reference')}: ${crefs.join(', ')}.`,
    configs.length
      ? `${plural(configs.length, 'configuration')} (${configs.map((c) => PFC_CONFIG_TYPE_LABELS[c.type] ?? c.type).join(', ')}), ${plural(sequences, 'sequence')}.`
      : 'No Page and Field Configurator configuration on it yet.'
  ];
  if (configs.length) {
    evidence.push(appliedOn.length
      ? `Applied (EOCC Event Mapping) on ${appliedOn.length} of ${crefs.length}: ${appliedOn.join(', ')}${appliedOn.length < crefs.length ? ' -- opened through the others, the configuration does not run' : ''}.`
      : 'Not applied: no EOCC Event Mapping on its content references, so the configuration has no effect at run time (save it on PeopleTools 8.62, or Apply Configuration on earlier releases).');
  }
  return { ...base, state: 'VERIFIED_AVAILABLE', evidence };
}
