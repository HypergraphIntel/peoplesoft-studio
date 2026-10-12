import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_TOOLS, DATA_MIGRATION_TOOLS, TOOL_TREES, type ToolNode } from '../model/toolTrees.js';

/* The two placeholder panes hold the tools asked for, in order, every one still planned. */

const outline = (nodes: readonly ToolNode[]): unknown[] => nodes.map((n) => (n.children ? { [n.label]: outline(n.children) } : n.label));
const all = (nodes: readonly ToolNode[]): ToolNode[] => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);

test('Configuration Tools: the requested tree', () => {
  assert.deepEqual(outline(CONFIGURATION_TOOLS), [
    'PS Query',
    { Customization: ['Page and Field Configurator', 'Event Mapping', 'Drop Zones'] },
    { Administration: ['Message Catalog', 'Text Catalog', 'URL Definitions'] },
    { 'Portal Registry': ['Structure & Content'] },
    { 'Integration Broker': ['Message Definitions', 'Document Definitions', 'Service', 'Service Operation', 'Nodes', 'Routes'] },
    { Security: ['OAuth', 'SAML'] }
  ]);
});

test('Data Migration Tools: the requested list', () => {
  assert.deepEqual(outline(DATA_MIGRATION_TOOLS), ['Data Mover Scripts', 'Data Migration Workbench']);
});

test('every entry is a placeholder with an icon, and both panes are registered by id', () => {
  for (const n of [...all(CONFIGURATION_TOOLS), ...all(DATA_MIGRATION_TOOLS)]) assert.ok(n.planned && n.icon, n.label);
  assert.deepEqual(Object.keys(TOOL_TREES), ['psft.configurationTools', 'psft.dataMigrationTools']);
});
