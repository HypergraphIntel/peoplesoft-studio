import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { LiveValidator, type ValidationRequest, type ValidationRunner } from '../peoplecode/liveValidation.js';
import { WorkerValidationRunner } from '../peoplecode/validateWorkerClient.js';
import type { Validation } from '../peoplecode/validate.js';

const key = { type: 8, parts: ['ZZ_R', 'ZZ_F', 'FieldChange'] };
const request = (version: number, text = `Local string &s${version};\n`, uri = 'psft://x/a'): ValidationRequest => ({ uri, version, text, key, release: '8.62' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A runner that takes `ms` per run and can be restarted, recording what it ran. */
function fakeRunner(ms: number) {
  const ran: number[] = [];
  let restarts = 0;
  let abandon: ((e: Error) => void) | undefined;
  const runner: ValidationRunner = {
    run: (r) => new Promise<Validation>((resolve, reject) => {
      ran.push(r.version);
      abandon = reject;
      setTimeout(() => resolve({ profile: 'PT862', problems: [{ offset: r.version, message: `v${r.version}` }] }), ms);
    }),
    restart: () => { restarts++; abandon?.(new Error('restarted')); },
    dispose: () => undefined
  };
  return { runner, ran, restarts: () => restarts };
}

test('validation waits for typing to pause and compiles only the latest text', async () => {
  const fake = fakeRunner(5);
  let version = 0;
  const published: number[] = [];
  const live = new LiveValidator(fake.runner, (r) => published.push(r.version), (_u, v) => v === version, { delayMs: 30 });
  for (version = 1; version <= 5; version++) { live.schedule(request(version)); await sleep(5); }
  version = 5;
  await sleep(200);
  assert.deepEqual(fake.ran, [5]);
  assert.deepEqual(published, [5]);
  live.dispose();
});

test('a result for text that changed while compiling is dropped, and the newer text is compiled', async () => {
  const fake = fakeRunner(40);
  let version = 1;
  const published: number[] = [];
  const live = new LiveValidator(fake.runner, (r) => published.push(r.version), (_u, v) => v === version, { delayMs: 5, staleAfterMs: 10_000 });
  live.schedule(request(1));
  await sleep(15);                       // version 1 is compiling
  version = 2;
  live.schedule(request(2));
  await sleep(250);
  assert.deepEqual(fake.ran, [1, 2]);
  assert.deepEqual(published, [2]);
  live.dispose();
});

test('a long run for stale text is abandoned by restarting the worker', async () => {
  const fake = fakeRunner(400);
  let version = 1;
  const published: number[] = [];
  const live = new LiveValidator(fake.runner, (r) => published.push(r.version), (_u, v) => v === version, { delayMs: 5, staleAfterMs: 30 });
  live.schedule(request(1));
  await sleep(15);
  version = 2;
  live.schedule(request(2));
  await sleep(100);
  assert.equal(fake.restarts(), 1);
  assert.deepEqual(fake.ran, [1, 2]);
  await sleep(700);
  assert.deepEqual(published, [2]);
  live.dispose();
});

test('the quiet time is read at each change, so a new setting applies at once', async () => {
  const fake = fakeRunner(1);
  let delay = 200;
  const published: number[] = [];
  const live = new LiveValidator(fake.runner, (r) => published.push(r.version), () => true, { delayMs: () => delay });
  delay = 10;
  live.schedule(request(1));
  await sleep(60);
  assert.deepEqual(published, [1]);
  live.dispose();
});

test('a closed document is forgotten before it compiles', async () => {
  const fake = fakeRunner(1);
  const live = new LiveValidator(fake.runner, () => assert.fail('published'), () => true, { delayMs: 20 });
  live.schedule(request(1));
  live.cancel('psft://x/a');
  await sleep(50);
  assert.deepEqual(fake.ran, []);
  live.dispose();
});

test('the worker thread compiles with the editor\'s compiler and reports where it stops', async () => {
  const runner = new WorkerValidationRunner(path.join(__dirname, '..', 'peoplecode', 'validateWorker.js'));
  try {
    const bad = await runner.run(request(1, 'Local string &s = "x";\n&s = ;\n'));
    assert.equal(bad.profile, 'PT862');
    assert.equal(bad.problems.length, 1);
    assert.equal(bad.problems[0].offset, 28);
    const ok = await runner.run({ ...request(2, 'Local string &s = "x";\n'), release: '8.61' });
    assert.equal(ok.profile, 'PT861');
    assert.deepEqual(ok.problems, []);
    // Restarting abandons the run in progress; the next run starts a fresh thread.
    const abandoned = runner.run(request(3, 'Local string &s;\n'));
    runner.restart();
    await assert.rejects(abandoned, /restarted/);
    assert.equal((await runner.run(request(4, 'Local number &n = 1;\n'))).problems.length, 0);
  } finally {
    runner.dispose();
  }
});
