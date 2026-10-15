import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csDiscoveryFor, describeCsConfiguration, type CsConfiguration } from '../model/configurableSearch.js';
import { strategySections, type CustomizationPolicy, type StrategyRow } from '../model/customizationStrategy.js';
import { DefinitionType } from '../model/definitions.js';

/*
 * Configurable Search discovery (model/configurableSearch.ts) on the shapes of
 * HRDMO's: PAY_SHEET_LINE's Standard Search on PAY_LINE_WORKX and
 * DEPEND_BENEF's Keyword Search on HC_BEN_DEPBEN_DATA, both inactive.
 */

const fields = (o: Partial<CsConfiguration['fields']> = {}): CsConfiguration['fields'] =>
  ({ total: 38, criteria: 10, results: 12, smallFormFactor: 12, keys: 3, relabelled: 0, required: 0, hidden: 0, displayOnly: 0, defaulted: 1, ...o });
const PAY: CsConfiguration = { cref: 'HC_PAY_SHEET_LINE_USA2', component: 'PAY_SHEET_LINE', market: 'USA', searchId: 'EMPLOYEE_HC_PAY_SHEET_LINE_USA2',
  effdt: '1900-01-01', type: 'S', source: 'PAY_LINE_WORKX', active: false, fields: fields() };

test('a configuration in a line, as the search page will behave', () => {
  assert.equal(describeCsConfiguration(PAY), 'Standard Search on PAY_LINE_WORKX, inactive: 38 fields, 10 criteria, 12 results; 1 default');
  assert.equal(describeCsConfiguration({ ...PAY, type: 'E', source: 'HC_BEN_DEPBEN_DATA', active: true, fields: fields({ total: 27, criteria: 15, results: 7, defaulted: 0, hidden: 2 }) }),
    'Keyword Search on HC_BEN_DEPBEN_DATA, active: 27 fields, 15 criteria, 7 results; 2 hidden');
});

test('the verdict: installed, registered, configured, active', () => {
  assert.equal(csDiscoveryFor('X.GBL', false, ['A'], []).state, 'VERIFIED_UNAVAILABLE');
  assert.match(csDiscoveryFor('X.GBL', true, [], []).evidence[0], /not registered/);
  assert.match(csDiscoveryFor('JOB_CODE_TBL.GBL', true, ['HC_C_JOB_CODE_TBL_GBL', 'HC_JOB_CODE_TBL_GBL2'], []).evidence[0], /No search configuration on its 2 content references/);
  const d = csDiscoveryFor('PAY_SHEET_LINE.USA', true, ['HC_PAY_SHEET_LINE_USA2', 'HC_PAY_SHEET_LINE_USA3'], [PAY, { ...PAY, cref: 'HC_PAY_SHEET_LINE_USA3' }]);
  assert.equal(d.state, 'VERIFIED_AVAILABLE');
  assert.match(d.evidence[0], /2 search configurations on 2 content references; none active/);
});

test('the Strategy view row lists each configuration, an inactive one greyed', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const configurableSearch = csDiscoveryFor('PAY_SHEET_LINE.USA', true, ['HC_PAY_SHEET_LINE_USA2'], [PAY]);
  const rows = all(strategySections({ type: DefinitionType.Component, name: 'PAY_SHEET_LINE' }, policy, false, undefined, { state: 'done', configurableSearch }));
  const row = rows.find((r) => r.id === 'capability.CONFIGURABLE_SEARCH')!;
  assert.equal(row.description, 'Verified available · 1 configured, 0 active');
  const config = rows.find((r) => r.id === 'capability.CONFIGURABLE_SEARCH.config.0')!;
  assert.equal(config.muted, true);
  assert.match(config.description!, /HC_PAY_SHEET_LINE_USA2 · effective 1900-01-01/);
});
