/*
 * Cycle 115: the PeopleTools release a snapshot's programs were compiled
 * under -- the input of `#If #ToolsRel ...` conditional compilation
 * (`src/peoplecode/conditionalCompilation.ts`). The encoder never assumes a
 * release; the corpus layer supplies it.
 *
 * `snapshot_meta.peopletools_release` when the capture recorded it. The
 * HCDEV capture did not (the column is NULL), so for that database the
 * release is the one its own stored programs prove: every one of the 231
 * directive blocks in the snapshot compiled exactly the branch 8.61 selects,
 * and no other release is consistent with all of them (`>= "8.61"` true in
 * 4 blocks, `>= "8.62"` false in 15; the patch level is not determined) --
 * `tools/corpus/research/cycle115-conditional-compilation-census.ts`.
 * Any other database without a recorded release gets none.
 */
import type Database from 'better-sqlite3';

import { getLatestCompletedSnapshot } from './store';
import type { ConditionalCompilationOptions } from '../../../src/peoplecode/conditionalCompilation';

export const HCDEV_EVIDENCED_TOOLS_RELEASE = '8.61';

export function snapshotToolsRelease(db: Database.Database): string | undefined {
  const snapshot = getLatestCompletedSnapshot(db);
  if (snapshot === undefined) return undefined;
  if (snapshot.peopleToolsRelease) return snapshot.peopleToolsRelease;
  return /(^|\/)HCDEV$/i.test(snapshot.databaseName.trim()) ? HCDEV_EVIDENCED_TOOLS_RELEASE : undefined;
}

export function snapshotConditionalCompilation(db: Database.Database): ConditionalCompilationOptions | undefined {
  const toolsRelease = snapshotToolsRelease(db);
  return toolsRelease === undefined ? undefined : { toolsRelease };
}
