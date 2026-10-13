import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  answerCapability, decideUpload, engineeringTask, observationFromLabRun, parseLabRun, DiscoveryInputError, KNOWLEDGE_NEVER_GRANTS, DiscoveryStore, keyIdOf, KnowledgeStore, policyFileLocations, TRUSTED_KNOWLEDGE_KEYS, verifyEnvelope, findingFingerprint, observationDigest, observationFromCapture, previewSubmission, PrivacyRejectedError,
  sanitizedDeltaOf, scanFinding, type FindingInput
} from '../intelligence/index.js';
import { contractVectors, findingInputJsonSchema } from '../intelligence/contract.js';

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
    // The same run of the same experiment in other words is the same evidence, not a reproduction.
    const reworded = await s.record({ ...base(), observation: { ...base().observation, observation: 'The same capture, described again.' } });
    assert.equal(reworded.outcome, 'duplicate');
    assert.equal(readFileSync(file, 'utf8'), before);
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

test('the server contract is the code\'s: the exported JSON Schema and fingerprint vectors have not drifted', () => {
  const dir = 'server/intelligence/contract';
  const schema = JSON.parse(readFileSync(path.join(dir, 'finding-input.schema.json'), 'utf8'));
  const facts = schema.properties.assertion.properties.facts;
  assert.deepEqual(schema, findingInputJsonSchema(), 'run: npx tsx tools/intelligence/export-contract.mts');
  const vectors = JSON.parse(readFileSync(path.join(dir, 'fingerprint-vectors.json'), 'utf8'));
  assert.deepEqual(vectors.vectors, JSON.parse(JSON.stringify(contractVectors())), 'run: npx tsx tools/intelligence/export-contract.mts');
  // Facts are 1..64 in the JSON Schema too (a zod refinement, written out).
  assert.deepEqual([facts.minProperties, facts.maxProperties], [1, 64]);
  // The vectors cover identity equality across reordering and case, and the number and string forms.
  const by = Object.fromEntries(vectors.vectors.map((v: { name: string; fingerprint: string }) => [v.name, v.fingerprint]));
  assert.equal(by['facts in another order'], by.basic);
  assert.equal(by['object type case and padding'], by.basic);
});

test('a submission preview: one payload per observation, lab provenance stripped and listed, exactly the server\'s input', async () => {
  const root = temp();
  try {
    const s = await new DiscoveryStore(root).open();
    await s.record({ ...base(), observation: { ...base().observation, evidence: [{ kind: 'capture-case', ref: 'em04-fluid-add-record' }, { kind: 'commit', ref: 'aa9469a' }] } });
    const { finding } = await s.record({ ...base(), observation: { ...base().observation, runId: 'run-2' } });
    const p = previewSubmission(finding);
    assert.equal(p.payloads.length, 2);
    assert.deepEqual(p.blocked, []);
    for (const payload of p.payloads) {
      assert.equal(payload.observation.experimentId, undefined);
      assert.equal(payload.observation.runId, undefined);
      assert.equal(payload.observation.environment.appRelease, undefined);
      assert.ok(!('digest' in payload.observation), 'local bookkeeping does not leave');
      assert.ok(!('localStatus' in payload) && !('privacy' in payload) && !('provenance' in payload));
      assert.deepEqual(scanFinding(payload), []);
    }
    assert.deepEqual(p.payloads[0].observation.evidence, [{ kind: 'commit', ref: 'aa9469a' }], 'a commit reference stays; the capture case goes');
    assert.deepEqual(p.removed.map((r) => `${r.observation}:${r.path}`), [
      '1:experimentId', '1:environment.appRelease', '1:evidence (1 capture case / repository path reference(s))', '2:experimentId', '2:runId', '2:environment.appRelease'
    ]);
    // The claim is the same claim on the server: the fingerprint does not depend on what was stripped.
    assert.equal(findingFingerprint(p.payloads[0]), finding.fingerprint);
    const kept = previewSubmission(finding, { keepProvenance: true });
    assert.deepEqual(kept.removed, []);
    assert.equal(kept.payloads[1].observation.runId, 'run-2');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('submissions are off unless every gate opens; the machine policy and telemetry win', () => {
  const open = { uploadMode: 'manual' as const, serverUrl: 'https://discovery.example/', telemetryLevel: 'all' };
  assert.deepEqual(decideUpload(open), { allowed: true, serverUrl: 'https://discovery.example', reasons: [] });
  const why = (i: Partial<Parameters<typeof decideUpload>[0]>) => decideUpload({ ...open, ...i }).reasons.join(' | ');
  assert.match(why({ uploadMode: 'off' }), /Submissions are off/);
  assert.match(why({ telemetryLevel: 'off' }), /telemetry is off/);
  assert.match(why({ policy: { intelligence: { uploads: 'disabled' } } }), /policy disables/);
  assert.match(why({ policyError: 'EACCES' }), /could not be read/);
  assert.match(why({ serverUrl: '' }), /No discovery server/);
  assert.match(why({ serverUrl: 'http://discovery.example' }), /HTTPS/);
  assert.match(why({ serverUrl: 'https://user:pw@discovery.example' }), /must not carry credentials/);
  assert.match(why({ serverUrl: 'not a url' }), /not a URL/);
  assert.equal(decideUpload({ ...open, serverUrl: 'http://127.0.0.1:8000' }).allowed, true, 'plain HTTP to this machine, for development');
  assert.match(why({ policy: { intelligence: { serverUrl: 'https://approved.example' } } }), /allows only https:\/\/approved.example/);
  assert.equal(decideUpload({ ...open, serverUrl: '', policy: { intelligence: { serverUrl: 'https://approved.example' } } }).serverUrl, 'https://approved.example');
  assert.equal(decideUpload({ uploadMode: 'off', serverUrl: '', telemetryLevel: 'off' }).reasons.length, 3, 'every reason, not the first');
  assert.deepEqual(policyFileLocations('linux', {}), ['/etc/peoplesoft-studio/policy.json']);
  assert.deepEqual(policyFileLocations('win32', { ProgramData: 'D:\\PD' }), ['D:\\PD\\PeopleSoftStudio\\policy.json']);
});

test('a bundle signed by the server verifies here; tampering, untrusted keys, expiry and rollback are refused', async () => {
  const vector = JSON.parse(readFileSync('server/intelligence/contract/bundle-vector.json', 'utf8'));
  const trusted = [{ keyId: vector.keyId, publicKey: vector.publicKey }];
  assert.equal(keyIdOf(vector.publicKey), vector.keyId, 'the key id is computed as the server computes it');
  const now = new Date('2026-10-14T00:00:00Z');
  const ok = verifyEnvelope(vector.envelope, trusted, { now });
  assert.deepEqual(ok.reasons, []);
  assert.equal(ok.bundle?.findings[0].verifiedReleases[0], '8.62.09');
  const tampered = JSON.parse(JSON.stringify(vector.envelope));
  tampered.bundle.findings[0].verifiedReleases = ['8.62.09', '8.61'];
  assert.match(verifyEnvelope(tampered, trusted, { now }).reasons.join(), /signature does not verify/);
  assert.match(verifyEnvelope(vector.envelope, [], { now }).reasons.join(), /does not trust/);
  assert.match(verifyEnvelope(vector.envelope, TRUSTED_KNOWLEDGE_KEYS, { now }).reasons.join(), /does not trust/, 'this build trusts no key yet');
  assert.match(verifyEnvelope(vector.envelope, trusted, { now: new Date('2040-01-01T00:00:00Z') }).reasons.join(), /expired/);
  assert.match(verifyEnvelope(vector.envelope, trusted, { now, installedVersion: 3 }).reasons.join(), /rollback refused/);
  const extra = JSON.parse(JSON.stringify(vector.envelope));
  extra.bundle.findings[0].script = 'rm -rf /';
  assert.match(verifyEnvelope(extra, trusted, { now }).reasons.join(), /does not match psft-knowledge\/1/, 'a bundle is data: unknown fields are refused');
  // Installed apart from the discovery store; a refused bundle writes nothing; re-verified on read.
  const root = temp();
  try {
    const k = new KnowledgeStore(root, () => trusted);
    assert.equal(await k.current(now), undefined);
    assert.equal((await k.install(tampered, now)).ok, false);
    assert.ok(!existsSync(path.join(root, 'knowledge', 'bundle.json')));
    assert.equal((await k.install(vector.envelope, now)).ok, true);
    assert.equal((await k.current(now))?.bundle?.version, 3);
    assert.match((await k.install(vector.envelope, now)).reasons.join(), /rollback refused/);
    assert.equal((await new KnowledgeStore(root, () => []).current(now))?.ok, false, 'a key no longer trusted invalidates what was installed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('capability answers: verified on a release, unsupported, conflicting, unverified, unknown -- never a grant', async () => {
  const vector = JSON.parse(readFileSync('server/intelligence/contract/bundle-vector.json', 'utf8'));
  const now = new Date('2026-10-14T00:00:00Z');
  const bundle = verifyEnvelope(vector.envelope, [{ keyId: vector.keyId, publicKey: vector.publicKey }], { now }).bundle!;
  const root = temp();
  try {
    const s = await new DiscoveryStore(root).open();
    const local = (await s.record(base())).finding;
    const q = { subsystem: 'event-mapping', table: 'PSPTCSSRVCONF' };
    const v = answerCapability({ ...q, release: '8.62.09' }, [local], bundle);
    assert.equal(v.answer, 'VERIFIED');
    assert.deepEqual(v.evidence.map((e) => [e.source, e.onRelease]), [['published', 'verified'], ['local', 'observed']]);
    assert.ok(v.notes[0] === KNOWLEDGE_NEVER_GRANTS && /never grants a write/.test(v.notes[0]));
    assert.ok(!('allowed' in v) && !('permission' in v), 'an answer carries no permission');
    assert.equal(answerCapability({ ...q, release: '8.62' }, [local], bundle).answer, 'VERIFIED', 'a release family matches its patch level');
    const other = answerCapability({ ...q, release: '8.60' }, [local], bundle);
    assert.equal(other.answer, 'UNVERIFIED');
    assert.match(other.notes.join(), /none is verified on 8.60/);
    assert.equal(answerCapability({ ...q, release: '8.62.09' }, [local]).answer, 'UNVERIFIED', 'local findings alone never verify');
    assert.equal(answerCapability({ subsystem: 'page-designer', release: '8.62' }, [local], bundle).answer, 'UNKNOWN');
    const incompatible = (await s.record({ ...base(), assertion: { kind: 'row-resave', facts: { table: 'PSPTCSSRVCONF', everyRowOnSave: false } }, knownIncompatible: ['8.62.09'],
      observation: { ...base().observation, environment: { peopleToolsRelease: '8.61.05' } } })).finding;
    assert.equal(answerCapability({ ...q, release: '8.62.09' }, [local, incompatible], bundle).answer, 'CONFLICTING');
    assert.equal(answerCapability({ ...q, release: '8.62.09' }, [incompatible]).answer, 'UNSUPPORTED');
    // A revoked id in the bundle silences the local copy too.
    const revokedBundle = { ...bundle, findings: [], revoked: [local.id] };
    const r = answerCapability({ ...q, release: '8.62.09' }, [local], revokedBundle);
    assert.equal(r.answer, 'UNKNOWN');
    assert.match(r.notes.join(), /revoked/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a lab run as an observation: check names and outcomes only, never the failure details', async () => {
  const out = ['PASS configure: four rows at SCNFM+1..+4, stamped', 'FAIL edit: the parameter changed', '     got ZZ_SECRET_VALUE for EMPLID 12345',
    '     configure: a note', 'PASS remove: no rows left', '', '2 passed, 1 failed'].join('\n');
  assert.deepEqual(parseLabRun(out), { results: [
    { name: 'configure: four rows at SCNFM+1..+4, stamped', outcome: 'pass' }, { name: 'edit: the parameter changed', outcome: 'fail' }, { name: 'remove: no rows left', outcome: 'pass' }
  ], passed: 2, failed: 1 });
  assert.equal(parseLabRun(out, /^configure/).results.length, 1);
  const o = observationFromLabRun(out, { script: '/abs/repo/tools/lab/event-mapping-e2e.mts', peopleToolsRelease: '8.62', observation: 'The writer ran.', observedAt: '2026-10-13T00:00:00Z' });
  assert.equal(o.experimentId, 'event-mapping-e2e');
  assert.deepEqual(o.evidence, [{ kind: 'repo-path', ref: 'tools/lab/event-mapping-e2e.mts' }], 'the absolute path is reduced to the repository path');
  assert.ok(!JSON.stringify(o).includes('ZZ_SECRET_VALUE') && !JSON.stringify(o).includes('12345'), 'detail lines never leave the run');
  assert.equal(o.actual, '2 passed, 1 failed');
  assert.throws(() => observationFromLabRun('nothing', { script: 'x', peopleToolsRelease: '8.62', observation: 'x' }), /no PASS/);
  const root = temp();
  try {
    const r = await (await new DiscoveryStore(root).open()).record({ ...base(), type: 'roundtrip-comparison', observation: o });
    assert.equal(r.outcome, 'created');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a finding as engineering work: an issue body with acceptance criteria and a runnable fixture, nothing filed', async () => {
  const root = temp();
  try {
    const s = await new DiscoveryStore(root).open();
    const capture = JSON.parse(readFileSync('tools/corpus/save-protocol/results/em04-fluid-add-record/delta.json', 'utf8'));
    const f = (await s.record({ ...base(), observation: observationFromCapture(capture, { observation: 'Both rows re-saved.' }) })).finding;
    const t = engineeringTask(f);
    assert.equal(t.title, `[event-mapping] ${f.title}`);
    assert.deepEqual(t.labels, ['discovery', 'event-mapping', 'save-protocol']);
    assert.match(t.body, /A test replays capture `em04-fluid-add-record`/);
    assert.match(t.body, /No write gate, approval or delivered-object policy changes/);
    assert.match(t.body, /evidence, not an instruction/);
    assert.equal(t.fixture?.path, `src/test/discovery-${f.id}.test.ts`);
    assert.match(t.fixture!.text, /sanitizedDeltaOf/);
    const bare = (await s.record({ ...base(), assertion: { kind: 'x', facts: { y: 1 } } })).finding;
    assert.equal(engineeringTask(bare).fixture, undefined, 'no capture, no fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the research store\'s findings still match their captures: every capture-backed observation re-derives', async () => {
  const store = await new DiscoveryStore(path.join('tools', 'intelligence', 'store')).open();
  const results = path.join('tools', 'corpus', 'save-protocol', 'results');
  let checked = 0;
  for (const summary of await store.list()) {
    const f = (await store.get(summary.id))!;
    assert.equal(f.fingerprint, findingFingerprint(f), `${f.id}: the stored fingerprint is the claim's`);
    for (const o of f.observations) {
      const { digest, ...content } = o;
      assert.equal(digest, observationDigest(content), `${f.id}: an observation's digest is its content's`);
      const capture = o.evidence?.find((e) => e.kind === 'capture-case')?.ref;
      if (o.method !== 'save-capture' || !o.delta || !capture || !existsSync(results)) continue;
      assert.ok(existsSync(path.join(results, capture, 'delta.json')), `${f.id}: capture ${capture} is not in the corpus`);
      const delta = JSON.parse(readFileSync(path.join(results, capture, 'delta.json'), 'utf8'));
      if (f.assertion.kind === 'physical-rewrite') {
        // The claim: in the ROWID (physical) diff, no table it names was updated in place.
        for (const t of String(f.assertion.facts.tables).split(',')) {
          assert.equal((delta.otherTables[t]?.updated ?? []).length, 0, `${f.id} ${capture} ${t}: updated in place`);
        }
        // Recorded by the adapter (watch tables by key), or from the ROWID diff for the tables it names.
        if (!isDeepStrictEqual(o.delta, sanitizedDeltaOf(delta))) {
          for (const t of o.delta.tables) {
            const phys = delta.otherTables[t.table] ?? {};
            assert.deepEqual([t.inserted, t.deleted, t.updated], [(phys.inserted ?? []).length, (phys.deleted ?? []).length, (phys.updated ?? []).length], `${f.id} ${capture} ${t.table}`);
          }
        }
      } else {
        assert.deepEqual(o.delta, sanitizedDeltaOf(delta), `${f.id}: capture ${capture} no longer shows what was recorded`);
      }
      if (delta.peopleToolsRelease) assert.equal(o.environment.peopleToolsRelease, delta.peopleToolsRelease, `${f.id}: ${capture}'s release`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `${checked} capture-backed observations checked`);
});

test('definition and page captures (def-capture, ae-capture, page-capture): watch counts and PSVERSION steps; the release must be given', { skip: !existsSync('tools/corpus/save-protocol/results/ae10-insert-section/delta.json') && 'captures' }, () => {
  const ae = JSON.parse(readFileSync('tools/corpus/save-protocol/results/ae10-insert-section/delta.json', 'utf8'));
  assert.deepEqual(sanitizedDeltaOf(ae), { tables: [{ table: 'PSAEAPPLDEFN', inserted: 0, deleted: 0, updated: 1 }, { table: 'PSAESECTDEFN', inserted: 1, deleted: 0, updated: 0 },
    { table: 'PSAESECTDTLDEFN', inserted: 1, deleted: 0, updated: 0 }], counters: { AEM: 1, AES: 1, SYS: 1 } });
  assert.throws(() => observationFromCapture(ae, { observation: 'x' }), /give it/);
  assert.equal(observationFromCapture(ae, { observation: 'x', peopleToolsRelease: '8.62.09' }).experimentId, 'ae10-insert-section');
  const sweep = JSON.parse(readFileSync('tools/corpus/save-protocol/results/em04-fluid-add-record/delta.json', 'utf8'));
  assert.throws(() => observationFromCapture(sweep, { observation: 'x', peopleToolsRelease: '8.61' }), /says PeopleTools 8.62.09/);
  const chn = JSON.parse(readFileSync('tools/corpus/save-protocol/results/chn02-props/delta.json', 'utf8'));
  assert.equal(sanitizedDeltaOf(chn).counters?.CHDM, 1);
  assert.ok(!JSON.stringify(sanitizedDeltaOf(chn)).includes('Lab channel'), 'counts only');
  const page = JSON.parse(readFileSync('tools/corpus/save-protocol/results/eb01-display-zero/delta.json', 'utf8'));
  assert.deepEqual(sanitizedDeltaOf(page), { tables: [{ table: 'PSPNLDEFN', inserted: 0, deleted: 0, updated: 1 }, { table: 'PSPNLFIELD', inserted: 0, deleted: 0, updated: 1 }], counters: { PDM: 1, SYS: 1 } });
  assert.throws(() => observationFromCapture(page, { observation: 'x' }), /give it/);
  // A renamed case keeps its old name in the file: the directory read is the ID.
  const renamed = JSON.parse(readFileSync('tools/corpus/save-protocol/results/r03-sqltable-key-and-fields/delta.json', 'utf8'));
  const o = observationFromCapture(renamed, { observation: 'x', caseName: 'r03-sqltable-key-and-fields' });
  assert.equal(o.experimentId, 'r03-sqltable-key-and-fields');
  assert.deepEqual(o.evidence, [{ kind: 'capture-case', ref: 'r03-sqltable-key-and-fields' }]);
});

test('counter-step findings: every observation shows exactly the counter steps its claim states', async () => {
  const store = await new DiscoveryStore(path.join('tools', 'intelligence', 'store')).open();
  let checked = 0;
  for (const summary of await store.list()) {
    const f = (await store.get(summary.id))!;
    if (f.assertion.kind !== 'counter-step') continue;
    const facts = f.assertion.facts;
    // Two shapes: { counter, psversionStep | newProgramStep, sysStep } or counters as upper-case facts (0 = must not move).
    const expect: Record<string, number> = typeof facts.counter === 'string'
      ? { [facts.counter]: Number(facts.psversionStep ?? facts.newProgramStep), SYS: Number(facts.sysStep) }
      : Object.fromEntries(Object.entries(facts).filter(([k, v]) => /^[A-Z]+$/.test(k) && typeof v === 'number') as Array<[string, number]>);
    for (const o of f.observations) {
      const got = o.delta?.counters ?? {};
      for (const [k, v] of Object.entries(expect)) assert.equal(got[k] ?? 0, v, `${f.id} ${o.experimentId}: ${k}`);
      checked++;
    }
  }
  assert.ok(checked >= 80, `${checked} counter-step observations checked`);
});
