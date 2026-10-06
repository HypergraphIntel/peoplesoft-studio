/*
 * Cycle 172: compare controlled-compile results with the encoder and with
 * an experiment pack's candidate models. No database connection.
 *
 *   npx tsx tools/corpus/compare-controlled-compile.ts --results lab.json
 *       [--experiments tools/corpus/controlled-compile/experiments.json]
 *       [--json report.json] [--verbose] [--release 8.61]
 *   npx tsx tools/corpus/compare-controlled-compile.ts --predict
 *       the encoder's own observation per experiment (no lab data; not evidence)
 *
 * `lab.json` is what tools/corpus/controlled-compile/capture-lab.ts writes
 * (format pcode-lab-results/1): per definition the key, PSPCMTXT source,
 * PSPCMPROG bytes (hex) and PSPCMNAME rows. See
 * docs/CONTROLLED_COMPILE_LAB.md.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  compareControlledCompile,
  synthesizeResults,
  type ControlledCompileReport,
  type ControlledCompileResults,
  type ExperimentPack
} from '../../src/peoplecode/corpus/controlledCompile';

const DEFAULT_PACK = path.join(__dirname, 'controlled-compile', 'experiments.json');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(name);

function print(report: ControlledCompileReport, verbose: boolean): void {
  const lab = report.lab;
  console.log(`lab ${lab.database} PeopleTools ${lab.toolsRelease}${lab.patch !== undefined ? ` patch ${lab.patch}` : ''}${lab.capturedAt ? ` captured ${lab.capturedAt}` : ''}`);
  console.log('');
  for (const d of report.definitions) {
    const bytes = d.encode.bytes;
    const status = !d.encode.ok ? `ENCODE_ERROR ${d.encode.error}`
      : bytes?.exact && d.encode.referencesExact ? 'EXACT'
        : `bytes ${bytes?.exact ? 'exact' : `differ at ${bytes?.firstDifference}`}, references ${d.encode.referencesExact ? 'exact' : `differ at NAMENUM ${d.encode.firstReferenceDifference?.nameNum} (stored ${d.encode.firstReferenceDifference?.stored ?? '-'}, generated ${d.encode.firstReferenceDifference?.generated ?? '-'})`}`;
    console.log(`${(d.experimentId ?? 'support').padEnd(8)} ${d.keyDescription}`);
    console.log(`         encoder: ${status}${d.encode.externalMetadataFallback ? ' [external-metadata fallback]' : ''}`);
    console.log(`         decode: ${d.decode.ok ? `ok, source ${d.decode.matchesSource ? 'matches' : 'differs'}${d.decode.unknownOpcodes ? `, ${d.decode.unknownOpcodes} unknown opcodes` : ''}` : `FAILED ${d.decode.error}`}`);
    if (d.observation !== undefined) {
      const o = d.observation;
      console.log(`         observe (${o.type}): stored [${o.stored.join(', ')}] encoder [${o.generated?.join(', ') ?? '-'}]${o.encoderAgrees === false ? '  ENCODER DISAGREES' : ''}${o.replicaReproduced === false ? '  REPLICA NOT REPRODUCED' : o.replicaReproduced ? '  replica reproduced' : ''}`);
      console.log(`         models: ${Object.entries(o.models).map(([m, v]) => `${m}=${v}`).join(' ')}`);
    }
    if (verbose) {
      console.log(`         NAMENUM: ${Object.entries(d.nameNumMap).map(([n, k]) => `${n}:${k}`).join(' ')}`);
      console.log(`         first use: ${d.firstUseOrder.join(' ')}`);
      if (d.encode.generatedReferences) console.log(`         generated: ${d.encode.generatedReferences.map((k, i) => `${i + 1}:${k}`).join(' ')}`);
      if (bytes && !bytes.exact) console.log(`         stored ${bytes.expectedWindow}\n         gen    ${bytes.actualWindow}`);
    }
  }
  console.log('');
  for (const f of report.families) {
    console.log(`family ${f.family}: ${f.experiments.length - f.missing.length}/${f.experiments.length} observed${f.missing.length ? ` (missing ${f.missing.join(' ')})` : ''}`);
    for (const [model, v] of Object.entries(f.models)) {
      console.log(`  ${model.padEnd(26)} consistent [${v.consistent.join(' ')}] refuted [${v.refuted.join(' ')}]`);
    }
    console.log(`  candidates (no refutation, >= 1 positive and >= 1 control): ${f.candidates.join(' ') || 'none'}`);
    console.log(`  encoder disagrees: ${f.encoderDisagrees.join(' ') || 'none'}`);
    console.log(`  replicas not reproduced: ${f.replicasNotReproduced.join(' ') || 'none'}`);
  }
}

function main(): void {
  const pack = JSON.parse(fs.readFileSync(argument('--experiments') ?? DEFAULT_PACK, 'utf8')) as ExperimentPack;
  const resultsPath = argument('--results');
  let results: ControlledCompileResults;
  if (flag('--predict')) {
    results = synthesizeResults(pack, { database: 'ENCODER-PREDICTION', toolsRelease: argument('--release') ?? '8.61' });
  } else if (resultsPath !== undefined) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as ControlledCompileResults;
  } else {
    console.error('usage: compare-controlled-compile.ts --results <lab.json> [--experiments <pack.json>] [--json <out>] [--verbose] | --predict');
    process.exit(2);
  }
  // Cycle 184: a capture's release is its own (lab.toolsRelease -> compiler
  // profile); --release only sets the synthetic lab of --predict.
  if (resultsPath !== undefined && argument('--release') !== undefined) {
    console.error('--release applies to --predict only; a capture is compared under the profile of its own PSSTATUS release.');
    process.exit(2);
  }
  const report = compareControlledCompile(results, pack);
  const out = argument('--json');
  if (out !== undefined) fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  print(report, flag('--verbose'));
}

main();
