import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_TOOLS, DATA_MIGRATION_TOOLS, TOOL_TREES, type ToolNode } from '../model/toolTrees.js';

/* The two tools panes retain their ordering as individual tools become available. */

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

test('every leaf is a placeholder or runs a command, every entry has an icon, and both panes are registered by id', () => {
  for (const n of [...all(CONFIGURATION_TOOLS), ...all(DATA_MIGRATION_TOOLS)]) {
    assert.ok(n.icon, n.label);
    if (!n.children?.length) assert.ok(n.planned !== !!n.command, `${n.label}: a leaf is either planned or built`);
  }
  // PS Query now opens its definition viewer; Event Mapping opens its configuration editor.
  const built = all(CONFIGURATION_TOOLS).filter((n) => n.command).map((n) => `${n.label} -> ${n.command}`);
  assert.deepEqual(built, ['PS Query -> psft.query.open', 'Event Mapping -> psft.customization.configureEventMapping']);
  assert.ok(!CONFIGURATION_TOOLS.find((n) => n.label === 'Customization')!.planned);
  assert.deepEqual(Object.keys(TOOL_TREES), ['psft.configurationTools', 'psft.dataMigrationTools']);
});
