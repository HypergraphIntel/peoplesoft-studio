/*
 * The research harnesses' way into the local discovery store
 * (docs/intelligence/DISCOVERY_PROTOCOL.md). Offline; writes only the store.
 *
 *   npx tsx tools/intelligence/discovery.mts record --file finding.json
 *   npx tsx tools/intelligence/discovery.mts capture <case> --type save-protocol --subsystem event-mapping \
 *       --object-type "Event Mapping configuration" --kind row-resave --fact table=PSPTCSSRVCONF --fact everyRowOnSave=true \
 *       --title "..." --statement "..." --observation "..." [--confidence medium] [--tool PIA] [--run-id ID] [--evidence repo-path:docs/X.md]
 *       [--release 8.62.09]   (required for def-capture / ae-capture / page-capture cases, which do not record it)
 *       [--expect-counters MDM=1,SYS=1]   (refused unless the capture's counter steps are exactly these)
 *   npx tsx tools/intelligence/discovery.mts lab-run --script tools/lab/X-e2e.mts --output run.log --release 8.62 [--tests REGEX] \
 *       --type roundtrip-comparison --subsystem ... --object-type ... --kind ... --fact k=v --title ... --statement ... --observation ...
 *   npx tsx tools/intelligence/discovery.mts test-run --file src/test/X.test.ts --output run.tap --release 8.62.09 [--tests REGEX] \
 *       --type roundtrip-comparison --subsystem ... --object-type ... --kind ... --fact k=v --title ... --statement ... --observation ...
 *       (run.tap: node --test --test-reporter=tap dist-test/test/X.test.js > run.tap)
 *   npx tsx tools/intelligence/discovery.mts list [--subsystem S] [--type T] [--release 8.62] [--text words]
 *   npx tsx tools/intelligence/discovery.mts get <id>
 *
 * The store is tools/intelligence/store (committed: the repository's
 * research findings), or --store DIR, or PSFT_DISCOVERY_STORE. A capture
 * case is read from tools/corpus/save-protocol/results/<case>/delta.json;
 * only its counts are kept (adapters/saveCapture.ts). The claim -- the
 * assertion -- is always the researcher's: one capture is one observation.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DiscoveryStore, observationFromCapture, observationFromLabRun, observationFromTestRun, type FindingInput, type Observation } from '../../src/intelligence/index';

const args = process.argv.slice(2);
const command = args.shift();
const opts = new Map<string, string[]>();
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    opts.set(k, [...(opts.get(k) ?? []), v]);
  } else positional.push(a);
}
const one = (k: string) => opts.get(k)?.[0];
const need = (k: string) => { const v = one(k); if (!v) throw new Error(`--${k} is required.`); return v; };
const parseValue = (v: string): string | number | boolean | null =>
  v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;

const root = one('store') ?? process.env.PSFT_DISCOVERY_STORE ?? path.join('tools', 'intelligence', 'store');
const store = await new DiscoveryStore(root).open();
const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));

try {
  switch (command) {
    case 'record': {
      const r = await store.record(JSON.parse(readFileSync(need('file'), 'utf8')));
      console.log(`${r.outcome} ${r.finding.id} (${r.finding.localStatus}, ${r.finding.observations.length} observation(s))`);
      break;
    }
    case 'capture':
    case 'lab-run':
    case 'test-run': {
      let observation: Observation;
      if (command === 'capture') {
        const caseName = positional[0];
        if (!caseName) throw new Error('Give the capture case.');
        const delta = JSON.parse(readFileSync(path.join('tools', 'corpus', 'save-protocol', 'results', caseName, 'delta.json'), 'utf8'));
        observation = observationFromCapture(delta, {
          observation: need('observation'), ...(one('tool') ? { tool: one('tool')! } : {}), ...(one('run-id') ? { runId: one('run-id')! } : {}),
          ...(one('expected') ? { expected: one('expected')! } : {}), ...(one('actual') ? { actual: one('actual')! } : {}),
          ...(one('release') ? { peopleToolsRelease: one('release')! } : {}), caseName
        });
      } else if (command === 'test-run') {
        observation = observationFromTestRun(readFileSync(need('output'), 'utf8'), {
          testFile: need('file'), peopleToolsRelease: need('release'), observation: need('observation'),
          ...(one('run-id') ? { runId: one('run-id')! } : {}), ...(one('tests') ? { only: new RegExp(one('tests')!) } : {})
        });
      } else {
        observation = observationFromLabRun(readFileSync(need('output'), 'utf8'), {
          script: need('script'), peopleToolsRelease: need('release'), observation: need('observation'),
          ...(one('tool') ? { tool: one('tool')! } : {}), ...(one('run-id') ? { runId: one('run-id')! } : {}), ...(one('tests') ? { only: new RegExp(one('tests')!) } : {})
        });
      }
      // --expect-counters "MDM=1,SYS=1": refuse unless the capture's counter steps are exactly these (DISCOVERY_PROTOCOL.md rule 7).
      if (one('expect-counters')) {
        const want = Object.fromEntries(one('expect-counters')!.split(',').map((p) => p.split('=')).map(([k, v]) => [k.trim(), Number(v)]));
        const got = observation.delta?.counters ?? {};
        const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
        const differ = keys.filter((k) => (got[k] ?? 0) !== (want[k] ?? 0));
        if (differ.length) throw new Error(`${positional[0] ?? 'the capture'}: counters ${keys.map((k) => `${k} ${got[k] ?? 0}`).join(', ')} -- expected ${one('expect-counters')}; not recorded.`);
      }
      const extra = (opts.get('evidence') ?? []).map((e) => { const [kind, ...ref] = e.split(':'); return { kind, ref: ref.join(':') }; });
      if (extra.length) observation.evidence = [...(observation.evidence ?? []), ...extra] as typeof observation.evidence;
      const facts = Object.fromEntries((opts.get('fact') ?? []).map((f) => { const i = f.indexOf('='); return [f.slice(0, i), parseValue(f.slice(i + 1))]; }));
      const input: FindingInput = {
        type: need('type') as FindingInput['type'],
        subject: { subsystem: need('subsystem') as FindingInput['subject']['subsystem'], objectType: need('object-type'),
          ...(opts.get('table') ? { tables: opts.get('table')! } : {}), ...(opts.get('property') ? { properties: opts.get('property')! } : {}) },
        assertion: { kind: need('kind'), facts },
        title: need('title'), statement: need('statement'), confidence: (one('confidence') ?? 'medium') as FindingInput['confidence'],
        source: 'research-harness', observation
      };
      const r = await store.record(input);
      console.log(`${r.outcome} ${r.finding.id} (${r.finding.localStatus}, ${r.finding.observations.length} observation(s))`);
      break;
    }
    case 'list': {
      const filter = {
        ...(one('subsystem') ? { subsystem: one('subsystem') as never } : {}), ...(one('type') ? { type: one('type') as never } : {}),
        ...(one('release') ? { release: one('release')! } : {}), ...(one('text') ? { text: one('text')! } : {})
      };
      for (const f of await store.list(filter)) {
        console.log(`${f.id}  ${f.localStatus.padEnd(10)} ${f.confidence.padEnd(6)} ${f.subsystem}/${f.type}  [${f.observedReleases.join(', ')}]  ${f.title}`);
      }
      break;
    }
    case 'get': {
      const f = await store.get(positional[0] ?? '');
      if (!f) throw new Error(`No finding ${positional[0] ?? ''} in ${root}.`);
      print(f);
      break;
    }
    default:
      console.log('Commands: record --file F | capture <case> ... | lab-run ... | test-run ... | list | get <id>  (see the comment at the top of this file)');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
