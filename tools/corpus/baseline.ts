import fs from 'node:fs';
import path from 'node:path';

import {
  CorpusResult,
  definitionKeyString
} from './classifications';

export interface BaselineEntry {
  displayName: string;

  classification: string;

  sourceSha256?: string;
  storedSha256?: string;

  construct?: string;
}

export interface CorpusBaseline {
  version: 1;

  generatedAt: string;
  database: string;

  definitions: Record<
    string,
    BaselineEntry
  >;
}

export interface RegressionDelta {
  improved: Array<{
    key: string;
    displayName: string;
    before: string;
    after: string;
  }>;

  regressed: Array<{
    key: string;
    displayName: string;
    before: string;
    after: string;
  }>;

  unchangedFailures: Array<{
    key: string;
    displayName: string;
    classification: string;
  }>;

  newDefinitions: Array<{
    key: string;
    displayName: string;
    classification: string;
  }>;

  sourceChanged: Array<{
    key: string;
    displayName: string;
  }>;
}

export function defaultBaselinePath(): string {
  return path.resolve(
    process.cwd(),
    'tools/corpus/baselines/hcdev.json'
  );
}

export function loadBaseline(
  filename = defaultBaselinePath()
): CorpusBaseline | undefined {
  if (!fs.existsSync(filename)) {
    return undefined;
  }

  return JSON.parse(
    fs.readFileSync(filename, 'utf8')
  ) as CorpusBaseline;
}

export function createBaseline(
  database: string,
  results: CorpusResult[]
): CorpusBaseline {
  const definitions: Record<
    string,
    BaselineEntry
  > = {};

  for (const result of results) {
    const key =
      definitionKeyString(
        result.definition.key
      );

    definitions[key] = {
      displayName:
        result.definition.displayName,

      classification:
        result.classification,

      sourceSha256:
        result.sourceSha256,

      storedSha256:
        result.storedSha256,

      construct:
        result.construct
    };
  }

  return {
    version: 1,
    generatedAt:
      new Date().toISOString(),
    database,
    definitions
  };
}

export function saveBaseline(
  baseline: CorpusBaseline,
  filename = defaultBaselinePath()
): void {
  fs.mkdirSync(
    path.dirname(filename),
    { recursive: true }
  );

  fs.writeFileSync(
    filename,
    JSON.stringify(
      baseline,
      null,
      2
    ) + '\n',
    'utf8'
  );
}

export function compareAgainstBaseline(
  baseline: CorpusBaseline,
  results: CorpusResult[]
): RegressionDelta {
  const delta: RegressionDelta = {
    improved: [],
    regressed: [],
    unchangedFailures: [],
    newDefinitions: [],
    sourceChanged: []
  };

  for (const result of results) {
    const key =
      definitionKeyString(
        result.definition.key
      );

    const previous =
      baseline.definitions[key];

    if (previous === undefined) {
      delta.newDefinitions.push({
        key,
        displayName:
          result.definition.displayName,
        classification:
          result.classification
      });

      continue;
    }

    if (
      previous.sourceSha256 !== undefined &&
      result.sourceSha256 !== undefined &&
      previous.sourceSha256 !==
        result.sourceSha256
    ) {
      delta.sourceChanged.push({
        key,
        displayName:
          result.definition.displayName
      });
    }

    const before =
      previous.classification;

    const after =
      result.classification;

    if (
      before === 'EXACT' &&
      after !== 'EXACT'
    ) {
      delta.regressed.push({
        key,
        displayName:
          result.definition.displayName,
        before,
        after
      });

      continue;
    }

    if (
      before !== 'EXACT' &&
      after === 'EXACT'
    ) {
      delta.improved.push({
        key,
        displayName:
          result.definition.displayName,
        before,
        after
      });

      continue;
    }

    if (
      before !== 'EXACT' &&
      after !== 'EXACT'
    ) {
      delta.unchangedFailures.push({
        key,
        displayName:
          result.definition.displayName,
        classification: after
      });
    }
  }

  return delta;
}

export function regressionGatePassed(
  delta: RegressionDelta
): boolean {
  return delta.regressed.length === 0;
}