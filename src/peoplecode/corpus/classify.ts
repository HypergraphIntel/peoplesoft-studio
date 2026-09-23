import type {
  CorpusClassification,
  DecodeResult,
  EncodeResult
} from './types.js';

export interface ClassificationInput {
  decode: DecodeResult;
  sourceEncode: EncodeResult;
  semanticRoundTrip: EncodeResult;
}

function classifyError(
  error: string | undefined
): CorpusClassification | undefined {
  if (error === undefined) {
    return undefined;
  }

  const value = error.toLowerCase();

  if (
    value.includes('unknown opcode') ||
    value.includes('unknown token')
  ) {
    return 'UNKNOWN_OPCODE';
  }

  if (
    value.includes('unsupported') ||
    value.includes('not supported')
  ) {
    return 'UNSUPPORTED_SYNTAX';
  }

  return undefined;
}

export function classifyResult(
  input: ClassificationInput
): CorpusClassification {
  if (!input.decode.success) {
    return (
      classifyError(input.decode.error) ??
      'DECODE_ERROR'
    );
  }

  if (!input.sourceEncode.success) {
    return (
      classifyError(input.sourceEncode.error) ??
      'ENCODE_ERROR'
    );
  }

  if (
    input.decode.normalizedSourceMatch === false
  ) {
    return 'DECODE_SOURCE_MISMATCH';
  }

  if (
    input.sourceEncode.exactProgramMatch === true &&
    input.semanticRoundTrip.exactProgramMatch === true
  ) {
    return 'EXACT';
  }

  return 'UNKNOWN_MISMATCH';
}