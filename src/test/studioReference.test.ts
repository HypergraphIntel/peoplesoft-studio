import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { studioReference } from '../mcp/studioReference.js';
import { CONFIGURATION_TOOLS, type ToolNode } from '../model/toolTrees.js';

test('every available configuration leaf routes to implemented MCP tools', () => {
  const reference = studioReference();
  const source = readdirSync(resolve('src/mcp')).filter(name => name.endsWith('.ts') && name !== 'studioReference.ts')
    .map(name => readFileSync(resolve('src/mcp', name), 'utf8')).join('\n');
  const registered = new Set([...source.matchAll(/registerTool\(\s*['"]([^'"]+)/g)].map(match => match[1]));
  const leaves = (nodes: readonly ToolNode[]): ToolNode[] => nodes.flatMap(node => node.children ? leaves(node.children) : [node]);
  const catalog = JSON.stringify(reference.configurationTools);
  for (const node of leaves(CONFIGURATION_TOOLS)) assert.ok(catalog.includes(node.label), node.label);
  for (const match of catalog.matchAll(/psft_[a-z_]+/g)) assert.ok(registered.has(match[0]), `${match[0]} is not registered`);
  assert.ok(!catalog.includes('No dedicated MCP workflow documented'), 'New tool entries need explicit coverage');
});

test('orientation distinguishes planned data tools and definition packages', () => {
  const reference = studioReference();
  for (const entry of reference.dataMigrationTools as { studioStatus: string; tools: string[] }[]) {
    assert.equal(entry.studioStatus, 'PLANNED');
    assert.deepEqual(entry.tools, []);
  }
  assert.match(reference.projectMigration.limits, /No MCP import\/apply tool/);
  assert.ok(reference.definitionTypes.some(type => type.mcpAccess.startsWith('Not in')));
  assert.ok(reference.customizationStrategy.limits.some(limit => limit.includes('not an enforced')));
});
