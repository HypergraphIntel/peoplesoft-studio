import type { Observation } from '../schema.js';

/*
 * The discovery adapter for writer replay tests (src/test/*Writer.test.ts,
 * savePlan.test.ts): a node:test run's TAP output as an observation -- each
 * top-level test's name and outcome, nothing else (a failure's diagnostics
 * can hold row values, so they never leave the run). A replay test rebuilds
 * App Designer's captured rows through a Studio writer's plan, so what it
 * shows is Studio's: record it as a roundtrip-comparison, never as another
 * observation of PeopleSoft's own behavior (DISCOVERY_PROTOCOL.md rule 3).
 *
 *   node --test --test-reporter=tap dist-test/test/channelWriter.test.js > run.tap
 */

export interface TestRunResult {
  results: Array<{ name: string; outcome: 'pass' | 'fail' | 'skip' }>;
  passed: number;
  failed: number;
  skipped: number;
}

/** The top-level `ok` / `not ok` lines of a TAP run (subtests are indented and left out), optionally only those whose names match. */
export function parseTap(output: string, only?: RegExp): TestRunResult {
  const results: TestRunResult['results'] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(ok|not ok) \d+ - (.*?)(?:\s+#\s*(SKIP|TODO)\b.*)?$/i);
    if (!m) continue;
    const name = m[2].trim().slice(0, 200);
    if (only && !only.test(name)) continue;
    results.push({ name, outcome: m[3] ? 'skip' : m[1] === 'ok' ? 'pass' : 'fail' });
  }
  const count = (o: string) => results.filter((r) => r.outcome === o).length;
  return { results, passed: count('pass'), failed: count('fail'), skipped: count('skip') };
}

export function observationFromTestRun(output: string, meta: {
  /** The test's source, e.g. src/test/channelWriter.test.ts. */
  testFile: string; peopleToolsRelease: string; observation: string; runId?: string; only?: RegExp; observedAt?: string;
}): Observation {
  const run = parseTap(output, meta.only);
  if (!run.results.length) throw new Error('The run has no top-level ok / not ok lines (or none match): give TAP output (--test-reporter=tap).');
  if (run.results.length > 100) throw new Error(`The run has ${run.results.length} tests; select the ones the claim rests on (at most 100).`);
  const file = meta.testFile.replace(/\\/g, '/').replace(/^.*?(src\/test\/)/, '$1').replace(/^dist-test\/test\/(.*)\.js$/, 'src/test/$1.ts');
  return {
    observedAt: meta.observedAt ?? new Date().toISOString(),
    method: 'unit-replay',
    experimentId: file.split('/').pop()!.replace(/\.m?[jt]s$/, ''),
    ...(meta.runId ? { runId: meta.runId } : {}),
    environment: { peopleToolsRelease: meta.peopleToolsRelease, tool: 'node:test' },
    observation: meta.observation,
    actual: `${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`,
    testResults: run.results,
    evidence: [{ kind: 'repo-path', ref: file }]
  };
}
