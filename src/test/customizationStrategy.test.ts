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

const POLICY: CustomizationPolicy = { organizationPrefix: 'ZZ_', defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'requireApproval' };
const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);

test('the five sections, in the panel design\'s order', () => {
  const rows = strategySections({ type: DefinitionType.Component, name: 'JOB_DATA', connection: 'HRDMO' }, POLICY, false);
  assert.deepEqual(rows.map((r) => r.label), ['Object Identity', 'Preferred Strategy', 'Configuration Capabilities', 'Dependencies & Upgrade Impact', 'Actions']);
  assert.deepEqual(rows[2].children!.map((r) => r.label), ['Event Mapping', 'Drop Zones', 'Page and Field Configurator', 'Configurable Search']);
});

test('nothing is claimed: ownership and every capability unknown, greyed -- even with the organization prefix', () => {
  for (const name of ['JOB_DATA', 'ZZ_PCODE_LAB_CMP']) {
    const rows = all(strategySections({ type: DefinitionType.Component, name }, POLICY, false));
    const ownership = rows.find((r) => r.id === 'identity.ownership')!;
    assert.equal(ownership.description, 'Unknown');
    assert.ok(ownership.muted);
    for (const r of rows.filter((x) => x.id.startsWith('capability.'))) assert.ok(r.muted && r.description === 'Unknown', r.id);
    assert.ok(!rows.some((r) => /verified|available|delivered\b/i.test(`${r.description ?? ''}`) && !/policy/i.test(r.id)), name);
  }
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
