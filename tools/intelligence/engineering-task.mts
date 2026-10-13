/*
 * A finding as engineering work (docs/intelligence, phase 6): prints the
 * issue title, labels and body, and writes the regression fixture when
 * asked. It never files anything: it prints the gh command a person may run
 * after reviewing the body.
 *
 *   npx tsx tools/intelligence/engineering-task.mts <finding-id> [--store DIR] [--write-fixture]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { DiscoveryStore } from '../../src/intelligence/index';
import { engineeringTask } from '../../src/intelligence/engineering';

const args = process.argv.slice(2);
const id = args.find((a) => /^f-[0-9a-f]{24}$/.test(a));
const storeAt = args.includes('--store') ? args[args.indexOf('--store') + 1] : path.join('tools', 'intelligence', 'store');
if (!id) { console.error('Give a finding id.'); process.exit(1); }
const f = await (await new DiscoveryStore(storeAt).open()).get(id);
if (!f) { console.error(`No finding ${id} in ${storeAt}.`); process.exit(1); }
const task = engineeringTask(f);
const bodyFile = path.join('tools', 'intelligence', 'tasks', `${id}.md`);
mkdirSync(path.dirname(bodyFile), { recursive: true });
writeFileSync(bodyFile, `${task.body}\n`);
console.log(`Title:  ${task.title}\nLabels: ${task.labels.join(', ')}\nBody:   ${bodyFile}\n`);
console.log(task.body);
if (task.fixture) {
  if (args.includes('--write-fixture')) {
    if (existsSync(task.fixture.path)) console.log(`\n${task.fixture.path} exists; not overwritten.`);
    else { writeFileSync(task.fixture.path, task.fixture.text); console.log(`\nWrote ${task.fixture.path}.`); }
  } else console.log(`\nFixture: ${task.fixture.path} (--write-fixture writes it).`);
}
console.log(`\nTo file it after review (not run by this tool):\n  gh issue create --title ${JSON.stringify(task.title)} --body-file ${bodyFile} ${task.labels.map((l) => `--label ${l}`).join(' ')}`);
