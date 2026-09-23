import {
  CorpusResult
} from './classifications';

import {
  RegressionDelta
} from './baseline';

export class CorpusReporter {
  private processed = 0;
  private exact = 0;
  private failed = 0;

  private readonly classifications =
    new Map<string, number>();

  public result(
    result: CorpusResult,
    verbose = false
  ): void {
    this.processed++;

    if (
      result.classification === 'EXACT'
    ) {
      this.exact++;
    } else {
      this.failed++;
    }

    this.classifications.set(
      result.classification,
      (
        this.classifications.get(
          result.classification
        ) ?? 0
      ) + 1
    );

    if (verbose) {
      console.log(
        `[${result.definition.offset}] ` +
        `${result.definition.displayName} ` +
        `${result.classification}`
      );

      if (
        result.firstDiffOffset !==
        undefined
      ) {
        console.log(
          `  diff: ${result.firstDiffOffset}`
        );
      }

      if (result.construct) {
        console.log(
          `  construct: ${result.construct}`
        );
      }

      if (result.errorMessage) {
        console.log(
          `  error: ${result.errorMessage}`
        );
      }
    } else if (
      this.processed % 25 === 0
    ) {
      console.log(
        `[${this.processed}] ` +
        `exact=${this.exact} ` +
        `failed=${this.failed}`
      );
    }
  }

  public summary(): void {
    console.log('');
    console.log('Summary');
    console.log('-------');

    console.log(
      `Definitions: ${this.processed}`
    );

    console.log(
      `Exact:       ${this.exact}`
    );

    console.log(
      `Failed:      ${this.failed}`
    );

    console.log('');
    console.log('Classifications');
    console.log('---------------');

    const entries =
      [...this.classifications.entries()]
        .sort(
          (a, b) =>
            b[1] - a[1]
        );

    for (
      const [classification, count]
      of entries
    ) {
      console.log(
        classification.padEnd(34) +
        count
      );
    }
  }

  public regression(
    delta: RegressionDelta
  ): void {
    console.log('');
    console.log(
      'Regression Comparison'
    );
    console.log(
      '---------------------'
    );

    console.log(
      `Improved:          ` +
      `${delta.improved.length}`
    );

    console.log(
      `Regressed:         ` +
      `${delta.regressed.length}`
    );

    console.log(
      `Unchanged failures:` +
      `${delta.unchangedFailures.length}`
    );

    console.log(
      `New definitions:   ` +
      `${delta.newDefinitions.length}`
    );

    console.log(
      `Source changed:     ` +
      `${delta.sourceChanged.length}`
    );

    if (
      delta.improved.length > 0
    ) {
      console.log('');
      console.log('Improved');
      console.log('--------');

      for (
        const item of delta.improved
      ) {
        console.log(
          `+ ${item.displayName}`
        );

        console.log(
          `  ${item.before} -> ` +
          `${item.after}`
        );
      }
    }

    if (
      delta.regressed.length > 0
    ) {
      console.log('');
      console.log('REGRESSIONS');
      console.log('-----------');

      for (
        const item of delta.regressed
      ) {
        console.log(
          `- ${item.displayName}`
        );

        console.log(
          `  ${item.before} -> ` +
          `${item.after}`
        );
      }
    }

    console.log('');

    if (
      delta.regressed.length === 0
    ) {
      console.log(
        'REGRESSION GATE: PASS'
      );
    } else {
      console.log(
        'REGRESSION GATE: FAIL'
      );
    }
  }
}