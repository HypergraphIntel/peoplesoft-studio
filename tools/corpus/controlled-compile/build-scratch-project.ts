/*
 * Cycle 180: write a scratch-only, source-only shell project for one
 * experiment family, ready for a guarded `run-compiler.ts --copy-from-file`.
 *
 *   npx tsx tools/corpus/controlled-compile/build-scratch-project.ts \
 *       --templates <lab -PJTF export dir>/<P>/<P>.XML --family 30124 --project ZZ_PCODE_LAB_H --out <dir>
 *
 * The shells (package and class definitions, no source, no compiled code)
 * come from the experiment pack's keys. The family's support classes and
 * experiment classes are grouped by sub-package. The root APM lists every
 * level-1 sub-package that must exist afterwards (the pack's plus SUPPORT).
 *
 * Cycle 181: a family whose experiments are Record Field PeopleCode (the
 * G matrix, --family 10860/15598) builds the pack's labObjects instead:
 * the scratch fields, the derived / work records and one Record PeopleCode
 * shell per experiment key. Same templates file, same validation.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { buildScratchRecordProject, buildScratchShellProject, recordTemplatesFromExport, templatesFromExport, type ScratchPackageSpec } from '../../../src/peoplecode/corpus/scratchProject';
import { SCRATCH_PREFIX, assertScratchName } from '../../../src/peoplecode/corpus/labSafety';
import { loadPack } from './load-experiment';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const templates = argument('--templates'), family = argument('--family'), project = argument('--project'), out = argument('--out');
  if (!templates || !family || !project || !out) throw new Error('usage: build-scratch-project.ts --templates <export.XML> --family <family> --project <ZZ_PCODE_LAB...> --out <dir>');
  assertScratchName('project', project);
  const pack = loadPack(argument('--experiments'));
  const recordKeys = pack.experiments.filter(e => e.family === family).map(e => e.key)
    .filter(k => Number(k.objectIds[0]) === 1 && Number(k.objectIds[1]) === 2 && Number(k.objectIds[2]) === 12);
  if (recordKeys.length > 0) return writeProject(templates, project, out, recordProject(pack, project, recordKeys, fs.readFileSync(templates, 'utf8')), recordKeys.map(k => k.objectValues.slice(0, 3).join('.')));
  const keys = [...pack.supportDefinitions.map(s => s.key), ...pack.experiments.filter(e => e.family === family).map(e => e.key)]
    .filter(k => Number(k.objectIds[0]) === 104 && Number(k.objectIds[1]) === 105 && Number(k.objectIds[2]) === 107);
  if (keys.length === 0) throw new Error(`no Application Class keys for family ${family}`);
  const byPackage = new Map<string, Set<string>>();
  for (const k of keys) {
    const [root, pkg, cls] = k.objectValues.map(v => String(v).trim());
    if (root !== SCRATCH_PREFIX) throw new Error(`key root ${root} is not ${SCRATCH_PREFIX}`);
    (byPackage.get(pkg) ?? byPackage.set(pkg, new Set()).get(pkg)!).add(cls);
  }
  const create: ScratchPackageSpec[] = [...byPackage].map(([name, classes]) => ({ name, classes: [...classes] }));
  const xml = buildScratchShellProject(templatesFromExport(fs.readFileSync(templates, 'utf8')), {
    project,
    root: SCRATCH_PREFIX,
    subpackages: [...new Set(['SUPPORT', ...create.map(p => p.name)])],
    create
  });
  writeProject(templates, project, out, xml, create);
}

interface LabObjects {
  records: Array<{ name: string; type: string; fields: string[] }>;
  fields: Array<{ name: string; type: string; length: number }>;
}

function recordProject(pack: ReturnType<typeof loadPack>, project: string, keys: Array<{ objectValues: Array<string | number> }>, exportXml: string): string {
  const lab = (pack as unknown as { labObjects?: LabObjects }).labObjects;
  if (lab === undefined) throw new Error('the experiment pack has no labObjects');
  for (const r of lab.records) if (r.type !== 'Derived/Work') throw new Error(`record ${r.name}: only Derived/Work records are generated`);
  for (const f of lab.fields) if (f.type !== 'Character') throw new Error(`field ${f.name}: only Character fields are generated`);
  return buildScratchRecordProject(recordTemplatesFromExport(exportXml), {
    project,
    fields: lab.fields.map(f => ({ name: f.name, length: f.length })),
    records: lab.records.map(r => ({ name: r.name, fields: r.fields })),
    programs: keys.map(k => {
      const [record, field, event] = k.objectValues.map(v => String(v).trim());
      return { record, field, event };
    })
  });
}

function writeProject(templates: string, project: string, out: string, xml: string, contents: unknown): void {
  const dir = path.join(out, project);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${project}.XML`), xml);
  const ini = templates.replace(/\.XML$/i, '.ini');
  fs.copyFileSync(ini, path.join(dir, `${project}.ini`));
  console.log(JSON.stringify({ project, file: path.join(dir, `${project}.XML`), sha256: createHash('sha256').update(xml).digest('hex'), contents }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
