import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ProjectFileProvider } from '../providers/projectFile.js';
import { compareProjectItems, normalizeForCompare, projectKeyIdentity } from '../projectCompare.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import type { DefinitionProvider } from '../providers/provider.js';
import type { RecordDefinition } from '../model/record.js';

const FIXTURE = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'sample-project.xml');

test('line endings and trailing whitespace at the end are not differences', () => {
  assert.equal(normalizeForCompare('a\r\nb  \n\n'), normalizeForCompare('a\nb'));
  assert.notEqual(normalizeForCompare('a\nb'), normalizeForCompare('a\nc'));
});

test("a project's definitions compared with another export: same, different, not compared", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'psft-compare-'));
  try {
    const changed = path.join(dir, 'changed.xml');
    const xml = readFileSync(FIXTURE, 'utf8');
    const line = 'Local string &amp;msg = &quot;a &amp; b&quot;;';
    assert.ok(xml.includes(line), 'the fixture holds the PeopleCode line the test changes');
    writeFileSync(changed, xml.replace(line, 'Local string &amp;msg = &quot;a &amp; c&quot;;'));
    const here = new ProjectFileProvider(FIXTURE, 'here');
    const there = new ProjectFileProvider(changed, 'there');
    await here.connect(); await there.connect();
    const items = await here.listProjectItems('DEMO_PROJECT');
    const r = await compareProjectItems(items, here, there);
    const by = (o: string) => r.filter((x) => x.outcome === o).map((x) => x.label).sort();
    assert.deepEqual(by('different'), ['WEBLIB_DEMO.ISCRIPT1.FieldFormula']);
    assert.ok(r.find((x) => x.outcome === 'different')!.otherText!.includes('a & c'));
    assert.ok(by('same').includes('DEMO_PACK:Layout:Engine'));
    assert.equal(r.length, items.length);
    assert.ok(by('notCompared').length > 0, 'some definition types have no comparable form');
    assert.ok(by('same').includes('WEBLIB_DEMO'), 'record metadata is compared');
    // The same export against itself: nothing differs.
    assert.deepEqual((await compareProjectItems(items, here, here)).filter((x) => x.outcome === 'different'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const sqlKey = makeKey(DefinitionType.SqlDefinition, 'ZZ_A_B', '0');
const items = [{ key: sqlKey }];
const provider = (overrides: Partial<DefinitionProvider> = {}) => ({
  canReadAsText: () => true,
  readText: async () => 'SELECT 1',
  search: async () => items,
  ...overrides
} as DefinitionProvider);

test('target read errors are not missing definitions', async () => {
  const broken = provider({ readText: async () => { throw new Error('connection lost'); } });
  const result = await compareProjectItems(items, provider(), broken);
  assert.equal(result[0].outcome, 'error');
  assert.match(result[0].detail!, /target: connection lost/);
  const noSearch = provider({ readText: broken.readText, search: async () => { throw new Error('offline'); } });
  assert.equal((await compareProjectItems(items, provider(), noSearch))[0].outcome, 'error');
});

test('absence is confirmed by successful untruncated search, not wildcard name alone', async () => {
  const target = provider({ readText: async () => { throw new Error('not found'); },
    search: async () => [{ key: makeKey(DefinitionType.SqlDefinition, 'ZZ_AXB', '0') }] });
  assert.equal((await compareProjectItems(items, provider(), target))[0].outcome, 'missing');
  const truncated = provider({ readText: target.readText,
    search: async () => Array.from({ length: 1000 }, (_, i) => ({ key: makeKey(DefinitionType.SqlDefinition, 'OTHER' + i) })) });
  assert.equal((await compareProjectItems(items, provider(), truncated))[0].outcome, 'error');
});

test('packed and expanded AE PeopleCode keys identify the same migration member', () => {
  const expanded = makeKey(DefinitionType.AppEnginePeopleCode, 'ZZ_AE', 'MAIN', 'GBL', 'default', '1900-01-01', 'INIT', 'OnExecute');
  const packed = makeKey(DefinitionType.AppEnginePeopleCode, 'ZZ_AE', 'MAIN    GBLdefault  1900-01-01', 'INIT', 'OnExecute');
  assert.equal(projectKeyIdentity(expanded), projectKeyIdentity(packed));
});

test('record comparisons ignore version stamps but preserve field edits and ordering', async () => {
  const key = makeKey(DefinitionType.Record, 'ZZ_REC');
  const record: RecordDefinition = { key, name: 'ZZ_REC', description: 'Test', recordType: 2, version: 1,
    fields: [{ name: 'A', fieldNum: 1, type: 0, length: 10, decimalPositions: 0, useEdit: 0 }] };
  const source = provider({ readRecord: async () => record });
  const target = provider({ readRecord: async () => ({ ...record, version: 999 }) });
  const same = (await compareProjectItems([{ key }], source, target))[0];
  assert.equal(same.outcome, 'same');
  assert.match(same.detail!, /modeled metadata/);
  const changed = provider({ readRecord: async () => ({ ...record, fields: [{ ...record.fields[0], useEdit: 1 }] }) });
  const diff = (await compareProjectItems([{ key }], source, changed))[0];
  assert.equal(diff.outcome, 'different');
  assert.ok(diff.sourceText);
  assert.ok(diff.otherText);
});

test('a field listed in a project with an omitted payload is an error, not missing', async () => {
  const key = makeKey(DefinitionType.Field, 'ZZ_FIELD');
  const field = { name: 'ZZ_FIELD', type: 0, length: 10, decimalPositions: 0, labels: [] };
  const source = provider({ readField: async () => field });
  const target = provider({ readField: async () => undefined, search: async () => [{ key }] });
  assert.equal((await compareProjectItems([{ key }], source, target))[0].outcome, 'error');
});
