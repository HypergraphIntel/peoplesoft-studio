import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  DiscoveryInputError, DiscoveryStore, findingFingerprint, observationDigest, observationFromCapture, PrivacyRejectedError, sanitizedDeltaOf,
  scanFinding, type FindingInput
} from '../intelligence/index.js';

/*
 * The local discovery engine (docs/intelligence, phase 1): schema
 * validation, deterministic identity, persistence, duplicates and merges,
 * the privacy scan, the save-capture adapter, and no network.
 */

const base = (): FindingInput => ({
  type: 'save-protocol',
  subject: { subsystem: 'event-mapping', objectType: 'Event Mapping configuration', tables: ['PSPTCSSRVCONF'] },
  assertion: { kind: 'row-resave', facts: { table: 'PSPTCSSRVCONF', everyRowOnSave: true, versionCounter: 'SCNFM' } },
  title: 'The Configure Event Mapping page re-saves every row on Save',
  statement: 'Each grid row is deleted and re-inserted at the next SCNFM, changed or not.',
  confidence: 'high',
  source: 'research-harness',
  observation: {
    observedAt: '2026-10-12T19:50:28.000Z', method: 'pia-capture', experimentId: 'em04-fluid-add-record',
    environment: { peopleToolsRelease: '8.62.09', appRelease: 'HRMS 9.20.00.000', platform: 'oracle', tool: 'PIA' },
    observation: 'Two rows saved, one unchanged: both deleted and re-inserted with VERSION 3 and 4.'
  }
});

const temp = () => mkdtempSync(path.join(tmpdir(), 'psft-discovery-'));

test('a finding is created, validated, fingerprinted and persisted across a restart', async () => {
  const root = temp();
  try {
    const a = await new DiscoveryStore(root).open();
    const r = await a.record(base());
    assert.equal(r.outcome, 'created');
    assert.match(r.finding.id, /^f-[0-9a-f]{24}$/);
    assert.equal(r.finding.fingerprint.length, 64);
    assert.equal(r.finding.localStatus, 'observed');
    assert.deepEqual(r.finding.compatibility.observedReleases, ['8.62.09']);
    assert.equal(r.finding.privacy.approvedForSubmission, false);
    assert.equal(r.finding.privacy.classification, 'internal', 'an experiment ID and the app release are lab provenance');
    assert.ok(existsSync(path.join(root, 'STORE.json')));
    // A new instance on the same directory -- the extension restarted -- reads it back.
    const b = await new DiscoveryStore(root).open();
    assert.deepEqual(await b.get(r.finding.id), r.finding);
    assert.deepEqual((await b.list()).map((s) => s.id), [r.finding.id]);
    assert.equal(await b.get('f-000000000000000000000000'), undefined);
    assert.equal(await b.get('../STORE'), undefined, 'IDs are checked, never used as paths');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the fingerprint is the claim: wording, order, release and evidence do not change it; the assertion does', () => {
  const f = findingFingerprint(base());
  const reworded = { ...base(), title: 'Every row is re-saved', statement: 'Reworded.' };
  const reordered = { ...base(), assertion: { kind: 'row-resave', facts: { versionCounter: 'SCNFM', everyRowOnSave: true, table: 'PSPTCSSRVCONF' } } };
  const otherRelease = { ...base(), observation: { ...base().observation, environment: { peopleToolsRelease: '8.61' } } };
  for (const x of [reworded, reordered, otherRelease]) assert.equal(findingFingerprint(x), f);
  assert.notEqual(findingFingerprint({ ...base(), assertion: { kind: 'row-resave', facts: { table: 'PSPTCSSRVCONF', everyRowOnSave: false, versionCounter: 'SCNFM' } } }), f);
  assert.notEqual(findingFingerprint({ ...base(), subject: { ...base().subject, subsystem: 'page-designer' } }), f);
  // The observation digest ignores only when it was recorded.
  assert.equal(observationDigest(base().observation), observationDigest({ ...base().observation, observedAt: '2027-01-01T00:00:00Z' }));
});

test('the same evidence twice is a duplicate; new evidence merges; a second run reproduces; releases widen', async () => {
  const root = temp();
  try {
    const s = await new DiscoveryStore(root, () => new Date('2026-10-12T20:00:00Z')).open();
    const first = await s.record(base());
    const file = path.join(root, 'findings', `${first.finding.id}.json`);
    const before = readFileSync(file, 'utf8');
    const dup = await s.record({ ...base(), title: 'reworded', observation: { ...base().observation, observedAt: '2026-10-13T00:00:00Z' } });
    assert.equal(dup.outcome, 'duplicate');
    assert.equal(readFileSync(file, 'utf8'), before, 'a duplicate writes nothing');
    const again = await s.record({ ...base(), confidence: 'medium', observation: { ...base().observation, runId: 'run-2', environment: { peopleToolsRelease: '8.61.05' } } });
    assert.equal(again.outcome, 'merged');
    assert.equal(again.finding.observations.length, 2);
    assert.equal(again.finding.localStatus, 'reproduced');
    assert.deepEqual(again.finding.compatibility.observedReleases, ['8.61.05', '8.62.09']);
    assert.equal(again.finding.title, base().title, 'the first words stand');
    assert.equal(again.finding.confidence, 'high', 'confidence does not drop on a weaker report');
    // Two parallel records on one finding are both kept (writes are serialized).
    const [x, y] = await Promise.all([3, 4].map((n) => s.record({ ...base(), observation: { ...base().observation, runId: `run-${n}` } })));
    assert.deepEqual([x.outcome, y.outcome], ['merged', 'merged']);
    assert.equal((await s.get(first.finding.id))!.observations.length, 4);
    assert.deepEqual(readdirSync(path.join(root, 'findings')).filter((f) => f.includes('.tmp-')), [], 'no temporary files left');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the schema is an allowlist: unknown or private fields are refused, at every level', async () => {
  const root = temp();
  try {
    const s = await new DiscoveryStore(root).open();
    const refused = async (raw: unknown, re: RegExp) => {
      await assert.rejects(s.record(raw), (e: unknown) => e instanceof DiscoveryInputError && re.test(e.message));
    };
    await refused({ ...base(), peopleCode: 'Local string &x;' }, /\$: Unrecognized key/);
    await refused({ ...base(), observation: { ...base().observation, connectString: 'x' } }, /\$\.observation: Unrecognized key/);
    await refused({ ...base(), observation: { ...base().observation, environment: { peopleToolsRelease: '8.62', database: 'HRDMO' } } }, /environment: Unrecognized key/);
    await refused({ ...base(), observation: { ...base().observation, delta: { tables: [{ table: 'PSOPRDEFN', inserted: 1, deleted: 0, updated: 0, rows: [] }] } } }, /Unrecognized key/);
    await refused({ ...base(), type: 'rumour' }, /\$\.type/);
    await refused({ ...base(), observation: { ...base().observation, environment: { peopleToolsRelease: 'latest' } } }, /PeopleTools release/);
    await refused({ ...base(), assertion: { kind: 'x', facts: {} } }, /between 1 and 64 facts/);
    await refused({ ...base(), statement: 'x'.repeat(4001) }, /\$\.statement/);
    assert.deepEqual(await s.list(), [], 'nothing refused was stored');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the privacy scan refuses what a technical claim never needs, and never echoes it', async () => {
  const root = temp();
  try {
    const s = await new DiscoveryStore(root).open();
    const cases: Array<[string, RegExp]> = [
      ['See https://hcm.example.edu/psp/HCMDMO', /URL/],
      ['Mail jane.doe@example.edu about it', /e-mail address/],
      ['Captured from /home/jared/lab/delta.json', /absolute file path/],
      ['Captured from C:\\PT8.62\\bin', /absolute file path/],
      ['The app server at 10.20.30.40 answered', /IP address/],
      ['Connect to dbhost:1521/HRDMO first', /connect string/],
      ['The host psoft.internal answered', /host name/],
      ['Signed on with password=Hunter2', /credential/],
      [`Token ${'A'.repeat(70)}`, /opaque token/]
    ];
    for (const [text, rule] of cases) {
      await assert.rejects(s.record({ ...base(), observation: { ...base().observation, observation: text } }), (e: unknown) => {
        assert.ok(e instanceof PrivacyRejectedError, text);
        assert.match(e.message, rule);
        assert.ok(!e.message.includes('Hunter2') && !e.message.includes('10.20.30.40') && !e.message.includes('jane.doe'), 'the value is never echoed');
        return true;
      });
    }
    // What is technical passes: release labels, PeopleSoft's dotted names, tables, ADS key hashes.
    assert.deepEqual(scanFinding({ ...base(), statement: 'HRMS 9.20.00.000 on 8.62.09: JOB.CO and PSPTCSSRVCONF.VERSION; hash T6Lgaueh9pJxTyXQS/5qOXLuZvM= (PT_RCF:ServiceInterface).' }), []);
    await assert.rejects(s.record({ ...base(), observation: { ...base().observation, evidence: [{ kind: 'repo-path', ref: '../outside/file' }] } }), /relative, inside the repository/);
    assert.deepEqual(scanFinding({ ...base(), observation: { ...base().observation, evidence: [{ kind: 'commit', ref: 'aa9469a' }, { kind: 'repo-path', ref: 'docs/CUSTOMIZATION.md' }] } }), []);
    assert.deepEqual(await s.list(), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('list filters; remove withdraws; a store of another format is refused', async () => {
  const root = temp();
  try {
    const s = await new DiscoveryStore(root).open();
    const a = await s.record(base());
    const pub = await s.record({
      ...base(), type: 'metadata-mapping', subject: { subsystem: 'page-designer', objectType: 'Page' },
      assertion: { kind: 'column-mapping', facts: { property: 'Display Only', table: 'PSPNLFIELD', column: 'FIELDUSE', bit: 1 } },
      observation: { observedAt: '2026-10-01T00:00:00Z', method: 'save-capture', environment: { peopleToolsRelease: '8.62' }, observation: 'Display Only sets FIELDUSE bit 1.' }
    });
    assert.equal(pub.finding.privacy.classification, 'public-technical');
    assert.deepEqual((await s.list({ subsystem: 'page-designer' })).map((x) => x.id), [pub.finding.id]);
    assert.deepEqual((await s.list({ release: '8.62' })).map((x) => x.id).sort(), [a.finding.id, pub.finding.id].sort());
    assert.deepEqual((await s.list({ text: 'fieldUSE' })).map((x) => x.id), [pub.finding.id]);
    assert.equal(await s.remove(a.finding.id), true);
    assert.equal(await s.get(a.finding.id), undefined);
    assert.equal(await s.remove(a.finding.id), false);
    const other = temp();
    writeFileSync(path.join(other, 'STORE.json'), JSON.stringify({ format: 'something-else/9' }));
    await assert.rejects(new DiscoveryStore(other).open(), /not a psft-discovery-store\/1 store/);
    rmSync(other, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a save capture as an observation: counts only, background tables left out [em04]', { skip: !existsSync('tools/corpus/save-protocol/results/em04-fluid-add-record/delta.json') && 'capture' }, async () => {
  const delta = JSON.parse(readFileSync('tools/corpus/save-protocol/results/em04-fluid-add-record/delta.json', 'utf8'));
  assert.deepEqual(sanitizedDeltaOf(delta), {
    tables: [
      { table: 'PSADSTRACKING', inserted: 1, deleted: 0, updated: 2 },
      { table: 'PSPTCSSRVCONF', inserted: 2, deleted: 1, updated: 0 },
      { table: 'PSPTCS_MAPFLDS', inserted: 2, deleted: 1, updated: 0 }
    ],
    counters: { SCNFM: 2, SYS: 2 }
  });
  const o = observationFromCapture(delta, { observation: 'The fluid page re-saved both rows.', tool: 'PIA' });
  assert.equal(o.environment.peopleToolsRelease, '8.62.09');
  assert.equal(o.experimentId, 'em04-fluid-add-record');
  assert.ok(!JSON.stringify(o).includes('ZZ_LAB_PARAM') && !JSON.stringify(o).includes('ROWID'), 'no row value leaves the capture');
  const root = temp();
  try {
    const r = await (await new DiscoveryStore(root).open()).record({ ...base(), observation: o });
    assert.equal(r.outcome, 'created');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the engine works offline: it imports no network module', () => {
  const dir = 'src/intelligence';
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)), ...readdirSync(path.join(dir, 'adapters')).map((f) => path.join(dir, 'adapters', f))];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /from 'node:(http|https|net|tls|dns|dgram)'|from '(http|https|net|tls|dns)'|\bfetch\(|from 'vscode'/, f);
  }
});
