/*
 * Cycle 175: materialize controlled-compile sources and build one
 * experiment's project file. This tool implements no compiler semantics:
 * it only moves source text.
 *
 *   npx tsx tools/corpus/controlled-compile/load-experiment.ts --materialize <dir>
 *       Writes the smoke, support and experiment sources as files, plus
 *       manifest.json (key, sha256). This is the input for the one-time
 *       bootstrap of the ZZ_PCODE_LAB project.
 *
 *   npx tsx tools/corpus/controlled-compile/load-experiment.ts \
 *       --pristine <dir> --experiment <ID|SMOKE> --out <dir> [--project ZZ_PCODE_LAB]
 *       Copies the pristine project export (`<dir>/<PROJECT>/`, written
 *       by `run-compiler.ts --copy-to-file`) and replaces only the
 *       experiment's <peoplecode_text>. The compiled blob stays the
 *       pristine compiler output, as a sentinel.
 *
 * Import the result with `run-compiler.ts --copy-from-file`, then compile
 * with `--compile-project`. orchestrate.ts does all of this per
 * experiment.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { listProjectPrograms, replaceProgramSource } from '../../../src/peoplecode/corpus/projectFile';
import type { ControlledCompileKey, ExperimentPack } from '../../../src/peoplecode/corpus/controlledCompile';

export const DEFAULT_PROJECT = 'ZZ_PCODE_LAB';
const sha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

export function loadPack(file = path.join(__dirname, 'experiments.json')): ExperimentPack {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ExperimentPack;
}

export function packDefinition(pack: ExperimentPack, id: string): { id: string; key: ControlledCompileKey; source: string } {
  if (pack.smoke !== undefined && pack.smoke.id === id) return pack.smoke;
  const experiment = pack.experiments.find(e => e.id === id);
  if (experiment === undefined) throw new Error(`No experiment ${id} in the pack.`);
  return experiment;
}

/** The project file inside a `-PJTF` export directory: <dir>/<PROJECT>/<PROJECT>.xml, any case. */
export function projectFileIn(directory: string, project: string): string {
  const folder = path.join(directory, project);
  const file = fs.existsSync(folder) ? fs.readdirSync(folder).find(name => name.toUpperCase() === `${project}.XML`) : undefined;
  if (file === undefined) throw new Error(`No ${project}.xml under ${folder}.`);
  return path.join(folder, file);
}

export interface PreparedExperiment {
  experimentId: string;
  key: ControlledCompileKey;
  sourceSha256: string;
  projectDirectory: string;
  projectFile: string;
}

export function prepareExperimentProject(pristineDir: string, project: string, pack: ExperimentPack, id: string, outDir: string): PreparedExperiment {
  const definition = packDefinition(pack, id);
  const pristineFolder = path.join(pristineDir, project);
  const targetFolder = path.join(outDir, project);
  fs.rmSync(targetFolder, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(pristineFolder, targetFolder, { recursive: true });
  const file = projectFileIn(outDir, project);
  const xml = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, replaceProgramSource(xml, definition.key, definition.source));
  return { experimentId: id, key: definition.key, sourceSha256: sha256(definition.source), projectDirectory: outDir, projectFile: file };
}

/** Every pack definition must have exactly one program in the pristine export. */
export function checkPristine(pristineDir: string, project: string, pack: ExperimentPack): string[] {
  const programs = listProjectPrograms(fs.readFileSync(projectFileIn(pristineDir, project), 'utf8'));
  const problems: string[] = [];
  const all = [...(pack.smoke ? [pack.smoke] : []), ...pack.supportDefinitions.map((s, i) => ({ id: `support#${i}`, key: s.key })), ...pack.experiments];
  for (const definition of all) {
    const count = programs.filter(p => p.key.objectIds.every((id, i) => id === Number(definition.key.objectIds[i])) &&
      p.key.objectValues.every((v, i) => v.trim().toUpperCase() === String(definition.key.objectValues[i]).trim().toUpperCase())).length;
    if (count !== 1) problems.push(`${definition.id}: ${count} programs in the pristine export`);
  }
  return problems;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const pack = loadPack(argument('--experiments'));
  const materialize = argument('--materialize');
  if (materialize !== undefined) {
    fs.mkdirSync(materialize, { recursive: true });
    const manifest: unknown[] = [];
    const write = (kind: string, id: string, key: ControlledCompileKey, source: string) => {
      const file = `${id}.pcode`;
      fs.writeFileSync(path.join(materialize, file), source);
      manifest.push({ kind, id, key, file, sha256: sha256(source) });
    };
    if (pack.smoke) write('smoke', pack.smoke.id, pack.smoke.key, pack.smoke.source);
    for (const support of pack.supportDefinitions) {
      write('support', support.key.objectValues.map(v => v.trim()).filter(v => v && v !== 'OnExecute').join('_'), support.key, support.source);
    }
    for (const experiment of pack.experiments) write('experiment', experiment.id, experiment.key, experiment.source);
    fs.writeFileSync(path.join(materialize, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${manifest.length} sources to ${materialize}`);
    return;
  }
  const pristine = argument('--pristine');
  const id = argument('--experiment');
  const out = argument('--out');
  if (pristine === undefined || id === undefined || out === undefined) {
    console.error('usage: load-experiment.ts --materialize <dir> | --pristine <dir> --experiment <ID> --out <dir> [--project <P>]');
    process.exit(2);
  }
  console.log(JSON.stringify(prepareExperimentProject(pristine, argument('--project') ?? DEFAULT_PROJECT, pack, id, out), null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
