import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropZoneDiscoveryFor, dropZoneFieldName, dropZoneLabel, type DropZone } from '../model/dropZones.js';
import { strategySections, type CustomizationPolicy, type StrategyRow } from '../model/customizationStrategy.js';
import { DefinitionType } from '../model/definitions.js';

const zone = (over: Partial<DropZone> = {}): DropZone => ({
  component: 'JOB_CODE_TBL', market: 'GBL', page: 'JOBCODE_TBL1_GBL', container: 'JOBCODE_TBL1_GBL', groupBoxId: 198, tabOrder: 194,
  level: 1, record: 'HR_CLS_DZ_S_WRK', field: 'HR_DZ_GB01', label: 'DZ-Bottom of Job Code And Profile',
  fieldName: '1.HR_CLS_DZ_S_WRK.HR_DZ_GB01.198', fieldId: 'JOBCODE_TBL1_GBL.198.', ...over
});

test('the drop-zone key is level.record.field.pnlfldid, blanks kept empty (HRDMO JOB_CODE_TBL)', () => {
  assert.equal(dropZoneFieldName(1, 'HR_CLS_DZ_S_WRK', 'HR_DZ_GB01', 198), '1.HR_CLS_DZ_S_WRK.HR_DZ_GB01.198');
  assert.equal(dropZoneFieldName(0, ' ', ' ', 7), '0...7');
});

test('a drop zone is labelled by its text, else REC.FIELD, else its field id', () => {
  assert.equal(dropZoneLabel('DZ-Top of Job Information page', 'R', 'F', 'P.1.'), 'DZ-Top of Job Information page');
  assert.equal(dropZoneLabel('  ', 'HR_JB_DZ_WRK', 'HR_JB_DZ_GB1', 'P.9.'), 'HR_JB_DZ_WRK.HR_JB_DZ_GB1');
  assert.equal(dropZoneLabel('', '', '', 'HR_JOBDATA_WL_FL.9.'), 'HR_JOBDATA_WL_FL.9.');
});

test('drop zones on the pages make Drop Zones available, with counts as evidence', () => {
  const d = dropZoneDiscoveryFor('JOB_CODE_TBL.GBL', [zone(), zone({ page: 'JOBCD_COMP_RATE', subpage: 'ZZ_MY_SBP' })], 'PT_ERCSUBPAGE_STUB');
  assert.equal(d.state, 'VERIFIED_AVAILABLE');
  assert.match(d.evidence[0], /2 drop zones on 2 pages of JOB_CODE_TBL.GBL/);
  assert.match(d.evidence[1], /1 configured/);
});

test('no drop zone is a verified unavailable, and says adding one is a customization', () => {
  const d = dropZoneDiscoveryFor('USERMAINT.GBL', [], 'PT_ERCSUBPAGE_STUB');
  assert.equal(d.state, 'VERIFIED_UNAVAILABLE');
  assert.match(d.evidence.join(' '), /delivered-object customization/);
});

test('no stub subpage in PSOPTIONS leaves it indeterminate', () => {
  assert.equal(dropZoneDiscoveryFor('X.GBL', [], '').state, 'INDETERMINATE');
});

test('the Strategy view shows Drop Zones discovered, with one row per drop zone', () => {
  const dropZones = dropZoneDiscoveryFor('JOB_CODE_TBL.GBL', [zone(), zone({ groupBoxId: 63, label: 'DZ-Bottom of Evaluation Criteria', subpage: 'ZZ_SBP' })], 'PT_ERCSUBPAGE_STUB');
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const rows = all(strategySections({ type: DefinitionType.Component, name: 'JOB_CODE_TBL' }, policy, false, undefined, { state: 'done', dropZones }));
  const row = rows.find((r) => r.id === 'capability.DROP_ZONES');
  assert.ok(row);
  assert.match(row!.description ?? '', /2 drop zones, 1 configured/);
  const zones = (row!.children ?? []).filter((c) => c.id.startsWith('capability.DROP_ZONES.zone.'));
  assert.equal(zones.length, 2);
  assert.match(zones[1].description ?? '', /ZZ_SBP/);
});

test('on a connection, each drop zone row configures it (its component, page and key)', () => {
  const dropZones = dropZoneDiscoveryFor('JOB_CODE_TBL.GBL', [zone()], 'PT_ERCSUBPAGE_STUB');
  const policy: CustomizationPolicy = { prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval' };
  const all = (rows: StrategyRow[]): StrategyRow[] => rows.flatMap((r) => [r, ...all(r.children ?? [])]);
  const rows = all(strategySections({ type: DefinitionType.Component, name: 'JOB_CODE_TBL', connectionId: 'oracle:HRDMO' }, policy, false, undefined, { state: 'done', dropZones }));
  const z = rows.find((r) => r.id === 'capability.DROP_ZONES.zone.0')!;
  assert.deepEqual(z.command, { id: 'psft.customization.configureDropZone', args: ['oracle:HRDMO', 'JOB_CODE_TBL', 'GBL', 'JOBCODE_TBL1_GBL', '1.HR_CLS_DZ_S_WRK.HR_DZ_GB01.198'] });
  const offline = all(strategySections({ type: DefinitionType.Component, name: 'JOB_CODE_TBL' }, policy, false, undefined, { state: 'done', dropZones }));
  assert.equal(offline.find((r) => r.id === 'capability.DROP_ZONES.zone.0')!.command, undefined);
});
