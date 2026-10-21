import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, DefinitionType } from '../model/definitions.js';
import { documentFromSpec } from '../model/aeSpec.js';
import { exportMigrationPackage, parseMigrationPackage, previewMigrationImport, applyMigrationImport, migrationHash, assetRequirements,
  type MigrationPackageReader, type MigrationTarget, type MigrationAsset } from '../migrationPackage.js';
import { PAGE_SNAPSHOT_TABLES } from '../providers/pageSnapshot.js';

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
  reader.listProjectItems = async () => [{ key: makeKey(DefinitionType.FileLayout, 'ZZ_LAYOUT') }];
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
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_PROJECT'), /unread indexes/);
});

test('orphan AE members are rejected even with a recomputed checksum', async () => {
  const pkg = await exportMigrationPackage(source(), 'ZZ_PROJECT');
  const { checksum: _checksum, ...body } = pkg;
  body.members.push(makeKey(DefinitionType.AppEnginePeopleCode, 'ZZ_AE', 'MAIN    GBLdefault  1900-01-01', 'MISSING', 'OnExecute'));
  assert.throws(() => parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) })), /no section or PeopleCode action/);
});

function sqlSource(): MigrationPackageReader {
  return { ...source(), listProjectItems: async () => [{ key: makeKey(DefinitionType.SqlDefinition, 'ZZ_SQL', '0') }],
    readSqlForMigration: async () => ({ data: { name: 'ZZ_SQL', text: 'SELECT 1\r\nFROM PS_INSTALLATION',
      description: 'Migration SQL', definition: 'Comments with Unicode é', ownerId: 'PPT' }, version: 123, token: 'source-sql-token' }) };
}

test('standalone SQL round-trips all portable metadata and its SQLTYPE project membership', async () => {
  const pkg = await exportMigrationPackage(sqlSource(), 'ZZ_SQL_PRJ');
  assert.equal(pkg.assets[0].kind, 'sql');
  assert.deepEqual(pkg.members[0], makeKey(DefinitionType.SqlDefinition, 'ZZ_SQL', '0'));
  assert.deepEqual(parseMigrationPackage(JSON.stringify(pkg)), pkg);
  assert.equal(JSON.stringify(pkg).includes('source-sql-token'), false);
  assert.equal(JSON.stringify(pkg).includes('123'), false);
  const t = target();
  const created = await previewMigrationImport(pkg, t.backend);
  assert.equal(created.changes[0].action, 'create');
  assert.equal((await applyMigrationImport(pkg, created, t.backend)).error, undefined);
  const same = await previewMigrationImport(pkg, t.backend);
  assert.equal(same.changes[0].action, 'same');
  assert.deepEqual(same.changes[0].before, pkg.assets[0].data);
  const data = { ...pkg.assets[0].data, description: 'Target description' };
  t.stored.set('ZZ_SQL', { data, token: 'target-v2' });
  const update = await previewMigrationImport(pkg, t.backend);
  assert.equal(update.changes[0].action, 'update');
  assert.deepEqual(update.changes[0].before, data);
  assert.equal((await applyMigrationImport(pkg, update, t.backend)).error, undefined);
  assert.deepEqual(t.stored.get('ZZ_SQL')!.data, pkg.assets[0].data);
});

test('SQL variants, incomplete readers, noncanonical payloads and changed checksums cannot migrate', async () => {
  const reader = sqlSource();
  reader.listProjectItems = async () => [{ key: makeKey(DefinitionType.SqlDefinition, 'ZZ_SQL', '1') }];
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_SQL_PRJ'), /SQLTYPE 0/);
  reader.listProjectItems = sqlSource().listProjectItems;
  reader.readSqlForMigration = undefined;
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_SQL_PRJ'), /complete standalone SQL/);
  const pkg = await exportMigrationPackage(sqlSource(), 'ZZ_SQL_PRJ');
  for (const mutation of [
    (p: typeof pkg) => { p.assets[0].key = makeKey(DefinitionType.SqlDefinition, 'ZZ_SQL', '1'); },
    (p: typeof pkg) => { if (p.assets[0].kind === 'sql') p.assets[0].data.text = 'a\nb'; },
    (p: typeof pkg) => { if (p.assets[0].kind === 'sql') p.assets[0].data.text = 'x'.repeat(14001); },
    (p: typeof pkg) => { if (p.assets[0].kind === 'sql') p.assets[0].data.description = 'x'.repeat(31); }
  ]) {
    const copy = structuredClone(pkg); mutation(copy);
    const { checksum: _checksum, ...body } = copy;
    assert.throws(() => parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) })));
  }
});

test('SQL targets are bound to the preview connection and metadata fingerprint', async () => {
  const pkg = await exportMigrationPackage(sqlSource(), 'ZZ_SQL_PRJ');
  const t = target(); t.backend.identity = 'oracle:TARGET_A';
  t.stored.set('ZZ_SQL', { data: { ...pkg.assets[0].data, description: 'Old' }, token: 'fingerprint-a' });
  const plan = await previewMigrationImport(pkg, t.backend);
  t.backend.identity = 'oracle:TARGET_B';
  await assert.rejects(applyMigrationImport(pkg, plan, t.backend), /Target changed/);
  t.backend.identity = 'oracle:TARGET_A';
  t.stored.set('ZZ_SQL', { data: { ...pkg.assets[0].data, description: 'Changed without a version bump' }, token: 'fingerprint-b' });
  await assert.rejects(applyMigrationImport(pkg, plan, t.backend), /Target changed/);
  assert.equal(t.written.length, 0);
});

test('SQL full readback rejects corruption beyond character 4000 and does not finish project', async () => {
  const reader = sqlSource(), read = reader.readSqlForMigration!;
  reader.readSqlForMigration = async key => { const r = (await read(key))!; r.data.text = 'SELECT /* ' + 'x'.repeat(9000) + ' */ 1 FROM PS_INSTALLATION'; return r; };
  const pkg = await exportMigrationPackage(reader, 'ZZ_SQL_PRJ');
  const t = target(), write = t.backend.write;
  t.backend.write = async (asset, token) => {
    await write(asset, token);
    if (asset.kind === 'sql') t.stored.set(asset.data.name, { data: { ...asset.data, text: asset.data.text.slice(0, 5000) + 'CORRUPT' }, token: 'corrupt' });
  };
  const receipt = await applyMigrationImport(pkg, await previewMigrationImport(pkg, t.backend), t.backend);
  assert.match(receipt.error!, /does not match/);
  assert.equal(t.finished(), false);
});

test('SQL edited while an earlier definition saves is refused immediately before its write', async () => {
  const reader = source(), items = reader.listProjectItems;
  reader.listProjectItems = async p => [...await items(p), ...await sqlSource().listProjectItems(p)];
  reader.readSqlForMigration = sqlSource().readSqlForMigration;
  const pkg = await exportMigrationPackage(reader, 'ZZ_PROJECT'), t = target(), write = t.backend.write;
  t.backend.write = async (asset, token) => {
    await write(asset, token);
    if (asset.kind === 'record') t.stored.set('ZZ_SQL', { data: pkg.assets.find(a => a.kind === 'sql')!.data, token: 'concurrent-create' });
  };
  const receipt = await applyMigrationImport(pkg, await previewMigrationImport(pkg, t.backend), t.backend);
  assert.equal(receipt.failed, 'ZZ_SQL');
  assert.match(receipt.error!, /changed after preview/);
  assert.deepEqual(receipt.completed, ['ZZ_COUNT', 'ZZ_AET']);
  assert.equal(t.finished(), false);
});

test('migration carries HTML/CSS and exact stored standalone PeopleCode with explicit owning prerequisites', async () => {
  const reader = source(), original = reader.listProjectItems;
  reader.listProjectItems = async p => [...await original(p),
    { key: makeKey(DefinitionType.HtmlDefinition, 'ZZ_HTML') }, { key: makeKey(DefinitionType.StyleSheet, 'ZZ_CSS') },
    { key: makeKey(DefinitionType.RecordPeopleCode, 'ZZ_WORK', 'ZZ_COUNT', 'FieldChange') }];
  reader.readContentForMigration = async key => ({ data: { name: key.parts[0], text: '/* text */\r\n', description: 'Description' }, token: 'local', version: 9 });
  reader.readPeopleCodeForEdit = async () => ({ text: 'Local number &n = 1;', fingerprint: 'source-only' });
  const pkg = await exportMigrationPackage(reader, 'ZZ_PROJECT');
  assert.deepEqual(pkg.assets.slice(-3).map(a => a.kind), ['html', 'stylesheet', 'peoplecode']);
  assert.ok(pkg.requirements.some(k => k.type === DefinitionType.Record && k.parts[0] === 'ZZ_WORK'));
  assert.ok(!JSON.stringify(pkg).includes('source-only'));
  const t = target(), plan = await previewMigrationImport(pkg, t.backend);
  assert.equal(plan.blockers.length, 0);
  assert.equal((await applyMigrationImport(pkg, plan, t.backend)).error, undefined);
  assert.equal(t.written.length, 6);
});

test('missing authoritative PeopleCode and unsupported HTML alternate identities stop export', async () => {
  const reader = source();
  reader.listProjectItems = async () => [{ key: makeKey(DefinitionType.RecordPeopleCode, 'ZZ_WORK', 'ZZ_COUNT', 'FieldChange') }];
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_PROJECT'), /authoritative/);
  reader.readPeopleCodeForEdit = async () => undefined;
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_PROJECT'), /Authoritative/);
  reader.listProjectItems = async () => [{ key: makeKey(DefinitionType.HtmlDefinition, 'ZZ_HTML', '9') }];
  await assert.rejects(exportMigrationPackage(reader, 'ZZ_PROJECT'), /CONTTYPE 4/);
});

test('Record export carries associated stored PeopleCode even when it is not a separate project member', async () => {
  const reader=source(), original=reader.readRecordLayout;
  reader.listProjectItems=async()=>[{key:makeKey(DefinitionType.Record,'ZZ_AET')}];
  reader.readRecordLayout=async key=>{const record=(await original(key))!;record.fields[0].hasPeopleCode=true;return record;};
  reader.readRecordPeopleCodeForMigration=async()=>[makeKey(DefinitionType.RecordPeopleCode,'ZZ_AET','ZZ_COUNT','FieldChange')];
  reader.readPeopleCodeForEdit=async()=>({text:'Local number &n = 1;\n',fingerprint:'native-source'});
  const pkg=await exportMigrationPackage(reader,'ZZ_PROJECT');
  assert.deepEqual(pkg.assets.map(a=>a.kind),['record','peoplecode']);assert.equal(pkg.members.length,1);
  delete reader.readRecordPeopleCodeForMigration;
  await assert.rejects(exportMigrationPackage(reader,'ZZ_PROJECT'),/complete native program listing/);
});

test('character field translate values travel in canonical order; translations, duplicates and noncanonical packages refuse', async () => {
  const translated = (items: { value: string; effectiveDate: string; status: string; longName: string; shortName: string }[]): MigrationPackageReader => ({
    ...source(), listProjectItems: async () => [{ key: makeKey(DefinitionType.Field, 'ZZ_STATUS') }],
    readField: async () => ({ name: 'ZZ_STATUS', type: 0, length: 1, decimalPositions: 0, format: 0, version: 4,
      labels: [{ id: 'ZZ_STATUS', longName: 'Status', shortName: 'Status', isDefault: true }] }),
    readTranslatesForMigration: async () => ({ items })
  });
  const b = { value: 'B', effectiveDate: '1900-01-01', status: 'A', longName: 'Beta', shortName: 'B' };
  const a = { value: 'A', effectiveDate: '1900-01-01', status: 'I', longName: 'Alpha', shortName: 'A' };
  const pkg = await exportMigrationPackage(translated([b, a]), 'ZZ_PROJECT');
  const field = pkg.assets[0];
  assert.equal(field.kind, 'field');
  assert.deepEqual(field.kind === 'field' && field.data.translates, [a, b]);
  assert.deepEqual(parseMigrationPackage(JSON.stringify(pkg)), pkg);
  await assert.rejects(exportMigrationPackage(translated([a, a]), 'ZZ_PROJECT'), /duplicate translate value/);
  await assert.rejects(exportMigrationPackage(translated([{ ...a, value: 'AA' }]), 'ZZ_PROJECT'), /does not fit the field/);
  await assert.rejects(exportMigrationPackage({ ...translated([]), readTranslatesForMigration: undefined, readTranslates: async () => [a] }, 'ZZ_PROJECT'), /complete translate migration scope/);
  const { checksum: _, ...body } = pkg;
  const reordered = { ...body, assets: [{ ...field, data: { ...field.data, translates: [b, a] } }] };
  assert.throws(() => parseMigrationPackage(JSON.stringify({ ...reordered, checksum: migrationHash(reordered) })), /not canonical/);
  const plain = await exportMigrationPackage(translated([]), 'ZZ_PROJECT');
  assert.equal(JSON.stringify(plain).includes('translates'), false);
});

test('field properties: New Field defaults stay implicit, stored owner/format/century/IME travel, unsupported flags refuse', async () => {
  const base = { name: 'ZZ_AMT', type: 2, length: 10, decimalPositions: 2, version: 3, description: '',
    labels: [{ id: 'ZZ_AMT', longName: 'Amount', shortName: 'Amt', isDefault: true }] };
  const one = (field: object): MigrationPackageReader => ({ ...source(), listProjectItems: async () => [{ key: makeKey(DefinitionType.Field, 'ZZ_AMT') }], readField: async () => ({ ...base, ...field }) as never });
  const exported = async (field: object) => { const a = (await exportMigrationPackage(one(field), 'ZZ_PROJECT')).assets[0]; return a.kind === 'field' ? a.data : undefined; };
  const defaults = await exported({ format: 0, formatFamily: '', displayName: '', formatLength: 0, defaultCenturyYear: 50, imeMode: 0, keyboardLayout: 0, imageFormat: 0, ownerId: '', notUsed: false, auxFlagMask: 0 });
  assert.deepEqual(Object.keys(defaults!).sort(), ['decimalPositions', 'description', 'labels', 'length', 'name', 'type']);
  const stated = await exported({ format: 7, defaultCenturyYear: 80, imeMode: -1, ownerId: 'PPT' });
  assert.deepEqual([stated!.format, stated!.defaultCenturyYear, stated!.imeMode, stated!.ownerId], [7, 80, -1, 'PPT']);
  await assert.rejects(exported({ type: 0, length: 10, decimalPositions: 0, format: 14 }), /format family/);
  await assert.rejects(exported({ format: 12 }), /not a stored format/);
  await assert.rejects(exported({ auxFlagMask: 1 }), /auxiliary flags/);
  await assert.rejects(exported({ notUsed: true }), /Not Used/);
  await assert.rejects(exported({ ownerId: 'TOOLONG' }), /owner ID/);
  const pkg = await exportMigrationPackage(one({ ownerId: 'PPT' }), 'ZZ_PROJECT'), { checksum: _, ...body } = pkg;
  const padded = { ...body, assets: body.assets.map(a => ({ ...a, data: { ...a.data, imeMode: 0 } })) };
  assert.throws(() => parseMigrationPackage(JSON.stringify({ ...padded, checksum: migrationHash(padded) })), /not canonical/);
});

test('Application Package members export one root asset with ordered subpackages; every class travels as PeopleCode', async () => {
  const sourceText = (cls: string) => 'class ' + cls + '\nend-class;\n';
  const reader: MigrationPackageReader = {
    ...source(),
    listProjectItems: async () => [{ key: makeKey(DefinitionType.ApplicationPackage, 'ZZ_PKG', 'ZZ_PKG', '.') }, { key: makeKey(DefinitionType.ApplicationPackage, 'UI', 'ZZ_PKG', ':') }],
    readPackageForMigration: async () => ({ data: { name: 'ZZ_PKG', packages: ['UI', 'UI:Widgets'] }, classes: ['Root', 'UI:Widgets:Button'], token: 'structure:x', version: 7 }),
    readPeopleCodeForEdit: async key => ({ text: sourceText(key.parts.at(-2) === 'OnExecute' ? key.parts.at(-3)! : key.parts.at(-1)!), fingerprint: 'f' })
  };
  const pkg = await exportMigrationPackage(reader, 'ZZ_PROJECT');
  assert.deepEqual(pkg.assets.map(a => [a.kind, a.key.parts.join('.')]), [['package', 'ZZ_PKG'], ['peoplecode', 'ZZ_PKG.Root'], ['peoplecode', 'ZZ_PKG.UI.Widgets.Button']]);
  assert.deepEqual(pkg.requirements, []);
  const { checksum: _, ...body } = pkg;
  const reparse = (assets: unknown[]) => { const next = { ...body, assets }; return () => parseMigrationPackage(JSON.stringify({ ...next, checksum: migrationHash(next) })); };
  assert.throws(reparse([{ ...pkg.assets[0], data: { name: 'ZZ_PKG', packages: ['UI:Widgets', 'UI'] } }, ...pkg.assets.slice(1)]), /ordered/);
  assert.throws(reparse([{ ...pkg.assets[0], data: { name: 'ZZ_PKG', packages: ['UI'] } }, ...pkg.assets.slice(1)]), /outside its package asset/);
  assert.throws(reparse([{ ...pkg.assets[0], data: { name: 'ZZ_PKG', packages: ['A', 'A:B', 'A:B:C'] } }]), /invalid subpackage path/);
});

test('page and component assets carry complete canonical rows, refuse foreign or stamped rows and declare what they name', async () => {
  const empty = Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t => [t, []]));
  const page = { name: 'ZZ_PG', native: { scope: 'page-writer-tables/1', tables: { ...empty,
    PSPNLDEFN: [{ PNLNAME: 'ZZ_PG', STYLESHEETNAME: 'ZZ_SS', POPUPMENU: ' ', FFSTYLESHEETNAME: ' ' }],
    PSPNLFIELD: [{ PNLNAME: 'ZZ_PG', PNLFLDID: 1, RECNAME: 'ZZ_REC', FIELDNAME: 'ZZ_FLD', SUBPNLNAME: ' ', CONTNAME: 'ZZ_IMG', GRDLBLMSGSET: 0, GRDLBLMSGNUM: 0 },
      { PNLNAME: 'ZZ_PG', PNLFLDID: 2, RECNAME: 'ZZ_REC', FIELDNAME: ' ', SUBPNLNAME: 'ZZ_SUB', GRDLBLMSGSET: 124, GRDLBLMSGNUM: 5 }] } } };
  const component = { name: 'ZZ_CMP', market: 'GBL', tables: { PSPNLGRPDEFN: [{ PNLGRPNAME: 'ZZ_CMP', MARKET: 'GBL', SEARCHRECNAME: 'ZZ_SRCH', ADDSRCHRECNAME: ' ', SEARCHPNLNAME: ' ' }],
    PSPNLGROUP: [{ PNLGRPNAME: 'ZZ_CMP', MARKET: 'GBL', PNLNAME: 'ZZ_PG', SUBITEMNUM: 1 }], PSPNLGRPDEFNEXT: [],
    PSPNLGRPSCRIPTS: [{ PNLGRPNAME: 'ZZ_CMP', MARKET: 'GBL', PTSCRIPTTYPE: 'JS', PTSCRIPTNAME: 'ZZ_JS' }] } };
  const make = (assets: unknown[]) => { const body = { format: 'psft-migration/1', project: 'ZZ_P', toolsRelease: '8.62', members: [], assets, requirements: [] as unknown[] };
    const own = new Set(assets.map(a => JSON.stringify((a as MigrationAsset).key)));
    body.requirements = assets.flatMap(a => assetRequirements(a as MigrationAsset)).filter(k => !own.has(JSON.stringify(k))); return JSON.stringify({ ...body, checksum: migrationHash(body) }); };
  const pageAsset = { kind: 'page', key: makeKey(DefinitionType.Page, 'ZZ_PG'), data: page };
  const componentAsset = { kind: 'component', key: makeKey(DefinitionType.Component, 'ZZ_CMP', 'GBL'), data: component };
  const parsed = parseMigrationPackage(make([pageAsset, componentAsset]));
  assert.deepEqual(parsed.requirements.map(k => k.type + ':' + k.parts.join('.')).sort(), ['0:ZZ_REC', '0:ZZ_SRCH', '2:ZZ_FLD', '25:124.5', '49:ZZ_IMG', '5:ZZ_SUB', '50:ZZ_SS', '51:ZZ_JS'].sort());
  const foreign = { ...pageAsset, data: { ...page, native: { ...page.native, tables: { ...page.native.tables, PSPNLFIELD: [{ ...page.native.tables.PSPNLFIELD[0], PNLNAME: 'OTHER' }] } } } };
  assert.throws(() => parseMigrationPackage(make([foreign])), /belong to the page/);
  const stamped = { ...componentAsset, data: { ...component, tables: { ...component.tables, PSPNLGRPDEFN: [{ ...component.tables.PSPNLGRPDEFN[0], VERSION: 3 }] } } };
  assert.throws(() => parseMigrationPackage(make([stamped])), /without installation stamps/);
  assert.throws(() => parseMigrationPackage(make([{ ...componentAsset, key: makeKey(DefinitionType.Component, 'ZZ_CMP', 'USA') }])), /identity/);
});

test('SQL Table user indexes and SubRecord definitions export; index order, DDL and non-table indexes refuse', async () => {
  const index = (id: string, fields: string[], extra: object = {}) => ({ index: { INDEXID: id, INDEXTYPE: 4, UNIQUEFLAG: 0, CLUSTERFLAG: 0, ACTIVEFLAG: 1, CUSTKEYORDER: 1, KEYCOUNT: fields.length, DDLCOUNT: 0, IDXCOMMENTS: ' ', ...extra },
    keys: fields.map((f, i) => ({ INDEXID: id, KEYPOSN: i + 1, FIELDNAME: f, ASCDESC: 1 })) });
  const layout = (recordType: number, indexIds: string[]) => ({ name: 'ZZ_T', description: '', recordType, sqlTableName: '', version: 2, indexIds,
    fields: ['ZZ_A', 'ZZ_B'].map((name, i) => ({ fieldNum: i + 1, name, isSubrecord: false, type: 0, length: 4, shortName: name, longName: name, useEdit: 0, hasPeopleCode: false, editTable: '', defaultRecord: '', defaultField: '' })) });
  const reader = (recordType: number, indexes: ReturnType<typeof index>[]): MigrationPackageReader => ({ ...source(), listProjectItems: async () => [{ key: makeKey(DefinitionType.Record, 'ZZ_T') }],
    readRecordLayout: async () => layout(recordType, ['_', ...indexes.map(i => i.index.INDEXID)]) as never, readRecordIndexesForMigration: async () => indexes as never });
  const pkg = await exportMigrationPackage(reader(0, [index('A', ['ZZ_B']), index('B', ['ZZ_A', 'ZZ_B'])]), 'ZZ_P');
  const record = pkg.assets.find(a => a.kind === 'record');
  assert.deepEqual(record?.kind === 'record' && record.data.indexes?.map(i => i.index.INDEXID), ['A', 'B']);
  const sub = await exportMigrationPackage(reader(3, []), 'ZZ_P');
  assert.equal(sub.assets.find(a => a.kind === 'record')?.data.name, 'ZZ_T');
  await assert.rejects(exportMigrationPackage(reader(2, [index('A', ['ZZ_B'])]), 'ZZ_P'), /only an SQL Table/);
  await assert.rejects(exportMigrationPackage({ ...reader(0, []), readRecordLayout: async () => layout(0, ['_', '0']) as never }, 'ZZ_P'), /alternate-key/);
  const { checksum: _, ...body } = pkg, rewrite = (indexes: unknown) => { const next = { ...body, assets: body.assets.map(a => a.kind === 'record' ? { ...a, data: { ...a.data, indexes } } : a) }; return () => parseMigrationPackage(JSON.stringify({ ...next, checksum: migrationHash(next) })); };
  assert.throws(rewrite([index('B', ['ZZ_A']), index('A', ['ZZ_B'])]), /INDEXID order/);
  assert.throws(rewrite([index('A', ['ZZ_B'], { DDLCOUNT: 2 })]), /custom DDL/);
  assert.throws(rewrite([index('A', ['ZZ_MISSING'])]), /record's fields/);
});
