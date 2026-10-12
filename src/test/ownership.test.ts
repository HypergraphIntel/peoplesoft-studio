import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runToolsAsAgent } from '../mcp/agentOrigin.js';
import { guardWrite, runAsAgent, setWriteGuard, writeOrigin, type GuardedWrite } from '../providers/writeGuard.js';
import { classifyOwnership, decideWrite, matchPrefix, normalizePrefixes, type NamingPrefix, type OwnershipEvidence } from '../model/ownership.js';

/*
 * Ownership from evidence (docs/CUSTOMIZATION.md): a delivered baseline
 * decides; without one the PPLSOFT stamp, an Oracle-delivered project and the
 * naming prefixes weigh in; a prefix alone is never proof; ambiguity is
 * UNKNOWN. And the delivered-object policy's answer to a write.
 */

const ZZ: NamingPrefix = { prefix: 'ZZ_', owner: 'organization', name: 'Acme Corp' };
const XYZ: NamingPrefix = { prefix: 'XYZ_', owner: 'partner', name: 'XYZ Bolt-On' };
const base = (contains: boolean) => ({ label: 'HRMS 9.20.00.000', contains });
const c = (e: Partial<OwnershipEvidence>) => classifyOwnership({ exists: true, ...e });

test('naming prefixes are a list: organization and bolt-on vendors; the longest wins; 0.8.4\'s single prefix as a fallback', () => {
  const list = normalizePrefixes([{ prefix: 'zz_', owner: 'organization' }, { prefix: 'XYZ_', owner: 'partner', name: 'XYZ' }, { prefix: 'XYZ_HR_', owner: 'partner' }, { prefix: ' ' }, { prefix: 'ZZ_' }]);
  assert.deepEqual(list.map((p) => `${p.prefix}:${p.owner}`), ['ZZ_:organization', 'XYZ_:partner', 'XYZ_HR_:partner']);
  assert.equal(matchPrefix('xyz_hr_job', list)?.prefix, 'XYZ_HR_');
  assert.equal(matchPrefix('JOB', list), undefined);
  assert.deepEqual(normalizePrefixes([], 'zz_'), [{ prefix: 'ZZ_', owner: 'organization' }]);
  assert.deepEqual(normalizePrefixes([{ prefix: 'AB_' }], 'zz_').map((p) => p.prefix), ['AB_']);
  assert.deepEqual(normalizePrefixes(['QQ_']), [{ prefix: 'QQ_', owner: 'organization' }]);
});

test('with a baseline of the release: it decides, and the stamp says modified', () => {
  assert.deepEqual([c({ baseline: base(true), operator: 'PPLSOFT' })].map((x) => [x.ownership, x.confidence]), [['DELIVERED', 'HIGH']]);
  assert.equal(c({ baseline: base(true), operator: 'JARED' }).ownership, 'DELIVERED_MODIFIED');
  // A delivered name with the organization's prefix is still delivered: the baseline outranks the prefix.
  assert.equal(c({ baseline: base(true), operator: 'JARED', prefix: ZZ }).ownership, 'DELIVERED_MODIFIED');
  assert.deepEqual([c({ baseline: base(false), operator: 'JARED', prefix: XYZ })].map((x) => [x.ownership, x.confidence]), [['PARTNER', 'HIGH']]);
  assert.deepEqual([c({ baseline: base(false), operator: 'JARED', prefix: ZZ })].map((x) => [x.ownership, x.confidence]), [['CUSTOM', 'HIGH']]);
  assert.deepEqual([c({ baseline: base(false), operator: 'PPLSOFT' })].map((x) => [x.ownership, x.confidence]), [['DELIVERED', 'MEDIUM']]);
  assert.deepEqual([c({ baseline: base(false), operator: 'JARED' })].map((x) => [x.ownership, x.confidence]), [['CUSTOM', 'MEDIUM']]);
});

test('without a baseline: the stamp, a delivered project, the prefixes -- and UNKNOWN when nothing decides', () => {
  assert.deepEqual([c({ operator: 'PPLSOFT' })].map((x) => [x.ownership, x.confidence]), [['DELIVERED', 'MEDIUM']]);
  assert.deepEqual([c({ operator: 'PPLSOFT', deliveredProject: 'PRJ1' })].map((x) => [x.ownership, x.confidence]), [['DELIVERED', 'HIGH']]);
  assert.deepEqual([c({ operator: 'JARED', deliveredProject: 'PRJ1' })].map((x) => [x.ownership, x.confidence]), [['DELIVERED_MODIFIED', 'LOW']]);
  assert.equal(c({ operator: 'JARED', prefix: XYZ }).ownership, 'PARTNER');
  assert.equal(c({ operator: 'JARED', prefix: ZZ }).ownership, 'CUSTOM');
  // A bolt-on installed under Oracle's operator: its prefix says whose, weakly.
  assert.deepEqual([c({ operator: 'PPLSOFT', prefix: XYZ })].map((x) => [x.ownership, x.confidence]), [['PARTNER', 'LOW']]);
  const unknown = c({ operator: 'JARED' });
  assert.deepEqual([unknown.ownership, unknown.confidence], ['UNKNOWN', 'LOW']);
  assert.ok(unknown.evidence.some((e) => /No delivered baseline/.test(e)));
  assert.equal(classifyOwnership({ exists: false }).ownership, 'UNKNOWN');
});

test('the delivered-object policy: Oracle\'s and vendors\' follow it, the organization\'s pass, unknown is asked, never refused', () => {
  const owner = (o: 'DELIVERED' | 'DELIVERED_MODIFIED' | 'PARTNER' | 'CUSTOM' | 'UNKNOWN') => ({ ownership: o, confidence: 'HIGH' as const, evidence: [] });
  for (const o of ['DELIVERED', 'DELIVERED_MODIFIED', 'PARTNER'] as const) {
    assert.equal(decideWrite(owner(o), 'block').action, 'refuse', o);
    assert.equal(decideWrite(owner(o), 'requireApproval').action, 'ask', o);
    assert.equal(decideWrite(owner(o), 'allowWithAudit').action, 'audit', o);
  }
  for (const p of ['block', 'requireApproval', 'allowWithAudit'] as const) assert.equal(decideWrite(owner('CUSTOM'), p).action, 'allow', p);
  assert.equal(decideWrite(owner('UNKNOWN'), 'block').action, 'ask');
  assert.equal(decideWrite(owner('UNKNOWN'), 'requireApproval').action, 'ask');
  assert.equal(decideWrite(owner('UNKNOWN'), 'allowWithAudit').action, 'audit');
  // A new definition has no owner to protect.
  assert.equal(decideWrite(owner('UNKNOWN'), 'block', false).action, 'allow');
});

test('a write knows whether an agent (an MCP tool call) or a person made it, across awaits', async () => {
  const seen: GuardedWrite[] = [];
  setWriteGuard(async (w) => { seen.push(w); });
  try {
    const key = { type: 0, parts: ['JOB'] };
    const write = async () => { await new Promise((r) => setTimeout(r, 1)); await guardWrite({ provider: {}, key, action: 'save' }); };
    assert.equal(writeOrigin(), 'user');
    await write();
    await runAsAgent(write);
    // Interleaved: each keeps its own origin.
    await Promise.all([runAsAgent(write), write()]);
    assert.deepEqual(seen.map((w) => w.origin), ['user', 'agent', 'agent', 'user']);
    assert.equal(writeOrigin(), 'user');
  } finally {
    setWriteGuard(undefined);
  }
});

test('the MCP server\'s tools run as an agent\'s, the rest of the extension as a person\'s', async () => {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  const server = { registerTool(name: string, _config: never, callback: never) { tools.set(name, callback as (...args: unknown[]) => unknown); } };
  runToolsAsAgent(server);
  server.registerTool('psft_any', {} as never, (async () => { await new Promise((r) => setTimeout(r, 1)); return writeOrigin(); }) as never);
  assert.equal(await tools.get('psft_any')!(), 'agent');
  assert.equal(writeOrigin(), 'user');
});
