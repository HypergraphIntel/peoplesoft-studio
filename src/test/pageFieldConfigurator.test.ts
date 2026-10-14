import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSequence, pfcDiscoveryFor, type PfcConfiguration, type PfcSequence } from '../model/pageFieldConfigurator.js';
import { strategySections, type CustomizationPolicy, type StrategyRow } from '../model/customizationStrategy.js';
import { DefinitionType } from '../model/definitions.js';

/*
 * Page and Field Configurator discovery's model, from HRDMO's delivered
 * configurations: Person Data Fluid hides 5 fields but has no EOCC Event
 * Mapping (so does nothing); Dependent/Beneficiary masking is applied on 1 of
 * its 5 content references; Job Code Table is registered with none.
 */

const seq = (over: Partial<PfcSequence> = {}): PfcSequence => ({
  number: 1, description: '', active: true, applyTo: 'A', formFactors: ['Small', 'Medium', 'Large', 'Extra Large'], criteria: 0, pagesHidden: 0, pagesDisplayOnly: 0,
  fields: { total: 5, hidden: 5, required: 0, relabelled: 0, disabled: 0, defaulted: 0, blanked: 0, masked: 0 }, ...over
});
const config = (sequences: PfcSequence[], over: Partial<PfcConfiguration> = {}): PfcConfiguration =>
  ({ component: 'PERSONAL_DATA_FL', market: 'GBL', type: 'STD', description: 'Person Data Configuration', active: true, sequences, ...over });

test('a sequence reads as what it changes and for whom', () => {
  assert.equal(describeSequence(seq()), 'Sequence 1: hides 5 fields · everyone');
  assert.equal(describeSequence(seq({ number: 10, description: 'NOA 9xx', applyTo: 'R', role: 'PAR Requestor', criteria: 1, pagesHidden: 2,
    fields: { total: 9, hidden: 3, required: 1, relabelled: 2, disabled: 0, defaulted: 0, blanked: 0, masked: 0 } })),
  'Sequence 10 "NOA 9xx": hides 3 fields, hides 2 pages, 1 required, 2 relabelled · role PAR Requestor · 1 criterion');
  assert.match(describeSequence(seq({ fields: { total: 4, hidden: 0, required: 0, relabelled: 0, disabled: 0, defaulted: 0, blanked: 0, masked: 0 }, active: false })),
    /4 fields listed, none changed .* inactive$/);
});

test('a configured component without EOCC Event Mapping is available but not applied [PERSONAL_DATA_FL]', () => {
  const d = pfcDiscoveryFor('PERSONAL_DATA_FL.GBL', true, ['HC_HR_PERSONAL_DATA_FL_GBL_FL'], [], [config([seq()])]);
  assert.equal(d.state, 'VERIFIED_AVAILABLE');
  assert.match(d.evidence[2], /Not applied: .* no effect at run time/);
});

test('applied on some content references says on which [DEPEND_BENEF]', () => {
  const crefs = ['HC_DEPEND_BENEF_GBL1', 'HC_DEPEND_BENEF_GBL2', 'HC_DEPEND_BENEF_GBL7', 'HC_DEPEND_BENEF_GBL8', 'HC_S201605021225562241458581'];
  const d = pfcDiscoveryFor('DEPEND_BENEF.GBL', true, crefs, ['HC_DEPEND_BENEF_GBL8'], [config([seq({ applyTo: 'U' })], { component: 'DEPEND_BENEF', type: 'MASK' })]);
  assert.match(d.evidence[2], /on 1 of 5: HC_DEPEND_BENEF_GBL8 -- opened through the others/);
});

test('unregistered or not installed is verified unavailable; registered with none is available', () => {
  assert.equal(pfcDiscoveryFor('X.GBL', true, [], [], []).state, 'VERIFIED_UNAVAILABLE');
  assert.match(pfcDiscoveryFor('X.GBL', true, [], [], []).evidence[0], /not registered/);
  assert.match(pfcDiscoveryFor('X.GBL', false, ['A'], [], []).evidence[0], /not on this database/);
  const none = pfcDiscoveryFor('JOB_CODE_TBL.GBL', true, ['HC_C_JOB_CODE_TBL_GBL'], [], []);
  assert.equal(none.state, 'VERIFIED_AVAILABLE');
  assert.match(none.evidence[1], /No Page and Field Configurator configuration/);
});

test('the Strategy view row: sequences listed, a partly applied configuration flagged', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const pageFieldConfigurator = pfcDiscoveryFor('PERSONAL_DATA_FL.GBL', true, ['HC_HR_PERSONAL_DATA_FL_GBL_FL'], [], [config([seq()])]);
  const rows = all(strategySections({ type: DefinitionType.Component, name: 'PERSONAL_DATA_FL' }, policy, false, undefined, { state: 'done', pageFieldConfigurator }));
  const row = rows.find((r) => r.id === 'capability.PAGE_FIELD_CONFIGURATOR')!;
  assert.equal(row.description, 'Verified available · 1 sequence, applied on 0 of 1');
  assert.equal(row.icon, 'warning');
  assert.equal(rows.filter((r) => r.id.startsWith('capability.PAGE_FIELD_CONFIGURATOR.seq.')).length, 1);
});

test('the Strategy view offers to create a Standard configuration where a registered component has none', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const none = { ...pfcDiscoveryFor('JOB_CODE_TBL.GBL', true, ['HC_C_JOB_CODE_TBL_GBL'], [], []), components: [{ component: 'JOB_CODE_TBL', market: 'GBL' }] };
  const key = { type: DefinitionType.Component, name: 'JOB_CODE_TBL', connectionId: 'oracle:HRDMO' };
  const create = all(strategySections(key, policy, false, undefined, { state: 'done', pageFieldConfigurator: none }))
    .find((r) => r.id === 'capability.PAGE_FIELD_CONFIGURATOR.create.JOB_CODE_TBL.GBL');
  assert.deepEqual(create?.command, { id: 'psft.customization.createPageFieldConfiguration', args: ['oracle:HRDMO', 'JOB_CODE_TBL', 'GBL', 'STD'] });
  // Not a type it has (a Masking one is still offered), nor without a connection to save on.
  const has = { ...none, configurations: [config([seq()], { component: 'JOB_CODE_TBL', type: 'STD' })] };
  const ids = all(strategySections(key, policy, false, undefined, { state: 'done', pageFieldConfigurator: has })).map((r) => r.id).filter((id) => id.includes('.create.'));
  assert.deepEqual(ids, ['capability.PAGE_FIELD_CONFIGURATOR.create.JOB_CODE_TBL.GBL.MASK']);
  assert.ok(!all(strategySections({ type: DefinitionType.Component, name: 'JOB_CODE_TBL' }, policy, false, undefined, { state: 'done', pageFieldConfigurator: none })).some((r) => r.id.includes('.create.')));
});
