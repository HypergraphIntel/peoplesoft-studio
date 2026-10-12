import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType } from '../model/definitions.js';
import {
  frameworksFor, nameFromTitle, singular, strategySections, type CustomizationPolicy, type StrategyRow
} from '../model/customizationStrategy.js';

/*
 * The Customization Strategy view's model (a preview): its five sections,
 * and -- the rule the design rests on -- nothing shown as known that no
 * environment has established.
 */

const POLICY: CustomizationPolicy = { prefixes: [{ prefix: 'ZZ_', owner: 'organization' }], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);

test('the five sections, in the panel design\'s order', () => {
  const rows = strategySections({ type: DefinitionType.Component, name: 'JOB_DATA', connection: 'HRDMO' }, POLICY, false);
  assert.deepEqual(rows.map((r) => r.label), ['Object Identity', 'Preferred Strategy', 'Configuration Capabilities', 'Dependencies & Upgrade Impact', 'Actions']);
  assert.deepEqual(rows[2].children!.map((r) => r.label), ['Event Mapping', 'Drop Zones', 'Page and Field Configurator', 'Configurable Search']);
});

test('ownership: being read, not readable, or classified with its evidence; capabilities stay unknown', () => {
  const ctx = { type: DefinitionType.Component, name: 'ZZ_PCODE_LAB_CMP' };
  const row = (owner?: Parameters<typeof strategySections>[3]) => all(strategySections(ctx, POLICY, false, owner)).find((r) => r.id === 'identity.ownership')!;
  assert.equal(row().description, 'Classifying…');
  const unavailable = row({ state: 'unavailable', message: 'not connected' });
  assert.deepEqual([unavailable.description, unavailable.muted], ['Unknown', true]);
  const done = row({ state: 'done', baseline: true, classification: { ownership: 'CUSTOM', confidence: 'MEDIUM', evidence: ['Saved locally.', 'Its name has the organization prefix ZZ_.'] } });
  assert.equal(done.description, 'Custom · medium confidence');
  assert.deepEqual(done.children!.map((r) => r.label), ['Saved locally.', 'Its name has the organization prefix ZZ_.']);
  // No baseline for the release: capturing one is offered; with one, not.
  const ids = (b: boolean) => all(strategySections(ctx, POLICY, false, { state: 'done', baseline: b, classification: { ownership: 'UNKNOWN', confidence: 'LOW', evidence: [] } })).map((r) => r.id);
  assert.ok(ids(false).includes('identity.baseline'));
  assert.ok(!ids(true).includes('identity.baseline'));
  // Both policies: yours (editors) and AI agents' (MCP).
  const strategy = all(strategySections(ctx, POLICY, false)).filter((r) => r.id.startsWith('strategy.'));
  assert.deepEqual(strategy.map((r) => `${r.label}: ${r.description ?? ''}`).slice(1), ['Your edits: Allow with audit record', 'AI agent edits: Require explicit approval']);
  // The prefix shows, as supporting evidence; capability discovery is still unknown.
  const rows = all(strategySections(ctx, POLICY, false));
  assert.equal(rows.find((r) => r.id === 'identity.prefix')?.description, 'ZZ_ · organization');
  // Event Mapping is discovered (eventMapping.test.ts); the frameworks not discovered yet stay unknown.
  for (const r of rows.filter((x) => x.id.startsWith('capability.') && !x.id.startsWith('capability.EVENT_MAPPING'))) assert.ok(r.muted && r.description === 'Unknown', r.id);
  assert.equal(all(strategySections({ type: DefinitionType.Component, name: 'JOB_DATA' }, POLICY, false)).find((r) => r.id === 'identity.prefix'), undefined);
});

test('frameworks by definition type: documented applicability only', () => {
  assert.deepEqual(frameworksFor(DefinitionType.AppEngineProgram), ['AE_PLUGINS']);
  assert.deepEqual(frameworksFor(DefinitionType.RecordPeopleCode), ['EVENT_MAPPING']);
  assert.deepEqual(frameworksFor(DefinitionType.Menu), []);
  const menu = strategySections({ type: DefinitionType.Menu, name: 'ZZ_PCODE_LAB_MENU' }, POLICY, false);
  assert.equal(menu[2].children![0].label, 'None documented for this type');
});

test('no definition: one hint row; pinned: Unpin offered', () => {
  assert.equal(strategySections(undefined, POLICY, false).length, 1);
  const actions = strategySections({ type: DefinitionType.Page, name: 'JOB_DATA1' }, POLICY, true)[4].children!;
  assert.ok(actions.some((r) => r.id === 'action.unpin'));
  assert.ok(!actions.some((r) => r.id === 'action.pin'));
});

test('designer titles and type labels', () => {
  assert.equal(nameFromTitle('● ZZ_PCODE_LAB_MENU'), 'ZZ_PCODE_LAB_MENU');
  assert.equal(nameFromTitle('JOB_DATA (GBL)'), 'JOB_DATA');
  assert.equal(singular('Message Channels'), 'Message Channel');
  assert.equal(singular('Application Classes'), 'Application Class');
  assert.equal(singular('Message Catalog Entries'), 'Message Catalog Entry');
});
