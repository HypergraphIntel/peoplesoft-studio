import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { compareBuffers } from '../peoplecode/corpus/binaryDiff.js';
import {
  normalizePeopleCodeSource,
  sourcesMatch
} from '../peoplecode/corpus/sourceNormalize.js';
import { classifyResult } from '../peoplecode/corpus/classify.js';

describe('PeopleCode corpus utilities', () => {
  describe('compareBuffers', () => {
    it('reports identical buffers as exact', () => {
      const expected = Buffer.from([
        0xa0, 0x00, 0x2d, 0x4f, 0x07
      ]);

      const actual = Buffer.from([
        0xa0, 0x00, 0x2d, 0x4f, 0x07
      ]);

      const diff = compareBuffers(expected, actual);

      assert.equal(diff.exact, true);
      assert.equal(diff.expectedLength, 5);
      assert.equal(diff.actualLength, 5);
      assert.equal(diff.firstDifference, undefined);
      assert.equal(diff.expectedWindow, undefined);
      assert.equal(diff.actualWindow, undefined);
    });

    it('finds the first differing byte', () => {
      const expected = Buffer.from([
        0xa0, 0x00, 0x2d, 0x4f, 0x44, 0x07
      ]);

      const actual = Buffer.from([
        0xa0, 0x00, 0x2d, 0x44, 0x44, 0x07
      ]);

      const diff = compareBuffers(expected, actual);

      assert.equal(diff.exact, false);
      assert.equal(diff.firstDifference, 3);
      assert.match(diff.expectedWindow ?? '', /4f/);
      assert.match(diff.actualWindow ?? '', /44/);
    });

    it('detects a length-only difference', () => {
      const expected = Buffer.from([
        0xa0, 0x00, 0x2d, 0x07
      ]);

      const actual = Buffer.from([
        0xa0, 0x00, 0x2d
      ]);

      const diff = compareBuffers(expected, actual);

      assert.equal(diff.exact, false);
      assert.equal(diff.firstDifference, 3);
      assert.equal(diff.expectedLength, 4);
      assert.equal(diff.actualLength, 3);
    });
  });

  describe('PeopleCode source normalization', () => {
    it('normalizes line endings', () => {
      const windows =
        'Local string &x;\r\n&x = "TEST";\r\n';

      const unix =
        'Local string &x;\n&x = "TEST";\n';

      assert.equal(sourcesMatch(windows, unix), true);
    });

    it('removes trailing whitespace', () => {
      const expected =
        'Local string &x;   \n&x = "TEST";\t';

      const actual =
        'Local string &x;\n&x = "TEST";';

      assert.equal(sourcesMatch(expected, actual), true);
    });

    it('does not collapse meaningful source differences', () => {
      const expected =
        '&x = &a + &b;';

      const actual =
        '&x = &a - &b;';

      assert.equal(sourcesMatch(expected, actual), false);
    });

    it('exposes normalized source', () => {
      assert.equal(
        normalizePeopleCodeSource('A  \r\nB\t\r\n'),
        'A\nB'
      );
    });
  });

  describe('classifyResult', () => {
    it('classifies a complete semantic match as exact', () => {
      assert.equal(
        classifyResult({
          decode: {
            success: true,
            normalizedSourceMatch: true
          },
          sourceEncode: {
            success: true,
            exactProgramMatch: true
          },
          semanticRoundTrip: {
            success: true,
            exactProgramMatch: true
          }
        }),
        'EXACT'
      );
    });

    it('classifies decoder failures', () => {
      assert.equal(
        classifyResult({
          decode: {
            success: false,
            error: 'decoder exploded'
          },
          sourceEncode: {
            success: false
          },
          semanticRoundTrip: {
            success: false
          }
        }),
        'DECODE_ERROR'
      );
    });

    it('recognizes unknown opcodes', () => {
      assert.equal(
        classifyResult({
          decode: {
            success: false,
            error: 'Unknown opcode 0x73 at offset 42'
          },
          sourceEncode: {
            success: false
          },
          semanticRoundTrip: {
            success: false
          }
        }),
        'UNKNOWN_OPCODE'
      );
    });

    it('recognizes unsupported encoder syntax', () => {
      assert.equal(
        classifyResult({
          decode: {
            success: true,
            normalizedSourceMatch: true
          },
          sourceEncode: {
            success: false,
            error: 'Property declarations are not supported'
          },
          semanticRoundTrip: {
            success: false
          }
        }),
        'UNSUPPORTED_SYNTAX'
      );
    });

    it('reports source mismatches independently of binary matching', () => {
      assert.equal(
        classifyResult({
          decode: {
            success: true,
            normalizedSourceMatch: false
          },
          sourceEncode: {
            success: true,
            exactProgramMatch: true
          },
          semanticRoundTrip: {
            success: true,
            exactProgramMatch: true
          }
        }),
        'DECODE_SOURCE_MISMATCH'
      );
    });

    it('does not call a partial binary result exact', () => {
      assert.equal(
        classifyResult({
          decode: {
            success: true,
            normalizedSourceMatch: true
          },
          sourceEncode: {
            success: true,
            exactProgramMatch: true
          },
          semanticRoundTrip: {
            success: true,
            exactProgramMatch: false
          }
        }),
        'UNKNOWN_MISMATCH'
      );
    });
  });
});