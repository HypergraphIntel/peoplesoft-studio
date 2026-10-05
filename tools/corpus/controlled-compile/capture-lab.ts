/*
 * Cycle 172 (Cycle 175: on labDb.ts): read the controlled-compile
 * experiments back from a LAB database, SELECT only, into the results
 * format (src/peoplecode/corpus/controlledCompile.ts,
 * pcode-lab-results/1).
 *
 *   PS_CONNECT_STRING=<lab alias> PS_USER=<lab capture user> PS_PASSWORD=... \
 *     npx tsx tools/corpus/controlled-compile/capture-lab.ts \
 *       --database <LAB DB_NAME> --out lab-results.json
 *       [--experiments tools/corpus/controlled-compile/experiments.json]
 *
 * Safety (labDb.ts):
 * - SELECT statements only, in a READ ONLY transaction;
 * - ZZ_PCODE_LAB% keys only;
 * - refuses institutional databases, and any DB_NAME other than
 *   `--database`.
 *
 * Compare with: npx tsx tools/corpus/compare-controlled-compile.ts --results lab-results.json
 */
import fs from 'node:fs';
import path from 'node:path';

import { captureLabDefinitions, openLab } from './labDb';
import { databaseMatchesRelease, releaseProfile } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import {
  CONTROLLED_COMPILE_RESULTS_FORMAT,
  type ControlledCompileResults,
  type ExperimentPack
} from '../../../src/peoplecode/corpus/controlledCompile';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const expectedDatabase = argument('--database');
  const out = argument('--out');
  if (expectedDatabase === undefined || out === undefined) {
    console.error('usage: capture-lab.ts --database <LAB DB_NAME> --out <results.json> [--experiments <pack.json>]');
    process.exit(2);
  }
  const pack = JSON.parse(fs.readFileSync(argument('--experiments') ?? path.join(__dirname, 'experiments.json'), 'utf8')) as ExperimentPack;

  const lab = await openLab(expectedDatabase);
  try {
    const profile = releaseProfile(process.env.PSLAB_RELEASE);
    if (!databaseMatchesRelease(profile, lab.toolsRelease, lab.patch)) {
      console.warn(`warning: the lab is PeopleTools ${lab.toolsRelease} patch ${lab.patch}, not ${profile.release} (PSLAB_RELEASE).`);
    }
    if (profile.release !== '8.61.15') console.warn(`note: ${profile.release} results are authoritative for ${profile.release} only, not for HCDEV (8.61.15).`);
    const definitions = await captureLabDefinitions(lab, pack);
    for (const d of definitions) {
      console.log(`${d.experimentId ?? 'support'} ${d.key.objectValues.map(v => v.trim()).filter(Boolean).join('.')}: ${d.programHex.length / 2} bytes, ${d.names.length} names`);
    }
    const missing = pack.experiments.filter(e => !definitions.some(d => d.experimentId === e.id)).map(e => e.id);
    if (missing.length > 0) console.warn(`not saved in the lab: ${missing.join(' ')}`);
    const results: ControlledCompileResults = {
      format: CONTROLLED_COMPILE_RESULTS_FORMAT,
      lab: { database: lab.database, toolsRelease: lab.toolsRelease, ...(Number.isFinite(lab.patch) ? { patch: lab.patch } : {}), capturedAt: new Date().toISOString() },
      definitions
    };
    fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`wrote ${definitions.length} definitions to ${out}`);
  } finally {
    await lab.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
