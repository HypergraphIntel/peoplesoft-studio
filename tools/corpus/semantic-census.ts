/*
 * The PeopleCode semantic rules (src/peoplecode/semanticCheck.ts) over every
 * delivered program in the local HCDEV snapshot. Each rule refuses what App
 * Designer refuses, so a delivered program it flags is a false positive: the
 * expected result is 0 flagged. Read only; local snapshot only.
 *
 *   npx tsx tools/corpus/semantic-census.ts [--show N]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkPeopleCodeSemantics, describeSemanticProblems } from '../../src/peoplecode/semanticCheck';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const show = Number(process.argv[process.argv.indexOf('--show') + 1]) || 10;
const db = new Database(path.join(__dirname, 'hcdev-snapshot.sqlite'), { readonly: true });
const rows = db.prepare('select objectid1, display_name, source_text from snapshot_definition where source_text is not null').all() as
  Array<{ objectid1: number; display_name: string; source_text: string }>;

const started = Date.now();
const byCode: Record<string, number> = {};
let flagged = 0, classes = 0;
for (const r of rows) {
  const source = r.source_text.replace(/\r\n/g, '\n');
  const applicationClass = r.objectid1 === 104;
  if (applicationClass) classes++;
  const problems = checkPeopleCodeSemantics(source, { applicationClass });
  if (!problems.length) continue;
  flagged++;
  for (const p of problems) byCode[p.code] = (byCode[p.code] ?? 0) + 1;
  if (flagged <= show) console.log(`${r.display_name.replace(/, 0= /g, '')}\n  ${describeSemanticProblems(source, problems).replace(/\n/g, '\n  ')}`);
}
console.log(`${rows.length} programs (${classes} Application Classes), ${flagged} flagged ${JSON.stringify(byCode)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(flagged ? 1 : 0);
