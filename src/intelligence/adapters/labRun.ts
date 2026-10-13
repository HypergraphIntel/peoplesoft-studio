import type { Observation } from '../schema.js';

/*
 * The discovery adapter for lab end-to-end proofs (tools/lab/*-e2e.mts): a
 * run's output as an observation -- each check's name and outcome. Only the
 * names: the indented detail lines after a FAIL can hold row values, so
 * they never leave the run. A Studio writer's proof is evidence about
 * Studio (record it as a roundtrip-comparison), never a reproduction of
 * PeopleSoft's own behavior (DISCOVERY_PROTOCOL.md rule 3).
 */

export interface LabRunResult {
  results: Array<{ name: string; outcome: 'pass' | 'fail' }>;
  passed: number;
  failed: number;
}

/** PASS / FAIL lines of a run, optionally only those whose names match. */
export function parseLabRun(output: string, only?: RegExp): LabRunResult {
  const results: LabRunResult['results'] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(PASS|FAIL) (.+)$/);
    if (!m) continue;
    const name = m[2].trim().slice(0, 200);
    if (only && !only.test(name)) continue;
    results.push({ name, outcome: m[1] === 'PASS' ? 'pass' : 'fail' });
  }
  return { results, passed: results.filter((r) => r.outcome === 'pass').length, failed: results.filter((r) => r.outcome === 'fail').length };
}

export function observationFromLabRun(output: string, meta: {
  script: string; peopleToolsRelease: string; observation: string; runId?: string; tool?: string; only?: RegExp; observedAt?: string;
}): Observation {
  const run = parseLabRun(output, meta.only);
  if (!run.results.length) throw new Error('The run has no PASS / FAIL lines (or none match).');
  if (run.results.length > 100) throw new Error(`The run has ${run.results.length} checks; select the ones the claim rests on (at most 100).`);
  const script = meta.script.replace(/\\/g, '/').replace(/^.*?(tools\/lab\/)/, '$1');
  return {
    observedAt: meta.observedAt ?? new Date().toISOString(),
    method: 'live-e2e',
    experimentId: script.split('/').pop()!.replace(/\.m?ts$/, ''),
    ...(meta.runId ? { runId: meta.runId } : {}),
    environment: { peopleToolsRelease: meta.peopleToolsRelease, ...(meta.tool ? { tool: meta.tool } : {}) },
    observation: meta.observation,
    actual: `${run.passed} passed, ${run.failed} failed`,
    testResults: run.results,
    evidence: [{ kind: 'repo-path', ref: script }]
  };
}
