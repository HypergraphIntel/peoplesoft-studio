/*
 * Cycle 175: the unattended controlled-compile orchestrator.
 *
 *   npm run controlled-compile -- --pristine <dir> --out <dir> [--all | --only SMOKE,H1,...]
 *       [--project ZZ_PCODE_LAB] [--project-arg inline|pjm] [--preflight]
 *
 * Environment:
 * - PSLAB_RELEASE: the PeopleTools release profile (default 8.61.15).
 *   The lab database's PSSTATUS must match it.
 * - run-compiler.ts: PSLAB_DB, PSLAB_OPRID, PSLAB_OPRPSWD, optional
 *   PSLAB_HOME / PSLAB_WINEPREFIX.
 * - labDb.ts capture account: PS_CONNECT_STRING, PS_USER, PS_PASSWORD.
 *
 * Per experiment (SMOKE always first; the run stops if SMOKE fails):
 *   1. reset    -- import the pristine project export (-PJFF), restoring
 *                  every ZZ_PCODE_LAB definition;
 *   2. load     -- import a copy with only this experiment's source
 *                  replaced (load-experiment.ts);
 *   3. sentinel -- capture this experiment's program before compiling,
 *                  and read the database clock;
 *   4. compile  -- one fresh pside.exe process: -CMPPRJPC <project>;
 *   5. capture  -- read back every ZZ_PCODE_LAB program (SELECT only);
 *   6. check    -- checkLabCompile: the source is the experiment's, the
 *                  program decodes to it, it differs from the sentinel,
 *                  and LASTUPDDTTM follows the compile start.
 * Then compareControlledCompile over the checked captures writes
 * report.json and report.txt.
 *
 * Nothing here writes PSPCMPROG or PSPCMNAME: only the PeopleTools
 * compiler does, inside pside.exe.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { captureLabDefinitions, databaseTimestamp, openLab } from './labDb';
import { DEFAULT_PROJECT, checkPristine, loadPack, packDefinition, prepareExperimentProject } from './load-experiment';
import { databaseMatchesRelease, releaseProfile } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import {
  CONTROLLED_COMPILE_RESULTS_FORMAT,
  captureHashes,
  checkLabCompile,
  compareControlledCompile,
  type ControlledCompileDefinition,
  type ControlledCompileResults
} from '../../../src/peoplecode/corpus/controlledCompile';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(name);

const RUN_COMPILER = path.join(__dirname, 'run-compiler.ts');

function runCompiler(args: string[]): any {
  const result = spawnSync('npx', ['tsx', RUN_COMPILER, ...args], { encoding: 'utf8', env: process.env, timeout: 15 * 60 * 1000 });
  if (result.status !== 0) throw new Error(`run-compiler ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  const report = JSON.parse(result.stdout);
  if (report.timedOut) throw new Error(`pside timed out: ${args.join(' ')}`);
  if (report.log?.signonFailed || report.log?.sqlLibraryMissing) {
    throw new Error(`pside could not sign on (${(report.log.oracleErrors ?? []).join(' ') || 'see ' + report.logFile})`);
  }
  return report;
}

async function main(): Promise<void> {
  const database = process.env.PSLAB_DB;
  const pristine = argument('--pristine');
  const out = argument('--out');
  const project = argument('--project') ?? DEFAULT_PROJECT;
  const projectArg = argument('--project-arg') ?? 'inline';
  if (database === undefined || pristine === undefined || out === undefined) {
    console.error('usage: orchestrate.ts --pristine <dir> --out <dir> [--all | --only SMOKE,H1,...] [--preflight]  (PSLAB_DB, PSLAB_OPRID, PSLAB_OPRPSWD, PS_CONNECT_STRING, PS_USER, PS_PASSWORD)');
    process.exit(2);
  }
  const pack = loadPack(argument('--experiments'));
  const profile = releaseProfile(process.env.PSLAB_RELEASE);

  /* Preflight: the pristine export covers every definition; the lab is 8.61 patch 15. */
  const problems = checkPristine(pristine, project, pack);
  if (problems.length > 0) throw new Error(`Pristine export incomplete:\n  ${problems.join('\n  ')}`);
  const probe = await openLab(database);
  try {
    if (!databaseMatchesRelease(profile, probe.toolsRelease, probe.patch)) {
      throw new Error(`Lab is PeopleTools ${probe.toolsRelease} patch ${probe.patch}; the ${profile.release} client needs ${profile.toolsRel} patch ${profile.patch}.`);
    }
  } finally {
    await probe.close();
  }
  console.log(`preflight ok: ${database} PeopleTools ${profile.release}; pristine export covers every definition`);
  if (flag('--preflight')) return;

  const ids = flag('--all') ? pack.experiments.map(e => e.id) : (argument('--only') ?? '').split(',').filter(Boolean).filter(id => id !== 'SMOKE');
  const order = [pack.smoke?.id ?? 'SMOKE', ...ids];
  fs.mkdirSync(out, { recursive: true });
  const checked: ControlledCompileDefinition[] = [];
  let support: ControlledCompileDefinition[] = [];

  for (const id of order) {
    const definition = packDefinition(pack, id);
    const runDir = path.join(out, id);
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.mkdirSync(runDir, { recursive: true });
    const record: Record<string, unknown> = { experimentId: id };
    try {
      record.reset = runCompiler(['--copy-from-file', project, '--dir', pristine]);
      const prepared = prepareExperimentProject(pristine, project, pack, id, path.join(runDir, 'project'));
      record.prepared = prepared;
      record.load = runCompiler(['--copy-from-file', project, '--dir', prepared.projectDirectory]);

      let sentinel: ControlledCompileDefinition | undefined;
      let compileStartedAt: string;
      const before = await openLab(database);
      try {
        [sentinel] = await captureLabDefinitions(before, pack, definition.key);
        compileStartedAt = await databaseTimestamp(before);
      } finally {
        await before.close();
      }
      record.sentinel = sentinel !== undefined ? { hashes: captureHashes(sentinel), compiledAt: sentinel.compiledAt } : null;

      record.compile = runCompiler(['--compile-project', project, '--project-arg', projectArg]);

      const after = await openLab(database);
      let captured: ControlledCompileDefinition[];
      try {
        captured = await captureLabDefinitions(after, pack);
      } finally {
        await after.close();
      }
      const own = captured.find(d => d.experimentId === id);
      if (own === undefined) throw new Error(`${id} has no PSPCMPROG rows after compiling.`);
      const check = checkLabCompile(own, definition.source, {
        ...(sentinel !== undefined ? { sentinelProgramHex: sentinel.programHex } : {}),
        compileStartedAt
      });
      record.capture = { ...own, hashes: captureHashes(own) };
      record.check = check;
      if (check.ok) checked.push(own);
      if (id === (pack.smoke?.id ?? 'SMOKE')) support = captured.filter(d => d.experimentId === undefined);
      console.log(`${id}: ${check.ok ? 'compiled by the lab' : `REJECTED -- ${check.reasons.join('; ')}`}`);
      if (!check.ok && id === (pack.smoke?.id ?? 'SMOKE')) {
        fs.writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
        throw new Error('SMOKE did not pass: fix the lab or the pipeline before any experiment.');
      }
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      fs.writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
      throw error;
    }
    fs.writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  }

  const lab = await openLab(database);
  const labInfo = { database: lab.database, toolsRelease: lab.toolsRelease, patch: lab.patch, capturedAt: new Date().toISOString() };
  await lab.close();
  const results: ControlledCompileResults = { format: CONTROLLED_COMPILE_RESULTS_FORMAT, lab: labInfo, definitions: [...support, ...checked] };
  fs.writeFileSync(path.join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = compareControlledCompile(results, pack);
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = report.families.map(f =>
    `family ${f.family}: observed ${f.experiments.length - f.missing.length}/${f.experiments.length}; candidates ${f.candidates.join(' ') || 'none'}; replicas not reproduced ${f.replicasNotReproduced.join(' ') || 'none'}; encoder disagrees ${f.encoderDisagrees.join(' ') || 'none'}`);
  fs.writeFileSync(path.join(out, 'report.txt'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
