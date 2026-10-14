import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, DefinitionType } from '../model/definitions.js';
import { documentFromSpec } from '../model/aeSpec.js';
import { exportMigrationPackage, parseMigrationPackage, previewMigrationImport, applyMigrationImport, migrationHash,
  type MigrationPackageReader, type MigrationTarget, type MigrationAsset } from '../migrationPackage.js';

function source(): MigrationPackageReader {
  const items = [
    { key: makeKey(DefinitionType.Record, 'ZZ_AET') },
    { key: makeKey(DefinitionType.Field, 'ZZ_COUNT') },
    { key: makeKey(DefinitionType.AppEngineProgram, 'ZZ_AE') },
    { key: makeKey(DefinitionType.AppEngineSection, 'ZZ_AE', 'MAIN') },
    { key: makeKey(DefinitionType.AppEnginePeopleCode, 'ZZ_AE', 'MAIN    GBLdefault  1900-01-01', 'INIT', 'OnExecute') }
  ];
  return {
    listProjectItems: async () => items,
    readEnvironment: async () => ({ toolsRelease: '8.62' }),
    readTranslates: async () => [],
    readField: async () => ({ name: 'ZZ_COUNT', type: 2, length: 10, decimalPositions: 0, version: 99,
      labels: [{ id: 'ZZ_COUNT', longName: 'Count', shortName: 'Count', isDefault: true }] }),
    readRecordLayout: async () => ({ name: 'ZZ_AET', description: '', recordType: 2, sqlTableName: '', version: 22,
      fields: [{ fieldNum: 1, name: 'ZZ_COUNT', isSubrecord: false, type: 2, length: 10,
        shortName: 'Count', longName: 'Count', useEdit: 0x800000, hasPeopleCode: false,
        editTable: '', defaultRecord: '', defaultField: '' }] }),
    readAppEngineDocument: async () => ({ token: 'source-token', doc: documentFromSpec({
      program: 'ZZ_AE', disableRestart: true, stateRecords: [{ record: 'ZZ_AET', default: true }],
      sections: [{ name: 'MAIN', steps: [{ name: 'INIT', actions: [{ type: 'PeopleCode', peopleCode: 'Local number &n = 1;' }] }] }]
    }) })
  };
}
function target() {
  const stored = new Map<string, { data: MigrationAsset['data']; token: string }>();
  const written: string[] = [];
  let version = 0;
  let finished = false;
  const backend: MigrationTarget = {
    toolsRelease: '8.62', exists: async () => true,
    read: async asset => stored.get(asset.data.name),
    write: async asset => {
      written.push(asset.data.name);
      stored.set(asset.data.name, { data: JSON.parse(JSON.stringify(asset.data)), token: String(++version) });
    },
    finish: async () => { finished = true; }
  };
  return { backend, stored, written, finished: () => finished };
}

test('Studio package exports complete supported project members and round-trips without installation stamps', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  assert.equal(pkg.format, 'psft-migration/1');
  assert.equal(pkg.members.length, 5);
  assert.equal(pkg.assets.length, 3);
  assert.equal(pkg.requirements.length, 0);
  assert.equal(JSON.stringify(pkg).includes('source-token'), false);
  assert.equal(JSON.stringify(pkg).includes('"version"'), false);
  assert.deepEqual(parseMigrationPackage(JSON.stringify(pkg)), pkg);
});

test('Studio import previews, writes in dependency order, verifies and is idempotent', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const t = target();
  const plan = await previewMigrationImport(pkg, t.backend);
  assert.deepEqual(plan.changes.map(c => c.asset.kind), ['field', 'record', 'ae']);
  const result = await applyMigrationImport(pkg, plan, t.backend);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.completed, ['ZZ_COUNT', 'ZZ_AET', 'ZZ_AE']);
  assert.ok(t.finished());
  const rerun = await previewMigrationImport(pkg, t.backend);
  assert.ok(rerun.changes.every(c => c.action === 'same'));
  assert.deepEqual((await applyMigrationImport(pkg, rerun, t.backend)).completed, []);
  assert.equal(t.written.length, 3);
});

test('unsupported members and corrupted packages cannot silently export or import', async () => {
  const reader = source();
  reader.listProjectItems = async () => [{ key: makeKey(DefinitionType.Page, 'ZZ_PAGE') }];
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_PROJECT'), /No migration adapter/);
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const corrupted = JSON.parse(JSON.stringify(pkg));
  corrupted.assets[0].data.name = 'ZZ_CHANGED';
  assert.throws(() => parseMigrationPackage(JSON.stringify(corrupted)), /checksum/);
  assert.throws(() => parseMigrationPackage(JSON.stringify({ ...pkg, format: 'unknown' })));
});

test('release mismatch and absent prerequisites block all writes', async () => {
  const reader = source();
  const original = reader.readRecordLayout;
  reader.readRecordLayout = async key => {
    const layout = (await original(key))!;
    layout.fields.push({ ...layout.fields[0], name: 'PROCESS_INSTANCE', fieldNum: 2 });
    return layout;
  };
  const pkg = await exportMigrationPackage(reader, 'ZZ_PROJECT');
  assert.equal(pkg.requirements[0].parts[0], 'PROCESS_INSTANCE');
  const t = target();
  t.backend.toolsRelease = '8.61';
  t.backend.exists = async () => false;
  const plan = await previewMigrationImport(pkg, t.backend);
  assert.equal(plan.blockers.length, 2);
  await assert.rejects(applyMigrationImport(pkg, plan, t.backend), /blocked/);
  assert.equal(t.written.length, 0);
});

test('target edits after preview are refused before any migration write', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const t = target();
  const plan = await previewMigrationImport(pkg, t.backend);
  t.stored.set('ZZ_COUNT', { data: pkg.assets.find(a => a.kind === 'field')!.data, token: 'new' });
  await assert.rejects(applyMigrationImport(pkg, plan, t.backend), /Target changed/);
  assert.equal(t.written.length, 0);
});

test('failed verification reports completed saves and never finishes the project', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const t = target();
  const original = t.backend.write;
  t.backend.write = async (asset, token) => {
    await original(asset, token);
    if (asset.kind === 'record') t.stored.set(asset.data.name, { data: { ...asset.data, name: 'WRONG' }, token: 'wrong' });
  };
  const result = await applyMigrationImport(pkg, await previewMigrationImport(pkg, t.backend), t.backend);
  assert.deepEqual(result.completed, ['ZZ_COUNT']);
  assert.equal(result.failed, 'ZZ_AET');
  assert.match(result.error!, /does not match/);
  assert.equal(t.finished(), false);
});

test('package mutations after preview invalidate the checksum before writes', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const t = target();
  const plan = await previewMigrationImport(pkg, t.backend);
  const field = pkg.assets.find(a => a.kind === 'field')!;
  if (field.kind === 'field') field.data.length = 12;
  await assert.rejects(applyMigrationImport(pkg, plan, t.backend), /checksum/);
  assert.equal(t.written.length, 0);
});

test('external requirements cannot be removed with a recomputed checksum', async () => {
  const reader = source();
  const original = reader.readRecordLayout;
  reader.readRecordLayout = async key => {
    const layout = (await original(key))!;
    layout.fields[0].editTable = 'ZZ_EXTERNAL';
    return layout;
  };
  const pkg = await exportMigrationPackage(reader, 'ZZ_PROJECT');
  const { checksum: _checksum, ...body } = pkg;
  body.requirements = [];
  assert.throws(() => parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) })), /dependency was omitted/);
});

test('source advanced record shapes stop export rather than losing settings', async () => {
  const reader = source();
  const original = reader.readRecordLayout;
  reader.readRecordLayout = async key => ({ ...(await original(key))!, indexIds: ['_', 'A'] });
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_PROJECT'), /secondary indexes/);
});

test('orphan AE members are rejected even with a recomputed checksum', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const { checksum: _checksum, ...body } = pkg;
  body.members.push(makeKey(DefinitionType.AppEnginePeopleCode, 'ZZ_AE', 'MAIN    GBLdefault  1900-01-01', 'MISSING', 'OnExecute'));
  assert.throws(() => parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) })), /no section or PeopleCode action/);
});
