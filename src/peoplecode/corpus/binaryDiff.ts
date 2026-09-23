import type { BinaryDiff } from './types.js';

const DEFAULT_WINDOW_RADIUS = 12;

function hexWindow(
  buffer: Buffer,
  offset: number,
  radius: number
): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(buffer.length, offset + radius + 1);

  return buffer
    .subarray(start, end)
    .toString('hex')
    .match(/.{1,2}/g)
    ?.join(' ') ?? '';
}

export function compareBuffers(
  expected: Buffer,
  actual: Buffer,
  windowRadius = DEFAULT_WINDOW_RADIUS
): BinaryDiff {
  const sharedLength = Math.min(expected.length, actual.length);

  let firstDifference: number | undefined;

  for (let i = 0; i < sharedLength; i++) {
    if (expected[i] !== actual[i]) {
      firstDifference = i;
      break;
    }
  }

  if (
    firstDifference === undefined &&
    expected.length !== actual.length
  ) {
    firstDifference = sharedLength;
  }

  if (firstDifference === undefined) {
    return {
      exact: true,
      expectedLength: expected.length,
      actualLength: actual.length
    };
  }

  return {
    exact: false,
    expectedLength: expected.length,
    actualLength: actual.length,
    firstDifference,
    expectedWindow: hexWindow(
      expected,
      firstDifference,
      windowRadius
    ),
    actualWindow: hexWindow(
      actual,
      firstDifference,
      windowRadius
    )
  };
}