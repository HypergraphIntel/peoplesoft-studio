import crypto from 'node:crypto';

import {
  encodeProgram,
  ReferenceTraceEvent
} from '../../src/peoplecode/encoder';

import {
  decodeProgram
} from '../../src/peoplecode/decoder';

import {
  NameTable
} from '../../src/peoplecode/progtext';

import {
  compareBuffers
} from '../../src/peoplecode/corpus/binaryDiff';

import {
  sourcesMatch
} from '../../src/peoplecode/corpus/sourceNormalize';

import {
  classifyResult
} from '../../src/peoplecode/corpus/classify';

import {
  CorpusClassification,
  CorpusResult
} from './classifications';

import {
  CapturedDefinition
} from './discovery';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sourceContext(
  source: string,
  offset: number,
  radius = 80
): string | undefined {
  if (
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return undefined;
  }

  const start =
    Math.max(0, offset - radius);

  const end =
    Math.min(source.length, offset + radius);

  return source
    .slice(start, end)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function sourceAtOffset(
  source: string,
  offset: number | undefined
): string {
  if (
    offset === undefined ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= source.length
  ) {
    return '';
  }

  return source.slice(offset);
}

function failureConstruct(
  source: string,
  offset: number | undefined
): string {
  if (offset === undefined) {
    return 'UNKNOWN';
  }

  const tail =
    sourceAtOffset(source, offset);

  if (!tail) {
    return 'EOF';
  }

  if (tail.startsWith('<*')) {
    return 'DISABLED_CODE';
  }

  if (tail.startsWith('/*')) {
    return 'BLOCK_COMMENT';
  }

  if (tail.startsWith('//')) {
    return 'LINE_COMMENT';
  }

  const word =
    /^[A-Za-z_%][A-Za-z0-9_%]*/
      .exec(tail);

  if (word) {
    return word[0];
  }

  return tail.slice(0, 16);
}

function errorSourceOffset(
  error: unknown
): number | undefined {
  const message =
    errorMessage(error);

  const match =
    message.match(
      /source offset\s+(\d+)/i
    );

  if (!match) {
    return undefined;
  }

  return Number.parseInt(
    match[1],
    10
  );
}

export function sha256(
  value: Buffer | string
): string {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

export interface ValidationOptions {
  traceRefs?: boolean;
  verbose?: boolean;
}

function referenceDescription(
  event: ReferenceTraceEvent
): string {
  const reference =
    event.reference;

  const details = [
    reference.recordName,
    reference.fieldName,
    reference.packageName,
    reference.objectName,
    reference.packagePath?.join(':'),
    reference.className,
    reference.methodName
  ].filter(
    (value): value is string =>
      value !== undefined &&
      value.length > 0
  );

  return (
    `${event.action.padEnd(5)} ` +
    `#${String(reference.sequence).padStart(3)} ` +
    `idx=${String(reference.index).padStart(3)} ` +
    `group=${String(event.controlGroup).padStart(3)} ` +
    `src=${String(event.sourceOffset).padStart(5)} ` +
    `${reference.kind.padEnd(18)} ` +
    `${details.join(' | ')}`
  );
}

function makeReferenceTrace(
  phase: string,
  enabled: boolean
): ((event: ReferenceTraceEvent) => void) | undefined {
  if (!enabled) {
    return undefined;
  }

  return event => {
    console.log(
      `  REF ${phase.padEnd(9)} ` +
      referenceDescription(event)
    );
  };
}

interface InternalValidation {
  decode: {
    success: boolean;
    decodedSource?: string;
    normalizedSourceMatch?: boolean;
    error?: string;
  };

  sourceEncode: {
    success: boolean;
    exactProgramMatch?: boolean;
    generatedLength?: number;
    generatedProgram?: Buffer;
    diff?: ReturnType<typeof compareBuffers>;
    error?: string;
    errorOffset?: number;
    errorContext?: string;
    failureConstruct?: string;
  };

  semanticRoundTrip: {
    success: boolean;
    exactProgramMatch?: boolean;
    generatedLength?: number;
    generatedProgram?: Buffer;
    diff?: ReturnType<typeof compareBuffers>;
    error?: string;
    errorOffset?: number;
    errorContext?: string;
    failureConstruct?: string;
  };

  classification: string;
}


function printVerboseDiagnostics(
  capture: CapturedDefinition,
  validation: InternalValidation
): void {
  console.log('');
  console.log('  ----- VERBOSE SOURCE -----');
  console.log(capture.source);

  console.log('  ----- VERBOSE PSPCMPROG HEX -----');
  console.log(
    capture.program
      .toString('hex')
      .match(/.{1,2}/g)
      ?.join(' ') ?? ''
  );

  console.log('  ----- VERBOSE DECODED SOURCE -----');
  console.log(
    validation.decode.decodedSource ??
    `decode unavailable: ${validation.decode.error ?? 'unknown error'}`
  );

  console.log('  ----- PSPCMNAME -----');
  console.dir(capture.names, {
    depth: null,
    colors: false,
    maxArrayLength: null
  });

  console.log('  ----- VALIDATION DETAIL -----');

  console.log(
    `  decode    ${
      validation.decode.success
        ? validation.decode.normalizedSourceMatch
          ? 'SOURCE MATCH'
          : 'SOURCE MISMATCH'
        : `ERROR: ${validation.decode.error ?? 'unknown error'}`
    }`
  );

  console.log(
    `  source→bin ${
      validation.sourceEncode.success
        ? validation.sourceEncode.exactProgramMatch
          ? 'EXACT'
          : `MISMATCH @ ${validation.sourceEncode.diff?.firstDifference}`
        : `ERROR: ${validation.sourceEncode.error ?? 'unknown error'}`
    }`
  );

  if (
    validation.sourceEncode.success &&
    !validation.sourceEncode.exactProgramMatch &&
    validation.sourceEncode.diff
  ) {
    const diff =
      validation.sourceEncode.diff;

    console.log(
      `  bin sizes  stored=${diff.expectedLength} generated=${diff.actualLength}`
    );

    if (diff.expectedWindow) {
      console.log(
        `  stored bin ${diff.expectedWindow}`
      );
    }

    if (diff.actualWindow) {
      console.log(
        `  gen bin    ${diff.actualWindow}`
      );
    }

    if (
      diff.bodyFirstDifference !== undefined
    ) {
      console.log(
        `  body diff  @ ${diff.bodyFirstDifference}`
      );

      if (diff.bodyExpectedWindow) {
        console.log(
          `  stored body ${diff.bodyExpectedWindow}`
        );
      }

      if (diff.bodyActualWindow) {
        console.log(
          `  gen body    ${diff.bodyActualWindow}`
        );
      }
    }
  }

  if (
    validation.sourceEncode.errorOffset !== undefined
  ) {
    console.log(
      `  source off ${validation.sourceEncode.errorOffset}`
    );
  }

  if (
    validation.sourceEncode.errorContext
  ) {
    console.log(
      `  source ctx ${validation.sourceEncode.errorContext}`
    );
  }

  if (
    validation.sourceEncode.failureConstruct
  ) {
    console.log(
      `  construct  ${validation.sourceEncode.failureConstruct}`
    );
  }

  console.log(
    `  roundtrip ${
      validation.semanticRoundTrip.success
        ? validation.semanticRoundTrip.exactProgramMatch
          ? 'EXACT'
          : `MISMATCH @ ${validation.semanticRoundTrip.diff?.firstDifference}`
        : validation.semanticRoundTrip.error
          ? `ERROR: ${validation.semanticRoundTrip.error}`
          : 'NOT ATTEMPTED'
    }`
  );

  if (
    validation.semanticRoundTrip.success &&
    !validation.semanticRoundTrip.exactProgramMatch &&
    validation.semanticRoundTrip.diff
  ) {
    const diff =
      validation.semanticRoundTrip.diff;

    console.log(
      `  rt sizes   stored=${diff.expectedLength} generated=${diff.actualLength}`
    );

    if (diff.expectedWindow) {
      console.log(
        `  stored rt  ${diff.expectedWindow}`
      );
    }

    if (diff.actualWindow) {
      console.log(
        `  gen rt     ${diff.actualWindow}`
      );
    }

    if (
      diff.bodyFirstDifference !== undefined
    ) {
      console.log(
        `  rt body diff @ ${diff.bodyFirstDifference}`
      );

      if (diff.bodyExpectedWindow) {
        console.log(
          `  stored body ${diff.bodyExpectedWindow}`
        );
      }

      if (diff.bodyActualWindow) {
        console.log(
          `  gen body    ${diff.bodyActualWindow}`
        );
      }
    }
  }

  if (
    validation.semanticRoundTrip.errorOffset !== undefined
  ) {
    console.log(
      `  decode off ${validation.semanticRoundTrip.errorOffset}`
    );
  }

  if (
    validation.semanticRoundTrip.errorContext
  ) {
    console.log(
      `  decode ctx ${validation.semanticRoundTrip.errorContext}`
    );
  }

  if (
    validation.semanticRoundTrip.failureConstruct
  ) {
    console.log(
      `  rt construct ${validation.semanticRoundTrip.failureConstruct}`
    );
  }

  console.log(
    `  result     ${validation.classification}`
  );
}

function runValidation(
  capture: CapturedDefinition,
  options: ValidationOptions = {}
): InternalValidation {
  const encodeContext = {
    owner: {
      recordName:
        capture.definition.key.objectValue1.trim(),

      fieldName:
        capture.definition.key.objectValue2.trim()
    }
  };

  const sourceTrace =
    makeReferenceTrace(
      'SOURCE',
      options.traceRefs === true
    );

  const roundTripTrace =
    makeReferenceTrace(
      'ROUNDTRIP',
      options.traceRefs === true
    );

  const decode: InternalValidation['decode'] = {
    success: false
  };

  const sourceEncode:
    InternalValidation['sourceEncode'] = {
      success: false
    };

  const semanticRoundTrip:
    InternalValidation['semanticRoundTrip'] = {
      success: false
    };

  /*
   * TEST A
   *
   * PSPCMTXT -> encoder -> PSPCMPROG
   */
  try {
    const encoded =
      encodeProgram(
        capture.source,
        {
          ...encodeContext,
          referenceTrace:
            sourceTrace
        }
      );

    const diff =
      compareBuffers(
        capture.program,
        encoded
      );

    const bodyDiff =
      compareBuffers(
        capture.program.subarray(37),
        encoded.subarray(37)
      );

    if (!bodyDiff.exact) {
      diff.bodyFirstDifference =
        bodyDiff.firstDifference === undefined
          ? undefined
          : bodyDiff.firstDifference + 37;

      diff.bodyExpectedWindow =
        bodyDiff.expectedWindow;

      diff.bodyActualWindow =
        bodyDiff.actualWindow;
    }

    sourceEncode.success = true;
    sourceEncode.exactProgramMatch =
      diff.exact;
    sourceEncode.generatedLength =
      encoded.length;
    sourceEncode.generatedProgram =
      encoded;
    sourceEncode.diff =
      diff;
  } catch (error) {
    sourceEncode.error =
      errorMessage(error);

    const offset =
      errorSourceOffset(error);

    if (offset !== undefined) {
      sourceEncode.errorOffset =
        offset;

      sourceEncode.errorContext =
        sourceContext(
          capture.source,
          offset
        );
    }

    sourceEncode.failureConstruct =
      failureConstruct(
        capture.source,
        offset
      );
  }

  /*
   * Decode the real PeopleTools program.
   */
  let decodedSource: string | undefined;
  let decodedCommentOpcodes:
    number[] | undefined;

  try {
    const names =
      new NameTable();

    for (const row of capture.names) {
      const recname =
        String(
          row.RECNAME ?? ''
        ).trim();

      const refname =
        String(
          row.REFNAME ?? ''
        ).trim();

      let name: string;

      if (recname && refname) {
        name =
          `${recname}.${refname}`;
      } else if (refname) {
        name =
          refname;
      } else {
        name =
          recname;
      }

      names.add(
        Number(row.NAMENUM),
        name
      );
    }

    const decoded =
      decodeProgram(
        capture.program,
        names,
        {
          mode: 'auto'
        }
      );

    decodedSource =
      decoded.text;

    decodedCommentOpcodes =
      decoded.tokens
        .map(token => token.opcode)
        .filter(
          opcode =>
            opcode === 0x24 ||
            opcode === 0x4e
        );

    decode.success = true;
    decode.decodedSource =
      decodedSource;

    decode.normalizedSourceMatch =
      sourcesMatch(
        capture.source,
        decodedSource
      );
  } catch (error) {
    decode.error =
      errorMessage(error);
  }

  /*
   * TEST B
   *
   * PSPCMPROG -> decoder -> PeopleCode
   *            -> encoder -> PSPCMPROG
   */
  if (decodedSource !== undefined) {
    try {
      const encoded =
        encodeProgram(
          decodedSource,
          {
            ...encodeContext,
            commentOpcodes:
              decodedCommentOpcodes,
            referenceTrace:
              roundTripTrace
          }
        );

      const diff =
        compareBuffers(
          capture.program,
          encoded
        );

      const bodyDiff =
        compareBuffers(
          capture.program.subarray(37),
          encoded.subarray(37)
        );

      if (!bodyDiff.exact) {
        diff.bodyFirstDifference =
          bodyDiff.firstDifference === undefined
            ? undefined
            : bodyDiff.firstDifference + 37;

        diff.bodyExpectedWindow =
          bodyDiff.expectedWindow;

        diff.bodyActualWindow =
          bodyDiff.actualWindow;
      }

      semanticRoundTrip.success =
        true;

      semanticRoundTrip.exactProgramMatch =
        diff.exact;

      semanticRoundTrip.generatedLength =
        encoded.length;

      semanticRoundTrip.generatedProgram =
        encoded;

      semanticRoundTrip.diff =
        diff;
    } catch (error) {
      semanticRoundTrip.error =
        errorMessage(error);

      const offset =
        errorSourceOffset(error);

      if (offset !== undefined) {
        semanticRoundTrip.errorOffset =
          offset;

        semanticRoundTrip.errorContext =
          sourceContext(
            decodedSource,
            offset
          );
      }

      semanticRoundTrip.failureConstruct =
        failureConstruct(
          decodedSource,
          offset
        );
    }
  }

  const classification =
    classifyResult({
      decode,
      sourceEncode,
      semanticRoundTrip
    });

  return {
    decode,
    sourceEncode,
    semanticRoundTrip,
    classification
  };
}

export async function validateDefinition(
  capture: CapturedDefinition,
  options: ValidationOptions = {}
): Promise<CorpusResult> {
  const validation =
    runValidation(
      capture,
      options
    );

  if (options.verbose) {
    printVerboseDiagnostics(
      capture,
      validation
    );
  }

  const sourceDiff =
    validation.sourceEncode.diff;

  const roundTripDiff =
    validation.semanticRoundTrip.diff;

  const primaryDiff =
    sourceDiff ?? roundTripDiff;

  const generatedProgram =
    validation.sourceEncode.generatedProgram;

  const error =
    validation.sourceEncode.error ??
    validation.semanticRoundTrip.error ??
    validation.decode.error;

  const construct =
    validation.sourceEncode.failureConstruct ??
    validation.semanticRoundTrip.failureConstruct;

  return {
    definition:
      capture.definition,

    sourceChars:
      capture.source.length,

    sourceSha256:
      sha256(capture.source),

    storedProgramBytes:
      capture.program.length,

    generatedProgramBytes:
      validation.sourceEncode.generatedLength,

    pscmnameRows:
      capture.names.length,

    decodeSuccess:
      validation.decode.success,

    sourceMatch:
      validation.decode.normalizedSourceMatch === true,

    sourceEncodeSuccess:
      validation.sourceEncode.success,

    sourceEncodeExact:
      validation.sourceEncode.exactProgramMatch === true,

    roundtripSuccess:
      validation.semanticRoundTrip.success,

    roundtripExact:
      validation.semanticRoundTrip.exactProgramMatch === true,

    classification:
      validation.classification as CorpusClassification,

    firstDiffOffset:
      primaryDiff?.firstDifference,

    construct,
    errorMessage:
      error,

    storedSha256:
      sha256(capture.program),

    generatedSha256:
      generatedProgram
        ? sha256(generatedProgram)
        : undefined,

    storedDiffHex:
      primaryDiff?.expectedWindow,

    generatedDiffHex:
      primaryDiff?.actualWindow
  };
}
