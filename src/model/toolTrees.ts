/*
 * The Configuration Tools and Data Migration Tools panes' trees
 * (views/toolsViews.ts): PeopleSoft's online tools, as entries. `planned`
 * entries are placeholders -- shown greyed, not available yet; a built entry
 * runs its `command`.
 */

export interface ToolNode {
  label: string;
  /** A codicon name. */
  icon: string;
  children?: ToolNode[];
  /** Not built yet: shown greyed, and choosing it says so. */
  planned?: boolean;
  /** What choosing a built entry runs. */
  command?: string;
}

export const CONFIGURATION_TOOLS: readonly ToolNode[] = [
  { label: 'PS Query', icon: 'search', command: 'psft.query.open' },
  { label: 'Customization', icon: 'wand', children: [
    { label: 'Page and Field Configurator', icon: 'layout', planned: true },
    { label: 'Event Mapping', icon: 'symbol-event', command: 'psft.customization.configureEventMapping' },
    { label: 'Drop Zones', icon: 'inbox', planned: true }
  ] },
  { label: 'Administration', icon: 'settings', planned: true, children: [
    { label: 'Message Catalog', icon: 'comment', planned: true },
    { label: 'Text Catalog', icon: 'symbol-text', planned: true },
    { label: 'URL Definitions', icon: 'link', planned: true }
  ] },
  { label: 'Portal Registry', icon: 'globe', planned: true, children: [
    { label: 'Structure & Content', icon: 'list-tree', planned: true }
  ] },
  { label: 'Integration Broker', icon: 'radio-tower', planned: true, children: [
    { label: 'Message Definitions', icon: 'mail', planned: true },
    { label: 'Document Definitions', icon: 'file-code', planned: true },
    { label: 'Service', icon: 'server', planned: true },
    { label: 'Service Operation', icon: 'arrow-swap', planned: true },
    { label: 'Nodes', icon: 'server-environment', planned: true },
    { label: 'Routes', icon: 'git-merge', planned: true }
  ] },
  { label: 'Security', icon: 'shield', planned: true, children: [
    { label: 'OAuth', icon: 'key', planned: true },
    { label: 'SAML', icon: 'lock', planned: true }
  ] }
];

export const DATA_MIGRATION_TOOLS: readonly ToolNode[] = [
  { label: 'Data Mover Scripts', icon: 'terminal', planned: true },
  { label: 'Data Migration Workbench', icon: 'package', planned: true }
];

export const TOOL_TREES = {
  'psft.configurationTools': { title: 'Configuration Tools', nodes: CONFIGURATION_TOOLS },
  'psft.dataMigrationTools': { title: 'Data Migration Tools', nodes: DATA_MIGRATION_TOOLS }
} as const;

export type ToolViewId = keyof typeof TOOL_TREES;
