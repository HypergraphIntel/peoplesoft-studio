import type {
  CorpusDataSource,
  CorpusWorkItem
} from './datasource';

import type {
  CapturedDefinition
} from './discovery';

import {
  openSnapshotDatabase
} from './snapshot/store';

import {
  getSnapshotDefinition
} from './snapshot/reader';

export class LocalCorpusDataSource
  implements CorpusDataSource
{
  readonly name =
    'LOCAL SNAPSHOT';

  private readonly db =
    openSnapshotDatabase();

  async capture(
    item: CorpusWorkItem
  ): Promise<CapturedDefinition> {
    const snapshot =
      getSnapshotDefinition(
        this.db,
        item.definitionId
      );

    return {
      definition:
        item.definition,

      // Snapshot has already reconstructed the complete source/program,
      // so these represent the logical captured artifact count.
      sourceRows: 1,

      source:
        snapshot.sourceText,

      programRows: 1,

      program:
        snapshot.storedProgram,

      names:
        snapshot.names.map(
          row => ({
            NAMENUM:
              row.namenum,

            RECNAME:
              row.recname,

            REFNAME:
              row.refname,

            PACKAGEROOT:
              row.packageroot,

            QUALIFYPATH:
              row.qualifypath,

            APPCLASSMETHOD:
              row.appclassmethod
          })
        )
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}