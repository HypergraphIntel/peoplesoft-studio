import { DefinitionType, typeLabel } from './definitions.js';
import { matchPrefix, OWNERSHIP_LABELS, type Classification, type NamingPrefix } from './ownership.js';
import { describeMapping, type EventMappingDiscovery } from './eventMapping.js';

export { OWNERSHIP_LABELS, type Ownership } from './ownership.js';

/*
 * Customization Intelligence, the UI's model (CUSTOMIZATION_INTELLIGENCE.md,
 * CUSTOMIZATION_STRATEGY_PANEL.md): the evidence and lifecycle states, the
 * configuration frameworks, which of them apply to a definition, and the
 * Customization Strategy view's sections. Ownership is classified from
 * evidence (ownership.ts); capability discovery is not implemented yet, so
 * every capability is UNKNOWN -- never a finding the environment has not
 * produced. Pure: no `vscode`.
 */

/** Capability discovery: evidence-driven; never VERIFIED_* without target-environment evidence. */
export type DiscoveryState = 'UNKNOWN' | 'POTENTIAL' | 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'INDETERMINATE';
export const DISCOVERY_LABELS: Readonly<Record<DiscoveryState, string>> = {
  UNKNOWN: 'Unknown', POTENTIAL: 'Potential — requires discovery', VERIFIED_AVAILABLE: 'Verified available',
  VERIFIED_UNAVAILABLE: 'Verified unavailable', INDETERMINATE: 'Indeterminate'
};

/** A plan's lifecycle, kept apart from discovery so an available mechanism is never mistaken for a done change. */
export type PlanStatus = 'NOT_PLANNED' | 'DRAFT' | 'VALIDATED' | 'APPROVED' | 'APPLIED' | 'TESTED' | 'FAILED';

export type Framework = 'EVENT_MAPPING' | 'DROP_ZONES' | 'PAGE_FIELD_CONFIGURATOR' | 'AE_PLUGINS' | 'CONFIGURABLE_SEARCH';

export interface FrameworkInfo {
  id: Framework;
  label: string;
  /** What it is for, in a line. */
  purpose: string;
  /** What discovery would have to establish before it could be offered. */
  mustVerify: string;
}

export const FRAMEWORKS: Readonly<Record<Framework, FrameworkInfo>> = {
  EVENT_MAPPING: { id: 'EVENT_MAPPING', label: 'Event Mapping', purpose: 'Application class PeopleCode at component, record and field events',
    mustVerify: 'A registered content reference, the supported events and their sequencing' },
  DROP_ZONES: { id: 'DROP_ZONES', label: 'Drop Zones', purpose: 'Custom subpages in configurable page insertion points',
    mustVerify: 'An available drop zone in the delivered page' },
  PAGE_FIELD_CONFIGURATOR: { id: 'PAGE_FIELD_CONFIGURATOR', label: 'Page and Field Configurator', purpose: 'Supported field properties: visibility, labels, required',
    mustVerify: 'Which field properties are supported for this component' },
  AE_PLUGINS: { id: 'AE_PLUGINS', label: 'App Engine Plug-ins', purpose: 'Before, after or replace eligible actions with a plug-in program',
    mustVerify: 'Eligible actions and existing plug-in configuration' },
  CONFIGURABLE_SEARCH: { id: 'CONFIGURABLE_SEARCH', label: 'Configurable Search', purpose: 'Supported search behavior without changing search definitions',
    mustVerify: 'Search definitions configured for the component' }
};

/** The frameworks that could extend a definition of a type -- documented applicability, not eligibility. */
export function frameworksFor(type: DefinitionType): Framework[] {
  switch (type) {
    case DefinitionType.Component:
      return ['EVENT_MAPPING', 'DROP_ZONES', 'PAGE_FIELD_CONFIGURATOR', 'CONFIGURABLE_SEARCH'];
    case DefinitionType.Page:
      return ['DROP_ZONES', 'PAGE_FIELD_CONFIGURATOR', 'EVENT_MAPPING'];
    case DefinitionType.Record:
    case DefinitionType.Field:
    case DefinitionType.RecordPeopleCode:
    case DefinitionType.ComponentPeopleCode:
    case DefinitionType.ComponentRecordPeopleCode:
    case DefinitionType.ComponentRecordFieldPeopleCode:
    case DefinitionType.PagePeopleCode:
      return ['EVENT_MAPPING'];
    case DefinitionType.AppEngineProgram:
    case DefinitionType.AppEngineSection:
    case DefinitionType.AppEnginePeopleCode:
      return ['AE_PLUGINS'];
    default:
      return [];
  }
}

/** The definition the view follows. */
export interface CustomizationContext {
  type: DefinitionType;
  name: string;
  connection?: string;
  /** The connection's id, when known: what the definition is classified on. */
  connectionId?: string;
  /** The key's parts (name is their display). */
  parts?: string[];
}

export interface CustomizationPolicy {
  /** The organization's prefix and each bolt-on vendor's (peoplesoft.customization.namingPrefixes). */
  prefixes: NamingPrefix[];
  defaultStrategy: 'configurationFirst' | 'allowDirect';
  /** For people, in the editors and designers. */
  deliveredObjectPolicy: 'block' | 'requireApproval' | 'allowWithAudit';
  /** For AI agents, through the MCP. */
  agentDeliveredObjectPolicy: 'block' | 'requireApproval' | 'allowWithAudit';
}

export const POLICY_LABELS = {
  configurationFirst: 'Configuration first', allowDirect: 'Allow direct modification where policy permits',
  block: 'Block all direct edits', requireApproval: 'Require explicit approval', allowWithAudit: 'Allow with audit record'
} as const;

/** A row of the view: a section, or an entry in one. */
export interface StrategyRow {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon: string;
  /** Shown greyed: not established, or not available yet. */
  muted?: boolean;
  /** A command the row runs. */
  command?: { id: string; args?: unknown[] };
  children?: StrategyRow[];
}

/** "Message Channels" -> "Message Channel", "Application Classes" -> "Application Class", "Entries" -> "Entry". */
export function singular(label: string): string {
  if (/ies$/.test(label)) return label.replace(/ies$/, 'y');
  if (/(ss|x)es$/.test(label)) return label.replace(/es$/, '');
  return label.replace(/s$/, '');
}

const PREVIEW = 'Preview — discovery of this framework is not implemented yet (Event Mapping is).';

/** The ownership row's state: being read, read, or not readable here. */
export type OwnershipState =
  | { state: 'pending' }
  | { state: 'unavailable'; message: string }
  | { state: 'done'; classification: Classification; /** Whether a delivered baseline of the release was applied. */ baseline: boolean };

function ownershipRows(ctx: CustomizationContext, policy: CustomizationPolicy, owner: OwnershipState | undefined): StrategyRow[] {
  const prefix = matchPrefix(ctx.name, policy.prefixes);
  const prefixRow: StrategyRow[] = prefix
    ? [{ id: 'identity.prefix', label: 'Prefix', description: `${prefix.prefix} · ${prefix.owner === 'partner' ? 'bolt-on' : 'organization'}${prefix.name ? ` (${prefix.name})` : ''}`, icon: 'tag',
        tooltip: 'From peoplesoft.customization.namingPrefixes. A naming convention: supporting evidence, never proof on its own.' }]
    : [];
  if (!owner || owner.state === 'pending') return [{ id: 'identity.ownership', label: 'Ownership', description: 'Classifying…', icon: 'loading~spin', muted: true }, ...prefixRow];
  if (owner.state === 'unavailable') return [{ id: 'identity.ownership', label: 'Ownership', description: OWNERSHIP_LABELS.UNKNOWN, icon: 'question', muted: true, tooltip: owner.message }, ...prefixRow];
  const c = owner.classification;
  const icon = c.ownership === 'CUSTOM' ? 'person' : c.ownership === 'PARTNER' ? 'organization' : c.ownership === 'UNKNOWN' ? 'question' : 'lock';
  return [{
    id: 'identity.ownership', label: 'Ownership', description: `${OWNERSHIP_LABELS[c.ownership]} · ${c.confidence.toLowerCase()} confidence`, icon,
    muted: c.ownership === 'UNKNOWN', tooltip: c.evidence.join('\n'),
    children: c.evidence.map((line, i) => ({ id: `identity.evidence.${i}`, label: line, icon: 'debug-stackframe-dot', muted: true, tooltip: line }))
  }, ...prefixRow,
  // Without a baseline, ownership rests on stamps and prefixes; one from a vanilla demo makes it reliable.
  ...(owner.baseline ? [] : [{ id: 'identity.baseline', label: 'Capture Delivered Baseline…', description: 'none for this release', icon: 'database',
    tooltip: 'No delivered baseline for this release: ownership rests on the PPLSOFT stamp, projects and prefixes. Capture one from a vanilla demo database of the release to make it reliable.',
    command: { id: 'psft.customization.captureBaseline' } }])];
}

/**
 * The Customization Strategy view's sections for a definition: Object
 * Identity, Preferred Strategy, Configuration Capabilities, Dependencies &
 * Upgrade Impact, Actions. Everything the environment would have to answer
 * shows as unknown.
 */
/** What discovery found, per framework: being read, read, or not readable here. */
export type CapabilitiesState =
  | { state: 'pending' }
  | { state: 'unavailable'; message: string }
  | { state: 'done'; eventMapping?: EventMappingDiscovery; knowledge?: KnowledgeSummary };

/** What recorded and verified knowledge says about Event Mapping on the connection's release (docs/intelligence, D18): information, never permission. */
export interface KnowledgeSummary {
  answer: 'VERIFIED' | 'UNVERIFIED' | 'UNSUPPORTED' | 'UNKNOWN' | 'CONFLICTING';
  release?: string;
  findings: Array<{ id: string; title: string; source: 'published' | 'local'; status: string }>;
}

const STATE_ICONS: Readonly<Record<DiscoveryState, string>> = {
  UNKNOWN: 'circle-large-outline', POTENTIAL: 'circle-large-outline', VERIFIED_AVAILABLE: 'pass', VERIFIED_UNAVAILABLE: 'circle-slash', INDETERMINATE: 'warning'
};

function capabilityRow(f: Framework, caps: CapabilitiesState | undefined, connectionId?: string): StrategyRow {
  const info = FRAMEWORKS[f];
  const unknown: StrategyRow = { id: `capability.${f}`, label: info.label, description: DISCOVERY_LABELS.UNKNOWN, icon: 'circle-large-outline', muted: true,
    tooltip: `${info.purpose}.\nTo verify: ${info.mustVerify}.\n${PREVIEW}`, command: { id: 'psft.customization.discover', args: [info.label] } };
  if (f !== 'EVENT_MAPPING') return unknown;
  if (!caps || caps.state === 'pending') return { ...unknown, description: 'Discovering…', icon: 'loading~spin', tooltip: `${info.purpose}.` };
  if (caps.state === 'unavailable') return { ...unknown, tooltip: `${info.purpose}.\n${caps.message}` };
  const d = caps.eventMapping;
  if (!d) return unknown;
  return {
    id: `capability.${f}`, label: info.label, icon: STATE_ICONS[d.state], muted: d.state !== 'VERIFIED_AVAILABLE',
    description: `${DISCOVERY_LABELS[d.state]}${d.state === 'VERIFIED_AVAILABLE' ? ` · ${d.mappings.length} configured` : ''}`,
    tooltip: `${info.purpose}.\n${d.evidence.join('\n')}`,
    children: [
      ...d.evidence.map((line, i) => ({ id: `capability.${f}.evidence.${i}`, label: line, icon: 'debug-stackframe-dot', muted: true, tooltip: line })),
      ...(caps.knowledge && caps.knowledge.answer !== 'UNKNOWN' ? [{
        id: `capability.${f}.knowledge`, label: `Knowledge: ${caps.knowledge.answer}${caps.knowledge.release ? ` on PeopleTools ${caps.knowledge.release}` : ''}`,
        description: `${caps.knowledge.findings.length} finding${caps.knowledge.findings.length === 1 ? '' : 's'}`,
        icon: caps.knowledge.answer === 'VERIFIED' ? 'verified' : caps.knowledge.answer === 'UNSUPPORTED' || caps.knowledge.answer === 'CONFLICTING' ? 'warning' : 'beaker',
        tooltip: `What PeopleSoft Studio's recorded findings say about Event Mapping on this release (information, never permission):\n${caps.knowledge.findings.map((k) => `• ${k.title} (${k.source}, ${k.status})`).join('\n')}`,
        command: { id: 'psft.intelligence.showDiscoveries' }
      }] : []),
      // Configure Event Mapping on each content reference the component is registered as (editors/eventMappingPanel.ts).
      ...(connectionId ? d.contentReferences.map((c) => ({
        id: `capability.${f}.configure.${c.portal}.${c.name}`, label: `Configure Event Mapping…`, description: `${c.label} · ${c.name}`, icon: 'edit',
        tooltip: `Open ${c.name} (${c.portal}, "${c.label}") in the Event Mapping editor: map its events to Application Class services, saved as PeopleTools' Configure Event Mapping page saves them.`,
        command: { id: 'psft.customization.configureEventMapping', args: [connectionId, c.name, c.portal] }
      })) : []),
      ...d.mappings.map((m, i) => {
        const cref = d.contentReferences.find((c) => c.name === m.contentReference);
        return {
          id: `capability.${f}.mapping.${i}`, label: describeMapping(m), icon: m.enabled ? 'symbol-event' : 'circle-slash',
          description: `${m.contentReference}${m.operator ? ` · ${m.operator === 'PPLSOFT' ? 'Oracle' : m.operator}` : ''}`,
          tooltip: `${describeMapping(m)}\nContent reference ${m.contentReference}${m.updated ? `; last saved by ${m.operator} on ${m.updated}` : ''}`,
          ...(connectionId && cref ? { command: { id: 'psft.customization.configureEventMapping', args: [connectionId, cref.name, cref.portal] } } : {})
        };
      })
    ]
  };
}

export function strategySections(ctx: CustomizationContext | undefined, policy: CustomizationPolicy, pinned: boolean, owner?: OwnershipState, caps?: CapabilitiesState): StrategyRow[] {
  if (!ctx) {
    return [{ id: 'none', label: 'No PeopleSoft definition', description: 'open one to see its strategy', icon: 'info', muted: true,
      tooltip: 'The view follows the PeopleSoft definition in the active editor.' }];
  }
  const kind = singular(typeLabel(ctx.type));
  const frameworks = frameworksFor(ctx.type);
  return [
    { id: 'identity', label: 'Object Identity', icon: 'symbol-class', children: [
      { id: 'identity.object', label: ctx.name, description: kind, icon: 'file-code', tooltip: `${ctx.name} · ${kind}${ctx.connection ? ` · ${ctx.connection}` : ''}` },
      ...(ctx.connection ? [{ id: 'identity.connection', label: 'Connection', description: ctx.connection, icon: 'plug' }] : []),
      ...ownershipRows(ctx, policy, owner)
    ] },
    { id: 'strategy', label: 'Preferred Strategy', icon: 'compass', children: [
      { id: 'strategy.default', label: POLICY_LABELS[policy.defaultStrategy], icon: 'law',
        tooltip: 'A policy preference (peoplesoft.customization.defaultStrategy), not a determination that a configuration solution is feasible.' },
      { id: 'strategy.delivered', label: 'Your edits', description: POLICY_LABELS[policy.deliveredObjectPolicy], icon: 'shield',
        tooltip: 'peoplesoft.customization.deliveredObjectPolicy: your saves, renames and deletes, in the editors and designers, of an Oracle- or vendor-delivered definition or one of unknown ownership.' },
      { id: 'strategy.agent', label: 'AI agent edits', description: POLICY_LABELS[policy.agentDeliveredObjectPolicy], icon: 'hubot',
        tooltip: 'peoplesoft.customization.agentDeliveredObjectPolicy: the same writes made by an AI agent through the MCP. An agent cannot approve them; you do, in VS Code.' }
    ] },
    { id: 'capabilities', label: 'Configuration Capabilities', icon: 'extensions', children: frameworks.length
      ? frameworks.map((f) => capabilityRow(f, caps, ctx.connectionId))
      : [{ id: 'capability.none', label: 'None documented for this type', icon: 'circle-slash', muted: true }] },
    { id: 'impact', label: 'Dependencies & Upgrade Impact', icon: 'references', children: [
      { id: 'impact.none', label: 'Not analyzed', icon: 'circle-large-outline', muted: true, tooltip: `No customization registry yet. ${PREVIEW}` }
    ] },
    { id: 'actions', label: 'Actions', icon: 'play', children: [
      { id: 'action.discover', label: 'Discover Capabilities', icon: 'search', muted: true, command: { id: 'psft.customization.discover' } },
      { id: 'action.plan', label: 'Open Plan Designer', icon: 'notebook', command: { id: 'psft.customization.openPlan' } },
      pinned
        ? { id: 'action.unpin', label: 'Unpin', description: `following ${ctx.name}`, icon: 'pinned', command: { id: 'psft.customization.unpin' } }
        : { id: 'action.pin', label: 'Pin this definition', icon: 'pin', command: { id: 'psft.customization.pin' } }
    ] }
  ];
}

/** The definition a designer panel shows, from its view type and title (an open webview has no URI). */
export const DESIGNER_TYPES: Readonly<Record<string, DefinitionType>> = {
  'psft.page': DefinitionType.Page, 'psft.component': DefinitionType.Component, 'psft.menuDesigner': DefinitionType.Menu,
  'psft.ciDesigner': DefinitionType.ComponentInterface, 'psft.aeDesigner': DefinitionType.AppEngineProgram,
  'psft.channelDesigner': DefinitionType.MessageChannel, 'psft.recordEditor': DefinitionType.Record, 'psft.fieldEditor': DefinitionType.Field
};

/** A panel title as its definition's name: the dirty marker dropped, a component's market kept apart. */
export function nameFromTitle(title: string): string {
  return title.replace(/^●\s*/, '').trim().split(/[\s(]/)[0];
}

/** The plan editor's stages. */
export const PLAN_STAGES = ['Requirement', 'Discover', 'Strategy', 'Validate', 'Approval'] as const;
