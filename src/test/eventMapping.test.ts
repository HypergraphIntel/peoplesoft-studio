import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType } from '../model/definitions.js';
import { describeMapping, discoveryFor, EVENT_LEVEL_LABELS, eventLabel, type EventMappingRow } from '../model/eventMapping.js';
import { knowledgeSubsystem, strategySections, type CustomizationPolicy, type StrategyRow } from '../model/customizationStrategy.js';

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

test('the view opens the Event Mapping editor on each content reference, and from each configuration row', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const caps = { state: 'done' as const, eventMapping: discoveryFor('DEPEND_BENEF.GBL', [CREF], DEP, 325) };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const on = all(strategySections({ type: DefinitionType.Component, name: 'DEPEND_BENEF', connection: 'HRDMO', connectionId: 'c1' }, policy, false, undefined, caps));
  const configure = on.filter((r) => r.id.startsWith('capability.EVENT_MAPPING.configure.'));
  assert.equal(configure.length, 1);
  assert.deepEqual(configure[0].command, { id: 'psft.customization.configureEventMapping', args: ['c1', 'HC_DEPEND_BENEF_GBL8', 'EMPLOYEE'] });
  assert.ok(on.filter((r) => r.id.startsWith('capability.EVENT_MAPPING.mapping.')).every((r) => r.command?.args?.[1] === 'HC_DEPEND_BENEF_GBL8'));
  // Without a connection there is nothing to open it on.
  const off = all(strategySections({ type: DefinitionType.Component, name: 'DEPEND_BENEF' }, policy, false, undefined, caps));
  assert.equal(off.filter((r) => r.id.startsWith('capability.EVENT_MAPPING.configure.')).length, 0);
});

test('the Event Mapping row shows what recorded knowledge says on the release -- information, with its findings', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const ctx = { type: DefinitionType.Component, name: 'DEPEND_BENEF', connection: 'HRDMO', connectionId: 'c1' };
  const em = discoveryFor('DEPEND_BENEF.GBL', [CREF], DEP, 325);
  const knowledge = { answer: 'UNVERIFIED' as const, release: '8.62.09', findings: [{ id: 'f-e3a3f17f095c20582322485d', title: 'Every row re-saved', source: 'local' as const, status: 'reproduced' }] };
  const row = all(strategySections(ctx, policy, false, undefined, { state: 'done', eventMapping: em, knowledge })).find((r) => r.id === 'capability.EVENT_MAPPING.knowledge')!;
  assert.equal(row.label, 'Knowledge: UNVERIFIED on PeopleTools 8.62.09');
  assert.equal(row.description, '1 finding');
  assert.match(row.tooltip!, /never permission[\s\S]*Every row re-saved \(local, reproduced\)/);
  const none = all(strategySections(ctx, policy, false, undefined, { state: 'done', eventMapping: em, knowledge: { answer: 'UNKNOWN', findings: [] } }));
  assert.equal(none.find((r) => r.id === 'capability.EVENT_MAPPING.knowledge'), undefined, 'nothing known: no row');
});

test('Studio Knowledge: each designer\'s definition shows what recorded findings say about writing it', () => {
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const page = { type: DefinitionType.Page, name: 'ZZ_PCODE_LAB_PG', connection: 'HRDMO', connectionId: 'c1' };
  const k = { answer: 'UNVERIFIED' as const, release: '8.62', findings: [{ id: 'f-6bbfd2ebcb24e3aa8d8a3bee', title: 'A page save moves PDM by 1', source: 'local' as const, status: 'reproduced' }] };
  const section = strategySections(page, policy, false, undefined, undefined, k).find((r) => r.id === 'knowledge')!;
  assert.equal(section.label, 'Studio Knowledge');
  assert.equal(section.children![0].label, 'UNVERIFIED on PeopleTools 8.62');
  assert.equal(section.children![0].description, '1 finding · page-designer');
  assert.deepEqual(section.children![1].command, { id: 'psft.intelligence.openDiscovery', args: ['any', 'f-6bbfd2ebcb24e3aa8d8a3bee'] });
  assert.equal(strategySections(page, policy, false, undefined, undefined, 'pending').find((r) => r.id === 'knowledge')!.children![0].id, 'knowledge.pending');
  assert.equal(strategySections(page, policy, false, undefined, undefined, { answer: 'UNKNOWN', findings: [] }).find((r) => r.id === 'knowledge')!.children![0].label, 'No recorded findings');
  assert.equal(knowledgeSubsystem(DefinitionType.AppEngineProgram), 'app-engine');
  assert.equal(knowledgeSubsystem(DefinitionType.MessageChannel), 'message-channel');
  assert.equal(strategySections({ type: DefinitionType.SqlDefinition, name: 'X' }, policy, false).find((r) => r.id === 'knowledge'), undefined, 'no section where no subsystem applies');
});
