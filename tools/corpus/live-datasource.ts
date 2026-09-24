import type oracledb from 'oracledb';

import type {
  CorpusDataSource,
  CorpusWorkItem
} from './datasource';

import type {
  CapturedDefinition
} from './discovery';

import {
  captureDefinition
} from './discovery';

export class LiveCorpusDataSource
  implements CorpusDataSource
{
  readonly name =
    'HCDEV LIVE';

  constructor(
    private readonly connection:
      oracledb.Connection
  ) {}

  async capture(
    item: CorpusWorkItem
  ): Promise<CapturedDefinition> {
    return captureDefinition(
      this.connection,
      item.definition
    );
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}