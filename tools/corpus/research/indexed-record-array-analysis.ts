/*
 * Cycle 45: population census for "indexed array-of-Record element,
 * row-shorthand field access" (`&arr [&i].FIELDNAME`), the construct that
 * traced 29522's true first byte divergence in Cycle 44/45. Uses the SAME
 * `validateDefinition`/`LocalCorpusDataSource` pipeline the CLI harness
 * uses, so EXACT/classification results here match `npm run corpus:harness`
 * exactly rather than an ad hoc re-implementation.
 *
 * Usage: npx tsx tools/corpus/research/indexed-record-array-analysis.ts [--json]
 */
import { openSnapshotDatabase } from '../snapshot/store';
import {
  listSnapshotDefinitionIds,
  getSnapshotDefinition,
  snapshotToCorpusDefinition
} from '../snapshot/reader';
import { LocalCorpusDataSource } from '../local-datasource';
import { validateDefinition } from '../validator';

interface CandidateRow {
  definitionId: number;
  isApplicationClass: boolean;
  arrayVariables: string[];
  occurrenceCount: number;
  classification: string;
  sourceEncodeExact: boolean;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');

  const db = openSnapshotDatabase();
  const ids = listSnapshotDefinitionIds(db);
  const dataSource = new LocalCorpusDataSource();

  const declRe = /\bLocal\s+array\s+of\s+Record\s+(&[A-Za-z0-9_]+)/gi;
  const ignoredMembers =
    /^(?:Len|Push|Pop|Delete|Sort|Insert|Clear|Fill|Shift|Unshift|CombineArray|Contains|Find|IsNew|IsDeleted|IsChanged|RowNumber)$/i;

  const rows: CandidateRow[] = [];

  for (const definitionId of ids) {
    const snapshot = getSnapshotDefinition(db, definitionId);
    const src = snapshot.sourceText;

    declRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    const vars = new Set<string>();
    while ((m = declRe.exec(src))) vars.add(m[1].toLowerCase());
    if (vars.size === 0) continue;

    let occurrenceCount = 0;
    for (const v of vars) {
      const escaped = v.replace(/[&]/g, '\\&');
      const accessRe = new RegExp(
        `${escaped}\\s*\\[[^\\]]*\\]\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`,
        'gi'
      );
      let am: RegExpExecArray | null;
      while ((am = accessRe.exec(src))) {
        if (ignoredMembers.test(am[1])) continue;
        occurrenceCount++;
      }
    }
    if (occurrenceCount === 0) continue;

    const isApplicationClass =
      /\bclass\s+[A-Za-z_]/i.test(src) && /end-class/i.test(src);

    const definition = snapshotToCorpusDefinition(snapshot, definitionId);
    const capture = await dataSource.capture({ definitionId, definition });
    const result = await validateDefinition(capture, {});

    rows.push({
      definitionId,
      isApplicationClass,
      arrayVariables: [...vars],
      occurrenceCount,
      classification: result.classification,
      sourceEncodeExact: result.classification === 'EXACT'
    });
  }

  db.close();

  const appClassCandidates = rows.filter(r => r.isApplicationClass).length;
  const ordinaryCandidates = rows.filter(r => !r.isApplicationClass).length;
  const exactCount = rows.filter(r => r.sourceEncodeExact).length;

  if (asJson) {
    console.log(JSON.stringify({ rows, summary: {
      candidateDefinitions: rows.length,
      appClassCandidates,
      ordinaryCandidates,
      exactCount,
      totalOccurrences: rows.reduce((sum, r) => sum + r.occurrenceCount, 0)
    } }, null, 2));
    return;
  }

  console.log(`Candidate definitions: ${rows.length}`);
  console.log(`Application Class:     ${appClassCandidates}`);
  console.log(`Ordinary PeopleCode:   ${ordinaryCandidates}`);
  console.log(`EXACT:                 ${exactCount}`);
  console.log('');
  for (const row of rows) {
    console.log(
      `${row.definitionId}\t` +
      `appClass=${row.isApplicationClass}\t` +
      `occurrences=${row.occurrenceCount}\t` +
      `${row.classification}`
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
