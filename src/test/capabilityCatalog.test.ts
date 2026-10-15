import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { capabilityCatalog } from '../mcp/capabilityCatalog.js';
import { DefinitionType } from '../model/definitions.js';

test('catalog covers every modeled type exactly once and exposes bounded operations', () => {
  const result = capabilityCatalog({ kind: 'definition' });
  const entries = result.entries as { type: number; purpose: string; operations: Record<string, { status: string; tools: string[]; session: string }> }[];
  const types = Object.values(DefinitionType).filter(value => typeof value === 'number');
  assert.deepEqual(entries.map(entry => entry.type).sort((a, b) => a - b), types.sort((a, b) => Number(a) - Number(b)));
  for (const entry of entries) assert.ok(entry.purpose.length > 10);
  const query = entries.find(entry => entry.type === DefinitionType.Query)!;
  assert.deepEqual(query.operations.execute.tools, ['psft_query_run']);
  assert.equal(query.operations.edit.session, 'WRITE_HOST_REQUIRED');
  assert.equal(query.operations.delete.status, 'NOT_EXPOSED');
  const process = entries.find(entry => entry.type === DefinitionType.ProcessDefinition)!;
  assert.equal(process.operations.execute.status, 'NOT_EXPOSED');
  assert.equal(process.operations.create.status, 'NOT_EXPOSED');
});

test('catalog routes resolve to registered tools, filters compose and unknown types remain empty', () => {
  const source = readdirSync('src/mcp').filter(name => name.endsWith('.ts') && !['capabilityCatalog.ts', 'studioReference.ts'].includes(name))
    .map(name => readFileSync(`src/mcp/${name}`, 'utf8')).join('\n');
  const registered = new Set([...source.matchAll(/registerTool\(\s*['"]([^'"]+)/g)].map(match => match[1]));
  for (const match of JSON.stringify(capabilityCatalog()).matchAll(/psft_[a-z_]+/g)) assert.ok(registered.has(match[0]), match[0]);
  assert.equal(capabilityCatalog({ kind: 'definition', type: DefinitionType.Query, query: 'prompt' }, true).entries.length, 1);
  assert.equal(capabilityCatalog({ type: 99999 }).entries.length, 0);
  assert.equal(capabilityCatalog({ kind: 'dataMigration' }).entries.length, 3);
});
