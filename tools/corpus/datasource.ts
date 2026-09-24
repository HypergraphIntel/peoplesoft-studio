import type {
  CorpusDefinition
} from './classifications';

import type {
  CapturedDefinition
} from './discovery';

export interface CorpusWorkItem {
  definitionId: number;
  definition: CorpusDefinition;
}

export interface CorpusDataSource {
  readonly name: string;

  capture(
    item: CorpusWorkItem
  ): Promise<CapturedDefinition>;

  close(): Promise<void>;
}