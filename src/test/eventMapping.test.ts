import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType } from '../model/definitions.js';
import { describeMapping, discoveryFor, EVENT_LEVEL_LABELS, eventLabel, type EventMappingRow } from '../model/eventMapping.js';
import { strategySections, type CustomizationPolicy, type StrategyRow } from '../model/customizationStrategy.js';

/*
 * Event Mapping discovery's model (docs/CUSTOMIZATION.md): the levels as the
 * Configure Event Mapping page shows them (not PSXLATITEM's labels), the
 * verdict from content references, and the view's rows -- HRDMO's
 * DEPEND_BENEF configuration as the page showed it.
 */

const DEP: EventMappingRow[] = [
  { contentReference: 'HC_DEPEND_BENEF_GBL8', serviceId: 'EOCC_MASK_POSTBUILD', applicationClass: 'EOCC_COMP_CONFIG:Services:Component_Mask_PostBuild', level: 'C', event: 'POST', processing: 'POST', sequence: 999, enabled: true, operator: 'PPLSOFT' },
  { contentReference: 'HC_DEPEND_BENEF_GBL8', serviceId: 'EOCC_MASK_ROWINIT', applicationClass: 'EOCC_COMP_CONFIG:Services:CompRecord_Mask_RowInit', level: 'P', record: 'DEP_BEN', event: 'RINI', processing: 'POST', sequence: 999, enabled: true, operator: 'PPLSOFT' },
  { contentReference: 'HC_DEPEND_BENEF_GBL8', serviceId: 'EOCC_MASK_PAGEACTIVATE', applicationClass: 'EOCC_COMP_CONFIG:Services:Page_Activate_Mask', level: 'R', page: 'DEPEND_BENEF_ADDR', event: 'PACT', processing: 'POST', sequence: 999, enabled: true, operator: 'JARED' }
];
const CREF = { portal: 'EMPLOYEE', name: 'HC_DEPEND_BENEF_GBL8', label: 'Dependent Information', menu: 'ADMINISTER_WORKFORCE_(GBL)' };

test('levels and events as the Configure Event Mapping page shows them: P is Record, R is Page', () => {
  assert.deepEqual(EVENT_LEVEL_LABELS, { C: 'Component', P: 'Record', R: 'Page', F: 'Record Field' });
  assert.equal(eventLabel({ level: 'C', event: 'POST' }), 'PostBuild');
  assert.equal(eventLabel({ level: 'P', event: 'RINI' }), 'RowInit');
  assert.equal(eventLabel({ level: 'R', event: 'PACT' }), 'Activate');
  assert.equal(describeMapping(DEP[1]), 'Record DEP_BEN RowInit -> EOCC_MASK_ROWINIT (EOCC_COMP_CONFIG:Services:CompRecord_Mask_RowInit), Post Process, sequence 999');
  assert.match(describeMapping({ ...DEP[2], enabled: false }), /^Page DEPEND_BENEF_ADDR Activate .*, disabled$/);
});

test('available only when registered as a content reference; the evidence says so', () => {
  const none = discoveryFor('ZZ_X.GBL', [], [], 325);
  assert.equal(none.state, 'VERIFIED_UNAVAILABLE');
  assert.match(none.evidence[0], /not registered as a content reference/);
  const dep = discoveryFor('DEPEND_BENEF.GBL', [CREF], DEP, 325);
  assert.equal(dep.state, 'VERIFIED_AVAILABLE');
  assert.match(dep.evidence[1], /3 Event Mapping configurations already on it \(2 delivered by Oracle\)/);
  assert.match(discoveryFor('JOB_DATA.GBL', [CREF], [], 325).evidence[1], /No Event Mapping configuration/);
});

test('the view: Event Mapping verified with its configurations; the other frameworks still unknown', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const ctx = { type: DefinitionType.Component, name: 'DEPEND_BENEF' };
  const rows = all(strategySections(ctx, policy, false, undefined, { state: 'done', eventMapping: discoveryFor('DEPEND_BENEF.GBL', [CREF], DEP, 325) }));
  const em = rows.find((r) => r.id === 'capability.EVENT_MAPPING')!;
  assert.equal(em.description, 'Verified available · 3 configured');
  assert.equal(em.muted, false);
  assert.equal(rows.filter((r) => r.id.startsWith('capability.EVENT_MAPPING.mapping.')).length, 3);
  assert.equal(rows.find((r) => r.id === 'capability.DROP_ZONES')!.description, 'Unknown');
  const pending = all(strategySections(ctx, policy, false, undefined, { state: 'pending' })).find((r) => r.id === 'capability.EVENT_MAPPING')!;
  assert.equal(pending.description, 'Discovering…');
  const unavailable = all(strategySections(ctx, policy, false, undefined, { state: 'done', eventMapping: discoveryFor('ZZ_X.GBL', [], [], 325) })).find((r) => r.id === 'capability.EVENT_MAPPING')!;
  assert.deepEqual([unavailable.description, unavailable.icon], ['Verified unavailable', 'circle-slash']);
});
