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
  { label: 'Process Definitions', icon: 'run', command: 'psft.process.open' },
  { label: 'Customization', icon: 'wand', children: [
    { label: 'Page and Field Configurator', icon: 'layout', command: 'psft.customization.openPageFieldConfigurator' },
    { label: 'Event Mapping', icon: 'symbol-event', command: 'psft.customization.configureEventMapping' },
    { label: 'Drop Zones', icon: 'inbox', command: 'psft.customization.configureDropZones' },
    { label: 'Configurable Search', icon: 'search-fuzzy', planned: true }
  ] },
  { label: 'Administration', icon: 'settings', children: [
    { label: 'Message Catalog', icon: 'comment', command: 'psft.administration.messages' },
    { label: 'Text Catalog', icon: 'symbol-text', command: 'psft.administration.text' },
    { label: 'URL Definitions', icon: 'link', command: 'psft.administration.urls' }
  ] },
  { label: 'Portal Registry', icon: 'globe', children: [
    { label: 'Structure & Content', icon: 'list-tree', command: 'psft.portal.structure' }
  ] },
  { label: 'Integration Broker', icon: 'radio-tower', children: [
    { label: 'Message Definitions', icon: 'mail', command: 'psft.ib.message' },
    { label: 'Document Definitions', icon: 'file-code', command: 'psft.ib.document' },
    { label: 'Service', icon: 'server', command: 'psft.ib.service' },
    { label: 'Service Operation', icon: 'arrow-swap', command: 'psft.ib.operation' },
    { label: 'Nodes', icon: 'server-environment', command: 'psft.ib.node' },
    { label: 'Routes', icon: 'git-merge', command: 'psft.ib.routing' }
  ] },
  { label: 'Security', icon: 'shield', children: [
    { label: 'OAuth', icon: 'key', command: 'psft.security.oauth' },
    { label: 'SAML', icon: 'lock', command: 'psft.security.saml' }
  ] }
];

export const DATA_MIGRATION_TOOLS: readonly ToolNode[] = [
  { label: 'Data Mover Scripts', icon: 'terminal', command: 'psft.dataMover.newScript' },
  { label: 'Import Migration Package…', icon: 'import', command: 'psft.project.importMigration' },
  { label: 'Data Migration Workbench', icon: 'package', planned: true }
];

export const TOOL_TREES = {
  'psft.configurationTools': { title: 'Configuration Tools', nodes: CONFIGURATION_TOOLS },
  'psft.dataMigrationTools': { title: 'Data Migration Tools', nodes: DATA_MIGRATION_TOOLS }
} as const;

export type ToolViewId = keyof typeof TOOL_TREES;
