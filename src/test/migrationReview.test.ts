import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ReviewService, type ReviewAdapter } from '../changeReview/service.js';
import { ReviewStore } from '../changeReview/store.js';
import { hash, type Json } from '../changeReview/model.js';
import { migrationAdapter, migrationJson, migrationReviewKey, reviewedMigrationAsset, stageMigrationImport } from '../changeReview/migration.js';
import { migrationHash, parseMigrationPackage, previewMigrationImport, type MigrationAsset, type MigrationTarget } from '../migrationPackage.js';
import { DefinitionType, makeKey } from '../model/definitions.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'psft-migration-review-'));
  const assets: MigrationAsset[] = [
    { kind: 'html', key: makeKey(DefinitionType.HtmlDefinition, 'ZZ_HTML', '4'), data: { name: 'ZZ_HTML', text: '<p>Migration</p>\r\n', description: 'HTML' } },
    { kind: 'stylesheet', key: makeKey(DefinitionType.StyleSheet, 'ZZ_CSS'), data: { name: 'ZZ_CSS', text: 'p { color: red; }\r\n', description: 'CSS' } },
    { kind: 'peoplecode', key: makeKey(DefinitionType.RecordPeopleCode, 'ZZ_WORK', 'DESCR', 'FieldChange'), data: { name: 'ZZ_WORK', text: 'Local number &n = 1;\n' } }
  ];
  const body = { format: 'psft-migration/1', toolsRelease: '8.62', project: 'ZZ_PROJECT', assets,
    members: assets.map(a => a.key), requirements: [makeKey(0, 'ZZ_WORK'), makeKey(2, 'DESCR')] };
  const pkg = parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) }));
  const live = new Map<string, { data: MigrationAsset['data']; token: string }>(), writes: string[] = [];
  let identity = 'same-database';
  const target: MigrationTarget = { toolsRelease: '8.62', readIdentity: async () => identity,
    read: async a => live.get(hash(a.key)), exists: async () => true,
    write: async (a, token) => { assert.equal(live.get(hash(a.key))?.token ?? 'absent', token); writes.push(a.kind); live.set(hash(a.key), { data: a.data, token: 'v' + writes.length }); }, finish: async () => {} };
  const adapters: ReviewAdapter[] = assets.map(asset => ({ id: migrationAdapter(asset.kind),
    read: async (_e, key) => { const value = live.get(hash(key)); return { value: value ? migrationJson(value.data) : null, token: value?.token ?? 'absent' }; },
    validate: async (_e, key, _before, after) => { reviewedMigrationAsset(asset.kind, key, after); return []; }, authorize: async () => {},
    write: async (_e, key, after, before) => target.write(reviewedMigrationAsset(asset.kind, key, after), before.token) }));
  const service = new ReviewService(new ReviewStore(root), { environment: async () => ({ connection: 'oracle:LAB', identity, label: 'LAB' }), changed() {} }, adapters);
  return { root, pkg, target, live, writes, service, identity: (value: string) => { identity = value; }, close: () => rm(root, { recursive: true, force: true }) };
}

test('migration stages exact portable objects and native baselines durably; only fresh review applies them', async () => {
  const f = await fixture();
  try {
    const plan = await previewMigrationImport(f.pkg, f.target);
    let set = (await stageMigrationImport(f.service, 'oracle:LAB', f.pkg, plan, f.target))!;
    assert.equal(f.writes.length, 0);
    assert.ok(set.objects.every(c => c.review === 'PENDING' && c.operation === 'CREATE' && c.baselineToken === 'absent'));
    assert.deepEqual(set.objects.map(c => c.adapter), ['migration-html', 'migration-stylesheet', 'migration-peoplecode']);
    assert.equal((await new ReviewStore(f.root).get(set.id)).objects.length, 3);
    await assert.rejects(f.service.apply(set.id), /approved|Approved/);
    set = await f.service.validate(set.id);
    set = await f.service.review(set.id, set.objects.map(c => c.id), 'APPROVED', set.revision);
    set = await f.service.apply(set.id);
    assert.equal(set.status, 'APPLIED');
    assert.deepEqual(f.writes, ['html', 'stylesheet', 'peoplecode']);
    assert.ok(set.objects.every(c => c.application === 'VERIFIED' && c.after === c.verified));
  } finally { await f.close(); }
});

test('migration staging refuses preview target drift and closed adapter payloads reject forged keys', async () => {
  const f = await fixture();
  try {
    const plan = await previewMigrationImport(f.pkg, f.target);
    f.identity('other-database');
    await assert.rejects(stageMigrationImport(f.service, 'oracle:LAB', f.pkg, plan, f.target), /Target changed/);
    assert.equal(f.writes.length, 0);
    assert.throws(() => migrationReviewKey({ type: 51, parts: ['ZZ_HTML'], extra: true }), /Invalid/);
    assert.throws(() => reviewedMigrationAsset('html', migrationJson(makeKey(50, 'ZZ_HTML')), { name: 'ZZ_HTML', text: '', description: '' }), /identity/);
    const value = migrationJson({ name: 'ZZ_AE', version: 99, sections: [], nested: { lastUpdatedBy: 'old' } });
    assert.deepEqual(value, { name: 'ZZ_AE', sections: [], nested: {} } as Json);
  } finally { await f.close(); }
});
