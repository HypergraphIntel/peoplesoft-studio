import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { ProjectFileProvider } from '../providers/projectFile.js';
import { canExpand } from '../providers/provider.js';
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
  assert.equal((await p.listProjectItems('DEMO_PROJECT')).length, 10);
});

test('the project name is matched case-insensitively, since exports are often .XML', async () => {
  const p = await load();
  assert.equal((await p.listProjectItems('demo_project')).length, 10);
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
  // A record opens in the record editor, not as text, so reading it as text
  // must not hand back the program that merely shares its name prefix.
  await assert.rejects(
    () => p.readText(makeKey(DefinitionType.Record, 'WEBLIB_DEMO')),
    /does not carry its definition/);
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

test('a field definition renders its type, length and labels', async () => {
  const p = await load();
  const text = await p.readText(makeKey(DefinitionType.Field, 'DEMO_ID'));
  assert.match(text, /Field\s+DEMO_ID/);
  assert.match(text, /Type\s+Character/);
  assert.match(text, /Length\s+30/);
  assert.match(text, /Demo Identifier/);
  assert.match(text, /short: Demo ID/);
});

test('an HTML definition returns its content with whitespace preserved', async () => {
  const p = await load();
  const text = await p.readText(makeKey(DefinitionType.HtmlDefinition, 'DEMO_HTML', '4'));
  // Leading indentation is part of the content and must survive.
  assert.equal(text, "  <div class='x'>a & b</div>");
});

test('a component lists its pages and search record', async () => {
  const p = await load();
  const text = await p.readText(makeKey(DefinitionType.Component, 'DEMO_CMP', 'GBL'));
  assert.match(text, /Component\s+DEMO_CMP/);
  assert.match(text, /Search record\s+INSTALLATION/);
  assert.match(text, /DEMO_PAGE\s+Demo Page/);
});

test('a menu lists its bars and the components they open', async () => {
  const p = await load();
  const text = await p.readText(makeKey(DefinitionType.Menu, 'DEMO_MENU'));
  assert.match(text, /Menu\s+DEMO_MENU/);
  assert.match(text, /USE\s+Demo Component\s+-> DEMO_CMP/);
});

test('an application package lists its classes, keyed by id or by root', async () => {
  const p = await load();
  // The item is keyed PACKAGEID.PACKAGEROOT; the instance is indexed by root.
  const text = await p.readText(
    makeKey(DefinitionType.ApplicationPackage, 'DemoPkg', 'DEMO_PACK', ':'));
  assert.match(text, /Package\s+DEMO_PACK/);
  assert.match(text, /Engine/);
  assert.match(text, /Helper/);
});

test('an item whose definition the export omitted says so, without blaming the user', async () => {
  // App Designer includes referenced definitions selectively; a project item
  // can legitimately have no instance block behind it.
  const p = await load();
  await assert.rejects(
    () => p.readText(makeKey(DefinitionType.HtmlDefinition, 'NOT_EXPORTED', '4')),
    /does not carry its definition/);
});

test('every project item either opens or explains why not', async () => {
  const p = await load();
  const items = await p.listProjectItems('DEMO_PROJECT');
  for (const item of items) {
    try {
      await p.readText(item.key);
    } catch (err) {
      const message = (err as Error).message;
      assert.match(message, /does not carry its definition|is not an item/,
        `opening ${item.key.parts.join('.')} failed with an unhelpful message: ${message}`);
    }
  }
});

test('a record expands to its fields, keyed so each field opens', async () => {
  const p = await load();
  const children = await p.listChildren(makeKey(DefinitionType.Record, 'WEBLIB_DEMO'));
  assert.deepEqual(children.map((c) => c.key.parts[0]), ['DEMO_ID', 'SEQNBR', 'DESCR']);
  // Each child is a field definition in its own right, not a decoration.
  assert.ok(children.every((c) => c.key.type === DefinitionType.Field));
});

test('field descriptions show key membership, type and length', async () => {
  const p = await load();
  const children = await p.listChildren(makeKey(DefinitionType.Record, 'WEBLIB_DEMO'));
  assert.match(children[0].description ?? '', /^Key .* Character .* 30$/);
  // DESCR is keyed only by an alternate index, so it is not a key field.
  assert.ok(!(children[2].description ?? '').startsWith('Key'));
});

test('fields keep record order rather than being sorted', async () => {
  const p = await load();
  const children = await p.listChildren(makeKey(DefinitionType.Record, 'WEBLIB_DEMO'));
  assert.deepEqual(children.map((c) => c.key.parts[0]), ['DEMO_ID', 'SEQNBR', 'DESCR']);
});

test('a component expands to its pages, keyed so each page opens', async () => {
  const p = await load();
  const children = await p.listChildren(makeKey(DefinitionType.Component, 'DEMO_CMP', 'GBL'));
  assert.equal(children.length, 1);
  assert.equal(children[0].key.type, DefinitionType.Page);
  assert.equal(children[0].key.parts[0], 'DEMO_PAGE');
  assert.equal(children[0].description, 'Demo Page');
});

test('expanding a definition with no children yields an empty list, not an error', async () => {
  const p = await load();
  assert.deepEqual(
    await p.listChildren(makeKey(DefinitionType.Field, 'DEMO_ID')), []);
  // A component the export does not carry must not throw from the tree.
  assert.deepEqual(
    await p.listChildren(makeKey(DefinitionType.Component, 'NO_SUCH_CMP', 'GBL')), []);
  assert.deepEqual(
    await p.listChildren(makeKey(DefinitionType.Record, 'NO_SUCH_RECORD')), []);
});

test('only records and components offer an expander', () => {
  assert.ok(canExpand(DefinitionType.Record));
  assert.ok(canExpand(DefinitionType.Component));
  assert.ok(!canExpand(DefinitionType.Field));
  assert.ok(!canExpand(DefinitionType.Page));
  assert.ok(!canExpand(DefinitionType.ApplicationClassPeopleCode));
});
