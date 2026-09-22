/**
 * Numeric operand layouts already understood by decoder.ts. Offsets are
 * relative to the operand (after the opcode); see its corpus evidence notes.
 * Signed/nonzero-prefix shapes remain unsupported. A nonzero scale is only
 * decoded for 0x50; the encoder currently writes zero-scale 0x50 integers.
 */
export interface NumberLiteralFormat {
  readonly opcode: number;
  readonly operandLength: number;
  readonly valueOffset: number;
  readonly valueBytes: number;
  readonly allowScale: boolean;
}

export const UNSIGNED_NUMBER_FORMAT: NumberLiteralFormat = Object.freeze({
  opcode: 0x50, operandLength: 18, valueOffset: 2, valueBytes: 16, allowScale: true
});

export const NUMBER_LITERAL_FORMATS: ReadonlyMap<number, NumberLiteralFormat> = new Map([
  [UNSIGNED_NUMBER_FORMAT.opcode, UNSIGNED_NUMBER_FORMAT],
  [0x11, Object.freeze({ opcode: 0x11, operandLength: 14, valueOffset: 4, valueBytes: 10, allowScale: false })]
]);
