import { DefinitionType, typeLabel } from './definitions.js';

/*
 * Customization Intelligence, the UI's model (CUSTOMIZATION_INTELLIGENCE.md,
 * CUSTOMIZATION_STRATEGY_PANEL.md): the evidence and lifecycle states, the
 * configuration frameworks, which of them apply to a definition, and the
 * Customization Strategy view's sections. A PREVIEW: nothing here inspects a
 * database yet, so every ownership is UNKNOWN and every capability UNKNOWN --
 * never a finding the environment has not produced. Pure: no `vscode`.
 */

/** Capability discovery: evidence-driven; never VERIFIED_* without target-environment evidence. */
export type DiscoveryState = 'UNKNOWN' | 'POTENTIAL' | 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'INDETERMINATE';
export const DISCOVERY_LABELS: Readonly<Record<DiscoveryState, string>> = {
  UNKNOWN: 'Unknown', POTENTIAL: 'Potential — requires discovery', VERIFIED_AVAILABLE: 'Verified available',
  VERIFIED_UNAVAILABLE: 'Verified unavailable', INDETERMINATE: 'Indeterminate'
};

/** A plan's lifecycle, kept apart from discovery so an available mechanism is never mistaken for a done change. */
export type PlanStatus = 'NOT_PLANNED' | 'DRAFT' | 'VALIDATED' | 'APPROVED' | 'APPLIED' | 'TESTED' | 'FAILED';

export type Ownership = 'DELIVERED' | 'CUSTOM' | 'PARTNER' | 'UNKNOWN' | 'DELIVERED_MODIFIED';
export const OWNERSHIP_LABELS: Readonly<Record<Ownership, string>> = {
  DELIVERED: 'Delivered', CUSTOM: 'Custom', PARTNER: 'Partner / third-party', UNKNOWN: 'Unknown', DELIVERED_MODIFIED: 'Delivered, modified'
};

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
}

export interface CustomizationPolicy {
  organizationPrefix: string;
  defaultStrategy: 'configurationFirst' | 'allowDirect';
  deliveredObjectPolicy: 'block' | 'requireApproval' | 'allowWithAudit';
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

const PREVIEW = 'Preview — classification and discovery are not implemented yet.';

/**
 * The Customization Strategy view's sections for a definition: Object
 * Identity, Preferred Strategy, Configuration Capabilities, Dependencies &
 * Upgrade Impact, Actions. Everything the environment would have to answer
 * shows as unknown.
 */
export function strategySections(ctx: CustomizationContext | undefined, policy: CustomizationPolicy, pinned: boolean): StrategyRow[] {
  if (!ctx) {
    return [{ id: 'none', label: 'No PeopleSoft definition', description: 'open one to see its strategy', icon: 'info', muted: true,
      tooltip: 'The view follows the PeopleSoft definition in the active editor.' }];
  }
  const kind = singular(typeLabel(ctx.type));
  const prefixed = !!policy.organizationPrefix && ctx.name.toUpperCase().startsWith(policy.organizationPrefix.toUpperCase());
  const frameworks = frameworksFor(ctx.type);
  return [
    { id: 'identity', label: 'Object Identity', icon: 'symbol-class', children: [
      { id: 'identity.object', label: ctx.name, description: kind, icon: 'file-code', tooltip: `${ctx.name} · ${kind}${ctx.connection ? ` · ${ctx.connection}` : ''}` },
      ...(ctx.connection ? [{ id: 'identity.connection', label: 'Connection', description: ctx.connection, icon: 'plug' }] : []),
      { id: 'identity.ownership', label: 'Ownership', description: OWNERSHIP_LABELS.UNKNOWN, icon: 'question', muted: true,
        tooltip: `Not classified. ${prefixed ? `The name has the organization prefix ${policy.organizationPrefix}, which` : 'A name prefix'} is a naming convention, not proof of ownership. ${PREVIEW}` },
      { id: 'identity.modified', label: 'Modified from baseline', description: 'Unknown', icon: 'diff', muted: true, tooltip: `No delivered baseline compared. ${PREVIEW}` }
    ] },
    { id: 'strategy', label: 'Preferred Strategy', icon: 'compass', children: [
      { id: 'strategy.default', label: POLICY_LABELS[policy.defaultStrategy], icon: 'law',
        tooltip: 'A policy preference (peoplesoft.customization.defaultStrategy), not a determination that a configuration solution is feasible.' },
      { id: 'strategy.delivered', label: 'Delivered-object edits', description: POLICY_LABELS[policy.deliveredObjectPolicy], icon: 'shield', muted: true,
        tooltip: 'peoplesoft.customization.deliveredObjectPolicy — not enforced yet.' }
    ] },
    { id: 'capabilities', label: 'Configuration Capabilities', icon: 'extensions', children: frameworks.length
      ? frameworks.map((f) => ({ id: `capability.${f}`, label: FRAMEWORKS[f].label, description: DISCOVERY_LABELS.UNKNOWN, icon: 'circle-large-outline', muted: true,
        tooltip: `${FRAMEWORKS[f].purpose}.\nTo verify: ${FRAMEWORKS[f].mustVerify}.\n${PREVIEW}`, command: { id: 'psft.customization.discover', args: [FRAMEWORKS[f].label] } }))
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
