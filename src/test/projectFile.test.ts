import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { ProjectFileProvider } from '../providers/projectFile.js';
import { parseExport } from '../providers/projectFileParser.js';
import { DefinitionType, makeKey, typeLabel } from '../model/definitions.js';
import { isKeyField } from '../model/record.js';

// Resolved against the source tree: tsc emits JavaScript to dist-test/ and does
// not copy data files, so __dirname points at a directory with no fixtures.
const FIXTURE = path.join(
  __dirname, '..', '..', 'src', 'test', 'fixtures', 'sample-project.xml');

async function load(): Promise<ProjectFileProvider> {
  const p = new ProjectFileProvider(FIXTURE, 'fixture');
  await p.connect();
  return p;
}

test('the project name and item list come from the PJM instance', async () => {
  const p = await load();
  const projects = await p.listProjects();
  assert.equal(projects[0].name, 'DEMO_PROJECT');
  assert.equal(projects[0].description, 'Fixture project');
  assert.equal((await p.listProjectItems('DEMO_PROJECT')).length, 4);
});

test('the project name is matched case-insensitively, since exports are often .XML', async () => {
  const p = await load();
  assert.equal((await p.listProjectItems('demo_project')).length, 4);
});

test('item types are read from eObjectType', async () => {
  const p = await load();
  const types = (await p.listProjectItems('DEMO_PROJECT')).map((i) => i.key.type);
  assert.ok(types.includes(DefinitionType.Record));
  assert.ok(types.includes(DefinitionType.RecordPeopleCode));
  assert.ok(types.includes(DefinitionType.ApplicationClassPeopleCode));
});

test('an unmapped type code is still listed, labelled by its number', async () => {
  const p = await load();
  const items = await p.listProjectItems('DEMO_PROJECT');
  const unknown = items.find((i) => (i.key.type as number) === 63);
  assert.ok(unknown, 'the item with an unmapped type was dropped from the project');
  assert.equal(typeLabel(63 as DefinitionType), 'Type 63');
});

test('PeopleCode comes back as source text with entities decoded', async () => {
  const p = await load();
  const text = await p.readText(
    makeKey(DefinitionType.RecordPeopleCode, 'WEBLIB_DEMO', 'ISCRIPT1', 'FieldFormula'));
  assert.match(text, /Local string &msg = "a & b";/);
  assert.match(text, /<b>/);
  assert.ok(!text.includes('&amp;'), 'entities were left escaped');
});

test('a record-field program is not filed under its parent record', async () => {
  // Both WEBLIB_DEMO and WEBLIB_DEMO.ISCRIPT1.FieldFormula are prefixes of the
  // program key; the PeopleCode item has to win.
  const p = await load();
  await assert.rejects(
    () => p.readText(makeKey(DefinitionType.Record, 'WEBLIB_DEMO')),
    /carries no text/);
});

test('an application class program is matched despite the appended OnExecute', async () => {
  const p = await load();
  const text = await p.readText(
    makeKey(DefinitionType.ApplicationClassPeopleCode, 'DEMO_PACK', 'Layout', 'Engine'));
  assert.match(text, /class Engine/);
});

test('record fields are read from the atm-prefixed export names', async () => {
  const p = await load();
  const rec = await p.readRecord(makeKey(DefinitionType.Record, 'WEBLIB_DEMO'));
  assert.equal(rec.fields.length, 3);
  assert.deepEqual(rec.fields.map((f) => f.name), ['DEMO_ID', 'SEQNBR', 'DESCR']);
  assert.equal(rec.fields[0].length, 30);
  assert.equal(rec.fields[1].length, 3);
});

test('key fields are derived from the primary index, not alternate indexes', async () => {
  const p = await load();
  const rec = await p.readRecord(makeKey(DefinitionType.Record, 'WEBLIB_DEMO'));
  const keys = rec.fields.filter(isKeyField).map((f) => f.name);
  // DESCR is keyed by index "A", which is an alternate index, not a key field.
  assert.deepEqual(keys, ['DEMO_ID', 'SEQNBR']);
});

test('field labels are read through the h-prefixed handle, not just lp pointers', async () => {
  const p = await load();
  const rec = await p.readRecord(makeKey(DefinitionType.Record, 'WEBLIB_DEMO'));
  assert.equal(rec.fields[0].label, 'Demo Identifier');
});

test('the standard XML entities do not trip the expansion limit', () => {
  // A real export blows past fast-xml-parser's 1000-expansion default on
  // legitimate content, because every PeopleCode variable starts with "&".
  const many = '&amp;'.repeat(5000);
  const xml =
    `<instance class="PCM"><rowset name="PcmProg" count="1"><row>` +
    `<szObjectValue_0>R</szObjectValue_0></row></rowset>` +
    `<peoplecode_text>${many}</peoplecode_text></instance>`;
  const instances = parseExport(xml);
  assert.equal(instances[0].peopleCodeText, '&'.repeat(5000));
});

test('a file with a DOCTYPE is refused rather than expanded', () => {
  const xml = `<!DOCTYPE x [<!ENTITY a "boom">]><instance class="PJM"></instance>`;
  assert.throws(() => parseExport(xml), /DOCTYPE/);
});

test('an escaped DOCTYPE inside PeopleCode is not mistaken for a declaration', () => {
  const xml =
    `<instance class="PCM"><rowset name="PcmProg" count="1"><row>` +
    `<szObjectValue_0>R</szObjectValue_0></row></rowset>` +
    `<peoplecode_text>%Response.WriteLine(&quot;&lt;!DOCTYPE html&gt;&quot;);</peoplecode_text>` +
    `</instance>`;
  const instances = parseExport(xml);
  assert.match(instances[0].peopleCodeText ?? '', /<!DOCTYPE html>/);
});

test('a file that is not a project export says so plainly', () => {
  assert.throws(() => parseExport('<PSPROJECTITEM><OBJECTTYPE>0</OBJECTTYPE></PSPROJECTITEM>'),
    /does not look like an Application Designer project export/);
});

test('saving is refused with a reason rather than silently dropping edits', async () => {
  const p = await load();
  assert.equal(p.capabilities.write, false);
  await assert.rejects(() => p.writeText(), /does not support/);
});
