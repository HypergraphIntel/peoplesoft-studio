import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ProjectFileProvider } from '../providers/projectFile.js';
import { compareProjectItems, normalizeForCompare } from '../projectCompare.js';

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
    assert.ok(by('notCompared').length > 0, 'a record or field has no text form');
    // The same export against itself: nothing differs.
    assert.deepEqual((await compareProjectItems(items, here, here)).filter((x) => x.outcome === 'different'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
